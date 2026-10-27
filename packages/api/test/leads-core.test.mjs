// S2L-1: the speed-to-lead core, driven by the fake adapter. Records and measures only; nothing is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../db/src/migrate.mjs';
import { seedDemo } from '../src/seed-demo.mjs';
import { ingestLead, markFirstTouch, ttftBySource, normalizeLead, LeadError, SOURCES, payloadIdentityProblem, externalIdIdentityProblem } from '../src/leads/core.mjs';
import { fakeAdapter, event } from './fake-lead-adapter.mjs';
import { approvedDraft, as, one } from '../../db/test/helpers.mjs';

async function setup() {
  const db = new PGlite();
  await migrate(db);
  const demo = await seedDemo(db);
  const ctx = { orgId: demo.org, workspaceId: demo.workspaces[0] };
  // The demo may seed none; start from empty either way. lead_events refuses DELETE (0023), so this test-only reset switches
  // that one trigger off for the statement, as a superuser can, and back on.
  await db.exec('ALTER TABLE lead_events DISABLE TRIGGER lead_events_no_delete');
  await db.query('DELETE FROM lead_events');
  await db.exec('ALTER TABLE lead_events ENABLE TRIGGER lead_events_no_delete');
  return { db, demo, ctx, userId: demo.users['maya@example.com'] };
}
const rows = async (db, sql, p) => (await db.query(sql, p)).rows;

// A real send to this contact (S2L-2a): enrollment, approved draft and a message through the guard path, then marked sent.
async function sentTo(db, ctx, userId, email, { channel = 'email', state = 'sent' } = {}) {
  const org = ctx.orgId, ws = ctx.workspaceId;
  await db.query(`UPDATE contacts SET email_status = 'valid' WHERE workspace_id = $1 AND email = $2`, [ws, email]);
  const contact = (await one(db, `SELECT id FROM contacts WHERE workspace_id = $1 AND email = $2`, [ws, email])).id;
  // One enrollment per campaign and contact, so each send gets its own campaign (a copy of the workspace's first).
  const campaign = (await one(db, `INSERT INTO campaigns (org_id, workspace_id, name, icp_id, status) SELECT org_id, workspace_id, 'send-' || gen_random_uuid(), icp_id, status FROM campaigns WHERE workspace_id = $1 LIMIT 1 RETURNING id`, [ws])).id;
  const mailbox = (await one(db, `SELECT id FROM mailboxes WHERE workspace_id = $1 LIMIT 1`, [ws])).id;
  const enrollment = (await one(db, `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id, heat) VALUES ($1, $2, $3, $4, 1) RETURNING id`, [org, ws, campaign, contact])).id;
  const draft = await approvedDraft(db, { org, ws, enrollment, user: userId });
  const id = (await as(db, 'sender_svc', { org, ws: [ws] }, () => one(db,
    `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email') RETURNING id`, [org, ws, draft, mailbox]))).id;
  await db.query(`UPDATE messages SET state = $2, sent_at = clock_timestamp(), channel = $3 WHERE id = $1`, [id, state, channel]);
  return id;
}

test('a verified event is recorded once; a retry is a duplicate; a bad signature records nothing', async () => {
  const { db, ctx } = await setup();
  const a = fakeAdapter();
  const first = await ingestLead(db, ctx, a, event('sub-1'));
  assert.equal(first.outcome, 'recorded');
  assert.equal(first.touchBlocker, null, 'express consent and a known contact: a touch is allowed');
  const again = await ingestLead(db, ctx, a, event('sub-1'));
  assert.deepEqual([again.outcome, again.leadEventId], ['duplicate', first.leadEventId]);
  assert.deepEqual(await ingestLead(db, ctx, a, { ...event('sub-2'), secret: 'wrong' }), { outcome: 'dropped' });
  assert.equal((await rows(db, `SELECT 1 FROM lead_events`)).length, 1);
  assert.equal((await rows(db, `SELECT 1 FROM contacts WHERE email = 'lena@example.test'`)).length, 1, 'one contact for one address');
});

test('the same person by two sources: two lead events, one contact, the second names the first as related', async () => {
  const { db, ctx } = await setup();
  const form = await ingestLead(db, ctx, fakeAdapter(), event('f-1'));
  const ad = await ingestLead(db, ctx, fakeAdapter({ source: 'ad_lead' }), event('ad-9', { contact: { email: ' LENA@example.test ' } }));
  assert.equal(ad.outcome, 'recorded');
  assert.equal(ad.relatedLeadEventId, form.leadEventId, 'mixed case and padding resolve to the same contact');
  assert.equal((await rows(db, `SELECT 1 FROM contacts WHERE email = 'lena@example.test'`)).length, 1);
});

