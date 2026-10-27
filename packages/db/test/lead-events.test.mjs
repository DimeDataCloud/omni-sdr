// 0022 (S2L-1): lead_events, the consent and suppression blocker, the write-once first touch, and the time-to-first-touch metric.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtemp, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/migrate.mjs';
import { freshDb, seedTenant, approvedDraft, as, one, q, refused } from './helpers.mjs';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const REC = `SELECT * FROM record_lead_event($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
const rec = (db, t, o = {}) => as(db, 'inbox_svc', { org: t.org, ws: [t.ws] }, () => one(db, REC, [
  o.org ?? t.org, o.ws ?? t.ws, o.source ?? 'web_form', o.channel ?? 'form', o.ext ?? 'ext-1', 'contact' in o ? o.contact : t.contact,
  o.consent ?? 'express_form', o.at ?? new Date().toISOString(), JSON.stringify(o.payload ?? {})]));
const blocker = (db, role, t, id) => as(db, role, { org: t.org, ws: [t.ws] }, async () => (await one(db, `SELECT lead_touch_blocker($1) AS r`, [id])).r);
// 0024: a touch names the message that was the touch. By default that is the tenant's seeded message (it belongs to t.contact),
// marked sent now; pass message: <id> for another, or message: null for none.
const markSent = async (db, t, o = {}) => {
  await db.query(`UPDATE messages SET state = $4, sent_at = coalesce($2::timestamptz, clock_timestamp()), channel = coalesce($3, channel) WHERE id = $1`,
    [t.message, o.at ?? null, o.channel ?? null, o.state ?? 'sent']);
  return t.message;
};
const touch = async (db, role, t, id, o = {}) => {
  const message = 'message' in o ? o.message : await markSent(db, t, { channel: o.channel ?? 'email' });
  return as(db, role, { org: t.org, ws: [t.ws] }, async () =>
    (await one(db, `SELECT record_first_touch($1, $2, $3, $4) AS r`, [id, o.channel ?? 'email', o.by ?? 'agent', message])).r);
};
// seedTenant adds one lead event; lead_events refuses DELETE (0023), so this test-only reset switches that trigger off for one statement, as a superuser can.
const clean = async (db, label) => {
  const t = await seedTenant(db, label);
  await db.exec('ALTER TABLE lead_events DISABLE TRIGGER lead_events_no_delete');
  await db.query('DELETE FROM lead_events WHERE org_id = $1', [t.org]);
  await db.exec('ALTER TABLE lead_events ENABLE TRIGGER lead_events_no_delete');
  return t;
};
const minutes = (m) => new Date(Date.now() - 3600000 + m * 60000).toISOString();   // an hour ago, plus m minutes

test('intake is idempotent on (workspace, source, external_id); another source with the same id is a separate lead', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const first = await rec(db, t);
  assert.equal(first.outcome, 'recorded');
  const again = await rec(db, t);
  assert.deepEqual([again.outcome, again.lead_event_id], ['duplicate', first.lead_event_id]);
  assert.equal((await rec(db, t, { source: 'ad_lead' })).outcome, 'recorded');
  assert.equal((await q(db, `SELECT 1 FROM lead_events WHERE org_id = $1`, [t.org])).length, 2);
});

test('the same person arriving by a second source inside 24 h is reported as related, so the core can skip a second first touch', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const form = await rec(db, t, { ext: 'f-1', at: minutes(0) });
  assert.equal(form.related_lead_event_id, null);
  const dm = await rec(db, t, { source: 'social_dm', channel: 'instagram_dm', ext: 'd-1', at: minutes(5) });
  assert.equal(dm.related_lead_event_id, form.lead_event_id);
});

test('tenant context: another tenant, a mismatched org or workspace, and no context are all refused or not found', async () => {
  const db = await freshDb();
  const a = await clean(db, 'alpha');
  const b = await clean(db, 'bravo');
  const bLead = (await rec(db, b, { ext: 'b-1' })).lead_event_id;
  // record_lead_event: naming B's org or workspace from A's context raises.
  assert.match(await refused(rec(db, a, { org: b.org })) ?? 'ran', /tenant context does not match/);
  assert.match(await refused(rec(db, a, { ws: b.ws })) ?? 'ran', /tenant context does not match/);
  assert.match(await refused(as(db, 'inbox_svc', null, () => db.query(REC, [a.org, a.ws, 'web_form', 'form', 'x', null, 'express_form', new Date().toISOString(), '{}']))) ?? 'ran', /tenant context does not match/);
  // A's contact on B's lead is refused by the composite FK.
  assert.ok(await refused(rec(db, b, { ext: 'b-2', contact: a.contact })), 'a lead cannot point at another tenant\'s contact');
  // The blocker and the touch answer not_found for B's lead from A, whichever role asks, and write nothing.
  for (const role of ['app_rw', 'inbox_svc', 'sender_svc']) assert.equal(await blocker(db, role, a, bLead), 'not_found', `${role} blocker`);
  for (const role of ['inbox_svc', 'sender_svc']) assert.equal(await touch(db, role, a, bLead), 'not_found', `${role} touch`);
  assert.equal((await one(db, `SELECT first_touch_at FROM lead_events WHERE id = $1`, [bLead])).first_touch_at, null);
  // No context at all (the service role with no tenant): not_found too.
  await db.exec('SET ROLE sender_svc');
  try { assert.equal((await one(db, `SELECT record_first_touch($1, 'email', 'agent', NULL) AS r`, [bLead])).r, 'not_found'); }
  finally { await db.exec('RESET ROLE'); }
});

test('no consent basis, no contact, and a suppressed person each block a first touch and write nothing', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const ok = (await rec(db, t, { ext: 'ok' })).lead_event_id;
  assert.equal(await blocker(db, 'app_rw', t, ok), null);
  const none = (await rec(db, t, { ext: 'none', consent: 'none' })).lead_event_id;
  const anon = (await rec(db, t, { ext: 'anon', contact: null })).lead_event_id;
  assert.equal(await blocker(db, 'app_rw', t, none), 'no_consent');
  assert.equal(await blocker(db, 'app_rw', t, anon), 'no_contact');
  assert.equal(await touch(db, 'sender_svc', t, none), 'no_consent');
  assert.equal(await touch(db, 'sender_svc', t, anon), 'no_contact');
  // The contact opts out (by address, as the unsubscribe path records it): the person is suppressed on every lead.
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash((SELECT email FROM contacts WHERE id = $2)), 'email', 'unsubscribe')`, [t.org, t.contact]);
  assert.equal(await blocker(db, 'app_rw', t, ok), 'suppressed');
  assert.equal(await touch(db, 'inbox_svc', t, ok), 'suppressed');
  assert.equal((await q(db, `SELECT 1 FROM lead_events WHERE first_touch_at IS NOT NULL AND org_id = $1`, [t.org])).length, 0, 'every refusal wrote nothing');
});

