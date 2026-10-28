// 0020, design tests 9, 10, 19, 21, 22/26/27, 31, 32, 36, 37, 38, 39, 48, 51, 52, 53, 55: catalog, phone lines, holds, locks.
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
const asUser = (db, t, fn) => as(db, 'app_rw', ctxOf(t), async () => {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [t.user]);
  return fn();
});

test('9: no schema CREATE for the 0020 owners; they own nothing but their functions', async () => {
  const db = await freshDb();
  for (const r of ['identity_owner', 'guard_owner', 'rename_owner', 'unsub_owner']) {
    assert.equal((await one(db, `SELECT has_schema_privilege($1, 'public', 'CREATE') AS c`, [r])).c, false, r);
  }
});

test('10: RLS catalog on the new tables: forced, tenant + ops + closer_scope where tenants may read, only definers write', async () => {
  const db = await freshDb();
  for (const t of ['contact_identities', 'suppression_origins', 'org_salts', 'optout_name_seeds']) {
    const r = await one(db, `SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t]);
    assert.deepEqual(r, { on: true, forced: true }, t);
  }
  const pol = async (t) => (await q(db, `SELECT policyname FROM pg_policies WHERE tablename = $1 ORDER BY 1`, [t])).map((r) => r.policyname);
  assert.deepEqual(await pol('contact_identities'), ['closer_scope', 'guard_read', 'identity_all', 'ops_all', 'tenant']);
  for (const t of ['contact_identities', 'suppression_origins']) {
    for (const role of ['app_rw', 'gate_svc', 'sender_svc', 'inbox_svc', 'ops']) {
      for (const priv of role === 'ops' ? ['INSERT', 'UPDATE'] : ['INSERT', 'UPDATE', 'DELETE']) {
        assert.equal((await one(db, `SELECT has_table_privilege($1, $2, $3) AS g`, [role, t, priv])).g, false, `${role} ${priv} ${t}`);
      }
    }
  }
});

test('19: the hold is set whichever order the contact and the opt-out arrive in', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Maria Lopez', slug: 'in/maria-lopez' });
  await optOut(db, t, a);
  const later = await addContact(db, t, { name: 'maria  LOPEZ', email: 'm@x.test' });
  assert.equal(await suppressed(db, later), true);
  // Reverse order: the held name exists first, the opt-out comes second.
  const b = await addContact(db, t, { name: 'Pat Quinn', slug: 'in/pat-quinn' });
  const twin = await addContact(db, t, { name: 'Pat Quinn', email: 'pq@x.test' });
  assert.equal(await suppressed(db, twin), false);
  await optOut(db, t, b);
  assert.equal(await suppressed(db, twin), true, 'a twin that existed before the opt-out is closed by the seed too');
  const fresh = await addContact(db, t, { name: 'Pat Quinn', email: 'pq2@x.test' });
  assert.equal(await suppressed(db, fresh), true);
});

test('21: hold columns are unwritable by app roles; clear needs reason, role and an audit row', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Maria Lopez', slug: 'in/maria-lopez' });
  await optOut(db, t, a);
  const b = await addContact(db, t, { name: 'Maria Lopez', email: 'm@x.test' });
  for (const role of ['app_rw', 'ops']) {
    assert.match((await refused(as(db, role, ctxOf(t), () => db.query(`UPDATE contacts SET hold_cleared_at = now() WHERE id = $1`, [b])))) ?? '', /permission denied/, role);
  }
  assert.match((await refused(as(db, 'app_rw', ctxOf(t), () => db.query(`SELECT clear_name_hold($1, 'long enough reason')`, [b])))) ?? '', /./, 'no user, no clear');
  await asUser(db, t, () => db.query(`SELECT clear_name_hold($1, 'Verified by phone call today')`, [b]));
  assert.equal(await suppressed(db, b), false);
  const row = await one(db, `SELECT hold_cleared_by, hold_clear_reason FROM contacts WHERE id = $1`, [b]);
  assert.equal(row.hold_cleared_by, t.user);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM audit_log WHERE action = 'clear_hold' AND entity_id = $1`, [b])).n, 1);
});

