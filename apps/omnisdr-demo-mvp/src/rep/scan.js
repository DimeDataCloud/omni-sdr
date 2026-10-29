// Single-business scan for the Lead Engine tab: an admin pastes a link, the Worker reads the business's own site politely
// (robots.txt respected, identified User-Agent, one request per host per 3 seconds, hard timeouts, a cap on subrequests) and scores it
// with the engine's rubric. Google Business Profile links are never fetched. The result is shown to the admin; nothing is added automatically.
import { parseRobots, robotsAllows } from '../engine-scan/robots.mjs';
export { scan, kindOf } from '../engine-scan/scan-core.mjs';
export { NICHES as NICHE_CONFIG, EXCLUDE } from '../engine-scan/config.mjs';

export const UA = 'OmniSDR-research/0.1 (+https://omnisdr.com; support@omnisdr.com)';
const MAX_SUBREQUESTS = 8, GAP_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Public http(s) pages on the default port, by name. A bare IP, localhost, a port or an internal-looking name is refused.
export function cleanUrl(v) {
  let u; try { u = new URL(/^https?:\/\//i.test(String(v).trim()) ? String(v).trim() : 'https://' + String(v).trim()); } catch { return null; }
  const h = u.hostname.toLowerCase();
  if (!/^https?:$/.test(u.protocol) || u.port || u.username || u.password) return null;
  if (!h.includes('.') || /^\d+(\.\d+){3}$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h)) return null;
  u.hash = ''; return u.href;
}

/** A robots-aware get(url) for scan(): never throws, returns { ok, html, finalUrl, skipped }. State is per call of makeGet. */
export function makeGet(fetchFn, gapMs = GAP_MS) {
  const robots = new Map(), last = new Map(); let used = 0;
  const spaced = async (host) => { const wait = (last.get(host) || 0) + gapMs - Date.now(); if (wait > 0) await sleep(wait); last.set(host, Date.now()); };
  const hit = async (url, accept) => {
    if (used >= MAX_SUBREQUESTS) throw new Error('budget');
    used++; await spaced(new URL(url).host);
    return fetchFn(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
  };
  const robotsFor = async (origin) => {
    if (robots.has(origin)) return robots.get(origin);
    let v;
    try { const r = await hit(origin + '/robots.txt', 'text/plain'); v = r.ok ? { groups: parseRobots((await r.text()).slice(0, 200000)) } : r.status >= 500 ? { down: true } : { groups: [] }; }
    catch { v = { down: true }; }
    robots.set(origin, v); return v;
  };
  return async (url) => {
    let u; try { u = new URL(url); } catch { return { ok: false, skipped: 'bad_url' }; }
    if (!cleanUrl(u.href)) return { ok: false, skipped: 'not_public' };
    try {
      const rb = await robotsFor(u.origin);
      if (rb.down) return { ok: false, skipped: 'robots_unreachable' };
      if (!robotsAllows(rb.groups, u.pathname + u.search)) return { ok: false, skipped: 'robots_disallow' };
      const r = await hit(u.href, 'text/html');
      if (!r.ok || !/html|text/.test(r.headers.get('content-type') || '')) return { ok: false, skipped: 'http_' + r.status };
      const final = r.url || u.href;
      if (!cleanUrl(final)) return { ok: false, skipped: 'not_public' }; // a redirect to an internal address is not followed into the result
      return { ok: true, html: (await r.text()).slice(0, 400000), finalUrl: final };
    } catch (e) { return { ok: false, skipped: e.message === 'budget' ? 'budget' : 'fetch_' + (e.name || 'error') }; }
  };
}