test('first touch: write-once in the definer and in the table; the by-values are agent, human, system only', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const id = (await rec(db, t)).lead_event_id;
  assert.equal(await touch(db, 'sender_svc', t, id, { by: 'system', channel: 'email' }), 'recorded');
  assert.equal(await touch(db, 'sender_svc', t, id, { by: 'agent' }), 'already_touched');
  const row = await one(db, `SELECT first_touch_by, first_touch_channel FROM lead_events WHERE id = $1`, [id]);
  assert.deepEqual([row.first_touch_by, row.first_touch_channel], ['system', 'email'], 'the second call changed nothing');
  // The table itself refuses a rewrite, even from the migrator, and any change to the rest of the row.
  assert.match(await refused(db.query(`UPDATE lead_events SET first_touch_at = first_touch_at - interval '1 minute' WHERE id = $1`, [id])) ?? 'ran', /write-once/);
  // (+1 minute would now stop earlier, at the 0023 bound "not in the future", before reaching this guard; the rewrite is refused either way.)
  assert.match(await refused(db.query(`UPDATE lead_events SET first_touch_by = 'human' WHERE id = $1`, [id])) ?? 'ran', /write-once/);
  assert.match(await refused(db.query(`UPDATE lead_events SET first_touch_at = NULL, first_touch_channel = NULL, first_touch_by = NULL WHERE id = $1`, [id])) ?? 'ran', /write-once/);
  assert.match(await refused(db.query(`UPDATE lead_events SET consent_basis = 'none' WHERE id = $1`, [id])) ?? 'ran', /immutable/);
  assert.match(await refused(db.query(`UPDATE lead_events SET received_at = received_at - interval '1 hour' WHERE id = $1`, [id])) ?? 'ran', /immutable/);
  // CHECKs: a bad actor, a touch before the lead, half a touch.
  const id2 = (await rec(db, t, { ext: 'e2' })).lead_event_id;
  assert.ok(await refused(touch(db, 'sender_svc', t, id2, { by: 'robot' })), 'unknown first_touch_by');
  assert.ok(await refused(db.query(`UPDATE lead_events SET first_touch_at = now() WHERE id = $1`, [id2])), 'a touch with no channel or actor');
  assert.ok(await refused(db.query(`UPDATE lead_events SET first_touch_at = received_at - interval '1 minute', first_touch_channel = 'email', first_touch_by = 'agent' WHERE id = $1`, [id2])), 'a touch before the lead arrived');
});

