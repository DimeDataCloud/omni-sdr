// Email verification (DECISIONS 2026-09-28). Free checks run on every address and cost nothing: syntax and
// disposable domains (catalog.mjs) and an MX lookup here. A mailbox check needs a vendor and a Data credit the
// customer spends; the vendor adapter ships OFF until Christian picks one [VERIFY vendor + unit price].
//
//   verifier.check(email) → { verdict: 'valid' | 'invalid' | 'risky' | 'unknown' }
import { resolveMx as dnsResolveMx, resolve4 as dnsResolve4, resolve6 as dnsResolve6 } from 'node:dns/promises';

const within = (p, ms = 5000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), ms))]);
const gone = (e) => e?.code === 'ENOTFOUND' || e?.code === 'ENODATA';

/** true: the domain takes mail; false: it can't (no such domain, a null MX, or no MX and no address); null: we
 *  couldn't tell (DNS trouble). A domain with no MX record still takes mail at its A/AAAA address (RFC 5321 §5.1,
 *  "implicit MX"; #59 audit P3-1). */
export async function mxOk(domain, resolveMx = dnsResolveMx, resolveAddr = defaultAddr) {
  try {
    const mx = await within(resolveMx(domain));
    if (Array.isArray(mx) && mx.length) return mx.some((m) => m.exchange && m.exchange !== '.');   // RFC 7505 null MX: no mail
  } catch (e) {
    if (!gone(e)) return null;
    if (e.code === 'ENOTFOUND') return false;
  }
  try {
    const a = await within(resolveAddr(domain));
    return Array.isArray(a) && a.length > 0;
  } catch (e) {
    return gone(e) ? false : null;
  }
}
async function defaultAddr(domain) {
  try { return await dnsResolve4(domain); } catch (e) { if (!gone(e)) throw e; return dnsResolve6(domain); }
}

export function offVerifier() {
  return { name: 'off', async check() { throw new Error('email verification is turned off'); } };
}

/** For tests and the dev server. */
export function fakeVerifier(decide = () => 'valid') {
  const calls = [];
  return { name: 'fake', calls, async check(email) { calls.push(email); return { verdict: await decide(email) }; } };
}
