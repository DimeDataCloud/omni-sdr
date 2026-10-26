import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, one, q } from './helpers.mjs';
import { withTenant, withService, withoutTenant, TenantAccessError, MAX_TX_ATTEMPTS } from '../src/context.mjs';
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
  assert.equal(rows.length, 2); // the seed gives each tenant 2 contacts in its workspace (0005 adds a meeting guest)
  assert.ok(rows.every((r) => r.org_id === a.org));
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
  // action:               admin operator reviewer client_viewer(toggle off) closer
  const expected = {
    billing:            [Y, N, N, N, N],
    members:            [Y, N, N, N, N],
    connections:        [Y, N, N, N, N],
    workspace_settings: [Y, N, N, N, N],
    build:              [Y, Y, N, N, N],
    approve:            [Y, Y, Y, N, N],
    inbox_read:         [Y, Y, Y, N, N],
    inbox_draft:        [Y, Y, N, N, N],
    clear_hold:         [Y, N, N, N, N],
    reports_view:       [Y, Y, Y, Y, N],
    team_view:          [Y, Y, Y, N, N],
    export_pii:         [Y, Y, N, N, N],
    handoff:            [Y, Y, N, N, N],
    handoff_work:       [Y, Y, N, N, Y],
  };
  assert.deepEqual(Object.keys(expected).sort(), [...ACTIONS].sort(), 'matrix test must cover every action');
  const roles = ['admin', 'operator', 'reviewer', 'client_viewer', 'closer'];
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

// ADV N-1: a deadlock (40P01) or serialization failure (40001) rolls the whole transaction back in the database. The wrappers
// run the callback again from BEGIN, a bounded number of times, and never retry any other error.
test('transactions: 40P01 and 40001 are retried from BEGIN, up to the cap; other errors are not', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const wrappers = {
    withTenant: (fn) => withTenant(db, ctxOf(a), fn),
    withService: (fn) => withService(db, { orgId: a.org, workspaceId: a.ws, role: 'inbox_svc' }, fn),
    withoutTenant: (fn) => withoutTenant(db, { role: 'inbox_svc' }, fn),
  };
  for (const [name, run] of Object.entries(wrappers)) {
    for (const code of ['40P01', '40001']) {
      let calls = 0;
      const out = await run(async (tx) => {
        calls++;
        await tx.query('SELECT 1');
        if (calls < 3) throw Object.assign(new Error('simulated ' + code), { code });
        return 'done after ' + calls;
      });
      assert.equal(out, 'done after 3', name + ' ' + code);
    }
    // Always failing: gives up at the cap with the original error.
    let calls = 0;
    const err = await run(async () => { calls++; throw Object.assign(new Error('still deadlocked'), { code: '40P01' }); }).catch((e) => e);
    assert.equal(err.code, '40P01');
    assert.equal(calls, MAX_TX_ATTEMPTS, name + ' stops at the cap');
    // Anything else is thrown at once.
    calls = 0;
    const other = await run(async () => { calls++; throw Object.assign(new Error('unique'), { code: '23505' }); }).catch((e) => e);
    assert.equal([other.code, calls].join(), '23505,1', name + ' does not retry other errors');
  }
  // A failed attempt leaves nothing behind: the retried callback sees none of the first attempt's writes.
  let attempt = 0;
  const seen = await withTenant(db, ctxOf(a), async (tx) => {
    attempt++;
    const before = (await tx.query("SELECT count(*)::int AS n FROM contacts WHERE name = 'Retry Probe'")).rows[0].n;
    await tx.query("INSERT INTO contacts (org_id, workspace_id, name) VALUES ($1, $2, 'Retry Probe')", [a.org, a.ws]);
    if (attempt === 1) throw Object.assign(new Error('deadlock'), { code: '40P01' });
    return before;
  });
  assert.equal(seen, 0, 'the first attempt was rolled back');
  assert.equal((await one(db, "SELECT count(*)::int AS n FROM contacts WHERE name = 'Retry Probe'")).n, 1);
});