test('no caller but the definers can write: app_rw, inbox_svc and sender_svc have no INSERT, UPDATE or DELETE', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const id = (await rec(db, t)).lead_event_id;
  for (const role of ['app_rw', 'inbox_svc', 'sender_svc', 'gate_svc']) {
    const run = (sql, p) => as(db, role, { org: t.org, ws: [t.ws] }, () => refused(db.query(sql, p)));
    assert.match(await run(`UPDATE lead_events SET first_touch_at = now(), first_touch_channel = 'email', first_touch_by = 'human' WHERE id = $1`, [id]) ?? 'ran', /permission denied/, `${role} update`);
    assert.match(await run(`DELETE FROM lead_events WHERE id = $1`, [id]) ?? 'ran', /permission denied/, `${role} delete`);
    assert.match(await run(`INSERT INTO lead_events (org_id, workspace_id, source, channel, external_id, consent_basis, received_at) VALUES ($1, $2, 'crm', 'email', 'z', 'express_form', now())`, [t.org, t.ws]) ?? 'ran', /permission denied/, `${role} insert`);
  }
});

test('payload is a size-capped object, and no column on lead_events can hold a raw email or phone', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  assert.ok(await refused(rec(db, t, { ext: 'big', payload: { blob: 'x'.repeat(21000) } })), 'over 20 kB');
  assert.ok(await refused(rec(db, t, { ext: 'arr', payload: ['x'] })), 'an array is not an object');
  assert.equal((await rec(db, t, { ext: 'small', payload: { form_id: 'f-77', page: 'landing-a' } })).outcome, 'recorded');
  // The catalog: the exact column set. A new column fails this until someone reviews it for identity.
  const cols = (await q(db, `SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'lead_events' ORDER BY 1`)).map((r) => r.c);
  assert.deepEqual(cols, ['channel', 'consent_basis', 'contact_id', 'created_at', 'external_id', 'first_touch_at', 'first_touch_by', 'first_touch_channel', 'first_touch_message_id',
    'id', 'inbound_message_id', 'org_id', 'payload', 'received_at', 'source', 'workspace_id']);
  assert.deepEqual(cols.filter((c) => /mail|phone|handle|name|address|contact_(value|point)/i.test(c)), [], 'no column is named for contact identity');
});

test('time to first touch: median, p90, untouched leads left out of the percentiles, and within_window uses the workspace\'s own window', async () => {
  const db = await freshDb();
  const a = await clean(db, 'alpha');
  const b = await clean(db, 'bravo');
  const insert = (t, ext, source, channel, mins, touchMins) => db.query(
    `INSERT INTO lead_events (org_id, workspace_id, contact_id, source, channel, external_id, consent_basis, received_at, first_touch_at, first_touch_channel, first_touch_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'express_form', $7, $8, $9, $10)`,
    [t.org, t.ws, t.contact, source, channel, ext, minutes(mins),
      touchMins == null ? null : minutes(mins + touchMins), touchMins == null ? null : 'email', touchMins == null ? null : 'agent']);
  // alpha web_form: touched after 2, 4, 8 minutes, one never touched. alpha ad_lead: one touched after 1 minute.
  await insert(a, 'w1', 'web_form', 'form', 0, 2);
  await insert(a, 'w2', 'web_form', 'form', 10, 4);
  await insert(a, 'w3', 'web_form', 'form', 20, 8);
  await insert(a, 'w4', 'web_form', 'form', 30, null);
  await insert(a, 'a1', 'ad_lead', 'form', 40, 1);
  await insert(b, 'b1', 'web_form', 'form', 0, 50);   // bravo's numbers must never reach alpha
  const ttft = (t) => as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => q(db, `SELECT * FROM ttft_by_source($1, $2)`, [minutes(-60), new Date(Date.now() + 60000).toISOString()]));

  let rows = await ttft(a);
  assert.deepEqual(rows.map((r) => [r.source, r.channel, r.n, r.touched]), [['ad_lead', 'form', 1, 1], ['web_form', 'form', 4, 3]]);
  const web = rows.find((r) => r.source === 'web_form');
  assert.equal(web.median_s, 240);                       // 2, 4, 8 minutes: the untouched lead is not in the percentile
  assert.equal(Math.round(web.p90_s), 432);              // 4 min + 0.8 * (8 - 4) min = 7.2 min
  assert.equal(web.within_window, 1, 'default window 2 min (0028): only the 2-minute touch');
});

