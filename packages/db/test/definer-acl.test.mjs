// SECURITY DEFINER functions run with their owner's rights, so who may EXECUTE them is a security boundary. Prod
// migrates as a non-superuser owner login; the other tests run PGlite as superuser, where a REVOKE issued after an
// ALTER ... OWNER still works and hides the bug that 0008a fixes. This test migrates the way prod does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/migrate.mjs';
import { refused } from './helpers.mjs';

// Who may call each definer function: exactly these roles and the owner, never PUBLIC. A new definer function fails
// this test until it is listed here, so its grants are a deliberate, reviewed choice.
const EXPECTED = {
  accept_invite: ['app_rw'], create_org_with_admin: ['app_rw'], create_workspace: ['app_rw'],
  ensure_user: ['app_rw'], my_memberships: ['app_rw'], unsubscribe: ['app_rw'],
  credit_reserve: ['ops'], credit_release: ['ops'],
  app_credit_reserve: ['app_rw'], app_credit_release: ['app_rw'], app_credit_settle: ['app_rw'],   // 0009 (#47)
  app_email_verified: ['app_rw'],   // 0013 (#59): the only way to write email_status 'valid'
  // 0015: read by the closer_scope policies, which apply to these four roles; answer only about the acting user.
  app_is_closer: ['app_rw', 'gate_svc', 'inbox_svc', 'sender_svc'], app_closer_owns: ['app_rw', 'gate_svc', 'inbox_svc', 'sender_svc'],
  app_set_booking_url: ['app_rw'],   // 0016: a member sets their own booking link
  app_closer_contact: ['app_rw', 'gate_svc', 'inbox_svc', 'sender_svc'], app_closer_enrollment: ['app_rw', 'gate_svc', 'inbox_svc', 'sender_svc'],
  app_closer_draft: ['app_rw', 'gate_svc', 'inbox_svc', 'sender_svc'],
  inbox_resolve_reply: ['inbox_svc'], inbox_undecided: ['inbox_svc'], inbox_wake_snoozed: ['inbox_svc'], inbox_sla_due: ['inbox_svc'],
  inbox_resolve_hook: ['inbox_svc'], inbox_undecided_fair: ['inbox_svc'],   // 0014
  inbox_handoffs_overdue: ['inbox_svc'],   // 0016
  sender_due_workspaces: ['sender_svc'],
  app_contact_suppressed: ['app_rw'],   // 0017: no reply drafted to someone who opted out
  send_guard: [], send_guard_enrollment: [], handoffs_sync: [],  // trigger-only
};

async function asProdOwner() {
  const db = new PGlite();
  // Like Cloud SQL: the migration login owns the database's public schema, creates the roles, and is no superuser.
  await db.exec(`CREATE ROLE omni_owner LOGIN CREATEROLE; ALTER SCHEMA public OWNER TO omni_owner;
    SET SESSION AUTHORIZATION omni_owner; SET createrole_self_grant = 'set';`);
  assert.equal((await db.query(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0].rolsuper, false);
  await migrate(db);
  return db;
}

test('migrated by a non-superuser owner, every SECURITY DEFINER function is executable only by the roles meant to call it', async () => {
  const db = await asProdOwner();
  const rows = (await db.query(`SELECT p.proname, r.rolname AS owner, p.proacl IS NULL AS default_acl,
      coalesce((SELECT array_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END ORDER BY 1)
                FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner), '{}') AS grantees
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public' AND p.prosecdef ORDER BY 1`)).rows;
  const got = Object.fromEntries(rows.map((x) => [x.proname, x.default_acl ? ['PUBLIC (default)'] : [...x.grantees].sort()]));   // JS order: SQL collation sorts '_' differently
  const want = Object.fromEntries(Object.entries(EXPECTED).map(([k, v]) => [k, [...v].sort()]));
  assert.deepEqual(got, want);
  for (const x of rows) assert.notEqual(x.owner, 'omni_owner', `${x.proname} must belong to a narrow owner role`);
});

test('the boundary holds when called: an app role cannot run the cross-tenant jobs; the roles meant to can', async () => {
  const db = await asProdOwner();
  const call = async (role, sql) => {
    await db.exec(`SET ROLE ${role}`);
    try { return await refused(db.query(sql)); } finally { await db.exec('RESET ROLE'); }
  };
  for (const sql of [`SELECT * FROM inbox_wake_snoozed(now(), 10)`, `SELECT * FROM inbox_sla_due(now(), 10)`,
    `SELECT * FROM sender_due_workspaces(10)`, `SELECT * FROM inbox_undecided(10)`]) {
    assert.match(await call('app_rw', sql) ?? 'ran', /permission denied/, sql);
  }
  assert.match(await call('inbox_svc', `SELECT * FROM sender_due_workspaces(10)`) ?? 'ran', /permission denied/);
  assert.equal(await call('inbox_svc', `SELECT * FROM inbox_wake_snoozed(now(), 10)`), null);
  assert.equal(await call('sender_svc', `SELECT * FROM sender_due_workspaces(10)`), null);
  assert.equal(await call('app_rw', `SELECT * FROM my_memberships()`), null);
});
