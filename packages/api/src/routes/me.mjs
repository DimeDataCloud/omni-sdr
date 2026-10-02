// Signed in, no tenant yet: who am I, sign-up, accept an invite, add a client workspace.
import { v, parse } from '../validate.mjs';
import { HttpError } from '../errors.mjs';

export function registerMe(r) {
  r.get('/v1/me', async (ctx) => {
    const rows = await ctx.noTenant(async (tx) => (await tx.query(`SELECT * FROM my_memberships()`)).rows);
    const orgs = new Map();
    for (const x of rows) {
      if (!orgs.has(x.org_id)) {
        // A client viewer is an outside party: the agency's plan state isn't theirs to see (#43 audit P3).
        orgs.set(x.org_id, { id: x.org_id, name: x.org_name, accountType: x.account_type,
          ...(x.role === 'client_viewer' ? {} : { subscriptionStatus: x.subscription_status }), role: x.role, workspaces: [] });
      }
      orgs.get(x.org_id).workspaces.push({ id: x.workspace_id, name: x.workspace_name });
    }
    return { user: { id: ctx.user.id, email: ctx.user.email }, orgs: [...orgs.values()] };
  });

  // Sign-up: org + first workspace + admin membership, in one database call (0002). Stripe Checkout
  // (7-day card-required trial) is Station 05 and not wired yet; the org starts 'trialing'.
  r.post('/v1/orgs', async (ctx) => {
    if (!ctx.allow(`signup:${ctx.user.id}`, 5, 3600000, ctx.now().getTime())) {
      throw new HttpError(429, 'rate_limited', 'too many sign-ups from this account; try again later');
    }
    const b = parse(v.object({
      orgName: v.string({ min: 1, max: 120 }),
      accountType: v.oneOf(['owner', 'agency']),
      workspaceName: v.optional(v.string({ min: 1, max: 120 })),
    }), ctx.body);
    const row = await ctx.noTenant(async (tx) => (await tx.query(
      `SELECT * FROM create_org_with_admin($1, $2, $3)`, [b.orgName, b.accountType, b.workspaceName ?? b.orgName])).rows[0]);
    return { status: 201, body: { orgId: row.org_id, workspaceId: row.workspace_id } };
  });

  r.post('/v1/invites/accept', async (ctx) => {
    const b = parse(v.object({ token: v.string({ min: 16, max: 200 }) }), ctx.body);
    const orgId = await ctx.noTenant(async (tx) => (await tx.query(`SELECT accept_invite($1) AS org`, [b.token])).rows[0].org);
    return { orgId };
  });

  // Agencies add client workspaces (org-wide admins only; enforced in create_workspace()).
  r.post('/v1/o/:org/workspaces', async (ctx) => {
    const b = parse(v.object({ name: v.string({ min: 1, max: 120 }) }), ctx.body);
    const id = await ctx.noTenant(async (tx) =>
      (await tx.query(`SELECT create_workspace($1, $2) AS id`, [ctx.params.org, b.name])).rows[0].id);
    return { status: 201, body: { workspaceId: id } };
  });
}
