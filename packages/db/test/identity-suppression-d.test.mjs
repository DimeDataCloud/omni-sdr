// 0020, design tests 35, 41, 43, 45, 46, 47, 49, 54, 56, 58: origins, bridging, held names after rename/delete, hand-off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb, seedTenant, as, refused, one, q } from './helpers.mjs';

const ctxOf = (t) => ({ org: t.org, ws: [t.ws] });
async function addContact(db, t, { name, email = null, phone = null, slug = null }) {
  return (await one(db,
    `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, phone, linkedin_slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [t.org, t.ws, name, email, email ? 'valid' : 'unknown', phone, slug])).id;
}
const suppressed = (db, id, channel = null) => one(db, `SELECT person_suppressed($1, $2) AS s`, [id, channel]).then((r) => r.s);
const optOut = (db, t, id, reason = 'manual') => as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, $2)`, [id, reason]));
const asUser = (db, t, user, fn) => as(db, 'app_rw', ctxOf(t), async () => {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [user]);
  return fn();
});
const handoff = (db, ctx, id) => as(db, 'sender_svc', ctx, () => one(db, `SELECT message_handoff_ok($1) AS ok`, [id])).then((r) => r.ok);

test('35/50: a dummy holding the real holder\'s phone, opted out later, never becomes the origin of an origin-less row', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const x = await addContact(db, t, { name: 'Real Holder', email: 'x@x.test', phone: '615-555-0150' });
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash('+16155550150'), 'phone', 'sms_stop')`, [t.org]);
  const d = await addContact(db, t, { name: 'Dummy Contact', email: 'd@x.test', phone: '(615) 555-0150' });
  await optOut(db, t, d);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM suppression_origins WHERE value_hash = value_hash('+16155550150')`)).n, 0, 'no origin appears on a row that had none');
  assert.equal(await suppressed(db, x, 'email'), true, 'the real holder stays blocked on email');
});

test('41: a two-row import that bridges to an opted-out address is closed in one statement', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Alice Anders', email: 'a@x.test' });
  await optOut(db, t, a);
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [t.org])).id;
  await db.query(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status, linkedin_slug) VALUES
    ($1, $2, 'Bridge One', 'b@x.test', 'unknown', 'in/bridge-x'), ($1, $3, 'Bridge Two', 'a@x.test', 'unknown', 'in/bridge-x')`, [t.org, t.ws, ws2]);
  const b = (await one(db, `SELECT id FROM contacts WHERE email = 'b@x.test'`)).id;
  assert.equal(await suppressed(db, b), true);
});

test('45: rename and delete of a profile-only opted-out contact, then a same-name import: held; the rename needs reason, role and audit', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const reviewer = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ('rv', 'rv@alpha.test') RETURNING id`)).id;
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'reviewer')`, [t.org, reviewer]);
  const p = await addContact(db, t, { name: 'Maria Lopez', slug: 'in/maria-lopez' });
  await optOut(db, t, p);
  assert.match((await refused(as(db, 'app_rw', ctxOf(t), () => db.query(`UPDATE contacts SET name = 'Mary Lopes' WHERE id = $1`, [p])))) ?? '', /opted out/);
  assert.match((await refused(asUser(db, t, t.user, () => db.query(`SELECT rename_opted_out_contact($1, 'Mary Lopes', 'short')`, [p])))) ?? '', /10 characters/);
  assert.match((await refused(asUser(db, t, reviewer, () => db.query(`SELECT rename_opted_out_contact($1, 'Mary Lopes', 'Legal name change confirmed')`, [p])))) ?? '', /./, 'a reviewer may not rename');
  await asUser(db, t, t.user, () => db.query(`SELECT rename_opted_out_contact($1, 'Mary Lopes', 'Legal name change confirmed')`, [p]));
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM audit_log WHERE action = 'rename_opted_out' AND entity_id = $1`, [p])).n, 1);
  await db.query(`DELETE FROM contacts WHERE id = $1`, [p]);
  const again = await addContact(db, t, { name: 'Maria Lopez', email: 'm@elsewhere.test' });
  assert.equal(await suppressed(db, again), true, 'the seed outlives the rename and the delete');
});