test('within_window follows response_window_minutes (a non-default window changes the count)', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  for (const [ext, touch] of [['w1', 2], ['w2', 4], ['w3', 8]]) {
    await db.query(`INSERT INTO lead_events (org_id, workspace_id, contact_id, source, channel, external_id, consent_basis, received_at, first_touch_at, first_touch_channel, first_touch_by)
      VALUES ($1, $2, $3, 'web_form', 'form', $4, 'express_form', $5, $6, 'email', 'agent')`, [t.org, t.ws, t.contact, ext, minutes(0), minutes(touch)]);
  }
  const within = () => as(db, 'app_rw', { org: t.org, ws: [t.ws] }, async () =>
    (await one(db, `SELECT within_window AS w FROM ttft_by_source($1, $2)`, [minutes(-60), new Date(Date.now() + 60000).toISOString()])).w);
  assert.equal(await within(), 1, 'default 2 minutes (0028): only the 2 minute touch');
  await db.query(`UPDATE workspaces SET response_window_minutes = 5 WHERE id = $1`, [t.ws]);
  assert.equal(await within(), 2, '5 minutes (the old default, now an explicit choice): the 2 and 4 minute touches');
  await db.query(`UPDATE workspaces SET response_window_minutes = 3 WHERE id = $1`, [t.ws]);
  assert.equal(await within(), 1, '3 minutes: only the 2 minute touch');
  await db.query(`UPDATE workspaces SET response_window_minutes = 10 WHERE id = $1`, [t.ws]);
  assert.equal(await within(), 3, '10 minutes: all three');
  assert.ok(await refused(db.query(`UPDATE workspaces SET response_window_minutes = 0 WHERE id = $1`, [t.ws])), 'the window is 1 to 1440');
});

test('0028: on a database populated at 0027, a window left at 5 moves to 2, any other choice is kept, and new rows default to 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mig27-'));
  for (const f of (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql') && n < '0028').sort()) await copyFile(new URL(f, MIGRATIONS), join(dir, f));
  const db = new PGlite();
  await migrate(db, dir);
  const org = (await one(db, `INSERT INTO orgs (name) VALUES ('window') RETURNING id`)).id;
  const ws = async (name, minutes) => (await one(db, `INSERT INTO workspaces (org_id, name${minutes == null ? '' : ', response_window_minutes'}) VALUES ($1, $2${minutes == null ? '' : ', $3'}) RETURNING id`,
    minutes == null ? [org, name] : [org, name, minutes])).id;
  const [five, ten, one1] = [await ws('at-five', 5), await ws('at-ten', 10), await ws('at-one', 1)];
  assert.equal((await one(db, `SELECT response_window_minutes AS m FROM workspaces WHERE id = $1`, [await ws('default-before', null)])).m, 5, 'before 0028 the default is 5');
  const ran = await migrate(db);   // the real directory: only 0028 is left
  assert.deepEqual(ran.ran, ['0028_response_window_default_2.sql']);
  const win = async (id) => (await one(db, `SELECT response_window_minutes AS m FROM workspaces WHERE id = $1`, [id])).m;
  assert.equal(await win(five), 2, 'a row at 5 moved with the default');
  assert.equal(await win(ten), 10, 'a window someone set to 10 is left alone');
  assert.equal(await win(one1), 1, 'and so is 1');
  assert.equal(await win(await ws('default-after', null)), 2, 'a new row defaults to 2');
});

// ─── 0023 (S2L-1b) ───────────────────────────────────────────────────────────────────────────────────────────────
const CASES = JSON.parse(readFileSync(fileURLToPath(new URL('./lead-identity-cases.json', import.meta.url)), 'utf8'));

test('S2L-1b: the first-touch time is the server\'s; the old 4-argument functions are gone', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const id = (await rec(db, t, { at: minutes(0) })).lead_event_id;
  // The old record_first_touch(uuid, text, text, timestamptz) and the 1-argument blocker no longer exist.
  const sigs = (await q(db, `SELECT proname || '(' || pg_get_function_identity_arguments(oid) || ')' AS s FROM pg_proc WHERE proname IN ('record_first_touch', 'lead_touch_blocker') ORDER BY 1`)).map((r) => r.s);
  assert.deepEqual(sigs, ['lead_touch_blocker(p_lead_event uuid, p_channel text)', 'record_first_touch(p_lead_event uuid, p_channel text, p_by text, p_message uuid)']);
  await db.exec('SET ROLE sender_svc');
  try {
    assert.match(await refused(db.query(`SELECT record_first_touch($1, 'email', 'agent', now() - interval '30 minutes')`, [id])) ?? 'ran', /does not exist/);
  } finally { await db.exec('RESET ROLE'); }
  assert.equal(await touch(db, 'sender_svc', t, id), 'recorded');
  // 0024: the time is the message's own sent_at, which the sender wrote; the caller supplies no time at all.
  const r = await one(db, `SELECT l.first_touch_at = m.sent_at AS same, l.first_touch_message_id = m.id AS tied FROM lead_events l JOIN messages m ON m.id = l.first_touch_message_id WHERE l.id = $1`, [id]);
  assert.deepEqual([r.same, r.tied], [true, true]);
});

