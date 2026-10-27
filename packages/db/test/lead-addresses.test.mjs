// 0027: inbound lead addresses. The token hash is never readable by the app, an address resolves only while live, and an
// unknown, revoked or malformed token all get the same empty answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freshDb, seedTenant, as, refused } from './helpers.mjs';

const hash = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const ctx = (t) => ({ org: t.org, ws: [t.ws] });
const resolve = (db, caller, h) => as(db, 'inbox_svc', ctx(caller), async () =>
  (await db.query(`SELECT * FROM inbox_resolve_lead_address($1)`, [h])).rows);
const mint = async (db, t, token, name = 'Leads') => (await as(db, 'app_rw', ctx(t), () => db.query(
  `INSERT INTO inbound_lead_addresses (org_id, workspace_id, name, token_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
  [t.org, t.ws, name, hash(token)]))).rows[0].id;

test('lead addresses: app_rw creates, lists and revokes; never reads the token hash; tenants are walled', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha'); const b = await seedTenant(db, 'beta');
  const id = await mint(db, a, 'tok-a');
  const inA = (sql, p) => as(db, 'app_rw', ctx(a), () => db.query(sql, p));
  assert.equal((await inA(`SELECT count(*)::int AS n FROM inbound_lead_addresses`)).rows[0].n, 2, 'the seed address + this one');
  assert.match(await refused(inA(`SELECT token_hash FROM inbound_lead_addresses`)) ?? '', /permission denied/);
  assert.match(await refused(inA(`UPDATE inbound_lead_addresses SET name = 'x' WHERE id = $1`, [id])) ?? '', /permission denied/);
  assert.match(await refused(inA(`UPDATE inbound_lead_addresses SET token_hash = $2 WHERE id = $1`, [id, hash('other')])) ?? '', /permission denied/);
  assert.equal((await as(db, 'app_rw', ctx(b), () => db.query(`SELECT count(*)::int AS n FROM inbound_lead_addresses WHERE id = $1`, [id]))).rows[0].n, 0, 'another tenant sees nothing');
  assert.match(await refused(as(db, 'app_rw', ctx(b), () => db.query(
    `INSERT INTO inbound_lead_addresses (org_id, workspace_id, name, token_hash) VALUES ($1, $2, 'x', $3)`, [a.org, a.ws, hash('t2')]))) ?? '', /row-level security/, 'cannot mint into another tenant');
  assert.match(await refused(inA(`INSERT INTO inbound_lead_addresses (org_id, workspace_id, name, token_hash) VALUES ($1, $2, 'bad', 'not-a-hash')`, [a.org, a.ws])) ?? '', /check constraint/);
  await inA(`UPDATE inbound_lead_addresses SET revoked_at = now() WHERE id = $1`, [id]);
  assert.equal((await inA(`SELECT revoked_at FROM inbound_lead_addresses WHERE id = $1`, [id])).rows[0].revoked_at instanceof Date, true, 'revoke works');
});

test('lead addresses: a live token resolves to exactly its workspace, whatever tenant the caller claims', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha'); const b = await seedTenant(db, 'beta');
  await mint(db, a, 'tok-a'); await mint(db, b, 'tok-b');
  assert.deepEqual(await resolve(db, b, hash('tok-a')), [{ org_id: a.org, workspace_id: a.ws }]);
  assert.deepEqual(await resolve(db, a, hash('tok-b')), [{ org_id: b.org, workspace_id: b.ws }]);
  assert.deepEqual(Object.keys((await resolve(db, a, hash('tok-a')))[0]), ['org_id', 'workspace_id'], 'the answer carries no token hash');
});

test('lead addresses: unknown, revoked and malformed tokens all get the same empty answer; a revoked row never resolves', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const id = await mint(db, a, 'tok-a');
  assert.equal((await resolve(db, a, hash('tok-a'))).length, 1);
  await as(db, 'app_rw', ctx(a), () => db.query(`UPDATE inbound_lead_addresses SET revoked_at = now() WHERE id = $1`, [id]));
  const unknown = await resolve(db, a, hash('never-issued'));
  const revoked = await resolve(db, a, hash('tok-a'));
  assert.deepEqual([unknown, revoked], [[], []], 'revoked looks exactly like unknown');
  for (const bad of ['', 'tok-a', hash('tok-a').toUpperCase(), hash('tok-a').slice(1), hash('tok-a') + 'a', '%', hash('tok-a').replace(/.$/, '%'), null]) {
    assert.deepEqual(await resolve(db, a, bad), [], `malformed ${String(bad).slice(0, 12)}`);
  }
});

test('lead addresses: only inbox_svc can resolve, and it cannot read the table directly', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  await mint(db, a, 'tok-a');
  for (const role of ['app_rw', 'gate_svc', 'sender_svc']) {
    assert.match(await refused(as(db, role, ctx(a), () => db.query(`SELECT * FROM inbox_resolve_lead_address($1)`, [hash('tok-a')]))) ?? '', /permission denied/, role);
  }
  assert.match(await refused(as(db, 'inbox_svc', ctx(a), () => db.query(`SELECT * FROM inbound_lead_addresses`))) ?? '', /permission denied/);
});

test('lead addresses: the definer is owned by inbox_owner, pins search_path public, pg_temp, and a temp table cannot stand in for the real one', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const row = (await db.query(`SELECT pg_get_userbyid(proowner) AS owner, proconfig FROM pg_proc WHERE proname = 'inbox_resolve_lead_address'`)).rows[0];
  assert.equal(row.owner, 'inbox_owner');
  assert.ok(row.proconfig.includes('search_path=public, pg_temp'));
  // A session that CAN create temp tables (the superuser here) plants a fake live address for a token that was never issued.
  await db.exec(`CREATE TEMP TABLE inbound_lead_addresses AS SELECT * FROM public.inbound_lead_addresses WHERE false`);
  await db.query(`INSERT INTO pg_temp.inbound_lead_addresses (id, org_id, workspace_id, name, token_hash) VALUES (gen_random_uuid(), $1, $2, 'fake', $3)`, [a.org, a.ws, hash('forged')]);
  await db.exec(`GRANT SELECT ON pg_temp.inbound_lead_addresses TO PUBLIC`);
  try {
    assert.deepEqual(await resolve(db, a, hash('forged')), [], 'the real table decides');
  } finally {
    await db.exec(`DROP TABLE IF EXISTS pg_temp.inbound_lead_addresses`);
  }
});
