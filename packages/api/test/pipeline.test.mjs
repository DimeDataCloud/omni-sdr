// GET …/pipeline?since: server-side funnel counts. The seeded rows are moved into a fixed 2020 window with known
// edges, so every expected number below is counted by hand, not by running the route's own SQL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';

let api;
before(async () => {
  api = await startApi();
  const q = api.q;
  const at = (d) => `${d}T12:00:00Z`;
  // Window under test: [2020-01-10, 2020-01-20). A row at exactly 2020-01-20T00:00:00Z belongs to the NEXT window.
  const IN = at('2020-01-12'), EDGE_START = '2020-01-10T00:00:00Z', EDGE_END = '2020-01-20T00:00:00Z', BEFORE = at('2020-01-09');

  // contacts (6 seeded): 4 in the window, 1 before it, 1 exactly at the end.
  const cs = await q(`SELECT id FROM contacts ORDER BY id`);
  for (const [i, c] of cs.entries()) {
    await q(`UPDATE contacts SET created_at = $2 WHERE id = $1`, [c.id, [IN, IN, IN, EDGE_START, BEFORE, EDGE_END][i]]);
  }

  // drafts (11 seeded: 3 approved, 1 blocked, 7 review, all with an agent). Window drafts: 9. Out: one before, one at the end.
  const ds = await q(`SELECT id, status FROM drafts ORDER BY status, id`);   // approved x3, blocked x1, review x7
  const approved = ds.filter((d) => d.status === 'approved'), review = ds.filter((d) => d.status === 'review');
  await q(`UPDATE drafts SET created_at = $1`, [IN]);
  await q(`UPDATE drafts SET created_at = $2 WHERE id = $1`, [review[0].id, BEFORE]);
  await q(`UPDATE drafts SET created_at = $2 WHERE id = $1`, [review[1].id, EDGE_END]);
  // approved_at: two in the window (one exactly at its start), one at its end (excluded). approved_at is independent of created_at.
  await q(`UPDATE drafts SET approved_at = $2 WHERE id = $1`, [approved[0].id, at('2020-01-15')]);
  await q(`UPDATE drafts SET approved_at = $2 WHERE id = $1`, [approved[1].id, EDGE_START]);
  await q(`UPDATE drafts SET approved_at = $2 WHERE id = $1`, [approved[2].id, EDGE_END]);
  // one window draft with no agent: counted in `drafted`, not in byAgent. One out-of-window draft is being written right now.
  await q(`UPDATE drafts SET agent_id = NULL WHERE id = $1`, [review[2].id]);
  await q(`UPDATE drafts SET status = 'generating' WHERE id = $1`, [review[0].id]);

  // messages (3 seeded, all sent): two in the window, one exactly at the end.
  const ms = await q(`SELECT id FROM messages ORDER BY id`);
  for (const [i, m] of ms.entries()) await q(`UPDATE messages SET sent_at = $2 WHERE id = $1`, [m.id, [IN, EDGE_START, EDGE_END][i]]);

  // inbound (3 seeded: unsubscribe, question, meeting_request) all in the window; add what must be excluded or counted specially.
  await q(`UPDATE inbound_messages SET received_at = $1`, [IN]);
  const base = (await q(`SELECT org_id, workspace_id, contact_id FROM inbound_messages LIMIT 1`))[0];
  for (const [intent, when] of [['bounce', IN], ['out_of_office', IN], ['unclassified', IN], ['not_interested', IN], ['unsubscribe', BEFORE], ['meeting_request', EDGE_END]]) {
    await q(`INSERT INTO inbound_messages (org_id, workspace_id, contact_id, channel, from_address, body, received_at, intent)
             VALUES ($1, $2, $3, 'form', 'x@example.test', 'b', $4, $5)`, [base.org_id, base.workspace_id, base.contact_id, when, intent]);
  }

  // meeting (1 seeded, booked): created in the window.
  await q(`UPDATE meetings SET created_at = $1`, [IN]);
});
after(async () => { await api.stop(); });

const WIN = 'since=2020-01-10T00:00:00Z&until=2020-01-20T00:00:00Z';