test('S2L-1b: a future-dated lead (up to 5 minutes of skew) cannot be touched by an earlier send; beyond 5 minutes is refused', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const soon = (await rec(db, t, { ext: 'soon', at: new Date(Date.now() + 240000).toISOString() })).lead_event_id;
  assert.equal(await touch(db, 'sender_svc', t, soon), 'message_before_lead', 'a send from before the lead arrived is not its first touch');
  assert.equal((await one(db, `SELECT first_touch_at FROM lead_events WHERE id = $1`, [soon])).first_touch_at, null);
  assert.match(await refused(rec(db, t, { ext: 'far', at: new Date(Date.now() + 600000).toISOString() })) ?? 'ran', /5 minutes in the future/);
  assert.match(await refused(db.query(`INSERT INTO lead_events (org_id, workspace_id, source, channel, external_id, consent_basis, received_at)
    VALUES ($1, $2, 'crm', 'email', 'far-direct', 'express_form', now() + interval '10 minutes')`, [t.org, t.ws])) ?? 'ran', /5 minutes in the future/, 'the table refuses it too, not only the definer');
  const id = (await rec(db, t, { ext: 'late', at: minutes(0) })).lead_event_id;
  assert.match(await refused(db.query(`UPDATE lead_events SET first_touch_at = now() + interval '1 hour', first_touch_channel = 'email', first_touch_by = 'agent' WHERE id = $1`, [id])) ?? 'ran', /in the future/);
});

test('S2L-1b: no DELETE and no TRUNCATE for any role, the table owner (the migrator) included; superuser limit stated', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const id = (await rec(db, t)).lead_event_id;
  // Every non-superuser role lacks the privileges outright.
  const roles = (await q(db, `SELECT rolname FROM pg_roles WHERE NOT rolsuper AND rolname !~ '^pg_' ORDER BY 1`)).map((r) => r.rolname);
  assert.ok(roles.includes('lead_owner') && roles.includes('app_rw'), 'the role list is real');
  for (const r of roles) for (const p of ['DELETE', 'TRUNCATE']) {
    assert.equal((await one(db, `SELECT has_table_privilege($1, 'lead_events', $2) AS h`, [r, p])).h, false, `${r} must not hold ${p}`);
  }
  // The owner always holds the privilege, so the triggers are what stop the owner: here the migrator's own session.
  const owner = (await one(db, `SELECT pg_get_userbyid(relowner) AS o, current_user AS me FROM pg_class WHERE relname = 'lead_events'`));
  assert.equal(owner.o, owner.me, 'this session is the table owner, as the migrator is');
  assert.match(await refused(db.query(`DELETE FROM lead_events WHERE id = $1`, [id])) ?? 'ran', /never deleted/);
  assert.match(await refused(db.query(`DELETE FROM lead_events`)) ?? 'ran', /never deleted/);
  assert.match(await refused(db.query(`TRUNCATE lead_events`)) ?? 'ran', /never deleted/);
  assert.equal((await q(db, `SELECT 1 FROM lead_events WHERE id = $1`, [id])).length, 1, 'the row is still there');
  // LIMIT, stated: a superuser can DISABLE TRIGGER or DROP TABLE. SQL cannot promise otherwise; the guard is the roles and the triggers.
  // Whether the production migrator is a superuser is a deployment fact to confirm before go-live.
});

