// 0021 (B-12): the 200-a-day organisation cap in send_guard, and what provider events do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, one, q, refused, approvedDraft, send } from './helpers.mjs';

const today = (db) => one(db, `SELECT send_day() AS d`).then((r) => r.d);
const orgCount = async (db, t, day) =>
  (await one(db, `SELECT coalesce(max(count), 0)::int AS n FROM org_send_counters WHERE org_id = $1 AND day = $2`, [t.org, day])).n;
const mailboxCount = async (db, t, day) =>
  (await one(db, `SELECT coalesce(max(count), 0)::int AS n FROM send_counters WHERE mailbox_id = $1 AND day = $2`, [t.mailbox, day])).n;
// seedTenant sends one message of its own (the inbound fixture hangs off it); start each cap test from empty counters.
const fresh = async (db, label, opts) => { const t = await seedTenant(db, label, opts); await db.query('DELETE FROM org_send_counters'); await db.query('DELETE FROM send_counters'); return t; };
const stubDay = (db, iso) => db.exec(`CREATE OR REPLACE FUNCTION send_day() RETURNS date LANGUAGE sql STABLE AS $$ SELECT '${iso}'::date $$`);

test('a mailbox at its cap with org budget left is refused, and the org unit it took is rolled back', async () => {
  const db = await freshDb();
  const t = await fresh(db, 'alpha', { cap: 1 });
  await send(db, t, await approvedDraft(db, t));
  const d2 = await approvedDraft(db, t);
  assert.match(await refused(send(db, t, d2)) ?? '', /mailbox daily cap reached/);
  const day = await today(db);
  assert.deepEqual([await orgCount(db, t, day), await mailboxCount(db, t, day)], [1, 1], 'the refused send used no budget at either level');
  assert.equal((await q(db, `SELECT 1 FROM messages WHERE draft_id = $1`, [d2])).length, 0, 'a refused send is never queued');
});

test('an org at 200 with mailbox budget left is refused, and no mailbox unit is taken', async () => {
  const db = await freshDb();
  const t = await fresh(db, 'alpha', { cap: 50 });
  const day = await today(db);
  await db.query(`INSERT INTO org_send_counters (org_id, day, count) VALUES ($1, $2, 200)`, [t.org, day]);
  const d = await approvedDraft(db, t);
  assert.match(await refused(send(db, t, d)) ?? '', /organization daily cap reached/);
  assert.deepEqual([await orgCount(db, t, day), await mailboxCount(db, t, day)], [200, 0]);
  assert.equal((await q(db, `SELECT 1 FROM messages WHERE draft_id = $1`, [d])).length, 0);
});

test('the org takes its 200th unit and refuses the 201st; another org is untouched', async () => {
  const db = await freshDb();
  const a = await fresh(db, 'alpha', { cap: 200 });
  const b = await fresh(db, 'beta', { cap: 200 });
  const day = await today(db);
  await db.query(`INSERT INTO org_send_counters (org_id, day, count) VALUES ($1, $2, 199)`, [a.org, day]);
  await send(db, a, await approvedDraft(db, a));
  assert.equal(await orgCount(db, a, day), 200);
  assert.match(await refused(send(db, a, await approvedDraft(db, a))) ?? '', /organization daily cap reached/);
  await send(db, b, await approvedDraft(db, b));
  assert.equal(await orgCount(db, b, day), 1);
});

test('the UTC boundary: a full day does not block the next UTC day, and both counters roll over together', async () => {
  const db = await freshDb();
  const t = await fresh(db, 'alpha', { cap: 2 });
  try {
    await stubDay(db, '2026-03-01');                                            // the last second before 00:00 UTC
    await send(db, t, await approvedDraft(db, t));
    await send(db, t, await approvedDraft(db, t));
    await db.query(`UPDATE org_send_counters SET count = 200 WHERE org_id = $1`, [t.org]);
    assert.match(await refused(send(db, t, await approvedDraft(db, t))) ?? '', /organization daily cap reached/);
    await stubDay(db, '2026-03-02');                                            // the first second after
    await send(db, t, await approvedDraft(db, t));
    assert.deepEqual([await orgCount(db, t, '2026-03-02'), await mailboxCount(db, t, '2026-03-02')], [1, 1]);
    assert.deepEqual([await orgCount(db, t, '2026-03-01'), await mailboxCount(db, t, '2026-03-01')], [200, 2], 'yesterday is left as it was');
  } finally {
    await stubDay(db, '1970-01-01');   // never reached by a test below; the db is thrown away
  }
});

test('the day is UTC whatever the session time zone says', async () => {
  const db = await freshDb();
  const t = await fresh(db, 'alpha', { cap: 5 });
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {   // UTC+14 and UTC-11
    await db.exec(`SET TIME ZONE '${tz}'`);
    await send(db, t, await approvedDraft(db, t));
    await db.exec(`SET TIME ZONE 'UTC'`);
  }
  const utc = (await one(db, `SELECT (now() AT TIME ZONE 'UTC')::date AS d`)).d;
  assert.deepEqual((await q(db, `SELECT day FROM org_send_counters WHERE org_id = $1`, [t.org])).map((r) => r.day), [utc], 'one row, keyed by the UTC date');
  assert.equal(await orgCount(db, t, utc), 2);
});

