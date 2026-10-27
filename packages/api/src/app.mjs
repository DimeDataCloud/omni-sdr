// The HTTP layer. Framework-free on purpose (the repo's packages have one runtime dependency each).
//
// Every request: security headers → CORS → rate limit → route match → auth → ONE pooled connection for
// the whole request → handler → JSON. Tenant routes live under /v1/o/:org/w/:ws/… and their handlers
// reach tenant data only through ctx.tenant(fn, { action }), which is withTenant() (membership proven from
// the database, RLS context for that transaction only) plus the SPEC §7 permission check.
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { withTenant, withoutTenant } from '../../db/src/context.mjs';
import { can } from '../../db/src/permissions.mjs';
import { HttpError, toHttp, forbidden, notFound, badRequest } from './errors.mjs';
import { AuthError } from './auth.mjs';
import { withClient } from './pool.mjs';
import { relayAlerts } from './services/alerts.mjs';
import { registerAll } from './routes/index.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 256 * 1024;

// Fixed-window counters, per process. Defense in depth; Cloud Armor / Cloudflare are the real edge.
function limiter() {
  const hits = new Map();
  return (key, limit, windowMs, nowMs) => {
    const slot = Math.floor(nowMs / windowMs);
    const k = `${key}|${slot}`;
    const n = (hits.get(k) ?? 0) + 1;
    hits.set(k, n);
    if (hits.size > 50000) for (const old of hits.keys()) { if (!old.endsWith(`|${slot}`)) hits.delete(old); }
    return n <= limit;
  };
}

function compile(path) {
  const names = [];
  const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
  return { re, names };
}