test('S2L-1b: erasure is anonymize, never delete: the contact UPDATE is allowed, a contact DELETE is refused, the lead stays', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const c = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, phone) VALUES ($1, $2, 'Lena', 'lena@alpha.test', '+16155550111') RETURNING id`, [t.org, t.ws])).id;
  const id = (await rec(db, t, { ext: 'er-1', contact: c })).lead_event_id;
  await db.query(`UPDATE contacts SET name = NULL, email = NULL, phone = NULL WHERE id = $1`, [c]);   // the anonymizing UPDATE
  const row = await one(db, `SELECT c.name, c.email, c.phone, l.contact_id FROM lead_events l JOIN contacts c ON c.id = l.contact_id WHERE l.id = $1`, [id]);
  assert.deepEqual([row.name, row.email, row.phone, row.contact_id], [null, null, null, c], 'still linked, identity gone');
  assert.match(await refused(db.query(`DELETE FROM contacts WHERE id = $1`, [c])) ?? 'ran', /lead_events|foreign key/i, 'no ON DELETE SET NULL, no cascade');
  assert.equal((await q(db, `SELECT 1 FROM lead_events WHERE id = $1`, [id])).length, 1);
  // A controlled erasure definer is deferred to the privacy card (B-20).
});

test('S2L-1b: the shared identity case list, DB layer (the JS layer runs the same list in api/test/leads-core.test.mjs)', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  let i = 0;
  for (const c of CASES.payloadRefuse) {
    assert.match(await refused(rec(db, t, { ext: `pr-${i++}`, payload: c.payload })) ?? 'ran', /identity_free/, `refuse: ${c.why}`);
  }
  for (const c of CASES.payloadAllow) {
    assert.equal((await rec(db, t, { ext: `pa-${i++}`, payload: c.payload })).outcome, 'recorded', `allow: ${c.why}`);
  }
  for (const id of CASES.externalIdRefuse) {
    assert.match(await refused(rec(db, t, { ext: id })) ?? 'ran', /identity_free/, `externalId refuse: ${id}`);
  }
  for (const id of CASES.externalIdAllow) {
    assert.equal((await rec(db, t, { ext: id })).outcome, 'recorded', `externalId allow: ${id}`);
  }
  // The CHECKs bind every writer: a direct INSERT by the owner cannot slip identity past the definer.
  assert.match(await refused(db.query(`INSERT INTO lead_events (org_id, workspace_id, source, channel, external_id, consent_basis, received_at, payload)
    VALUES ($1, $2, 'crm', 'email', 'direct-1', 'express_form', now(), '{"fullName": "x"}')`, [t.org, t.ws])) ?? 'ran', /identity_free/);
  // The free-text limit, stated as a test so nobody mistakes the guard for a PII detector.
  assert.equal((await rec(db, t, { ext: 'free-text', payload: { note: 'ask for Lena at the front desk' } })).outcome, 'recorded', 'free text is not scanned');
});

test('S2L-1b: the blocker judges the touch channel: an sms or voice touch on a lead that arrived by email has no consent', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const mail = (await rec(db, t, { ext: 'm', source: 'inbound_email', channel: 'email' })).lead_event_id;
  const sms = (await rec(db, t, { ext: 's', source: 'sms', channel: 'sms' })).lead_event_id;
  const blockerFor = (id, ch) => as(db, 'sender_svc', { org: t.org, ws: [t.ws] }, async () => (await one(db, `SELECT lead_touch_blocker($1, $2) AS r`, [id, ch])).r);
  assert.equal(await blockerFor(mail, null), null, 'no channel given: the lead\'s own channel');
  assert.equal(await blockerFor(mail, 'email'), null);
  assert.equal(await blockerFor(mail, 'sms'), 'no_consent');
  assert.equal(await blockerFor(mail, 'voice'), 'no_consent');
  assert.equal(await blockerFor(sms, 'sms'), null, 'they texted us');
  assert.equal(await blockerFor(sms, 'voice'), 'no_consent', 'texting us is not consent to be called');
  assert.equal(await touch(db, 'sender_svc', t, mail, { channel: 'sms' }), 'no_consent');
  assert.equal((await one(db, `SELECT first_touch_at FROM lead_events WHERE id = $1`, [mail])).first_touch_at, null, 'nothing written');
  assert.equal(await touch(db, 'sender_svc', t, mail, { channel: 'email' }), 'recorded');
});

// ─── 0024 (S2L-2a): a first touch needs a real send ──────────────────────────────────────────────────────────────
// A second contact in the same workspace, with its own enrollment, draft and message (made through the real guard path).
async function otherContactMessage(db, t, label) {
  const c = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'Other', $3, 'valid') RETURNING id`, [t.org, t.ws, `other-${label}@example.test`])).id;
  await db.query(`INSERT INTO email_verifications (org_id, workspace_id, contact_id, email, verdict, vendor, job)
    SELECT org_id, workspace_id, id, email, 'valid', 'seed', 'seed-job' FROM contacts WHERE id = $1`, [c]);
  const e = (await one(db, `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id, heat) VALUES ($1, $2, $3, $4, 1) RETURNING id`, [t.org, t.ws, t.campaign, c])).id;
  const draft = await approvedDraft(db, { ...t, enrollment: e });
  const m = (await as(db, 'sender_svc', { org: t.org, ws: [t.ws] }, () => one(db,
    `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email') RETURNING id`, [t.org, t.ws, draft, t.mailbox]))).id;
  await db.query(`UPDATE messages SET state = 'sent', sent_at = clock_timestamp() WHERE id = $1`, [m]);
  return { contact: c, message: m };
}
const touched = async (db, id) => (await one(db, `SELECT first_touch_at, first_touch_message_id FROM lead_events WHERE id = $1`, [id]));

