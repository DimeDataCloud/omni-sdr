// Email verification (DECISIONS 2026-09-28). Free checks run on every address and cost nothing: syntax and
// disposable domains (catalog.mjs) and an MX lookup here. A mailbox check needs a vendor and a Data credit the
// customer spends; the vendor adapter ships OFF until Christian picks one [VERIFY vendor + unit price].
//
//   verifier.check(email) → { verdict: 'valid' | 'invalid' | 'risky' | 'unknown' }
import { resolveMx as dnsResolveMx } from 'node:dns/promises';

/** true: the domain takes mail; false: it can't (no such domain, no MX); null: we couldn't tell (DNS trouble). */
export async function mxOk(domain, resolveMx = dnsResolveMx) {
  try {
    const mx = await Promise.race([resolveMx(domain), new Promise((_, no) => setTimeout(() => no(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 5000))]);
    // RFC 7505 null MX ("." at preference 0) says the domain accepts no mail.
    return Array.isArray(mx) && mx.some((m) => m.exchange && m.exchange !== '.');
  } catch (e) {
    return e?.code === 'ENOTFOUND' || e?.code === 'ENODATA' ? false : null;
  }
}

export function offVerifier() {
  return { name: 'off', async check() { throw new Error('email verification is turned off'); } };
}

/** For tests and the dev server. */
export function fakeVerifier(decide = () => 'valid') {
  const calls = [];
  return { name: 'fake', calls, async check(email) { calls.push(email); return { verdict: await decide(email) }; } };
}
