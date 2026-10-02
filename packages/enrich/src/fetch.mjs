// Fetching a prospect's website without becoming a proxy into our own network (SSRF).
// The API and jobs run on Cloud Run with Direct VPC egress: a fetch to 10.x reaches the database VM. So every hop
// (the first request and each redirect) resolves the host itself, refuses any address that isn't public unicast,
// and then connects to exactly the address it checked, so DNS can't answer differently between check and connect.
//
//   https/http only, ports 443/80 only, no credentials in the URL, at most 3 redirects, 10 s, 1 MiB, text/html only.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export class FetchRefused extends Error {
  constructor(reason) { super(`refused: ${reason}`); this.name = 'FetchRefused'; this.reason = reason; }
}

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

/** True only for public unicast addresses. Everything private, local, reserved or special is refused. */
export function isPublicAddress(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;            // this-net, private, loopback, multicast/reserved
    if (a === 100 && b >= 64 && b <= 127) return false;                          // carrier-grade NAT
    if (a === 169 && b === 254) return false;                                    // link-local, incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(Number(ip.split('.')[2]))))) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;                       // benchmarking
    if (a === 198 && b === 51 && ip.split('.')[2] === '100') return false;       // TEST-NET-2
    if (a === 203 && b === 0 && ip.split('.')[2] === '113') return false;        // TEST-NET-3
    return true;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicAddress(mapped[1]);
    const first = parseInt(s.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false;  // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false;  // link-local fe80::/10
    if ((first & 0xff00) === 0xff00) return false;  // multicast
    if (s.startsWith('64:ff9b:') || s.startsWith('2001:db8:') || s.startsWith('2001:0db8:')) return false; // NAT64, documentation
    return (first & 0xe000) === 0x2000;             // only global unicast 2000::/3
  }
  return false;
}

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new FetchRefused('not a URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchRefused(`scheme ${u.protocol}`);
  if (u.username || u.password) throw new FetchRefused('credentials in URL');
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (port !== 443 && port !== 80) throw new FetchRefused(`port ${port}`);
  if (isIP(u.hostname.replace(/^\[|\]$/g, ''))) throw new FetchRefused('literal IP host');
  if (!/^[a-z0-9.-]+\.[a-z]{2,63}$/i.test(u.hostname) || /\.(local|internal|localhost|test|example|invalid)$/i.test(u.hostname)) {
    throw new FetchRefused(`host ${u.hostname}`);
  }
  return { u, port };
}

/**
 * GET one page. Resolves `{ url, status, body, contentType }` for the final hop; throws FetchRefused or Error.
 * `lookup` and `transport` are injectable for tests.
 */
export async function safeFetch(raw, { lookup = dnsLookup, transport = { http, https }, maxBytes = MAX_BYTES, timeoutMs = TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let url = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { u, port } = checkUrl(url);
    const addrs = await lookup(u.hostname, { all: true, verbatim: true });
    if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address))) throw new FetchRefused(`${u.hostname} resolves to a non-public address`);
    const pinned = addrs.find((a) => a.family === 4) ?? addrs[0];   // IPv4 first: Cloud Run's VPC egress and many hosts lack IPv6 routes
    const res = await new Promise((resolve, reject) => {
      const lib = u.protocol === 'https:' ? transport.https : transport.http;
      const req = lib.request({
        host: pinned.address, family: pinned.family, port, path: `${u.pathname}${u.search}`, method: 'GET',
        servername: u.hostname,                                    // TLS: SNI and certificate check against the name, not the IP
        headers: { host: u.host, 'user-agent': 'OmniSDR-evidence/1.0 (+https://omnisdr.com)', accept: 'text/html,application/xhtml+xml' },
        timeout: Math.max(1, deadline - Date.now()),
      }, (r) => {
        const loc = r.headers.location;
        if (r.statusCode >= 300 && r.statusCode < 400 && loc) { r.resume(); resolve({ redirect: new URL(loc, u).href }); return; }
        const type = String(r.headers['content-type'] ?? '');
        if (!/^(text\/html|application\/xhtml\+xml)/i.test(type)) { r.destroy(); reject(new FetchRefused(`content-type ${type || 'none'}`)); return; }
        const chunks = []; let n = 0;
        r.on('data', (c) => { n += c.length; if (n > maxBytes) { r.destroy(); resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8'), truncated: true, type }); } else chunks.push(c); });
        r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8'), truncated: false, type }));
        r.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', reject);
      req.end();
    });
    if (res.redirect) { url = res.redirect; continue; }
    return { url: u.href, status: res.status, body: res.body, truncated: res.truncated, contentType: res.type };
  }
  throw new FetchRefused('too many redirects');
}
