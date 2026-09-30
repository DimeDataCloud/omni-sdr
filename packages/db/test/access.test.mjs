import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { freshDb, seedTenant, one, q, refused } from './helpers.mjs';
import { withTenant } from '../src/context.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const newUser = async (db, email) =>
  (await one(db, `INSERT INTO users (idp_uid, email) VALUES ($1, $2) RETURNING id`, [`uid-${email}`, email])).id;

// A signed-in user with no org yet (sign-up, invite acceptance): app_rw + app.user_id only.
async function asUser(db, userId, fn) {
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL ROLE app_rw');
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId ?? '']);
    const r = await fn();
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}
const addMember = async (db, t, email, role) => {
  const u = await newUser(db, email);
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)`, [t.org, u, role]);
  return u;
};
const ctx = (t, userId) => ({ userId, orgId: t.org, workspaceId: t.ws });
const invite = (tx, t, by, { email = 'new@x.test', role = 'reviewer', token = randomBytes(24).toString('hex'), ws = null, days = 7 } = {}) =>
  tx.query(`INSERT INTO invites (org_id, email_hash, role, workspace_ids, token_hash, invited_by, expires_at)
            VALUES ($1, value_hash($2), $3, $4, $5, $6, now() + make_interval(days => $7))`,
    [t.org, email, role, ws, sha(token), by, days]).then(() => token);

test('sign-up: one call creates the org, its first workspace and the admin membership', async () => {
  const db = await freshDb();
  const u = await newUser(db, 'maya@x.test');
  const r = await asUser(db, u, () => one(db, `SELECT * FROM create_org_with_admin('Maya Web', 'owner', 'Main')`));
  const m = await one(db, `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`, [r.org_id, u]);
  assert.equal(m.role, 'admin');
  assert.equal((await one(db, `SELECT account_type FROM orgs WHERE id = $1`, [r.org_id])).account_type, 'owner');
  assert.equal((await one(db, `SELECT org_id FROM workspaces WHERE id = $1`, [r.workspace_id])).org_id, r.org_id);
  assert.equal((await q(db, `SELECT 1 FROM audit_log WHERE org_id = $1 AND action = 'create'`, [r.org_id])).length, 1);
  // "solo" is not an account type; no signed-in user means no org.
  assert.match(await refused(asUser(db, u, () => db.query(`SELECT * FROM create_org_with_admin('X', 'solo', 'W')`))) ?? '', /check constraint/);
  assert.match(await refused(asUser(db, null, () => db.query(`SELECT * FROM create_org_with_admin('X', 'owner', 'W')`))) ?? '', /no signed-in user/);
});

test('the app role cannot create memberships or orgs directly', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const u = await newUser(db, 'sneaky@x.test');
  assert.match(await refused(withTenant(db, ctx(t, t.user), (tx) =>
    tx.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')`, [t.org, u]))) ?? '', /permission denied/);
  assert.match(await refused(asUser(db, u, () => db.query(`INSERT INTO orgs (name) VALUES ('x')`))) ?? '', /permission denied/);
});

test('workspace settings: an admin may change them, an operator may not, and nobody may self-serve trust level', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha'); // t.user is admin
  const op = await addMember(db, t, 'op@x.test', 'operator');
  await withTenant(db, ctx(t, t.user), (tx) =>
    tx.query(`UPDATE workspaces SET client_approvals_enabled = true, auto_adjust_sources = ARRAY['booked_meetings'] WHERE id = $1`, [t.ws]));
  assert.equal((await one(db, `SELECT client_approvals_enabled FROM workspaces WHERE id = $1`, [t.ws])).client_approvals_enabled, true);
  assert.match(await refused(withTenant(db, ctx(t, op), (tx) =>
    tx.query(`UPDATE workspaces SET client_approvals_enabled = false WHERE id = $1`, [t.ws]))) ?? '', /admin only/);
  assert.match(await refused(withTenant(db, ctx(t, t.user), (tx) =>
    tx.query(`UPDATE workspaces SET trust_level = 2 WHERE id = $1`, [t.ws]))) ?? '', /permission denied/);
  assert.match(await refused(withTenant(db, ctx(t, t.user), (tx) =>
    tx.query(`UPDATE workspaces SET custom_domain = 'x.test' WHERE id = $1`, [t.ws]))) ?? '', /permission denied/);
});

