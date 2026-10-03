import { registerPublic } from './public.mjs';
import { registerMe } from './me.mjs';
import { registerWorkspace } from './workspace.mjs';
import { registerApprovals } from './approvals.mjs';
import { registerInbox } from './inbox.mjs';
import { registerAgents } from './agents.mjs';
import { registerProspects } from './prospects.mjs';
import { registerOps } from './ops.mjs';
import { registerMailboxes } from './mailboxes.mjs';
import { registerReports } from './reports.mjs';
import { registerGenerate } from './generate.mjs';
import { registerOnboarding } from './onboarding.mjs';
import { registerIcp } from './icp.mjs';
import { registerCompetitors } from './competitors.mjs';
import { registerLeads } from './leads.mjs';
import { registerVerify } from './verify.mjs';
import { registerHooks } from './hooks.mjs';

// Specific paths before parameterized ones within each module; modules don't overlap.
export function registerAll(r) {
  registerPublic(r);
  registerMe(r);
  registerWorkspace(r);
  registerApprovals(r);
  registerInbox(r);
  registerAgents(r);
  registerProspects(r);
  registerOps(r);
  registerMailboxes(r);
  registerReports(r);
  registerGenerate(r);
  registerOnboarding(r);
  registerIcp(r);
  registerCompetitors(r);
  registerLeads(r);
  registerVerify(r);
  registerHooks(r);
}

// Tenant route prefix.
export const T = '/v1/o/:org/w/:ws';

// snake_case row → camelCase object (dates stay Date → JSON ISO strings).
export const camel = (row) => Object.fromEntries(Object.entries(row).map(([k, val]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), val]));

export const audit = (tx, m, action, entityType, entityId) => tx.query(
  `INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
  [m.orgId, m.userId, action, entityType, String(entityId)]);
