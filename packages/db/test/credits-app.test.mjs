// 0009: the app's own credit wrappers. Tenant-bound (the org comes from the session, never a parameter), capped, and
// still under 0001's ledger rules. Each test tries to break one of those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused } from './helpers.mjs';

const bal = async (db, org, meter = 'action') =>
  Number((await db.query(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = $2`, [org, meter])).rows[0]?.balance ?? -1);
const asApp = (db, t, sql, params) => as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => db.query(sql, params));

async function setup() {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'beta');
  for (const t of [a, b]) {
    await db.query(`INSERT INTO credit_balances (org_id, meter, balance) VALUES ($1, 'action', 50)
                    ON CONFLICT (org_id, meter) DO UPDATE SET balance = 50`, [t.org]);
  }
  return { db, a, b };
}

test('app reserves and releases its own org\'s credits; the ledger records both', async () => {
  const { db, a } = await setup();
  await asApp(db, a, `SELECT app_credit_reserve('action', 10, 'generate', 'job-1')`);
  assert.equal(await bal(db, a.org), 40);
  await asApp(db, a, `SELECT app_credit_release('action', 4, 'generate', 'job-1')`);
  assert.equal(await bal(db, a.org), 44);
  const rows = (await db.query(`SELECT kind, delta FROM credit_ledger WHERE org_id = $1 AND ref_id = 'job-1' ORDER BY id`, [a.org])).rows;
  assert.deepEqual(rows.map((r) => [r.kind, Number(r.delta)]), [['reserve', -10], ['release', 4]]);
});

test('no way to touch another org: the wrapper has no org parameter, and the raw functions stay ops-only', async () => {
  const { db, a, b } = await setup();
  assert.match(await refused(asApp(db, a, `SELECT credit_reserve($1, 'action', 5, 'x', 'y')`, [b.org])) ?? '', /permission denied/);
  assert.match(await refused(asApp(db, a, `SELECT credit_release($1, 'action', 5, 'x', 'y')`, [b.org])) ?? '', /permission denied/);
  // Even holding a reservation in its own org, A can't release into B's balance: the release goes to app_org().
  await asApp(db, a, `SELECT app_credit_reserve('action', 5, 'generate', 'job-x')`);
  await asApp(db, a, `SELECT app_credit_release('action', 5, 'generate', 'job-x')`);
  assert.deepEqual([await bal(db, a.org), await bal(db, b.org)], [50, 50]);
});

test('A can\'t refund itself from B\'s job: a release needs this org\'s own reservation under that reference', async () => {
  const { db, a, b } = await setup();
  await asApp(db, b, `SELECT app_credit_reserve('action', 20, 'generate', 'shared-ref')`);
  assert.match(await refused(asApp(db, a, `SELECT app_credit_release('action', 20, 'generate', 'shared-ref')`)) ?? '', /exceeds what this job still holds/);
  assert.deepEqual([await bal(db, a.org), await bal(db, b.org)], [50, 30]);
});

test('limits: no overspend, no free money, a cap per call, a job reference, a tenant', async () => {
  const { db, a } = await setup();
  assert.match(await refused(asApp(db, a, `SELECT app_credit_reserve('action', 51, 'generate', 'j')`)) ?? '', /balance_check/);
  assert.match(await refused(asApp(db, a, `SELECT app_credit_reserve('action', -5, 'generate', 'j')`)) ?? '', /1\.\.10000/);
  assert.match(await refused(asApp(db, a, `SELECT app_credit_reserve('action', 10001, 'generate', 'j')`)) ?? '', /1\.\.10000/);
  assert.match(await refused(asApp(db, a, `SELECT app_credit_reserve('action', 1, 'Robert''); --', 'j')`)) ?? '', /job reference/);
  assert.match(await refused(asApp(db, a, `SELECT app_credit_release('action', 1, 'generate', 'never-reserved')`)) ?? '', /exceeds/);
  assert.match(await refused(as(db, 'app_rw', null, () => db.query(`SELECT app_credit_reserve('action', 1, 'generate', 'j')`))) ?? '', /no tenant|invalid input/);
  assert.equal(await bal(db, a.org), 50);
  // The app still can't write balances or the ledger directly.
  assert.match(await refused(asApp(db, a, `UPDATE credit_balances SET balance = 999999 WHERE org_id = $1`, [a.org])) ?? '', /permission denied/);
  assert.match(await refused(asApp(db, a, `INSERT INTO credit_ledger (org_id, meter, delta, kind) VALUES ($1, 'action', 999, 'grant')`, [a.org])) ?? '', /permission denied/);
});
