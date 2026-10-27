// 0022 (S2L-1): lead_events, the consent and suppression blocker, the write-once first touch, and the time-to-first-touch metric.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, one, q, refused } from './helpers.mjs';

const REC = `SELECT * FROM record_lead_event($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
const rec = (db, t, o = {}) => as(db, 'inbox_svc', { org: t.org, ws: [t.ws] }, () => one(db, REC, [
  o.org ?? t.org, o.ws ?? t.ws, o.source ?? 'web_form', o.channel ?? 'form', o.ext ?? 'ext-1', 'contact' in o ? o.contact : t.contact,
  o.consent ?? 'express_form', o.at ?? new Date().toISOString(), JSON.stringify(o.payload ?? {})]));
const blocker = (db, role, t, id) => as(db, role, { org: t.org, ws: [t.ws] }, async () => (await one(db, `SELECT lead_touch_blocker($1) AS r`, [id])).r);
const touch = (db, role, t, id, o = {}) => as(db, role, { org: t.org, ws: [t.ws] }, async () =>
  (await one(db, `SELECT record_first_touch($1, $2, $3, $4) AS r`, [id, o.channel ?? 'email', o.by ?? 'agent', o.at ?? new Date().toISOString()])).r);
const clean = async (db, label) => { const t = await seedTenant(db, label); await db.query('DELETE FROM lead_events WHERE org_id = $1', [t.org]); return t; };
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
  try { assert.equal((await one(db, `SELECT record_first_touch($1, 'email', 'agent', now()) AS r`, [bLead])).r, 'not_found'); }
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
  assert.equal(await touch(db, 'sender_svc', t, id, { by: 'system', channel: 'sms' }), 'recorded');
  assert.equal(await touch(db, 'sender_svc', t, id, { by: 'agent' }), 'already_touched');
  const row = await one(db, `SELECT first_touch_by, first_touch_channel FROM lead_events WHERE id = $1`, [id]);
  assert.deepEqual([row.first_touch_by, row.first_touch_channel], ['system', 'sms'], 'the second call changed nothing');
  // The table itself refuses a rewrite, even from the migrator, and any change to the rest of the row.
  assert.match(await refused(db.query(`UPDATE lead_events SET first_touch_at = first_touch_at + interval '1 minute' WHERE id = $1`, [id])) ?? 'ran', /write-once/);
  assert.match(await refused(db.query(`UPDATE lead_events SET first_touch_by = 'human' WHERE id = $1`, [id])) ?? 'ran', /write-once/);
  assert.match(await refused(db.query(`UPDATE lead_events SET first_touch_at = NULL, first_touch_channel = NULL, first_touch_by = NULL WHERE id = $1`, [id])) ?? 'ran', /write-once/);
  assert.match(await refused(db.query(`UPDATE lead_events SET consent_basis = 'none' WHERE id = $1`, [id])) ?? 'ran', /immutable/);
  assert.match(await refused(db.query(`UPDATE lead_events SET received_at = received_at - interval '1 hour' WHERE id = $1`, [id])) ?? 'ran', /immutable/);
  // CHECKs: a bad actor, a touch before the lead, half a touch.
  const id2 = (await rec(db, t, { ext: 'e2' })).lead_event_id;
  assert.ok(await refused(touch(db, 'sender_svc', t, id2, { by: 'robot' })), 'unknown first_touch_by');
  assert.ok(await refused(db.query(`UPDATE lead_events SET first_touch_at = now() WHERE id = $1`, [id2])), 'a touch with no channel or actor');
  assert.ok(await refused(touch(db, 'sender_svc', t, id2, { at: new Date(Date.now() - 86400000 * 365).toISOString() })), 'a touch before the lead arrived');
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
  assert.deepEqual(cols, ['channel', 'consent_basis', 'contact_id', 'created_at', 'external_id', 'first_touch_at', 'first_touch_by', 'first_touch_channel',
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
  assert.equal(web.within_window, 2, 'default window 5 min: the 2- and 4-minute touches');
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
  assert.equal(await within(), 2, 'default 5 minutes: the 2 and 4 minute touches');
  await db.query(`UPDATE workspaces SET response_window_minutes = 3 WHERE id = $1`, [t.ws]);
  assert.equal(await within(), 1, '3 minutes: only the 2 minute touch');
  await db.query(`UPDATE workspaces SET response_window_minutes = 10 WHERE id = $1`, [t.ws]);
  assert.equal(await within(), 3, '10 minutes: all three');
  assert.ok(await refused(db.query(`UPDATE workspaces SET response_window_minutes = 0 WHERE id = $1`, [t.ws])), 'the window is 1 to 1440');
});