test('S2L-2a: a first touch with no message id, or a message that is not a real send to this lead, is refused and writes nothing', async () => {
  const db = await freshDb();
  const a = await clean(db, 'alpha');
  const b = await clean(db, 'bravo');
  const lead = (await rec(db, a, { at: minutes(0) })).lead_event_id;
  const other = await otherContactMessage(db, a, 'a');
  const none = { first_touch_at: null, first_touch_message_id: null };
  const refuse = async (why, o) => {
    assert.equal(await touch(db, 'sender_svc', a, lead, o), why);
    assert.deepEqual(await touched(db, lead), none, `${why}: nothing written`);
  };
  await refuse('no_message', { message: null });
  await refuse('message_not_found', { message: other.message });                 // another contact, same workspace
  await refuse('message_not_found', { message: b.message });                     // another tenant's message
  await refuse('message_not_found', { message: '00000000-0000-4000-8000-000000000000' });
  for (const state of ['claimed', 'failed', 'handed_off']) {
    await markSent(db, a, { state });
    await refuse('message_not_sent', { message: a.message });
  }
  await markSent(db, a, { state: 'sent', channel: 'sms' });
  await refuse('message_channel', { message: a.message, channel: 'email' });
  await markSent(db, a, { state: 'sent', channel: 'email', at: new Date(Date.now() - 2 * 3600000).toISOString() });
  await refuse('message_before_lead', { message: a.message });
  // The honest one works, for either service role, and ties the touch to the message.
  await markSent(db, a, { state: 'sent', channel: 'email' });
  assert.equal(await touch(db, 'inbox_svc', a, lead, { message: a.message }), 'recorded');
  assert.equal((await touched(db, lead)).first_touch_message_id, a.message);
});

test('S2L-2a: a confirmed message counts as sent; another tenant cannot use this tenant\'s message', async () => {
  const db = await freshDb();
  const a = await clean(db, 'alpha');
  const b = await clean(db, 'bravo');
  const aLead = (await rec(db, a, { at: minutes(0) })).lead_event_id;
  const bLead = (await rec(db, b, { ext: 'b-1', at: minutes(0) })).lead_event_id;
  await markSent(db, a, { state: 'confirmed' });
  assert.equal(await touch(db, 'sender_svc', b, bLead, { message: a.message }), 'message_not_found');
  assert.equal(await touch(db, 'sender_svc', a, aLead, { message: a.message }), 'recorded');
});

test('S2L-2a: the message id is write-once with the touch; a message id needs a touch; only the definer may write it', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const id = (await rec(db, t, { at: minutes(0) })).lead_event_id;
  assert.equal(await touch(db, 'sender_svc', t, id), 'recorded');
  const other = await otherContactMessage(db, t, 'w');
  assert.match(await refused(db.query(`UPDATE lead_events SET first_touch_message_id = $2 WHERE id = $1`, [id, other.message])) ?? 'ran', /write-once/);
  assert.match(await refused(db.query(`UPDATE lead_events SET first_touch_message_id = NULL WHERE id = $1`, [id])) ?? 'ran', /write-once/);
  const id2 = (await rec(db, t, { ext: 'untouched' })).lead_event_id;
  assert.ok(await refused(db.query(`UPDATE lead_events SET first_touch_message_id = $2 WHERE id = $1`, [id2, t.message])), 'a message with no touch');
  for (const role of ['app_rw', 'inbox_svc', 'sender_svc']) {
    assert.equal((await one(db, `SELECT has_column_privilege($1, 'lead_events', 'first_touch_message_id', 'UPDATE') AS h`, [role])).h, false, role);
  }
});

