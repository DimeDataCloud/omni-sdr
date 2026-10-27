// No session. Health, unsubscribe (CAN-SPAM + RFC 8058 one-click), and the signed internal inbound hook.
import { ingestReply } from '../services/inbox.mjs';
import { relayAlerts } from '../services/alerts.mjs';
import { badRequest } from '../errors.mjs';
import { v, parse } from '../validate.mjs';

// The same page for a valid, reused or unknown token, so the route can't be used to probe tokens (0003).
const page = (title, text, form = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1A1A1A;background:#F7F5F0">
<h1 style="font-size:1.4rem">${title}</h1><p>${text}</p>${form}</body></html>`;

const UNSUB_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export function registerPublic(r) {
  r.get('/healthz', { auth: 'none', publicLimit: 120 }, () => ({ ok: true }));
  // Google's front end answers /healthz itself on *.run.app (404, verified by claude-local 2026-10-02), so uptime
  // checks and the deploy smoke test use this path.
  r.get('/v1/health', { auth: 'none', publicLimit: 120 }, () => ({ ok: true }));

  // GET never unsubscribes: link scanners prefetch GETs. One page, one button (CAN-SPAM allows one page visit).
  r.get('/u/:token', { auth: 'none' }, (ctx) => ({
    status: 200,
    html: page('Unsubscribe', 'Stop receiving these emails?',
      `<form method="post" action="/u/${UNSUB_TOKEN.test(ctx.params.token) ? ctx.params.token : 'x'}"><button type="submit"
       style="font-size:1rem;padding:.6rem 1.2rem;border:0;border-radius:.5rem;background:#A3FFB4;color:#1A1A1A">Unsubscribe</button></form>`),
  }));

  // The form button and the RFC 8058 one-click POST from mail clients both land here.
  r.post('/u/:token', { auth: 'none', body: 'raw' }, async (ctx) => {
    if (UNSUB_TOKEN.test(ctx.params.token)) {
      await ctx.noTenant((tx) => tx.query(`SELECT unsubscribe($1)`, [ctx.params.token]));
    }
    return { status: 200, html: page('You\'re unsubscribed', 'You won\'t get further emails from this sender. It can take a moment to apply everywhere.') };
  });

  // Cloudflare email-worker → here, HMAC-signed (app.mjs verifyInternal). Answers only what the worker needs.
  r.post('/internal/inbound', { auth: 'internal', body: 'raw' }, async (ctx) => {
    let json;
    try { json = JSON.parse(ctx.body.toString('utf8')); } catch { throw badRequest('body is not valid JSON'); }
    const msg = parse(v.object({
      to: v.string({ min: 3, max: 320 }),
      from: v.optional(v.string({ max: 320 })),
      subject: v.optional(v.string({ max: 998, trim: false })),
      body: v.string({ max: 100000, trim: false }),
      receivedAt: v.datetime(),
      externalId: v.optional(v.string({ min: 1, max: 998 })),
    }), json);
    const out = await ingestReply(ctx.client, { ...msg, channel: 'email', receivedAt: new Date(msg.receivedAt) });
    return { outcome: out.outcome, id: out.id ?? null };
  });

  // One relay pass for owner alerts (0030), HMAC-signed like the others. Called by the one-minute Cron Trigger (the safety net for
  // the intake kick). Answers counts only.
  r.post('/internal/relay', { auth: 'internal', body: 'raw' }, async (ctx) => relayAlerts(ctx.client,
    { transport: ctx.config.alertTransport, consoleBase: ctx.config.appUrl, sendTimeoutMs: ctx.config.alertSendTimeoutMs }));

  // Cloudflare Email Sending has no webhooks: a Queue consumer (edge/, a later card) forwards each queue event here,
  // HMAC-signed like /internal/inbound. Exactly the normalized shape of the event, nothing else is accepted. The DB
  // decides what a type means: only a complaint, or a terminal bounce/failure, suppresses (record_mail_event, 0021).
  r.post('/internal/mail-events', { auth: 'internal', body: 'raw' }, async (ctx) => {
    let json;
    try { json = JSON.parse(ctx.body.toString('utf8')); } catch { throw badRequest('body is not valid JSON'); }
    const e = parse(v.object({
      type: v.string({ min: 1, max: 100 }),
      source: v.object({ type: v.string({ max: 50 }), zoneId: v.optional(v.string({ max: 100 })), domain: v.optional(v.string({ max: 255 })) }),
      payload: v.object({
        messageId: v.string({ min: 1, max: 998 }),
        recipient: v.string({ min: 3, max: 320 }),
        terminal: v.optional(v.bool()),
        delivery: v.optional(v.json({ maxBytes: 2000 })),
      }),
    }), json);
    const m = /^cf\.email\.sending\.message\.(delivered|deferred|bounced|failed|rejected|complained)$/.exec(e.type);
    if (!m || e.source.type !== 'email.sending') throw badRequest('not a cf.email.sending.message event');
    const outcome = await ctx.noTenant(async (tx) => (await tx.query(`SELECT record_mail_event($1, $2, $3, $4) AS outcome`,
      [e.payload.messageId, m[1], e.payload.terminal === true, e.payload.recipient])).rows[0].outcome, { role: 'inbox_svc' });
    return { outcome };
  });
}