test('invites: admins only, as themselves, within scope, at most 7 days', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  const op = await addMember(db, t, 'op@x.test', 'operator');
  await withTenant(db, ctx(t, t.user), (tx) => invite(tx, t, t.user));
  const cases = [
    ['operator invites', ctx(t, op), (tx) => invite(tx, t, op), /admin only/],
    ['admin spoofs invited_by', ctx(t, t.user), (tx) => invite(tx, t, op), /acting user/],
    ['workspace outside scope', ctx(t, t.user), (tx) => invite(tx, t, t.user, { ws: [b.ws] }), /outside the request scope/],
    ['14-day expiry', ctx(t, t.user), (tx) => invite(tx, t, t.user, { days: 14 }), /check constraint/],
    ['role "owner"', ctx(t, t.user), (tx) => invite(tx, t, t.user, { role: 'owner' }), /check constraint/],
  ];
  for (const [label, c, fn, re] of cases) {
    assert.match(await refused(withTenant(db, c, fn)) ?? `${label}: ACCEPTED`, re, label);
  }
  console.log(`  invite refusals: ${cases.length} of ${cases.length}`);
});

test('accept_invite: once, by the invited email only, never expired or revoked, one error for every failure', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const token = await withTenant(db, ctx(t, t.user), (tx) => invite(tx, t, t.user, { email: 'Rae@X.test', role: 'reviewer' }));
  const rae = await newUser(db, 'rae@x.test');   // hash is case-insensitive, as value_hash() is
  const other = await newUser(db, 'other@x.test');

  const generic = /invalid or expired invite/;
  assert.match(await refused(asUser(db, other, () => db.query(`SELECT accept_invite($1)`, [token]))) ?? '', generic, 'wrong email');
  assert.match(await refused(asUser(db, rae, () => db.query(`SELECT accept_invite($1)`, ['not-a-token']))) ?? '', generic, 'bad token');

  const org = (await asUser(db, rae, () => one(db, `SELECT accept_invite($1) AS org`, [token]))).org;
  assert.equal(org, t.org);
  const m = await one(db, `SELECT role, workspace_ids FROM memberships WHERE org_id = $1 AND user_id = $2`, [t.org, rae]);
  assert.equal(m.role, 'reviewer');
  assert.match(await refused(asUser(db, rae, () => db.query(`SELECT accept_invite($1)`, [token]))) ?? '', generic, 'second use');

  // Revoked and expired invites are refused with the same message.
  const t2 = await withTenant(db, ctx(t, t.user), (tx) => invite(tx, t, t.user, { email: 'other@x.test' }));
  await withTenant(db, ctx(t, t.user), (tx) => tx.query(`UPDATE invites SET revoked_at = now() WHERE token_hash = $1`, [sha(t2)]));
  assert.match(await refused(asUser(db, other, () => db.query(`SELECT accept_invite($1)`, [t2]))) ?? '', generic, 'revoked');
  const t3 = await withTenant(db, ctx(t, t.user), (tx) => invite(tx, t, t.user, { email: 'other@x.test' }));
  await db.query(`UPDATE invites SET created_at = now() - interval '2 days', expires_at = now() - interval '1 hour' WHERE token_hash = $1`, [sha(t3)]);
  assert.match(await refused(asUser(db, other, () => db.query(`SELECT accept_invite($1)`, [t3]))) ?? '', generic, 'expired');
  assert.equal((await q(db, `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [t.org, other])).length, 0);
});
