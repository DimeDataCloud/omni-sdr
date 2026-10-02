// 0014: an address is 'valid' only through a paid vendor check (DECISIONS 2026-09-28), so the send guard's
// "email verified" means what it says. Tries to get 'valid' in every other way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused } from './helpers.mjs';

const asApp = (db, t, sql, params) => as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => db.query(sql, params));
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];

async function setup() {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha'); const b = await seedTenant(db, 'beta');
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