test('S2L-2a: lead_owner only reads messages, drafts and enrollments; with no tenant context the definer finds nothing', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const grants = await q(db, `SELECT table_name AS t, privilege_type AS p FROM information_schema.role_table_grants WHERE grantee = 'lead_owner' AND table_name IN ('messages', 'drafts', 'enrollments') ORDER BY 1, 2`);
  assert.deepEqual(grants, [{ t: 'drafts', p: 'SELECT' }, { t: 'enrollments', p: 'SELECT' }, { t: 'messages', p: 'SELECT' }]);
  // The lead_read policies are tenant-scoped: under tenant A, lead_owner sees none of B's rows; with no context, none at all.
  const b = await clean(db, 'bravo');
  const count = (t) => as(db, 'lead_owner', t, async () => Object.fromEntries(await Promise.all(['messages', 'drafts', 'enrollments'].map(async (n) =>
    [n, (await one(db, `SELECT count(*)::int AS c FROM ${n} WHERE org_id = $1`, [b.org])).c]))));
  assert.deepEqual(await count({ org: t.org, ws: [t.ws] }), { messages: 0, drafts: 0, enrollments: 0 }, 'tenant A sees nothing of B');
  assert.deepEqual(await count({ org: b.org, ws: [b.ws] }), { messages: 1, drafts: 1, enrollments: 1 }, 'tenant B sees its own');
  assert.deepEqual(await count({ org: b.org, ws: [t.ws] }), { messages: 0, drafts: 0, enrollments: 0 }, 'B org with A workspace sees nothing');
  const all = (ctx) => as(db, 'lead_owner', ctx, async () => (await one(db, `SELECT (SELECT count(*) FROM messages)::int + (SELECT count(*) FROM drafts)::int + (SELECT count(*) FROM enrollments)::int AS c`)).c);
  assert.equal(await all(null), 0, 'no context: nothing');
  await db.exec('SET ROLE sender_svc');
  try { assert.equal((await one(db, `SELECT record_first_touch($1, 'email', 'agent', $2) AS r`, [t.lead, t.message])).r, 'not_found'); }
  finally { await db.exec('RESET ROLE'); }
});

// ─── 0026: a temp table cannot shadow a definer's lookup ───────────────────────────────────────────────────────────
test('0026: every SECURITY DEFINER function puts pg_temp last in its search_path', async () => {
  const db = await freshDb();
  const bad = await q(db, `SELECT p.oid::regprocedure::text AS fn, p.proconfig AS cfg FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.prosecdef AND NOT ('search_path=public, pg_temp' = ANY (coalesce(p.proconfig, '{}')))`);
  assert.deepEqual(bad, [], 'a definer without `SET search_path = public, pg_temp` can be shadowed by a temp table');
});

test('0026: no service role can create a temp table (TEMP is revoked from PUBLIC and each role)', async () => {
  const db = await freshDb();
  for (const role of ['app_rw', 'gate_svc', 'inbox_svc', 'sender_svc', 'ops']) {
    assert.equal((await one(db, `SELECT has_database_privilege($1, current_database(), 'TEMP') AS h`, [role])).h, false, `${role} holds TEMP`);
    await db.exec(`SET ROLE ${role}`);
    try { assert.match(await refused(db.query(`CREATE TEMP TABLE shadow_probe (x int)`)) ?? 'ran', /permission denied/, role); }
    finally { await db.exec('RESET ROLE'); }
  }
});

test('0026: a temp messages/drafts/enrollments table cannot shadow the definer lookup (the V-19 repro)', async () => {
  const db = await freshDb();
  const t = await clean(db, 'alpha');
  const lead = (await rec(db, t, { at: minutes(0) })).lead_event_id;
  await markSent(db, t, { state: 'claimed' });            // the real message was never sent
  // A session that CAN create temp tables (the superuser here; a role that still held TEMP before 0026) plants fakes that say
  // "sent, to this contact": the definer must still read the real tables.
  await db.exec(`CREATE TEMP TABLE messages AS SELECT * FROM public.messages`);
  await db.exec(`UPDATE pg_temp.messages SET state = 'sent', sent_at = clock_timestamp()`);
  await db.exec(`GRANT SELECT ON pg_temp.messages TO PUBLIC`);   // readable by the definer, as the verifier's repro had it
  try {
    assert.equal(await touch(db, 'sender_svc', t, lead, { message: t.message }), 'message_not_sent', 'the real (claimed) message decides');
    await db.exec(`CREATE TEMP TABLE drafts AS SELECT * FROM public.drafts`);
    await db.exec(`CREATE TEMP TABLE enrollments AS SELECT * FROM public.enrollments`);
    await db.exec(`UPDATE pg_temp.enrollments SET contact_id = '00000000-0000-4000-8000-000000000000'`);
    await db.exec(`GRANT SELECT ON pg_temp.drafts, pg_temp.enrollments TO PUBLIC`);
    assert.equal(await touch(db, 'sender_svc', t, lead, { message: t.message }), 'message_not_sent', 'temp drafts and enrollments are ignored too');
    assert.deepEqual(await touched(db, lead), { first_touch_at: null, first_touch_message_id: null }, 'nothing written');
  } finally {
    await db.exec(`DROP TABLE IF EXISTS pg_temp.messages, pg_temp.drafts, pg_temp.enrollments`);
  }
  await markSent(db, t, { state: 'sent' });
  assert.equal(await touch(db, 'sender_svc', t, lead, { message: t.message }), 'recorded', 'and the honest send still works');
});
