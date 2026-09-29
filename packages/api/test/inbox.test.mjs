// Replies in (signed hook → classify → safe-side effects), the inbox screen, meetings, and unsubscribe.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startApi } from './helpers.mjs';
import { classifyReply, addBusinessMinutes } from '../src/services/inbox.mjs';
import { sendDraft } from '../../sender/src/send.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// Approve this contact's first touch and send it through the real sender with a capture adapter; returns the
// Reply-To address the prospect would answer.
async function sentTo(email) {
  const [d] = await api.q(`SELECT d.id, d.status FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN contacts c ON c.id = e.contact_id
    WHERE c.email = $1 AND d.step = 0 AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.draft_id = d.id)`, [email]);
  if (d.status === 'review') assert.equal((await api.call('POST', `${api.W}/approvals/${d.id}/approve`)).status, 200);
  let raw = '';
  const out = await sendDraft(api.db, { orgId: api.demo.org, workspaceId: api.demo.workspaces[0], draftId: d.id, mailboxId: api.demo.mailbox,
    adapter: { async send(m) { raw = m.raw; return { providerMessageId: 'test' }; } },
    urls: { unsubscribeBase: 'https://app.test', replyDomain: 'reply.omnisdr.com' } });
  assert.equal(out.outcome, 'sent', out.reason);
  return { to: /^Reply-To: (.+)$/mi.exec(raw)[1].trim() };
}

test('classifier: the safest reading wins; nothing is ever ≥0.8 from rules alone', () => {
  const cases = [
    ['Not interested, please remove me from your list', 'unsubscribe'],
    ['STOP', 'unsubscribe'],
    ['I am out of the office until Monday', 'out_of_office'],
    ['Can we schedule a call next week?', 'meeting_request'],
    ['No thanks, we are all set', 'not_interested'],
    ['I\'m no longer with the company', 'wrong_person'],
    ['How much does it cost?', 'question'],
    ['Sounds good', 'unclassified'],
  ];
  for (const [text, want] of cases) assert.equal(classifyReply({ body: text }).intent, want, text);
  assert.equal(classifyReply({ body: 'x', from: 'MAILER-DAEMON@mx.example' }).intent, 'bounce');
  for (const [text] of cases) {
    const c = classifyReply({ body: text }).confidence;
    assert.ok(c === null || c < 0.8, `${text} would skip the human`);
  }
});

test('SLA: 2 business hours in the workspace time zone, skipping nights and weekends', () => {
  const tz = 'America/Chicago';
  // Tue 2026-09-29 10:00 CDT (15:00Z) → 12:00 CDT
  assert.equal(addBusinessMinutes(new Date('2026-09-29T15:00:00Z'), 120, tz).toISOString(), '2026-09-29T17:00:00.000Z');
  // Fri 2026-10-02 16:30 CDT (21:30Z) → 30 min Friday + 90 min Monday → Mon 10:30 CDT (15:30Z)
  assert.equal(addBusinessMinutes(new Date('2026-10-02T21:30:00Z'), 120, tz).toISOString(), '2026-10-05T15:30:00.000Z');
  // Sat → Mon 11:00 CDT
  assert.equal(addBusinessMinutes(new Date('2026-10-03T15:00:00Z'), 120, tz).toISOString(), '2026-10-05T16:00:00.000Z');
  // Across the DST change (Sun 2026-11-01): Fri 16:00 CDT → Mon 10:00 CST = 16:00Z
  assert.equal(addBusinessMinutes(new Date('2026-10-30T21:00:00Z'), 120, tz).toISOString(), '2026-11-02T16:00:00.000Z');
});