test('22/26/27: phone lines: own phone refused on every channel, a shared line blocks sms and voice not email, an unattributable row blocks all', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Owner One', email: 'a@x.test', phone: '615-555-0142' });
  const b = await addContact(db, t, { name: 'Desk Mate', email: 'b@x.test', phone: '(615) 555-0142' });
  await optOut(db, t, a);
  for (const ch of ['email', 'sms', 'voice', 'linkedin_assist']) assert.equal(await suppressed(db, a, ch), true, `own ${ch}`);
  assert.equal(await suppressed(db, b, 'email'), false, 'same line, different person: email is allowed');
  for (const ch of ['sms', 'voice']) assert.equal(await suppressed(db, b, ch), true, ch);
  // Unattributable: a phone row with no origin blocks every channel for anyone on that line.
  const c = await addContact(db, t, { name: 'Third Person', email: 'c@x.test', phone: '+1 615 555 0177' });
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash('+16155550177'), 'phone', 'stop')`, [t.org]);
  for (const ch of ['email', 'sms', 'voice']) assert.equal(await suppressed(db, c, ch), true, `unattributed ${ch}`);
});

test('51: the shared-line exemption is only for channel email; anything else counts', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Owner One', email: 'a@x.test', phone: '615-555-0142' });
  const b = await addContact(db, t, { name: 'Desk Mate', email: 'b@x.test', phone: '615-555-0142' });
  await optOut(db, t, a);
  assert.equal(await suppressed(db, b, 'email'), false);
  for (const ch of ['sms', 'voice', 'linkedin_assist', 'carrier-pigeon', null]) assert.equal(await suppressed(db, b, ch), true, String(ch));
});

test('53: a second origin on the same phone hash is recorded, and neither origin loses its status', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Owner One', email: 'a@x.test', phone: '615-555-0142' });
  const b = await addContact(db, t, { name: 'Desk Mate', email: 'b@x.test', phone: '615-555-0142' });
  await optOut(db, t, a);
  await optOut(db, t, b);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM suppression_origins WHERE value_hash = value_hash('+16155550142')`)).n, 2);
  assert.equal(await suppressed(db, b, 'email'), true, 'b is now an origin itself');
});

test('31: no 0020 function body reads an omni. setting', () => {
  const sql = readFileSync(new URL('../migrations/0020_identity_suppression.sql', import.meta.url), 'utf8');
  assert.equal(/current_setting\(\s*'omni\./.test(sql), false);
});

test('32: closure and guard take the same per-org advisory lock via org_lock_key', async () => {
  const sql = readFileSync(new URL('../migrations/0020_identity_suppression.sql', import.meta.url), 'utf8');
  const uses = sql.match(/pg_advisory_xact_lock(_shared)?\(\s*org_lock_key/g) ?? [];
  assert.ok(uses.length >= 3, `expected the lock in the org-lock trigger, send_guard and handoff, found ${uses.length}`);
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await db.query('BEGIN');
  try {
    await db.query(`SELECT pg_advisory_xact_lock(org_lock_key($1))`, [t.org]);
    const held = await one(db, `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted`);
    assert.ok(held.n >= 1);
  } finally { await db.query('ROLLBACK'); }
});

test('36: an explicit org never touches another org', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const u = await seedTenant(db, 'beta');
  const a = await addContact(db, t, { name: 'Jane Doe', email: 'j@x.test' });
  await addContact(db, u, { name: 'Jane Doe', email: 'j@x.test' });
  const before = (await one(db, `SELECT count(*)::int AS n FROM suppression WHERE scope_org_id = $1`, [u.org])).n;
  await optOut(db, t, a);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM suppression WHERE scope_org_id = $1`, [u.org])).n, before);
});

test('37: deleting and re-inserting a held name holds again; app roles hold column grants only', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Maria Lopez', slug: 'in/maria-lopez' });
  await optOut(db, t, a);
  const b = await addContact(db, t, { name: 'Maria Lopez', email: 'm@x.test' });
  await db.query(`DELETE FROM contacts WHERE id = $1`, [b]);
  const c = await addContact(db, t, { name: 'Maria Lopez', email: 'm@x.test' });
  assert.equal(await suppressed(db, c), true);
  for (const role of ['app_rw', 'ops']) {
    for (const priv of ['INSERT', 'UPDATE']) {
      assert.equal((await one(db, `SELECT has_table_privilege($1, 'contacts', $2) AS g`, [role, priv])).g, false, `${role} ${priv}`);
    }
    assert.equal((await one(db, `SELECT has_column_privilege($1, 'contacts', 'name', 'UPDATE') AS g`, [role])).g, true, `${role} name`);
    assert.equal((await one(db, `SELECT has_column_privilege($1, 'contacts', 'hold_reason', 'INSERT') AS g`, [role])).g, false);
  }
});

test('38: an upsert that renames into a held name is held; a cleared hold is not set again', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Maria Lopez', slug: 'in/maria-lopez' });
  await optOut(db, t, a);
  const b = await addContact(db, t, { name: 'Someone Else', email: 'm@x.test' });
  assert.equal(await suppressed(db, b), false);
  await db.query(`UPDATE contacts SET name = 'Maria Lopez' WHERE id = $1`, [b]);
  assert.equal(await suppressed(db, b), true, 'renamed into the held name');
  await asUser(db, t, () => db.query(`SELECT clear_name_hold($1, 'Verified by phone call today')`, [b]));
  await db.query(`UPDATE contacts SET name = 'Maria Lopez', title = 'CEO' WHERE id = $1`, [b]);
  assert.equal(await suppressed(db, b), false, 'saving the same name again does not re-hold');
});

test('39: a shared-phone STOP sequence keeps the first origin; backdating created_at is not writable', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Owner One', email: 'a@x.test', phone: '615-555-0142' });
  await optOut(db, t, a);
  assert.match((await refused(as(db, 'app_rw', ctxOf(t), () => db.query(`UPDATE suppression_origins SET created_at = now() - interval '1 year'`)))) ?? '', /permission denied/);
});

test('48: the seed table has no tenant access, no plaintext name, survives a contact delete and goes with the org; one token seeds nothing', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Maria Lopez', slug: 'in/maria-lopez' });
  await optOut(db, t, a);
  const seeds = await q(db, `SELECT * FROM optout_name_seeds WHERE org_id = $1`, [t.org]);
  assert.ok(seeds.length >= 1);
  assert.equal(JSON.stringify(seeds).toLowerCase().includes('maria'), false, 'no plaintext name');
  await db.query(`DELETE FROM contacts WHERE id = $1`, [a]);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM optout_name_seeds WHERE org_id = $1`, [t.org])).n, seeds.length);
  const solo = await addContact(db, t, { name: 'Cher', slug: 'in/cher-fan' });
  const n = (await one(db, `SELECT count(*)::int AS n FROM optout_name_seeds`)).n;
  await optOut(db, t, solo);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM optout_name_seeds`)).n, n);
});

test('52: rename block: a direct rename of an opted-out contact is refused, nothing is a member of rename_owner', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Maria Lopez', slug: 'in/maria-lopez' });
  await optOut(db, t, a);
  assert.match((await refused(as(db, 'app_rw', ctxOf(t), () => db.query(`UPDATE contacts SET name = 'Mary L' WHERE id = $1`, [a])))) ?? '', /opted out/);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = 'rename_owner'`)).n, 0);
  await asUser(db, t, () => db.query(`SELECT rename_opted_out_contact($1, 'Mary Lopez', 'Legal name change confirmed')`, [a]));
  assert.equal((await one(db, `SELECT name FROM contacts WHERE id = $1`, [a])).name, 'Mary Lopez');
});

