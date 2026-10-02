// Role × action matrix: SPEC §7. Server actions call can(membership, action) after withTenant()
// has proved the membership. The database still enforces the hard floors (grants, RLS, gate,
// send_guard); this decides what the product lets each role *try*.
//
// Cells SPEC §7 marks "default" are recommendations awaiting Christian's confirmation in
// Station 1; changing one is a one-line edit here plus its test row.

export const ACTIONS = Object.freeze([
  'billing',            // plan, payment, delete org/workspace
  'members',            // invite/remove, set roles
  'connections',        // mailboxes, integrations, LinkedIn consent (operator: default deny)
  'workspace_settings', // client-approval toggle, Auto-adjust + sources, warm-up ramp, SLA hours
  'build',              // research, ICPs, leads, campaigns, content, composer jobs
  'approve',            // approve / edit / discard drafts
  'inbox_read',
  'inbox_draft',        // reviewer: default read-only
  'clear_hold',         // operator: default deny
  'reports_view',       // reports, analytics, meetings: everyone, client viewers included (own workspace)
  'team_view',          // the team's working data: agents and their chats, routines, campaigns, connectors, capacity,
                        // credits. Not client viewers, an outside party (bug bounty 2026-10-02 #4; proposal defaulted
                        // to restrict by Christian's "you have control", acceptance A3)
  'export_pii',         // leads/messages exports
]);

const MATRIX = Object.freeze({
  admin:         new Set(ACTIONS),
  operator:      new Set(['build', 'approve', 'inbox_read', 'inbox_draft', 'reports_view', 'team_view', 'export_pii']),
  reviewer:      new Set(['approve', 'inbox_read', 'reports_view', 'team_view']),
  client_viewer: new Set(['reports_view']),
});

/**
 * @param membership  { role, clientApprovalsEnabled } as returned by withTenant()
 * @param action      one of ACTIONS; anything else throws, so a typo can't silently deny or allow
 */
export function can(membership, action) {
  if (!ACTIONS.includes(action)) throw new Error(`unknown action ${JSON.stringify(action)}`);
  const allowed = MATRIX[membership?.role];
  if (!allowed) return false; // unknown or missing role: fail closed
  if (membership.role === 'client_viewer' && action === 'approve') return membership.clientApprovalsEnabled === true;
  return allowed.has(action);
}

// Trust Dial Level 2 and generation flags are not tenant actions at all: only the ops console
// (Christian) changes them, and the app role has no UPDATE on those columns (tenancy.test.mjs).
