import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused, one } from './helpers.mjs';
import { migrate } from '../src/migrate.mjs';

const balance = async (db, org) =>
  Number((await one(db, `SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'media'`, [org])).balance);

test('credits: overspend is refused and leaves the balance untouched', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha'); // 100 media credits
  const msg = await refused(as(db, 'ops', null, () =>
    db.query(`SELECT credit_reserve($1, 'media', 150, 'render', 'job-1')`, [t.org])));
  assert.match(msg ?? '', /credit_balances_balance_check/);
  assert.equal(await balance(db, t.org), 100);
});

test('credits: reserve then release a failed job restores the balance; over-release is refused', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await as(db, 'ops', null, () => db.query(`SELECT credit_reserve($1, 'media', 60, 'render', 'job-1')`, [t.org]));
  assert.equal(await balance(db, t.org), 40);
  assert.match(await refused(as(db, 'ops', null, () =>
    db.query(`SELECT credit_release($1, 'media', 61, 'render', 'job-1')`, [t.org]))) ?? '', /exceeds/);
  await as(db, 'ops', null, () => db.query(`SELECT credit_release($1, 'media', 60, 'render', 'job-1')`, [t.org]));
  assert.equal(await balance(db, t.org), 100);
  const sum = await one(db, `SELECT sum(delta)::bigint AS s FROM credit_ledger WHERE org_id = $1 AND meter = 'media'`, [t.org]);
  assert.equal(Number(sum.s), 100, 'ledger sum disagrees with the cached balance');
});

test('credits: the app role cannot move money', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const msg = await refused(as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () =>
    db.query(`SELECT credit_reserve($1, 'media', 1, 'x', 'y')`, [t.org])));
  assert.match(msg ?? '', /permission denied/);
});

test('evidence is immutable except for its expiry', async () => {
  const db = await freshDb();
  await seedTenant(db, 'alpha');
  assert.match(await refused(db.query(`UPDATE evidence SET facts = '{"booking":true}'`)) ?? '', /immutable/);
  assert.equal(await refused(db.query(`UPDATE evidence SET expires_at = now() + interval '1 day'`)), null);
});

test('audit_log is append-only', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  assert.match(await refused(db.query(`UPDATE audit_log SET action = 'x'`)) ?? '', /append-only/);
  assert.match(await refused(as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () =>
    db.query(`DELETE FROM audit_log`))) ?? '', /permission denied/);
});

test('cross-tenant functions are not owned by a superuser', async () => {
  const db = await freshDb();
  const rows = (await db.query(`
    SELECT p.proname, r.rolname, r.rolsuper, r.rolbypassrls FROM pg_proc p
    JOIN pg_roles r ON r.oid = p.proowner JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef`)).rows;
  console.log(`  SECURITY DEFINER functions: ${rows.map((r) => `${r.proname}→${r.rolname}`).join(', ')}`);
  assert.ok(rows.length >= 3, `expected ≥3 SECURITY DEFINER functions, found ${rows.length}`);
  for (const r of rows) {
    assert.equal(r.rolsuper, false, `${r.proname} owned by superuser ${r.rolname}; Cloud SQL has none`);
    assert.equal(r.rolbypassrls, false, `${r.proname} relies on BYPASSRLS`);
  }
});

test('migrations are idempotent', async () => {
  const db = await freshDb();
  const second = await migrate(db);
  assert.ok(second.total >= 1);
  assert.deepEqual(second.ran, []);
});