test('the hard maximum is a CHECK, not only code: 201 is not storable at either level', async () => {
  const db = await freshDb();
  const t = await fresh(db, 'alpha', { cap: 200 });
  const day = await today(db);
  assert.match(await refused(db.query(`INSERT INTO org_send_counters (org_id, day, count) VALUES ($1, $2, 201)`, [t.org, day])) ?? '', /check/i);
  assert.match(await refused(db.query(`UPDATE mailboxes SET daily_cap = 201 WHERE id = $1`, [t.mailbox])) ?? '', /mailboxes_daily_cap_max/);
  assert.match(await refused(seedTenant(db, 'beta', { cap: 201 })) ?? '', /mailboxes_daily_cap_max/);
  await db.query(`UPDATE mailboxes SET daily_cap = 200 WHERE id = $1`, [t.mailbox]);   // 200 itself is allowed
});

test('a tenant cannot write or reset the org counter; the sender reads it', async () => {
  const db = await freshDb();
  const t = await fresh(db, 'alpha');
  await send(db, t, await approvedDraft(db, t));
  const ctx = { org: t.org, ws: [t.ws] };
  for (const role of ['app_rw', 'sender_svc', 'gate_svc']) {
    assert.match(await refused(as(db, role, ctx, () => db.query(`UPDATE org_send_counters SET count = 0`))) ?? 'ran', /permission denied/, role);
    assert.match(await refused(as(db, role, ctx, () => db.query(`DELETE FROM org_send_counters`))) ?? 'ran', /permission denied/, role);
  }
  assert.equal((await as(db, 'sender_svc', ctx, () => q(db, `SELECT count FROM org_send_counters`))).length, 1);
  const other = await fresh(db, 'beta');
  assert.equal((await as(db, 'sender_svc', { org: other.org, ws: [other.ws] }, () => q(db, `SELECT count FROM org_send_counters`))).length, 0, 'RLS: not another org\'s');
});

// ─── provider events ─────────────────────────────────────────────────────────────────────────────────────────────
async function sentMessage(db, t, providerId) {
  const d = await approvedDraft(db, t);
  await send(db, t, d);
  await db.query(`UPDATE messages SET state = 'sent', sent_at = now(), provider_message_id = $2 WHERE draft_id = $1`, [d, providerId]);
}
const event = (db, id, type, terminal, recipient = null) => as(db, 'inbox_svc', null, async () =>
  (await one(db, `SELECT record_mail_event($1, $2, $3, $4) AS r`, [id, type, terminal, recipient])).r);
const suppressed = async (db, t) => (await q(db, `SELECT reason FROM suppression WHERE scope_org_id = $1 AND value_hash = value_hash($2)`, [t.org, 'pat@alpha.test'])).map((r) => r.reason);

test('a hard bounce and a hard failure suppress the address and stop its enrollment; the next send is refused', async () => {
  for (const type of ['bounced', 'failed']) {
    const db = await freshDb();
    const t = await seedTenant(db, 'alpha');
    await sentMessage(db, t, 'cf-1');
    assert.equal(await event(db, 'cf-1', type, true), 'recorded');
    assert.deepEqual(await suppressed(db, t), ['bounce'], type);
    assert.equal((await one(db, `SELECT stop_reason FROM enrollments WHERE id = $1`, [t.enrollment])).stop_reason, 'bounce');
    assert.match(await refused(send(db, t, await approvedDraft(db, t))) ?? '', /suppressed/);
    assert.equal((await q(db, `SELECT 1 FROM audit_log WHERE org_id = $1 AND action = $2`, [t.org, `mail_event:${type}:address`])).length, 1);
  }
});

test('a complaint suppresses the person, as an unsubscribe does', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await sentMessage(db, t, 'cf-2');
  assert.equal(await event(db, 'cf-2', 'complained', false), 'recorded');
  assert.ok((await suppressed(db, t)).includes('complaint'));
  assert.match(await refused(send(db, t, await approvedDraft(db, t))) ?? '', /suppressed/);
});

test('deferred, delivered, rejected and a soft bounce never suppress', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await sentMessage(db, t, 'cf-3');
  for (const [type, terminal] of [['deferred', false], ['delivered', false], ['rejected', true], ['bounced', false], ['failed', false]]) {
    assert.equal(await event(db, 'cf-3', type, terminal), 'recorded', type);
  }
  assert.deepEqual(await suppressed(db, t), []);
  assert.equal((await one(db, `SELECT state FROM enrollments WHERE id = $1`, [t.enrollment])).state !== 'stopped', true);
  await send(db, t, await approvedDraft(db, t));   // still sendable
});

