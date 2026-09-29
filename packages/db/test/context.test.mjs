import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, one, q } from './helpers.mjs';
import { withTenant, TenantAccessError } from '../src/context.mjs';
import { can, ACTIONS } from '../src/permissions.mjs';

const ctxOf = (t, extra = {}) => ({ userId: t.user, orgId: t.org, workspaceId: t.ws, ...extra });
const refusedWith = async (p, re) => {
  const err = await p.then(() => null, (e) => e);
  assert.ok(err, 'expected a refusal, got success');
  assert.ok(err instanceof TenantAccessError, `expected TenantAccessError, got ${err?.message}`);
  assert.match(err.reason, re);
};

test('withTenant: a member sees only its own workspace rows, and the membership comes from the DB', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  await seedTenant(db, 'bravo');
  const { rows, m } = await withTenant(db, ctxOf(a), async (tx, m) => ({
    rows: (await tx.query('SELECT org_id FROM contacts')).rows, m }));
  assert.equal(m.role, 'admin');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].org_id, a.org);
});

test('withTenant: refuses another org, a workspace outside the membership, and a foreign workspace', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  await refusedWith(withTenant(db, ctxOf(a, { orgId: b.org, workspaceId: b.ws }), async () => {}), /no membership/);
  await refusedWith(withTenant(db, ctxOf(a, { workspaceId: b.ws }), async () => {}), /workspace not found/);
  // A second workspace in A's org that A's user is not scoped to.
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'ws2') RETURNING id`, [a.org])).id;
  await db.query(`UPDATE memberships SET workspace_ids = ARRAY[$2::uuid] WHERE org_id = $1`, [a.org, a.ws]);
  await refusedWith(withTenant(db, ctxOf(a, { workspaceId: ws2 }), async () => {}), /does not cover/);
});

test('withTenant: rejects malformed ids and non-service roles before any SQL runs', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  await refusedWith(withTenant(db, ctxOf(a, { orgId: "x' OR '1'='1" }), async () => {}), /orgId is not a uuid/);
  await refusedWith(withTenant(db, ctxOf(a, { role: 'ops' }), async () => {}), /not a service role/);
  await refusedWith(withTenant(db, ctxOf(a, { role: 'postgres; DROP TABLE orgs' }), async () => {}), /not a service role/);
});

test('withTenant: the tenant context ends with the transaction (no leak to the next request)', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  await withTenant(db, ctxOf(a), async () => {});
  const s = await one(db, `SELECT current_setting('app.org_id', true) AS org, current_setting('app.workspace_ids', true) AS ws, current_setting('app.user_id', true) AS uid, current_user AS u`);
  assert.ok(!s.org, `app.org_id leaked: ${s.org}`);
  assert.ok(!s.ws, `app.workspace_ids leaked: ${s.ws}`);
  assert.ok(!s.uid, `app.user_id leaked: ${s.uid}`);
  assert.notEqual(s.u, 'app_rw', 'role leaked past the transaction');
});

test('withTenant: an error inside fn rolls back everything fn wrote', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const before = (await q(db, `SELECT id FROM contacts WHERE org_id = $1`, [a.org])).length;
  await assert.rejects(withTenant(db, ctxOf(a), async (tx) => {
    await tx.query(`INSERT INTO contacts (org_id, workspace_id, name) VALUES ($1, $2, 'temp')`, [a.org, a.ws]);
    throw new Error('boom');
  }), /boom/);
  const after = (await q(db, `SELECT id FROM contacts WHERE org_id = $1`, [a.org])).length;
  assert.equal(after, before);
});

test('permissions: the SPEC §7 matrix, cell by cell', () => {
  const Y = true, N = false;
  // action:               admin operator reviewer client_viewer(toggle off)
  const expected = {
    billing:            [Y, N, N, N],
    members:            [Y, N, N, N],
    connections:        [Y, N, N, N],
    workspace_settings: [Y, N, N, N],
    build:              [Y, Y, N, N],
    approve:            [Y, Y, Y, N],
    inbox_read:         [Y, Y, Y, N],
    inbox_draft:        [Y, Y, N, N],
    clear_hold:         [Y, N, N, N],
    reports_view:       [Y, Y, Y, Y],
    export_pii:         [Y, Y, N, N],
  };
  assert.deepEqual(Object.keys(expected).sort(), [...ACTIONS].sort(), 'matrix test must cover every action');
  const roles = ['admin', 'operator', 'reviewer', 'client_viewer'];
  let cells = 0;
  for (const [action, row] of Object.entries(expected)) {
    roles.forEach((role, i) => {
      assert.equal(can({ role, clientApprovalsEnabled: false }, action), row[i], `${role} × ${action}`);
      cells++;
    });
  }
  console.log(`  permission cells checked: ${cells}`);
  assert.equal(can({ role: 'client_viewer', clientApprovalsEnabled: true }, 'approve'), true, 'toggle on lets client viewers approve');
  assert.equal(can({ role: 'client_viewer', clientApprovalsEnabled: true }, 'build'), false);
  assert.equal(can({ role: 'owner' }, 'reports_view'), false, 'unknown role fails closed');
  assert.throws(() => can({ role: 'admin' }, 'aprove'), /unknown action/);
});
