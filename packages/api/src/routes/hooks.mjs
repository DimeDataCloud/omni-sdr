// Inbound webhooks (0014; docs/claude/SDR-PIVOT.md P5): a server-side caller (a website's form backend, a Zapier step)
// posts each submission to /v1/hooks/:id with `Authorization: Bearer <token>`. Never a browser: the token would be public. Managing hooks needs the `connections` permission.
// The token is shown once, at creation; only its sha256 is stored.
import { randomBytes, createHash } from 'node:crypto';
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { badRequest, notFound, HttpError } from '../errors.mjs';
import { ingestFormLead } from '../leads/web-form.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^Bearer ([A-Za-z0-9_-]{32,128})$/;
const MAX_BODY = 64 * 1024;

export function registerHooks(r) {
  r.get(`${T}/hooks`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT id, kind, name, created_at, revoked_at FROM inbound_hooks ORDER BY created_at DESC`)).rows;
    return { items: rows.map((x) => ({ ...camel(x), url: hookUrl(ctx, x.id) })) };
  }, { action: 'connections' }));

  r.post(`${T}/hooks`, (ctx) => ctx.tenant(async (tx, m) => {
    const b = parse(v.object({ name: v.string({ min: 1, max: 80 }) }), ctx.body ?? {});
    const token = randomBytes(32).toString('base64url');
    const id = (await tx.query(`INSERT INTO inbound_hooks (org_id, workspace_id, name, token_hash, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [m.orgId, m.workspaceId, b.name, sha(token), m.userId])).rows[0].id;
    await audit(tx, m, 'create', 'inbound_hook', id);
    // The only time the token leaves the server. Losing it means revoking the hook and making a new one.
    return { status: 201, body: { id, name: b.name, kind: 'form', url: hookUrl(ctx, id), token } };
  }, { action: 'connections' }));

  r.delete(`${T}/hooks/:id`, (ctx) => ctx.tenant(async (tx, m) => {
    if (!UUID.test(ctx.params.id)) throw notFound('hook not found');
    const hit = (await tx.query(`UPDATE inbound_hooks SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [ctx.params.id])).rows[0];
    if (!hit) throw notFound('hook not found');
    await audit(tx, m, 'revoke', 'inbound_hook', hit.id);
    return { status: 204 };
  }, { action: 'connections' }));

  // Public intake. A wrong id, a wrong token and a revoked hook all answer the same 404, so the route can't be used
  // to find live hooks. Nothing about the workspace comes back.
  r.post('/v1/hooks/:id', { auth: 'none', body: 'raw', publicLimit: 60 }, async (ctx) => {
    const tok = TOKEN.exec(String(ctx.req.headers.authorization ?? ''))?.[1];
    if (!tok || !UUID.test(ctx.params.id)) throw notFound('not found');
    if (ctx.body.length > MAX_BODY) throw new HttpError(413, 'too_large', 'submission is too large');
    let json;
    try { json = JSON.parse(ctx.body.toString('utf8')); } catch { throw badRequest('body is not valid JSON'); }
    const msg = parse(v.object({
      message: v.string({ min: 1, max: 5000, trim: false }),
      email: v.optional(v.email()),
      name: v.optional(v.string({ max: 200 })),
      phone: v.optional(v.string({ max: 40 })),
      page: v.optional(v.string({ max: 200 })),
      externalId: v.optional(v.string({ min: 1, max: 200 })),
    }), json);
    // Postgres text cannot hold U+0000: it would surface as a 500. It is never real form input, so it is the caller's 400.
    if (Object.values(msg).some((x) => typeof x === 'string' && x.includes('\u0000'))) throw badRequest('submission contains a NUL character');
    // One transaction: the message and its lead event land together or not at all (S2L-2b). Over the daily cap nothing is written.
    const out = await ingestFormLead(ctx.client, { id: ctx.params.id.toLowerCase(), tokenHash: sha(tok) },
      { body: msg.message, email: msg.email, name: msg.name, phone: msg.phone, page: msg.page, externalId: msg.externalId, receivedAt: ctx.now() },
      { dailyCap: ctx.config.formDailyCap });
    if (out.outcome === 'unknown_hook') throw notFound('not found');
    if (out.outcome === 'rate_limited') throw new HttpError(429, 'rate_limited', 'too many submissions for this workspace today; try again later');
    // After COMMIT (ingestFormLead has returned): tell the owner. Not awaited, never throws.
    if (out.outcome === 'recorded' && !out.capped) ctx.kickAlerts?.();
    return { status: out.outcome === 'duplicate' ? 200 : 202, body: { received: true } };
  });
}

function hookUrl(ctx, id) {
  return `${String(ctx.config.publicApiBase ?? ctx.config.unsubscribeBase).replace(/\/+$/, '')}/v1/hooks/${id}`;
}