test('events are idempotent on (message id, type); an unknown message id changes nothing', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await sentMessage(db, t, 'cf-4');
  assert.equal(await event(db, 'cf-4', 'bounced', true), 'recorded');
  assert.equal(await event(db, 'cf-4', 'bounced', true), 'duplicate');
  assert.equal((await q(db, `SELECT 1 FROM audit_log WHERE org_id = $1 AND action LIKE 'mail_event:%'`, [t.org])).length, 1);
  assert.equal(await event(db, 'cf-nope', 'complained', false), 'unknown_message');
  assert.deepEqual(await suppressed(db, t), ['bounce']);
  assert.match(await refused(event(db, 'cf-4', 'mystery', true)) ?? '', /unknown type/);
});

test('only the events route role may call record_mail_event; a tenant cannot read another org\'s events', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const u = await seedTenant(db, 'beta');
  await sentMessage(db, t, 'cf-5');
  await event(db, 'cf-5', 'deferred', false);
  for (const role of ['app_rw', 'sender_svc', 'gate_svc']) {
    assert.match(await refused(as(db, role, null, () => db.query(`SELECT record_mail_event('cf-5', 'complained', false, null)`))) ?? 'ran', /permission denied/, role);
  }
  // seedTenant leaves one 'delivered' event per org, so each side sees its seed row, and ours for t only.
  const seen = (x) => as(db, 'app_rw', { org: x.org, ws: [x.ws] }, () => q(db, `SELECT org_id, type FROM mail_events`));
  assert.ok((await seen(u)).every((r) => r.org_id === u.org));
  assert.deepEqual((await seen(t)).map((r) => r.type).sort(), ['deferred', 'delivered']);
  assert.ok((await seen(t)).every((r) => r.org_id === t.org));
  assert.match(await refused(as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => db.query(`DELETE FROM mail_events`))) ?? 'ran', /permission denied/);
});

test('sender_svc can append an audit row for its own org and nothing else in audit_log', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const u = await seedTenant(db, 'beta');
  const ctx = { org: t.org, ws: [t.ws] };
  await as(db, 'sender_svc', ctx, () => db.query(`INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES ($1, 'sender', 'send_refused:x', 'draft', 'd')`, [t.org]));
  assert.match(await refused(as(db, 'sender_svc', ctx, () => db.query(`INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES ($1, 'sender', 'x', 'draft', 'd')`, [u.org]))) ?? 'ran', /row-level security/);
  assert.match(await refused(as(db, 'sender_svc', ctx, () => db.query(`UPDATE audit_log SET action = 'y'`))) ?? 'ran', /permission denied/);
});

test('with no stored message id (REST send returns none), the recipient finds the latest sent message; only that address is suppressed', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await sentMessage(db, t, 'cf-rest:abc');
  assert.equal(await event(db, 'evt-other-id', 'bounced', true), 'unknown_message', 'no id and no recipient: nothing to act on');
  assert.equal(await event(db, 'evt-other-id', 'bounced', true, 'nobody@elsewhere.test'), 'unknown_message');
  assert.deepEqual(await suppressed(db, t), []);
  assert.equal(await event(db, 'evt-other-id', 'bounced', true, '  PAT@alpha.test '), 'recorded', 'case and spaces do not matter');
  assert.deepEqual(await suppressed(db, t), ['bounce']);
  assert.equal(await event(db, 'evt-other-id', 'bounced', true, 'pat@alpha.test'), 'duplicate');
});

test('the recipient fallback only sees mail actually sent, and only in the last 30 days', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const d = await approvedDraft(db, t);
  await send(db, t, d);                                                       // claimed, never sent
  await db.query(`UPDATE messages SET state = 'claimed', sent_at = NULL, provider_message_id = NULL`);
  assert.equal(await event(db, 'e1', 'complained', false, 'pat@alpha.test'), 'unknown_message');
  await db.query(`UPDATE messages SET state = 'sent', sent_at = now() - interval '31 days'`);
  assert.equal(await event(db, 'e2', 'complained', false, 'pat@alpha.test'), 'unknown_message');
  await db.query(`UPDATE messages SET sent_at = now() - interval '29 days'`);
  assert.equal(await event(db, 'e3', 'complained', false, 'pat@alpha.test'), 'recorded');
});

test('suppression lives in its own rows: deleting the message (and so its events) cannot lift an opt-out or a bounce', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await sentMessage(db, t, 'cf-keep');
  assert.equal(await event(db, 'cf-keep', 'bounced', true), 'recorded');
  assert.deepEqual(await suppressed(db, t), ['bounce']);
  assert.equal((await q(db, `SELECT 1 FROM mail_events WHERE provider_message_id = 'cf-keep'`)).length, 1);
  await db.query(`DELETE FROM inbound_messages WHERE message_id IN (SELECT id FROM messages WHERE provider_message_id = 'cf-keep')`);
  await db.query(`DELETE FROM messages WHERE provider_message_id = 'cf-keep'`);
  assert.equal((await q(db, `SELECT 1 FROM mail_events WHERE provider_message_id = 'cf-keep'`)).length, 0, 'the event rows cascade');
  assert.deepEqual(await suppressed(db, t), ['bounce'], 'the suppression row stays');
  assert.match(await refused(send(db, t, await approvedDraft(db, t))) ?? '', /suppressed/, 'and the next send is still refused');
});
