// api.omnisdr.com: a pass-through to the Cloud Run API (omni-api), so the public name works without a Cloud Run domain
// mapping (which needs Search Console verification of omnisdr.com) or a load balancer (which costs money; the MVP is
// $0). Unsubscribe links (OMNI_UNSUBSCRIBE_BASE) and the console use this name; the API stays the security boundary
// and this Worker adds nothing to it: no auth, no caching, no logging of bodies or headers.
//
//   env.ORIGIN   the Cloud Run URL, e.g. https://omni-api-….run.app (no trailing slash)
//
// The client's address: the API reads the n-th X-Forwarded-For entry from the end (OMNI_TRUST_PROXY=1 on Cloud Run).
// Google's front end appends the address that connected to it, which from here is a Cloudflare egress address, so
// rate-limit buckets for calls through this name are per Cloudflare egress, not per person. Raising the API to 2 would
// let anyone calling the run.app URL directly pick their own bucket, so it stays at 1 until run.app ingress is closed.

const DROP = new Set(['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cf-worker', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip']);

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