test('46: deleting the contact that bridged a component releases nothing', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Alice Anders', email: 'a@x.test' });
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [t.org])).id;
  const bridge = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, linkedin_slug) VALUES ($1, $2, 'Bridge Person', 'a@x.test', 'unknown', 'in/bridge-y') RETURNING id`, [t.org, ws2])).id;
  const b = await addContact(db, t, { name: 'Bobby Brown', email: 'b@x.test', slug: 'in/bridge-y' });
  await optOut(db, t, a);
  assert.equal(await suppressed(db, b), true);
  await db.query(`DELETE FROM contacts WHERE id = $1`, [bridge]);
  assert.equal(await suppressed(db, b), true);
});

test('47: message_handoff_ok on another org\'s message is false and the shared org lock is taken; sender_svc is the only grantee', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const u = await seedTenant(db, 'beta');
  await db.query('BEGIN');
  try {
    assert.equal(await handoff(db, ctxOf(u), t.message), false);
    const locks = await q(db, `SELECT mode FROM pg_locks WHERE locktype = 'advisory' AND granted`);
    assert.ok(locks.some((l) => l.mode === 'ShareLock'), 'shared advisory lock held');
  } finally { await db.query('ROLLBACK'); }
  for (const role of ['app_rw', 'gate_svc', 'inbox_svc', 'ops']) {
    assert.equal((await one(db, `SELECT has_function_privilege($1, 'message_handoff_ok(uuid)', 'EXECUTE') AS g`, [role])).g, false, role);
  }
  assert.equal((await one(db, `SELECT has_function_privilege('sender_svc', 'message_handoff_ok(uuid)', 'EXECUTE') AS g`)).g, true);
});

test('49: attaching an email and phone to an opted-out profile-only person later does not unhold the same-name twin', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const v = await addContact(db, t, { name: 'Victor Vance', slug: 'in/victor-vance' });
  await optOut(db, t, v);
  await db.query(`UPDATE contacts SET email = 'v@x.test', phone = '615-555-0161' WHERE id = $1`, [v]);
  const twin = await addContact(db, t, { name: 'Victor Vance', email: 'other@x.test' });
  assert.equal(await suppressed(db, twin), true);
  assert.equal(await suppressed(db, v), true);
});

test('54: a person with profile and phone and no email seeds the name (twin held with or without the phone); email plus profile seeds nothing', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const v = await addContact(db, t, { name: 'Victor Vance', slug: 'in/victor-vance', phone: '615-555-0162' });
  await optOut(db, t, v);
  assert.equal(await suppressed(db, await addContact(db, t, { name: 'Victor Vance', email: 't1@x.test' }), 'email'), true);
  assert.equal(await suppressed(db, await addContact(db, t, { name: 'Victor Vance', email: 't2@x.test', phone: '615-555-0162' }), 'email'), true);
  const e = await addContact(db, t, { name: 'Edith Ember', slug: 'in/edith-ember', email: 'e@x.test' });
  const before = (await one(db, `SELECT count(*)::int AS n FROM optout_name_seeds`)).n;
  await optOut(db, t, e);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM optout_name_seeds`)).n, before, 'email plus profile writes no seed (stated residual)');
  assert.equal(await suppressed(db, await addContact(db, t, { name: 'Edith Ember', email: 'e2@x.test' })), false);
});

test('56: the name hash has one formula, the vectors collide, one token yields none, org_salts is keyed by org', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const h = (n) => one(db, `SELECT name_seed_hash($1, $2, true) AS h`, [t.org, n]).then((r) => r.h);
  const jr = await h('Jane  Roe');
  assert.equal(await h('jane roe'), jr);
  assert.equal(await h('JANE-ROE'), jr);
  assert.equal(await h('Jane'), null);
  const salt = (await one(db, `SELECT salt FROM org_salts WHERE org_id = $1`, [t.org])).salt;
  assert.equal(jr, (await one(db, `SELECT value_hash($1 || ':name:' || normalize_name('Jane Roe')) AS h`, [salt])).h);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid WHERE c.relname = 'org_salts' AND i.indisprimary`)).n, 1);
});

test('43/58: message_handoff_ok and send_guard are VOLATILE, and the hand-off takes the lock before it reads', async () => {
  const db = await freshDb();
  for (const f of ['message_handoff_ok', 'send_guard']) {
    assert.equal((await one(db, `SELECT provolatile FROM pg_proc WHERE proname = $1`, [f])).provolatile, 'v', f);
  }
  const sql = readFileSync(new URL('../migrations/0020_identity_suppression.sql', import.meta.url), 'utf8');
  const body = sql.slice(sql.indexOf('CREATE FUNCTION message_handoff_ok'));
  assert.ok(body.indexOf('pg_advisory_xact_lock_shared') < body.indexOf('person_suppressed('), 'lock first, read after');
  const t = await seedTenant(db, 'alpha');
  assert.equal(await handoff(db, ctxOf(t), t.message), true);
  await optOut(db, t, t.contact);
  assert.equal(await handoff(db, ctxOf(t), t.message), false, 'a row committed before the lock is seen');
});
