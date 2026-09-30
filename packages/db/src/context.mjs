// Tenant context: the ONE way request code touches tenant data (AGENT-RAILS §4, SPEC §5 S1).
//
// withTenant() opens a transaction, drops to a service role, proves the user's membership in the
// requested org + workspace from the database itself, sets app.org_id / app.workspace_ids for that
// (plus app.user_id, which 0002 triggers use for admin checks) for that transaction only (SET LOCAL semantics, so a pooled connection never carries a tenant into the
// next request), runs fn, and commits. Any error rolls back everything fn wrote.
//
// Works with any client exposing query(sql, params): PGlite in tests, a checked-out pg client in prod
// (never a Pool: BEGIN and the queries must share one connection).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Roles request code may run as. SET ROLE can't take a bind parameter, so the name must come from here.
export const SERVICE_ROLES = Object.freeze(['app_rw', 'gate_svc', 'sender_svc']);

export class TenantAccessError extends Error {
  constructor(reason) {
    super(`tenant access refused: ${reason}`);
    this.name = 'TenantAccessError';
    this.reason = reason;
  }
}

function assertUuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TenantAccessError(`${name} is not a uuid`);
}

/**
 * @param client  a single connection with query(sql, params)
 * @param ctx     { userId, orgId, workspaceId, role = 'app_rw' }, taken from the verified session, never from the request body
 * @param fn      async (tx, membership) => result; tx is the same client, already scoped
 * @returns       whatever fn returns
 */
export async function withTenant(client, { userId, orgId, workspaceId, role = 'app_rw' }, fn) {
  assertUuid(userId, 'userId');
  assertUuid(orgId, 'orgId');
  assertUuid(workspaceId, 'workspaceId');
  if (!SERVICE_ROLES.includes(role)) throw new TenantAccessError(`role ${JSON.stringify(role)} is not a service role`);

  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    // Scope to the org first: memberships is RLS-filtered by app.org_id, so only this org's rows are visible.
    await client.query(`SELECT set_config('app.org_id', $1, true), set_config('app.workspace_ids', '', true), set_config('app.user_id', $2, true)`,
      [orgId, userId]);
    const m = (await client.query(
      `SELECT role, workspace_ids FROM memberships WHERE org_id = $1 AND user_id = $2`, [orgId, userId])).rows[0];
    if (!m) throw new TenantAccessError('no membership in this org');
    if (m.workspace_ids !== null && !m.workspace_ids.includes(workspaceId)) {
      throw new TenantAccessError('membership does not cover this workspace');
    }
    await client.query(`SELECT set_config('app.workspace_ids', $1, true)`, [workspaceId]);
    // The workspace must exist in this org; RLS makes a foreign or missing id return no row.
    const ws = (await client.query(`SELECT client_approvals_enabled FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
    if (!ws) throw new TenantAccessError('workspace not found in this org');

    const membership = Object.freeze({
      userId, orgId, workspaceId, role: m.role,
      clientApprovalsEnabled: ws.client_approvals_enabled,
    });
    const result = await fn(client, membership);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Worker modules (gate, sender, sequencer) act for a tenant without a signed-in user. Same
// transaction-scoped context as withTenant, but no membership check and no app.user_id, so the
// 0002 admin-only triggers can never pass for a service role.
export const WORKER_ROLES = Object.freeze(['gate_svc', 'sender_svc', 'inbox_svc']);

export async function withService(client, { orgId, workspaceId, role }, fn) {
  assertUuid(orgId, 'orgId');
  assertUuid(workspaceId, 'workspaceId');
  if (!WORKER_ROLES.includes(role)) throw new TenantAccessError(`role ${JSON.stringify(role)} is not a worker role`);
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('app.org_id', $1, true), set_config('app.workspace_ids', $2, true), set_config('app.user_id', '', true)`,
      [orgId, workspaceId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Before a tenant is known: first sign-in (ensure_user), "which orgs am I in" (my_memberships), sign-up
// (create_org_with_admin), invite acceptance, and the public unsubscribe route. No org or workspace is
// set, so every RLS-scoped read returns nothing; only the narrow definer functions do anything useful.
// userId is optional (null for the public routes) and, when given, must come from a verified token.
export async function withoutTenant(client, { role = 'app_rw', userId = null } = {}, fn) {
  if (!SERVICE_ROLES.includes(role) && !WORKER_ROLES.includes(role)) throw new TenantAccessError(`role ${JSON.stringify(role)} is not a service role`);
  if (userId !== null) assertUuid(userId, 'userId');
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('app.org_id', '', true), set_config('app.workspace_ids', '', true), set_config('app.user_id', $1, true)`,
      [userId ?? '']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
