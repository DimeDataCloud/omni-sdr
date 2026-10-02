// api.omnisdr.com: a pass-through to the Cloud Run API (omni-api), so the public name works without a Cloud Run domain
// mapping (which needs Search Console verification of omnisdr.com) or a load balancer (which costs money; the MVP is
// $0). Unsubscribe links (OMNI_UNSUBSCRIBE_BASE) and the console use this name; the API stays the security boundary
// and this Worker adds nothing to it: no auth, no caching, no logging of bodies or headers.
//
//   env.ORIGIN   the Cloud Run URL, e.g. https://omni-api-….run.app (no trailing slash)
//
//   env.EDGE_SECRET  HMAC key shared with the API (OMNI_EDGE_SECRET): signs the caller's address (wrangler secret)
//
// The client's address: Google's front end sees this Worker's Cloudflare egress, so without help every caller through
// this name would share a few rate-limit buckets (#52 audit P2: sign-in lockouts, unsubscribe 429s). The Worker signs
// the caller's own cf-connecting-ip: x-omni-client-ip, x-omni-client-ts (unix s), x-omni-client-sig =
// hex HMAC-SHA256(EDGE_SECRET, `${ip}.${ts}`). The API trusts it only with a valid signature from the last 60 s
// (app.mjs edgeIp, #55); a direct run.app caller can't forge one, and anything a caller sends in these headers is
// dropped here first.

const DROP = new Set(['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cf-worker', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip',
  'x-omni-client-ip', 'x-omni-client-ts', 'x-omni-client-sig']);
const enc = new TextEncoder();

async function sign(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    if (!env.ORIGIN || !/^https:\/\/[a-z0-9.-]+\.run\.app$/.test(env.ORIGIN)) {
      return new Response(JSON.stringify({ error: 'not_configured' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    const url = new URL(request.url);
    const target = `${env.ORIGIN}${url.pathname}${url.search}`;
    const headers = new Headers();
    for (const [k, v] of request.headers) if (!DROP.has(k.toLowerCase())) headers.set(k, v);
    headers.set('x-forwarded-host', url.host);
    const ip = request.headers.get('cf-connecting-ip');
    if (env.EDGE_SECRET && ip) {
      const ts = String(Math.floor(Date.now() / 1000));
      headers.set('x-omni-client-ip', ip);
      headers.set('x-omni-client-ts', ts);
      headers.set('x-omni-client-sig', await sign(env.EDGE_SECRET, `${ip}.${ts}`));
    }
    const init = { method: request.method, headers, redirect: 'manual' };
    if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
    let res;
    try {
      res = await fetch(target, init);
    } catch {
      return new Response(JSON.stringify({ error: 'upstream_unreachable', message: 'Omni-SDR is briefly unavailable. Try again.' }),
        { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    // Responses pass through as the API sent them (its CSP, no-store, nosniff, CORS); only a redirect to the origin's
    // own host is rewritten so the run.app name never leaks into a browser's address bar.
    const out = new Response(res.body, res);
    const loc = out.headers.get('location');
    if (loc && loc.startsWith(env.ORIGIN)) out.headers.set('location', `${url.origin}${loc.slice(env.ORIGIN.length)}`);
    return out;
  },
};
