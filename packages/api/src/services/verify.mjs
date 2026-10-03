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

// ZeroBounce (Christian 2026-10-03: "lets go with zero bounce"). The batch endpoint is used even for one address
// because it takes the key in the request body; the single-address endpoint takes it in the URL, and a secret never
// goes in a URL (rails §3.6). [VERIFY https://www.zerobounce.net/docs/email-validation-api-quickstart/ for the
// endpoint, field names and statuses.] Only 'valid' becomes valid: a catch-all domain accepts any address, so it can't
// prove this one exists ('risky'); role inboxes and spam traps are never mailed.
const ZB_VERDICT = { valid: 'valid', invalid: 'invalid', 'catch-all': 'risky', unknown: 'unknown', spamtrap: 'invalid', abuse: 'invalid', do_not_mail: 'invalid' };
export function zeroBounceVerifier({ key, fetchImpl = fetch, timeoutMs = 30000 }) {
  if (!key) throw new Error('zeroBounceVerifier needs a key');
  return {
    name: 'zerobounce',
    async check(email) {
      const res = await fetchImpl('https://bulkapi.zerobounce.net/v2/validatebatch', {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: key, email_batch: [{ email_address: email, ip_address: null }] }),
      });
      if (!res.ok) throw new Error(`zerobounce http ${res.status}`);
      const d = await res.json();
      if (d.errors?.length) throw new Error('zerobounce refused the request');   // its message can echo input; not passed on
      const row = (d.email_batch ?? []).find((x) => String(x.address ?? '').toLowerCase() === email.toLowerCase());
      if (!row) throw new Error('zerobounce returned no result for this address');
      const status = String(row.status ?? '').toLowerCase();
      // A role inbox (info@, office@) is do_not_mail/role_based: not a dead address, but not one we write to cold.
      const verdict = status === 'do_not_mail' && /role/i.test(String(row.sub_status ?? '')) ? 'risky' : (ZB_VERDICT[status] ?? 'unknown');
      return { verdict, detail: { status, subStatus: row.sub_status ?? null } };
    },
  };
}