export function createApp({ pool, verifyToken, config = {}, model = null, now = () => new Date(), log = () => {} }) {
  const cfg = {
    corsOrigins: [], appUrl: 'https://app.omnisdr.com', unsubscribeBase: 'https://app.omnisdr.com',
    replyDomain: 'reply.omnisdr.com', inboundSecret: null, trustProxy: false, formDailyCap: undefined, ...config,
  };
  // The alert relay (0030) after a lead is committed. Fired and forgotten: it must never fail or slow the intake request, so every
  // failure is swallowed (the one-minute cron is the safety net). No transport wired: nothing to do.
  // Single flight: one pass at a time per process; a kick while one runs does nothing (that pass, or the cron, takes the new row).
  let kicking = false;
  const kickAlerts = () => {
    if (!cfg.alertTransport || kicking) return;
    kicking = true;
    try {
      withClient(pool, (c) => relayAlerts(c, { transport: cfg.alertTransport, consoleBase: cfg.appUrl, sendTimeoutMs: cfg.alertSendTimeoutMs }))
        .catch(() => {}).finally(() => { kicking = false; });
    } catch { kicking = false; }
  };
  const routes = [];
  const add = (method) => (path, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    routes.push({ method, path, ...compile(path), opts: { auth: 'user', ...opts }, handler });
  };
  const r = { get: add('GET'), post: add('POST'), patch: add('PATCH'), put: add('PUT'), delete: add('DELETE') };
  registerAll(r);

  const allow = limiter();
  const userCache = new Map();   // idp uid → { id, email, at }

  async function resolveUser(client, identity) {
    const hit = userCache.get(identity.uid);
    if (hit && hit.email === identity.email && now().getTime() - hit.at < 300000) return hit;
    const id = await withoutTenant(client, {}, async (tx) =>
      (await tx.query(`SELECT ensure_user($1, $2) AS id`, [identity.uid, identity.email])).rows[0].id);
    const user = { id, email: identity.email, uid: identity.uid, at: now().getTime() };
    userCache.set(identity.uid, user);
    if (userCache.size > 10000) userCache.delete(userCache.keys().next().value);
    return user;
  }

  // The api.omnisdr.com Worker (edge/api-proxy) reaches us from Cloudflare's egress, so without this every user
  // through that name would share a few rate-limit buckets (#52 audit). It signs the caller's address:
  // x-omni-client-ip, x-omni-client-ts (unix s), x-omni-client-sig = hex HMAC-SHA256(edgeSecret, `${ip}.${ts}`).
  // Trusted only with a valid signature from the last 60 s; anything else falls through to the hop-count rule, so a
  // direct run.app caller can't choose its own bucket.
  function edgeIp(req) {
    const ip = req.headers['x-omni-client-ip']; const ts = req.headers['x-omni-client-ts']; const sig = req.headers['x-omni-client-sig'];
    if (!cfg.edgeSecret || typeof ip !== 'string' || typeof ts !== 'string' || typeof sig !== 'string') return null;
    if (!/^[0-9a-fA-F:.]{2,45}$/.test(ip) || !isIP(ip) || !/^\d{9,11}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return null;
    if (Math.abs(now().getTime() / 1000 - Number(ts)) > 60) return null;
    const want = Buffer.from(createHmac('sha256', cfg.edgeSecret).update(`${ip}.${ts}`).digest('hex'));
    return timingSafeEqual(want, Buffer.from(sig)) ? ip : null;
  }

  function clientIp(req) {
    const edge = edgeIp(req);
    if (edge) return edge;
    // trustProxy = how many proxies in front append to X-Forwarded-For (true = 1, Cloud Run alone). Behind Cloudflare
    // or a load balancer as well it is 2: the last entry would be that proxy, and every user would share one rate-limit
    // and sign-in-failure bucket (bug bounty 2026-10-02).
    const hops = cfg.trustProxy === true ? 1 : Number(cfg.trustProxy) || 0;
    if (hops > 0) {
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length >= hops) return xff[xff.length - hops];
      if (xff.length) return xff[0];
    }
    return req.socket?.remoteAddress ?? 'unknown';
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'request body too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  function send(res, status, body, headers = {}) {
    const isHtml = typeof body === 'string' && headers['content-type']?.startsWith('text/html');
    // A file the handler built itself (a CSV export): sent as is, with its own type and disposition.
    const isFile = typeof body === 'string' && !isHtml && Boolean(headers['content-type']) && !headers['content-type'].startsWith('application/json');
    const payload = body === undefined || status === 204 ? '' : isHtml || isFile ? body : JSON.stringify(body);
    res.writeHead(status, {
      'content-type': isHtml ? 'text/html; charset=utf-8' : isFile ? headers['content-type'] : 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(isHtml ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }
        : { 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" }),
      ...headers,
    });
    res.end(payload);
  }

  async function handle(req, res) {
    const started = Date.now();
    const reqId = randomUUID();
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    const origin = req.headers.origin;
    const cors = origin && cfg.corsOrigins.includes(origin)
      ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
    let status = 500;
    try {
      if (req.method === 'OPTIONS') {
        status = 204;
        return send(res, 204, undefined, cors['access-control-allow-origin'] ? {
          ...cors, 'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE',
          'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' } : {});
      }
      const ip = clientIp(req);
      const nowMs = now().getTime();
      if (!allow(`ip:${ip}`, 1200, 60000, nowMs)) throw new HttpError(429, 'rate_limited', 'too many requests');

      let match = null;
      let methodMismatch = false;
      for (const rt of routes) {
        const m = rt.re.exec(path);
        if (!m) continue;
        if (rt.method !== req.method) { methodMismatch = true; continue; }
        // Malformed %-encoding is the client's mistake: 404, not a 500 with a stack trace (bug bounty 2026-10-02).
        try { match = { rt, params: Object.fromEntries(rt.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) }; } catch { throw notFound(); }
        break;
      }
      if (!match) throw methodMismatch ? new HttpError(405, 'method_not_allowed', 'method not allowed') : notFound();
      const { rt, params } = match;
      for (const [k, val] of Object.entries(params)) if ((k === 'org' || k === 'ws' || /id$/i.test(k)) && !UUID.test(val)) throw notFound();

      const raw = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : Buffer.alloc(0);
      let body;
      if (rt.opts.body === 'raw') body = raw;
      else if (raw.length) {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
          throw new HttpError(415, 'unsupported_media_type', 'send application/json');
        }
        try { body = JSON.parse(raw.toString('utf8')); } catch { throw badRequest('body is not valid JSON'); }
      }

      if (rt.opts.auth === 'none' && !allow(`public:${ip}`, rt.opts.publicLimit ?? 30, 60000, nowMs)) {
        throw new HttpError(429, 'rate_limited', 'too many requests');
      }
      if (rt.opts.auth === 'internal') verifyInternal(req, raw, nowMs);

      let identity = null;
      if (rt.opts.auth === 'user') {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
        if (!m) throw new AuthError('no bearer token');
        try {
          identity = await verifyToken(m[1]);
        } catch (err) {
          if (!allow(`authfail:${ip}`, 30, 60000, nowMs)) throw new HttpError(429, 'rate_limited', 'too many requests');
          throw err;
        }
      }

      const out = await withClient(pool, async (client) => {
        const user = identity ? await resolveUser(client, identity) : null;
        if (user && !allow(`user:${user.id}`, 600, 60000, nowMs)) throw new HttpError(429, 'rate_limited', 'too many requests');
        const ctx = {
          req, params, body, user, client, config: cfg, model, now, ip, reqId, allow, kickAlerts,
          query: Object.fromEntries(url.searchParams),
          tenant: (fn, { action } = {}) => {
            if (!params.org || !params.ws) throw new Error('ctx.tenant used on a route without :org/:ws');
            return withTenant(client, { userId: user.id, orgId: params.org, workspaceId: params.ws }, async (tx, m) => {
              if (action && !can(m, action)) throw forbidden();
              return fn(tx, m);
            });
          },
          noTenant: (fn, opts = {}) => withoutTenant(client, { userId: user?.id ?? null, ...opts }, fn),
        };
        return rt.handler(ctx);
      });

      // A handler returns data (→ 200) or an explicit { status, body?, html?, headers? } envelope.
      const res0 = out && typeof out === 'object' && typeof out.status === 'number'
        && Object.keys(out).every((k) => ['status', 'body', 'html', 'headers', 'file'].includes(k)) ? out : { status: 200, body: out };
      status = res0.status;
      if (res0.html !== undefined) return send(res, status, res0.html, { 'content-type': 'text/html; charset=utf-8', ...cors });
      if (res0.file !== undefined) return send(res, status, res0.file.content, { 'content-type': res0.file.type,
        'content-disposition': `attachment; filename="${res0.file.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`, ...cors });
      return send(res, status, res0.body, { ...cors, ...(res0.headers ?? {}) });
    } catch (err) {
      const h = toHttp(err);
      if (!h) {
        status = 500;
        log({ level: 'error', reqId, path: redact(path), error: String(err?.stack ?? err) });
        return send(res, 500, { error: 'internal', message: 'something went wrong', requestId: reqId }, cors);
      }
      status = h.status;
      return send(res, h.status, { error: h.code, message: h.message, ...(h.details ? { details: h.details } : {}), requestId: reqId }, cors);
    } finally {
      log({ level: 'info', reqId, method: req.method, path: redact(path), status, ms: Date.now() - started });
    }
  }

  // Cloudflare email-worker → /internal/*: HMAC-SHA256 over "<unix seconds>.<raw body>", 5-minute window.
  function verifyInternal(req, raw, nowMs) {
    if (!cfg.inboundSecret) throw notFound();
    const ts = Number(req.headers['x-omni-timestamp']);
    const sig = String(req.headers['x-omni-signature'] ?? '');
    if (!Number.isInteger(ts) || Math.abs(nowMs / 1000 - ts) > 300) throw new HttpError(401, 'unauthenticated', 'stale or missing timestamp');
    const want = createHmac('sha256', cfg.inboundSecret).update(`${ts}.`).update(raw).digest('hex');
    const got = /^sha256=([0-9a-f]{64})$/.exec(sig)?.[1] ?? '';
    if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
      throw new HttpError(401, 'unauthenticated', 'bad signature');
    }
  }

  return { handle, kickAlerts, routes: routes.map((x) => `${x.method} ${x.path}`), config: cfg };
}

// Unsubscribe and invite tokens are credentials; they never reach logs.
const redact = (p) => p.replace(/^\/u\/[^/]+/, '/u/[token]');
