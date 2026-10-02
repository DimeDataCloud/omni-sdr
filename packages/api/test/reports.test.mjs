// Level C: campaign report (JSON + printable page), CSV exports (acceptance step 11).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { toCsv } from '../src/routes/reports.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

const campaignWithSends = async () => {
  const [c] = await api.q(`SELECT e.campaign_id AS id, count(x.id)::int AS sent FROM enrollments e JOIN drafts d ON d.enrollment_id = e.id
    JOIN messages x ON x.draft_id = d.id WHERE e.workspace_id = $1 AND x.state IN ('sent', 'confirmed', 'handed_off')
    GROUP BY e.campaign_id ORDER BY sent DESC LIMIT 1`, [api.demo.workspaces[0]]);
  return c;
};

test('campaign report: the funnel for one campaign, counts that match the rows, no open rate anywhere', async () => {
  const c = await campaignWithSends();
  assert.ok(c && c.sent > 0, 'fixture: the demo has a campaign with sends');
  const r = await api.call('GET', `${api.W}/reports/campaigns/${c.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.totals.sent, c.sent, 'sent counts this campaign\'s messages only');
  const [{ n }] = await api.q(`SELECT count(*)::int AS n FROM enrollments WHERE campaign_id = $1`, [c.id]);
  assert.equal(r.body.totals.enrolled, n);
  assert.equal(r.body.byStep.reduce((s, x) => s + x.sent, 0), c.sent);
  assert.doesNotMatch(JSON.stringify(r.body), /open/i, 'no open-rate field (S14)');
  for (const k of ['replyRate', 'positiveRate', 'meetingRate']) assert.ok(r.body.rates[k] === null || typeof r.body.rates[k] === 'number');
});

test('campaign report with nothing sent: rates are null, not 0%', async () => {
  const camp = await api.call('POST', `${api.W}/campaigns`, { body: { name: 'Empty one' } });
  const r = await api.call('GET', `${api.W}/reports/campaigns/${camp.body.id}`);
  assert.equal(r.body.totals.sent, 0);
  assert.deepEqual(r.body.rates, { replyRate: null, positiveRate: null, meetingRate: null });
});

test('printable report: self-contained, escaped, white-label (the agency\'s name, never Omni-SDR), no scripts', async () => {
  const c = await campaignWithSends();
  await api.q(`UPDATE campaigns SET name = $2 WHERE id = $1`, [c.id, 'Q4 <script>alert(1)</script> & co']);
  const r = await api.call('GET', `${api.W}/reports/campaigns/${c.id}?format=html`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.ok(!r.text.includes('<script>'), 'campaign name is escaped');
  assert.match(r.text, /Q4 &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co/);
  assert.doesNotMatch(r.text, /omni/i, 'no Omni-SDR mention a client can see');
  assert.doesNotMatch(r.text, /\bopen(s|ed)? rate\b/i);
  assert.doesNotMatch(r.text, /<script|src=|href=/i, 'no scripts, no external resources');
  const [{ name }] = await api.q(`SELECT name FROM orgs WHERE id = $1`, [api.demo.org]);
  assert.ok(r.text.includes(name.replace(/&/g, '&amp;')), 'the org\'s own name heads the page');
});

test('reports: client viewers can read their workspace\'s report; not another workspace\'s; strangers 403', async () => {
  const c = await campaignWithSends();
  assert.equal((await api.call('GET', `${api.W}/reports/campaigns/${c.id}`, { as: 'client@example.com' })).status, 200);
  assert.equal((await api.call('GET', `${api.ws(1)}/reports/campaigns/${c.id}`)).status, 404, 'another workspace\'s campaign id');
  assert.equal((await api.call('GET', `${api.W}/reports/campaigns/${c.id}`, { as: 'stranger@example.com' })).status, 403);
  assert.equal((await api.call('GET', `${api.W}/reports/campaigns/00000000-0000-4000-8000-000000000000`)).status, 404);
});

test('CSV exports: PII needs export_pii (admin, operator), files come as attachments, and every export is audited', async () => {
  const r = await api.call('GET', `${api.W}/exports/contacts.csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/csv/);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="contacts\.csv"$/);
  const lines = r.text.trim().split('\r\n');
  assert.equal(lines[0], 'Name,Email,Company,Title,Email status,Fit score,Added');
  const [{ n }] = await api.q(`SELECT count(*)::int AS n FROM contacts WHERE workspace_id = $1`, [api.demo.workspaces[0]]);
  assert.equal(lines.length - 1, n, 'one row per contact in this workspace only');
  assert.equal((await api.call('GET', `${api.W}/exports/meetings.csv`, { as: 'sam@example.com' })).status, 200, 'operator');
  for (const who of ['riley@example.com', 'client@example.com']) {
    assert.equal((await api.call('GET', `${api.W}/exports/contacts.csv`, { as: who })).status, 403, who);
  }
  const audits = await api.q(`SELECT action, entity_type FROM audit_log WHERE action = 'export' ORDER BY at`);
  assert.deepEqual(audits.map((a) => a.entity_type), ['contacts', 'meetings']);
});

test('CSV cells: formula injection is neutralised, quotes and newlines are escaped', () => {
  const csv = toCsv([['A', 'a'], ['B', 'b']], [{ a: '=HYPERLINK("http://evil")', b: '+1 555' }, { a: '-2', b: '@SUM(A1)' }, { a: 'line\nbreak', b: 'say "hi", ok' }]);
  assert.equal(csv, 'A,B\r\n"\'=HYPERLINK(""http://evil"")",\'+1 555\r\n\'-2,\'@SUM(A1)\r\n"line\nbreak","say ""hi"", ok"\r\n');
});

test('a meeting counts for the campaign whose email the reply answered, not every campaign the contact is in (#46 audit P3)', async () => {
  const c = await campaignWithSends();
  const before = (await api.call('GET', `${api.W}/reports/campaigns/${c.id}`)).body.totals.meetings;
  // Put one of this campaign's contacts into a second campaign and book a meeting there with no reply behind it.
  // A contact with no meetings yet (a deterministic pick: with LIMIT 1 alone, a contact holding a reply-less meeting
  // could be chosen, and enrolling it elsewhere rightly moves that meeting out of this campaign's count).
  const [{ contact_id: contact }] = await api.q(`SELECT e.contact_id FROM enrollments e WHERE e.campaign_id = $1
    AND NOT EXISTS (SELECT 1 FROM meetings mt WHERE mt.contact_id = e.contact_id) ORDER BY e.contact_id LIMIT 1`, [c.id]);
  const other = (await api.call('POST', `${api.W}/campaigns`, { body: { name: 'Other campaign' } })).body.id;
  await api.call('POST', `${api.W}/campaigns/${other}/enrollments`, { body: { contactIds: [contact] } });
  const start = new Date(Date.now() + 3 * 864e5);
  assert.equal((await api.call('POST', `${api.W}/meetings`, { body: { contactId: contact, startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 18e5).toISOString() } })).status, 201);
  assert.equal((await api.call('GET', `${api.W}/reports/campaigns/${c.id}`)).body.totals.meetings, before, 'not this campaign\'s meeting');
});