test('refusal cases: no consent basis, no address, and an opted-out person block the touch and record nothing', async () => {
  const { db, ctx } = await setup();
  const a = fakeAdapter();
  const none = await ingestLead(db, ctx, a, event('n-1', { consent: 'none' }));
  assert.equal(none.touchBlocker, 'no_consent');
  assert.equal(await markFirstTouch(db, ctx, none.leadEventId, { channel: 'email', by: 'agent' }), 'no_consent');
  const anon = await ingestLead(db, ctx, a, event('a-1', { contact: undefined }));
  assert.equal(anon.touchBlocker, 'no_contact');
  const ok = await ingestLead(db, ctx, a, event('s-1', { contact: { email: 'gone@example.test' } }));
  assert.equal(ok.touchBlocker, null);
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash('gone@example.test'), 'email', 'unsubscribe')`, [ctx.orgId]);
  assert.equal(await markFirstTouch(db, ctx, ok.leadEventId, { channel: 'email', by: 'agent' }), 'suppressed');
  assert.equal((await rows(db, `SELECT 1 FROM lead_events WHERE first_touch_at IS NOT NULL`)).length, 0);
});

test('first touch is write-once, and agent, human and system are the only touchers', async () => {
  const { db, ctx, userId } = await setup();
  const lead = await ingestLead(db, ctx, fakeAdapter(), event('t-1'));
  const messageId = await sentTo(db, ctx, userId, 'lena@example.test');
  assert.equal(await markFirstTouch(db, ctx, lead.leadEventId, { channel: 'email', by: 'system', messageId }), 'recorded');
  assert.equal(await markFirstTouch(db, ctx, lead.leadEventId, { channel: 'email', by: 'human', messageId }), 'already_touched');
  assert.equal((await rows(db, `SELECT first_touch_by AS b FROM lead_events`))[0].b, 'system');
  await assert.rejects(markFirstTouch(db, ctx, lead.leadEventId, { channel: 'email', by: 'robot' }), LeadError);
  await assert.rejects(markFirstTouch(db, ctx, lead.leadEventId, { channel: 'carrier-pigeon', by: 'agent' }), LeadError);
});

test('another workspace cannot touch this lead: not_found, nothing written', async () => {
  const { db, ctx, demo } = await setup();
  const lead = await ingestLead(db, ctx, fakeAdapter(), event('x-1'));
  const other = { orgId: demo.org, workspaceId: demo.workspaces[1] };
  assert.equal(await markFirstTouch(db, other, lead.leadEventId, { channel: 'email', by: 'agent' }), 'not_found');
  assert.equal((await rows(db, `SELECT 1 FROM lead_events WHERE first_touch_at IS NOT NULL`)).length, 0);
});

test('normalizer: identity in the payload, an email as the external id, a missing basis and unknown values are refused', () => {
  const a = fakeAdapter();
  const n = (o) => normalizeLead(a, { channel: 'form', externalId: 'e-1', consentBasis: 'express_form', receivedAt: new Date(), ...o });
  assert.doesNotThrow(() => n({ payload: { form_id: 'f-77', utm: { campaign: 'spring' } } }));
  for (const bad of [{ payload: { email: 'x@y.test' } }, { payload: { lead: { phone_number: '1' } } }, { payload: { note: 'call me at pat@example.test' } },
    { externalId: 'pat@example.test' }, { consentBasis: undefined }, { consentBasis: 'implied' }, { channel: 'fax' }, { externalId: '' }, { receivedAt: 'not a date' }]) {
    assert.throws(() => n(bad), LeadError, JSON.stringify(bad));
  }
  assert.throws(() => normalizeLead({ source: 'telepathy' }, {}), LeadError);
  assert.equal(SOURCES.length, 9);
});

test('time to first touch end to end through the core', async () => {
  const { db, ctx, userId } = await setup();
  const a = fakeAdapter();
  // The database stamps the touch with its own clock, so the leads arrive 1, 3 and 9 minutes ago and are touched now.
  const ago = (m) => new Date(Date.now() - m * 60000);
  for (const [id, minsAgo] of [['m-1', 1], ['m-2', 3], ['m-3', 9]]) {
    const lead = await ingestLead(db, ctx, a, event(id, { at: ago(minsAgo), contact: { email: `${id}@example.test` } }));
    const messageId = await sentTo(db, ctx, userId, `${id}@example.test`);
    assert.equal(await markFirstTouch(db, ctx, lead.leadEventId, { channel: 'email', by: 'agent', messageId }), 'recorded');
  }
  const [row] = await ttftBySource(db, { ...ctx, userId }, ago(60), new Date(Date.now() + 60000));
  assert.deepEqual([row.source, row.channel, row.n, row.touched, row.within_window], ['web_form', 'form', 3, 3, 1]);   // 0028: default window 2 minutes, so only the 1-minute touch (was 2 at 5 minutes)
  assert.ok(Math.abs(row.median_s - 180) < 5, `median ${row.median_s}`);
});

test('S2L-1b/2a: markFirstTouch has no time argument; a send from before a (future-dated) lead arrived is not its first touch', async () => {
  const { db, ctx, userId } = await setup();
  const lead = await ingestLead(db, ctx, fakeAdapter(), event('fut-1', { at: new Date(Date.now() + 120000) }));   // 2 min of clock skew
  const messageId = await sentTo(db, ctx, userId, 'lena@example.test');
  assert.equal(await markFirstTouch(db, ctx, lead.leadEventId, { channel: 'email', by: 'agent', messageId, at: new Date(0) }), 'message_before_lead', 'an at option is ignored');
  assert.equal((await rows(db, `SELECT 1 FROM lead_events WHERE first_touch_at IS NOT NULL`)).length, 0);
  await assert.rejects(ingestLead(db, ctx, fakeAdapter(), event('fut-2', { at: new Date(Date.now() + 3600000) })), /5 minutes in the future/);
});

test('S2L-1b: a sms touch on an email lead is blocked (no sms consent); suppression is judged on the touch channel', async () => {
  const { db, ctx, userId } = await setup();
  const mail = await ingestLead(db, ctx, fakeAdapter(), event('mail-1', { channel: 'email' }));
  assert.equal(await markFirstTouch(db, ctx, mail.leadEventId, { channel: 'sms', by: 'agent' }), 'no_consent');
  assert.equal(await markFirstTouch(db, ctx, mail.leadEventId, { channel: 'voice', by: 'agent' }), 'no_consent');
  assert.equal((await rows(db, `SELECT 1 FROM lead_events WHERE first_touch_at IS NOT NULL`)).length, 0, 'nothing written');
  const sms = await ingestLead(db, ctx, fakeAdapter({ source: 'sms' }), event('sms-1', { channel: 'sms', contact: { email: 'texter@example.test' } }));
  const messageId = await sentTo(db, ctx, userId, 'texter@example.test', { channel: 'sms' });
  assert.equal(await markFirstTouch(db, ctx, sms.leadEventId, { channel: 'sms', by: 'system', messageId }), 'recorded', 'they texted us: a text back is allowed');
});

const CASES = JSON.parse(readFileSync(fileURLToPath(new URL('../../db/test/lead-identity-cases.json', import.meta.url)), 'utf8'));

test('S2L-1b: the shared identity case list, JS layer (the DB layer runs the same list in db/test/lead-events.test.mjs)', () => {
  for (const c of CASES.payloadRefuse) assert.ok(payloadIdentityProblem(c.payload), `refuse: ${c.why}`);
  for (const c of CASES.payloadAllow) assert.equal(payloadIdentityProblem(c.payload), null, `allow: ${c.why}`);
  for (const id of CASES.externalIdRefuse) assert.ok(externalIdIdentityProblem(id), `externalId refuse: ${id}`);
  for (const id of CASES.externalIdAllow) assert.equal(externalIdIdentityProblem(id), null, `externalId allow: ${id}`);
});

test('S2L-2a: a first touch with no message, a bad id, an unsent, wrong-channel or a message to another contact is refused; nothing is written', async () => {
  const { db, ctx, userId } = await setup();
  const lead = await ingestLead(db, ctx, fakeAdapter(), event('r-1'));
  const other = await ingestLead(db, ctx, fakeAdapter(), event('r-2', { contact: { email: 'other@example.test' } }));
  const touch = (o) => markFirstTouch(db, ctx, lead.leadEventId, { channel: 'email', by: 'agent', ...o });
  assert.equal(await touch({}), 'no_message');
  await assert.rejects(touch({ messageId: 'not-a-uuid' }), LeadError);
  assert.equal(await touch({ messageId: '00000000-0000-4000-8000-000000000000' }), 'message_not_found');
  assert.equal(await touch({ messageId: await sentTo(db, ctx, userId, 'other@example.test') }), 'message_not_found', 'a message to another contact');
  assert.equal(await touch({ messageId: await sentTo(db, ctx, userId, 'lena@example.test', { state: 'failed' }) }), 'message_not_sent');
  assert.equal(await touch({ messageId: await sentTo(db, ctx, userId, 'lena@example.test', { channel: 'sms' }) }), 'message_channel');
  assert.equal((await rows(db, `SELECT 1 FROM lead_events WHERE first_touch_at IS NOT NULL`)).length, 0, 'nothing written');
  assert.equal(await touch({ messageId: await sentTo(db, ctx, userId, 'lena@example.test') }), 'recorded');
  assert.equal(other.outcome, 'recorded');
});
