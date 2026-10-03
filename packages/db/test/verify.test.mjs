// 0013: an address is 'valid' only through a paid vendor check (DECISIONS 2026-09-28), so the send guard's
// "email verified" means what it says. Tries to get 'valid' in every other way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused } from './helpers.mjs';

const asApp = (db, t, sql, params) => as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => db.query(sql, params));
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];

async function setup() {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha'); const b = await seedTenant(db, 'beta');
  // No trial (DECISIONS 2026-10-02): ops grants the Data credits these checks spend, through the ledger.
  for (const t of [a, b]) {
    await db.query(`INSERT INTO credit_balances (org_id, meter, balance) VALUES ($1, 'data', 10) ON CONFLICT (org_id, meter) DO UPDATE SET balance = 10`, [t.org]);
    await db.query(`INSERT INTO credit_ledger (org_id, meter, delta, kind, ref_type) VALUES ($1, 'data', 10, 'grant', 'ops')`, [t.org]);
  }
  const mk = async (t, email) => (await asApp(db, t, `INSERT INTO contacts (org_id, workspace_id, email) VALUES ($1, $2, $3) RETURNING id`, [t.org, t.ws, email])).rows[0].id;
  return { db, a, b, ca: await mk(a, 'pat@clinic-a.example'), cb: await mk(b, 'lee@clinic-b.example') };
}
const status = async (db, id) => (await one(db, `SELECT email_status FROM contacts WHERE id = $1`, [id])).email_status;

test('the app cannot write valid: not on insert, not on update, not by changing the address of a valid contact', async () => {
  const { db, a, ca } = await setup();
  assert.match(await refused(asApp(db, a, `INSERT INTO contacts (org_id, workspace_id, email, email_status) VALUES ($1, $2, 'x@y.example', 'valid')`, [a.org, a.ws])) ?? '', /vendor verification/);
  assert.match(await refused(asApp(db, a, `UPDATE contacts SET email_status = 'valid' WHERE id = $1`, [ca])) ?? '', /vendor verification/);
  // Free checks may still mark an address invalid, or leave it unknown.
  await asApp(db, a, `UPDATE contacts SET email_status = 'invalid' WHERE id = $1`, [ca]);
  await asApp(db, a, `UPDATE contacts SET email_status = 'unknown' WHERE id = $1`, [ca]);
  assert.equal(await status(db, ca), 'unknown');
});

test('a paid check makes it valid; the verdict is kept; a new address loses it', async () => {
  const { db, a, ca } = await setup();
  assert.match(await refused(asApp(db, a, `SELECT app_email_verified($1, 'pat@clinic-a.example', 'valid', 'fake', 'job-1')`, [ca])) ?? '', /data credit reservation/);
  await asApp(db, a, `SELECT app_credit_reserve('data', 1, 'email_verify', 'job-1')`);
  // A reservation for another kind of job doesn't count.
  await asApp(db, a, `SELECT app_credit_reserve('data', 1, 'lead_find', 'job-2')`);
  assert.match(await refused(asApp(db, a, `SELECT app_email_verified($1, 'pat@clinic-a.example', 'valid', 'fake', 'job-2')`, [ca])) ?? '', /data credit reservation/);
  assert.match(await refused(asApp(db, a, `SELECT app_email_verified($1, 'other@clinic-a.example', 'valid', 'fake', 'job-1')`, [ca])) ?? '', /address changed/);
  assert.match(await refused(asApp(db, a, `SELECT app_email_verified($1, 'pat@clinic-a.example', 'great', 'fake', 'job-1')`, [ca])) ?? '', /bad verdict/);
  await asApp(db, a, `SELECT app_email_verified($1, ' Pat@Clinic-A.example ', 'valid', 'fake', 'job-1')`, [ca]);
  assert.equal(await status(db, ca), 'valid');
  const rows = (await asApp(db, a, `SELECT email, verdict, vendor, job FROM email_verifications WHERE contact_id = $1`, [ca])).rows;
  assert.deepEqual(rows, [{ email: 'pat@clinic-a.example', verdict: 'valid', vendor: 'fake', job: 'job-1' }]);
  assert.match(await refused(asApp(db, a, `UPDATE email_verifications SET verdict = 'valid'`)) ?? '', /permission denied/);
  assert.match(await refused(asApp(db, a, `INSERT INTO email_verifications (org_id, workspace_id, contact_id, email, verdict, vendor, job) VALUES ($1, $2, $3, 'pat@clinic-a.example', 'valid', 'x', 'y')`, [a.org, a.ws, ca])) ?? '', /permission denied/);
  // A new address hasn't been checked.
  await asApp(db, a, `UPDATE contacts SET email = 'new@clinic-a.example' WHERE id = $1`, [ca]);
  assert.equal(await status(db, ca), 'unknown');
});

