// Mailboxes: connect Gmail (send-only), list, disconnect (docs/claude/SENDER-PLAN.md §2). Permission `connections`
// (admins; SPEC §7). The refresh token is sealed before it reaches the database and is never returned.
//
//   GET    …/mailboxes                  status of each mailbox (never a token)
//   POST   …/mailboxes/google/start     → { url }: Google's consent page, state bound to this person + workspace
//   POST   …/mailboxes/google/finish    { code, state } from the console's redirect page → the connected mailbox
//   DELETE …/mailboxes/{id}             revoke at Google, mark revoked, pause the mailbox
//
// Config (ctx.config.google, else the environment through loadGoogleConfig):
//   OMNI_GOOGLE_CLIENT_ID, OMNI_GOOGLE_REDIRECT_URI (https://suite.omnisdr.com/connect/google)
//   OMNI_SENDER_SECRETS   one Secret Manager value (JSON): { mailboxKey, googleClientSecret, stateSecret }. One secret
//                         version instead of three keeps Secret Manager inside its free allowance ($0 rule).
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, badRequest, HttpError } from '../errors.mjs';
import { mintState, checkState, authUrl, exchangeCode, ConnectError, GMAIL_SEND } from '../../../sender/src/google.mjs';
import { seal, credentialKey } from '../../../sender/src/credentials.mjs';

export function loadGoogleConfig(env = process.env) {
  if (!env.OMNI_GOOGLE_CLIENT_ID || !env.OMNI_SENDER_SECRETS) return null;
  let s;
  try { s = JSON.parse(env.OMNI_SENDER_SECRETS); } catch { return null; }
  if (!s.mailboxKey || !s.googleClientSecret || !s.stateSecret) return null;
  return { clientId: env.OMNI_GOOGLE_CLIENT_ID, clientSecret: s.googleClientSecret, stateSecret: s.stateSecret,
    mailboxKey: credentialKey(s.mailboxKey), redirectUri: env.OMNI_GOOGLE_REDIRECT_URI ?? 'https://suite.omnisdr.com/connect/google' };
}

const DAY_ONE_CAP = 5;   // the ramp's first day (SENDER-PLAN §3.4); admins raise it

export function registerMailboxes(r, { google: fromEnv = loadGoogleConfig(), fetchImpl } = {}) {
  const cfg = (ctx) => {
    const g = ctx.config.google ?? fromEnv;
    if (!g) throw new HttpError(503, 'not_configured', 'Gmail connect is not configured on this server yet');
    return g;
  };
  const doFetch = (ctx) => ctx.config.fetch ?? fetchImpl ?? fetch;

  r.get(`${T}/mailboxes`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`
      SELECT mb.id, mb.provider, mb.address, mb.daily_cap, mb.paused_reason,
             cr.connected_at, cr.revoked_at, cr.scopes
      FROM mailboxes mb LEFT JOIN mailbox_credentials cr ON cr.mailbox_id = mb.id ORDER BY mb.address`)).rows;
    return { items: rows.map((x) => ({ ...camel(x), connected: Boolean(x.connected_at) && !x.revoked_at && !x.paused_reason })) };
  }, { action: 'connections' }));

  r.post(`${T}/mailboxes/google/start`, (ctx) => ctx.tenant(async (tx, m) => {
    const g = cfg(ctx);
    const state = mintState(g.stateSecret, { orgId: m.orgId, workspaceId: ctx.params.ws, userId: m.userId, now: ctx.now().getTime() });
    return { url: authUrl({ clientId: g.clientId, redirectUri: g.redirectUri, secret: g.stateSecret, state }) };
  }, { action: 'connections' }));

  r.post(`${T}/mailboxes/google/finish`, async (ctx) => {
    const b = parse(v.object({ code: v.string({ min: 10, max: 2048 }), state: v.string({ min: 20, max: 1024 }) }), ctx.body);
    const g = cfg(ctx);
    // Check who started it before spending the code: the state must name this person, org and workspace.
    const who = await ctx.tenant(async (_tx, m) => m, { action: 'connections' });
    try {
      checkState(g.stateSecret, b.state, { orgId: who.orgId, workspaceId: ctx.params.ws, userId: who.userId, now: ctx.now().getTime() });
    } catch (e) {
      if (e instanceof ConnectError) throw new HttpError(403, e.code, e.message);
      throw e;
    }
    let got;
    try {
      got = await exchangeCode({ code: b.code, state: b.state, clientId: g.clientId, clientSecret: g.clientSecret, redirectUri: g.redirectUri, secret: g.stateSecret, fetchImpl: doFetch(ctx) });
    } catch (e) {
      if (e instanceof ConnectError) throw badRequest(e.message, { code: e.code });
      throw e;
    }
    return ctx.tenant(async (tx, m) => {
      const ws = ctx.params.ws;
      const mb = (await tx.query(
        `INSERT INTO mailboxes (org_id, workspace_id, provider, address, daily_cap) VALUES ($1, $2, 'gmail', $3, $4)
         ON CONFLICT (workspace_id, address) DO UPDATE SET paused_reason = NULL RETURNING id, address, daily_cap`,
        [m.orgId, ws, got.email, DAY_ONE_CAP])).rows[0];
      const secret = seal(g.mailboxKey, { orgId: m.orgId, workspaceId: ws, mailboxId: mb.id }, got.refreshToken);
      // Update-then-insert, not ON CONFLICT DO UPDATE: an upsert needs SELECT on the row, and app_rw never gets SELECT
      // on `secret` (0007). Reconnecting replaces the sealed token and clears any revocation.
      const upd = await tx.query(
        `UPDATE mailbox_credentials SET secret = $2, scopes = $3, connected_by = $4, connected_at = now(), revoked_at = NULL WHERE mailbox_id = $1`,
        [mb.id, secret, got.scopes, m.userId]);
      if (!(upd.affectedRows ?? upd.rowCount)) {
        await tx.query(
          `INSERT INTO mailbox_credentials (org_id, workspace_id, mailbox_id, provider, secret, scopes, connected_by) VALUES ($1, $2, $3, 'gmail', $4, $5, $6)`,
          [m.orgId, ws, mb.id, secret, got.scopes, m.userId]);
      }
      await audit(tx, m, 'connect', 'mailbox', mb.id);
      return { status: 201, body: { id: mb.id, provider: 'gmail', address: mb.address, dailyCap: mb.daily_cap, scopes: got.scopes.filter((s) => s === GMAIL_SEND), connected: true } };
    }, { action: 'connections' });
  });

  // Disconnect: the mailbox is paused and its credential marked revoked in one transaction, so the sender stops at
  // once. app_rw can never read the sealed token, so the revoke call at Google is the send job's (sender_svc reads
  // revoked rows and calls oauth2.googleapis.com/revoke); a person can also remove access in their Google account.
  r.delete(`${T}/mailboxes/:id`, (ctx) => ctx.tenant(async (tx, m) => {
    const mb = (await tx.query(`UPDATE mailboxes SET paused_reason = 'disconnected' WHERE id = $1 RETURNING id`, [ctx.params.id])).rows[0];
    if (!mb) throw notFound('mailbox not found');
    await tx.query(`UPDATE mailbox_credentials SET revoked_at = now() WHERE mailbox_id = $1 AND revoked_at IS NULL`, [mb.id]);
    await audit(tx, m, 'disconnect', 'mailbox', mb.id);
    return { status: 204 };
  }, { action: 'connections' }));
}