test('internal hook: 404 unless configured, 401 on a bad or stale signature', async () => {
  const payload = { to: 'r+abcdefabcdefabcdef@reply.omnisdr.com', body: 'hi', receivedAt: new Date().toISOString() };
  assert.equal((await api.signedInbound(payload, { secret: 'wrong' })).status, 401);
  assert.equal((await api.signedInbound(payload, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
  assert.equal((await api.call('POST', '/internal/inbound', { as: null, body: payload })).status, 401);
  // A session token is not a substitute for the signature.
  assert.equal((await api.call('POST', '/internal/inbound', { body: payload })).status, 401);
  const unmatched = await api.signedInbound(payload);
  assert.deepEqual([unmatched.status, unmatched.body.outcome], [200, 'unmatched']);
});

test('a meeting request lands with an SLA; the sequence stops; a retry is a duplicate', async () => {
  const { to } = await sentTo('tom@maplegrove-dental.example');
  const payload = { to, from: 'tom@maplegrove-dental.example', subject: 'Re: Hold times', body: 'Could we set up a call Thursday?',
    receivedAt: new Date().toISOString(), externalId: '<m1@maplegrove.example>' };
  const r = await api.signedInbound(payload);
  assert.equal(r.body.outcome, 'recorded');
  const [row] = await api.q(`SELECT intent, sla_due_at FROM inbound_messages WHERE id = $1`, [r.body.id]);
  assert.equal(row.intent, 'meeting_request');
  assert.ok(row.sla_due_at > new Date());
  const [e] = await api.q(`SELECT e.state, e.stop_reason FROM enrollments e JOIN contacts c ON c.id = e.contact_id WHERE c.email = $1`,
    ['tom@maplegrove-dental.example']);
  assert.deepEqual(e, { state: 'stopped', stop_reason: 'reply:meeting_request' });
  const again = await api.signedInbound(payload);
  assert.deepEqual([again.body.outcome, again.body.id], ['duplicate', r.body.id]);
});

test('an opt-out reply suppresses the address in the same transaction; an out-of-office does not stop anything', async () => {
  const email = 'aisha@crescent-ortho.example';
  await api.q(`UPDATE enrollments SET state = 'waiting', stop_reason = NULL
    WHERE contact_id = (SELECT id FROM contacts WHERE email = $1)`, [email]);
  const thread = await sentTo(email);
  const ooo = await api.signedInbound({ ...thread, body: 'I am out of the office until Monday.', receivedAt: new Date().toISOString() });
  assert.equal(ooo.body.outcome, 'recorded');
  const [live] = await api.q(`SELECT state FROM enrollments WHERE contact_id = (SELECT id FROM contacts WHERE email = $1)`, [email]);
  assert.equal(live.state, 'waiting');
  const out = await api.signedInbound({ ...thread, body: 'Please unsubscribe me.', receivedAt: new Date().toISOString() });
  assert.equal(out.body.outcome, 'recorded');
  const sup = await api.q(`SELECT reason FROM suppression WHERE value_hash = value_hash($1) AND scope_org_id = $2`, [email, api.demo.org]);
  assert.deepEqual(sup.map((s) => s.reason), ['reply_unsubscribe']);
  const [stopped] = await api.q(`SELECT state FROM enrollments WHERE contact_id = (SELECT id FROM contacts WHERE email = $1)`, [email]);
  assert.equal(stopped.state, 'stopped');
});

test('inbox screen: open replies first by SLA, needs-a-human flag, handle once', async () => {
  const r = await api.call('GET', `${api.W}/inbox`);
  assert.equal(r.status, 200);
  const first = r.body.items[0];
  assert.equal(first.intent, 'meeting_request');
  assert.equal(typeof first.slaMinutesRemaining, 'number');
  assert.ok(r.body.items.every((x) => x.needsHuman === true));
  const target = r.body.items.find((x) => x.intent === 'question');
  assert.equal((await api.call('POST', `${api.W}/inbox/${target.id}/handle`, { as: 'client@example.com' })).status, 403);
  assert.equal((await api.call('POST', `${api.W}/inbox/${target.id}/handle`, { as: 'sam@example.com' })).status, 200);
  assert.equal((await api.call('POST', `${api.W}/inbox/${target.id}/handle`)).status, 409);
  const open = (await api.call('GET', `${api.W}/inbox`)).body.items.map((x) => x.id);
  assert.ok(!open.includes(target.id));
});

test('book from a reply: meeting created, reply handled, the contact\'s sequence converted, https links only', async () => {
  const reply = (await api.call('GET', `${api.W}/inbox`)).body.items.find((x) => x.intent === 'meeting_request');
  const start = new Date(Date.now() + 2 * 86400e3);
  const bad = await api.call('POST', `${api.W}/inbox/${reply.id}/meeting`, { body: {
    startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 1800e3).toISOString(), meetUrl: 'javascript:alert(1)' } });
  assert.equal(bad.status, 400);
  const backwards = await api.call('POST', `${api.W}/inbox/${reply.id}/meeting`, { body: {
    startsAt: start.toISOString(), endsAt: new Date(start.getTime() - 1800e3).toISOString() } });
  assert.equal(backwards.status, 409);
  const ok = await api.call('POST', `${api.W}/inbox/${reply.id}/meeting`, { body: {
    startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 1800e3).toISOString(), meetUrl: 'https://meet.google.com/abc-defg-hij' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const [rep] = await api.q(`SELECT handled_at FROM inbound_messages WHERE id = $1`, [reply.id]);
  assert.ok(rep.handled_at);
  const meetings = (await api.call('GET', `${api.W}/meetings`)).body.items;
  assert.ok(meetings.some((x) => x.id === ok.body.id && x.contactName));
  const [e] = await api.q(`SELECT state FROM enrollments WHERE contact_id = $1`, [reply.contactId]);
  assert.equal(e.state, 'converted');
  assert.equal((await api.call('PATCH', `${api.W}/meetings/${ok.body.id}`, { body: { status: 'no_show' } })).body.status, 'no_show');
});

test('unsubscribe: GET only shows the button; POST suppresses; unknown and reused tokens look identical', async () => {
  const token = 'U'.repeat(32);
  const [c] = await api.q(`SELECT id, email FROM contacts WHERE email = 'priya@eastside-smiles.example'`);
  await api.q(`INSERT INTO unsubscribe_tokens (token_hash, org_id, workspace_id, contact_id) VALUES ($1, $2, $3, $4)`,
    [sha(token), api.demo.org, api.demo.workspaces[0], c.id]);
  await api.q(`DELETE FROM suppression WHERE value_hash = value_hash($1)`, [c.email]);
  const page = await api.call('GET', `/u/${token}`, { as: null });
  assert.equal(page.status, 200);
  assert.match(page.text, /<form method="post"/);
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM suppression WHERE value_hash = value_hash($1)`, [c.email]))[0].n, 0,
    'a GET (link scanner) must not unsubscribe');
  const post = await api.call('POST', `/u/${token}`, { as: null, raw: 'List-Unsubscribe=One-Click',
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(post.status, 200);
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM suppression WHERE value_hash = value_hash($1)`, [c.email]))[0].n, 1);
  const reused = await api.call('POST', `/u/${token}`, { as: null, raw: '' });
  const unknown = await api.call('POST', `/u/${'Z'.repeat(32)}`, { as: null, raw: '' });
  const junk = await api.call('POST', `/u/%3Cscript%3E`, { as: null, raw: '' });
  assert.deepEqual([reused.status, unknown.status, junk.status], [200, 200, 200]);
  assert.equal(reused.text, unknown.text);
  assert.equal(unknown.text, junk.text);
  assert.doesNotMatch(junk.text, /<script>/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.ok(api.logs.every((l) => !String(l.path ?? '').includes(token)), 'unsubscribe tokens must not be logged');
});