test('tenant walls: another org\'s contact or reservation does nothing; a role other than app_rw cannot call it', async () => {
  const { db, a, b, cb } = await setup();
  await asApp(db, a, `SELECT app_credit_reserve('data', 1, 'email_verify', 'job-a')`);
  assert.match(await refused(asApp(db, a, `SELECT app_email_verified($1, 'lee@clinic-b.example', 'valid', 'fake', 'job-a')`, [cb])) ?? '', /contact not found/);
  assert.match(await refused(asApp(db, b, `SELECT app_email_verified($1, 'lee@clinic-b.example', 'valid', 'fake', 'job-a')`, [cb])) ?? '', /data credit reservation/);
  assert.equal(await status(db, cb), 'unknown');
  for (const role of ['sender_svc', 'inbox_svc', 'gate_svc']) {
    const r = await as(db, role, { org: b.org, ws: [b.ws] }, () => refused(db.query(`SELECT app_email_verified($1, 'lee@clinic-b.example', 'valid', 'f', 'j')`, [cb])));
    assert.match(r ?? '', /permission denied/, role);
  }
});

test('one verdict per credit the job still holds: a refunded job writes nothing; a job can\'t write more than it paid for (#59 audit P2-1)', async () => {
  const { db, a } = await setup();
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await asApp(db, a, `INSERT INTO contacts (org_id, workspace_id, email) VALUES ($1, $2, $3) RETURNING id`, [a.org, a.ws, `p${i}@clinic-a.example`])).rows[0].id);
  // claude-local's repro: reserve 1, release 1, then verdicts.
  await asApp(db, a, `SELECT app_credit_reserve('data', 1, 'email_verify', 'job-x')`);
  await asApp(db, a, `SELECT app_credit_release('data', 1, 'email_verify', 'job-x')`);
  assert.match(await refused(asApp(db, a, `SELECT app_email_verified($1, 'p0@clinic-a.example', 'valid', 'fake', 'job-x')`, [ids[0]])) ?? '', /held 0, used 0/);
  // Reserve 2: two verdicts, the third refused.
  await asApp(db, a, `SELECT app_credit_reserve('data', 2, 'email_verify', 'job-y')`);
  await asApp(db, a, `SELECT app_email_verified($1, 'p1@clinic-a.example', 'valid', 'fake', 'job-y')`, [ids[1]]);
  await asApp(db, a, `SELECT app_email_verified($1, 'p2@clinic-a.example', 'invalid', 'fake', 'job-y')`, [ids[2]]);
  assert.match(await refused(asApp(db, a, `SELECT app_email_verified($1, 'p3@clinic-a.example', 'valid', 'fake', 'job-y')`, [ids[3]])) ?? '', /held 2, used 2/);
  const st = (await db.query(`SELECT email, email_status FROM contacts WHERE id = ANY ($1::uuid[]) ORDER BY email`, [ids])).rows.map((x) => x.email_status);
  assert.deepEqual(st, ['unknown', 'valid', 'invalid', 'unknown', 'unknown']);
});

test('one job\'s credits are counted org-wide: a second workspace of the same org can\'t spend them again (#59 audit P2-1b)', async () => {
  const { db, a } = await setup();
  const ws2 = (await db.query(`INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [a.org])).rows[0].id;
  const in1 = (sql, p) => as(db, 'app_rw', { org: a.org, ws: [a.ws] }, () => db.query(sql, p));
  const in2 = (sql, p) => as(db, 'app_rw', { org: a.org, ws: [ws2] }, () => db.query(sql, p));
  const c1 = (await in1(`INSERT INTO contacts (org_id, workspace_id, email) VALUES ($1, $2, 'one@clinic-a.example') RETURNING id`, [a.org, a.ws])).rows[0].id;
  const c2 = (await in2(`INSERT INTO contacts (org_id, workspace_id, email) VALUES ($1, $2, 'two@clinic-a.example') RETURNING id`, [a.org, ws2])).rows[0].id;
  // claude-local's repro: reserve 1 in ws1, verdict in ws1, then the same job in ws2.
  await in1(`SELECT app_credit_reserve('data', 1, 'email_verify', 'job-z')`);
  await in1(`SELECT app_email_verified($1, 'one@clinic-a.example', 'valid', 'fake', 'job-z')`, [c1]);
  assert.match(await refused(in2(`SELECT app_email_verified($1, 'two@clinic-a.example', 'valid', 'fake', 'job-z')`, [c2])) ?? '', /held 1, used 1/);
  assert.equal((await db.query(`SELECT email_status FROM contacts WHERE id = $1`, [c2])).rows[0].email_status, 'unknown');
  // The org-wide read is for the count only: app_rw in ws2 still sees no ws1 verdicts.
  assert.equal((await in2(`SELECT count(*)::int AS n FROM email_verifications`)).rows[0].n, 0);
});