test('every number matches a hand count, with since inclusive and until exclusive', async () => {
  const r = await api.call('GET', `${api.W}/pipeline?${WIN}`);
  assert.equal(r.status, 200, r.text);
  const b = r.body;
  assert.equal(b.since, '2020-01-10T00:00:00.000Z');
  assert.equal(b.until, '2020-01-20T00:00:00.000Z');
  assert.equal(b.found, 4);              // 6 contacts: 4 inside, one before, one exactly at until
  assert.equal(b.drafted, 9);            // 11 drafts: 9 inside
  assert.equal(b.blocked, 1);            // the one blocked draft is inside
  assert.equal(b.waiting, 5);            // 7 in review, minus the one moved before the window (now 'generating') and the one at until
  assert.equal(b.approved, 2);           // approved_at: one inside, one exactly at since; the third at until is out
  assert.equal(b.sent, 2);
  assert.equal(b.replies, 5);            // question, meeting_request, unsubscribe (seed) + unclassified + not_interested; bounce and out_of_office excluded; the two extra rows outside the window excluded
  assert.equal(b.meetingRequests, 1);
  assert.equal(b.optOuts, 1);            // the seeded unsubscribe only: not_interested is a reply, not an opt-out; the extra unsubscribe is before the window
  assert.equal(b.booked, 1);
  assert.deepEqual(b.live, { drafting: 1, classifying: 1 });
});

test('byAgent: most drafts first, drafts without an agent are left out (so the sum can be below drafted)', async () => {
  const b = (await api.call('GET', `${api.W}/pipeline?${WIN}`)).body;
  assert.equal(b.drafted, 9);
  assert.equal(b.byAgent.length, 1);
  assert.equal(b.byAgent[0].name, 'Sales Outbound');
  assert.equal(b.byAgent[0].drafted, 8);
  assert.match(b.byAgent[0].agentId, /^[0-9a-f-]{36}$/);
});

test('a canceled meeting is not booked', async () => {
  await api.q(`UPDATE meetings SET status = 'canceled'`);
  assert.equal((await api.call('GET', `${api.W}/pipeline?${WIN}`)).body.booked, 0);
  await api.q(`UPDATE meetings SET status = 'booked'`);
});

test('another workspace of the same org sees none of it', async () => {
  const b = (await api.call('GET', `${api.ws(1)}/pipeline?${WIN}`)).body;
  for (const k of ['found', 'drafted', 'waiting', 'blocked', 'approved', 'sent', 'replies', 'meetingRequests', 'optOuts', 'booked']) assert.equal(b[k], 0, k);
  assert.deepEqual(b.byAgent, []);
  assert.deepEqual(b.live, { drafting: 0, classifying: 0 });
});

test('the window is checked: missing, malformed, backwards, empty and over-long are 400, never zeros', async () => {
  for (const qs of ['', 'since=nope', 'since=2020-01-10T00:00:00Z&until=nope', 'since=2020-01-20T00:00:00Z&until=2020-01-10T00:00:00Z',
    'since=2020-01-10T00:00:00Z&until=2020-01-10T00:00:00Z', 'since=2020-01-01T00:00:00Z&until=2020-06-01T00:00:00Z']) {
    const r = await api.call('GET', `${api.W}/pipeline?${qs}`);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.found, undefined, qs);
  }
  assert.equal((await api.call('GET', `${api.W}/pipeline?since=2020-01-01T00:00:00Z&until=2020-03-31T00:00:00Z`)).status, 200);   // 90 days exactly
});

test('without until the window ends now', async () => {
  const since = new Date(Date.now() - 86400000).toISOString();
  const r = await api.call('GET', `${api.W}/pipeline?since=${since}`);
  assert.equal(r.status, 200);
  assert.ok(Date.parse(r.body.until) >= Date.parse(since));
  assert.ok(Math.abs(Date.parse(r.body.until) - Date.now()) < 60000);
});

test('access follows /analytics: signed-in team and client_viewer read it, a stranger and no token do not', async () => {
  for (const as of ['maya@example.com', 'sam@example.com', 'riley@example.com', 'client@example.com']) {
    assert.equal((await api.call('GET', `${api.W}/pipeline?${WIN}`, { as })).status, 200, as);
    assert.equal((await api.call('GET', `${api.W}/analytics`, { as })).status, 200, `analytics ${as}`);
  }
  assert.equal((await api.call('GET', `${api.W}/pipeline?${WIN}`, { as: null })).status, 401);
  assert.equal((await api.call('GET', `${api.W}/pipeline?${WIN}`, { as: 'stranger@example.com' })).status, 403);
});

test('counts only: no address, body or name of a person anywhere in the response', async () => {
  const r = await api.call('GET', `${api.W}/pipeline?${WIN}`);
  assert.ok(!/@|example\.test|crescent|aisha/i.test(r.text.replace(/maya@/g, '')), r.text);
});
