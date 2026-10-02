// Settings, members and invites (SPEC §7). The DB enforces admin-only settings and invites (0002 triggers);
// can() gives the same answer earlier with a clean 403.
import { randomBytes, createHash } from 'node:crypto';
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, badRequest } from '../errors.mjs';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));
const AUTO_ADJUST_SOURCES = ['booked_meetings', 'positive_replies', 'objections', 'unsubscribes_bounces', 'sops', 'won_lost', 'draft_edits', 'rejections'];
const ROLES = ['admin', 'operator', 'reviewer', 'client_viewer'];

// Request field → column. Only these are writable, and the DB grants match (0002, 0004).
const SETTINGS = {
  name: ['name', v.string({ min: 1, max: 120 })],
  timezone: ['timezone', (x, p) => { const s = v.string({ min: 1, max: 64 })(x, p); if (!TIMEZONES.has(s)) throw badRequest(`${p}: unknown time zone`, { field: p }); return s; }],
  clientApprovalsEnabled: ['client_approvals_enabled', v.bool()],
  autoAdjustEnabled: ['auto_adjust_enabled', v.bool()],
  autoAdjustSources: ['auto_adjust_sources', v.array(v.oneOf(AUTO_ADJUST_SOURCES), { max: 8 })],
  postalAddress: ['postal_address', v.nullable(v.string({ min: 10, max: 300 }))],
};

export function registerWorkspace(r) {
  r.get(`${T}/settings`, (ctx) => ctx.tenant(async (tx, m) => {
    const w = (await tx.query(`SELECT id, name, timezone, trust_level, client_approvals_enabled, auto_adjust_enabled,
      auto_adjust_sources, postal_address, custom_domain, created_at FROM workspaces WHERE id = $1`, [m.workspaceId])).rows[0];
    const o = (await tx.query(`SELECT id, name, account_type, subscription_status, trial_ends_at, feature_flags FROM orgs WHERE id = $1`,
      [m.orgId])).rows[0];
    // A client viewer (an outside party) sees what their screens need, not the agency's plan, trial, flags, Trust Dial,
    // postal address or Auto-adjust setup (bug bounty 2026-10-02 #4).
    if (m.role === 'client_viewer') {
      return { workspace: { id: w.id, name: w.name, timezone: w.timezone, clientApprovalsEnabled: w.client_approvals_enabled },
        org: { id: o.id, name: o.name, accountType: o.account_type }, you: { userId: m.userId, role: m.role } };
    }
    // Trust level and feature flags are shown, never editable here (ops only, SPEC §5 S7).
    return { workspace: camel(w), org: camel(o), you: { userId: m.userId, role: m.role } };
  }));

  r.patch(`${T}/settings`, (ctx) => {
    const b = parse(v.object(Object.fromEntries(Object.entries(SETTINGS).map(([k, [, chk]]) => [k, v.optional(chk)])),
      { atLeastOne: true }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const cols = Object.keys(b).map((k) => SETTINGS[k][0]);
      const vals = Object.keys(b).map((k) => b[k]);
      await tx.query(`UPDATE workspaces SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [m.workspaceId, ...vals]);
      await audit(tx, m, 'update_settings', 'workspace', m.workspaceId);
      return { updated: Object.keys(b) };
    }, { action: 'workspace_settings' });
  });

  r.get(`${T}/members`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT m.user_id, u.email, m.role, m.workspace_ids FROM memberships m
      JOIN users u ON u.id = m.user_id ORDER BY u.email`)).rows;
    const invites = (await tx.query(`SELECT id, role, workspace_ids, expires_at, created_at FROM invites
      WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`)).rows;
    return { members: rows.map(camel), pendingInvites: invites.map(camel) };
  }, { action: 'members' }));

  // The raw token is returned once, inside the link; only its hash is stored (0002).
  r.post(`${T}/invites`, (ctx) => {
    const b = parse(v.object({
      email: v.email(),
      role: v.oneOf(ROLES),
      workspaceIds: v.optional(v.nullable(v.array(v.uuid(), { min: 1, max: 50 }))),
    }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
      const row = (await tx.query(
        `INSERT INTO invites (org_id, email_hash, role, workspace_ids, token_hash, invited_by, expires_at)
         VALUES ($1, value_hash($2), $3, $4, $5, $6, now() + interval '7 days') RETURNING id, expires_at`,
        [m.orgId, b.email, b.role, b.workspaceIds ?? null, tokenHash, m.userId])).rows[0];
      return { status: 201, body: { id: row.id, expiresAt: row.expires_at, inviteUrl: `${ctx.config.appUrl}/invite/${token}` } };
    }, { action: 'members' });
  });

  r.delete(`${T}/invites/:id`, (ctx) => ctx.tenant(async (tx, m) => {
    const n = (await tx.query(`UPDATE invites SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [ctx.params.id]));
    if (!(n.affectedRows ?? n.rowCount)) throw notFound('no open invite with that id');
    await audit(tx, m, 'revoke', 'invite', ctx.params.id);
    return { status: 204 };
  }, { action: 'members' }));
}