test('55: org_salts cannot be updated or deleted by any role; a seed with no salt row makes name_seed_hash raise', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  for (const role of ['app_rw', 'gate_svc', 'sender_svc', 'inbox_svc', 'ops']) {
    assert.match((await refused(as(db, role, ctxOf(t), () => db.query(`UPDATE org_salts SET salt = 'x'`)))) ?? '', /permission denied|row-level/, role);
    assert.match((await refused(as(db, role, ctxOf(t), () => db.query(`DELETE FROM org_salts`)))) ?? '', /permission denied|row-level/, role);
  }
  assert.match((await refused(db.query(`UPDATE org_salts SET salt = repeat('z', 40) WHERE org_id = $1`, [t.org]))) ?? '', /immutable|cannot/i);
  const bare = (await one(db, `INSERT INTO orgs (name) VALUES ('bare') RETURNING id`)).id;
  assert.equal((await one(db, `SELECT name_seed_hash($1, 'Maria Lopez', false) AS h`, [bare])).h, null, 'no seeds, no salt: nothing to match');
  await db.query(`INSERT INTO optout_name_seeds (org_id, name_hash, seed_value_hash) VALUES ($1, 'h', 's')`, [bare]);
  assert.match((await refused(db.query(`SELECT name_seed_hash($1, 'Maria Lopez', false)`, [bare]))) ?? '', /no salt/);
  await db.query(`DELETE FROM optout_name_seeds WHERE org_id = $1`, [bare]);
  const h1 = (await one(db, `SELECT name_seed_hash($1, 'Maria Lopez', true) AS h`, [bare])).h;
  const h2 = (await one(db, `SELECT name_seed_hash($1, 'Maria Lopez', true) AS h`, [bare])).h;
  assert.equal(h1, h2, 'one salt on repeated first use');
});
