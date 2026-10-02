// ZeroBounce mailbox verification, behind services/verify.mjs's interface: check(email) → { verdict }.
// Christian, 2026-10-02: vendor option (a), a per-check API with free starter credits and no subscription; the rule
// stays that only a vendor pass makes an address 'valid' (0014), and catch-all / accept-all / unknown never do.
//
// [VERIFY https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails] POST /v2/validate
// (GET and POST; POST since 2026-09-03) with api_key, email, timeout. The key goes in the POST body, never in a URL
// we build, so it can't reach a log line. ZeroBounce charges no credit for an `unknown` result.

const ENDPOINT = 'https://api.zerobounce.net/v2/validate';
const NEVER_VALID = new Set(['accept_all', 'role_based_catch_all']);
const NOT_SENDABLE = new Set(['invalid', 'spamtrap', 'abuse', 'do_not_mail']);

/** ZeroBounce's answer → our verdict. Anything we don't recognise is 'unknown' (never 'valid'). */
export function verdictOf(r) {
  const status = String(r?.status ?? '').toLowerCase();
  const sub = String(r?.sub_status ?? '').toLowerCase();
  if (NOT_SENDABLE.has(status)) return 'invalid';
  if (status === 'catch-all') return 'risky';
  if (status === 'valid') {
    // A catch-all domain accepts every address, so "valid" there proves nothing about this mailbox.
    if (NEVER_VALID.has(sub) || r?.catchall_domain === true || r?.catchall_domain === 'true') return 'risky';
    return 'valid';
  }
  return 'unknown';
}

export function zeroBounceVerifier({ key, fetchImpl = fetch, timeoutS = 15 }) {
  if (!key) throw new Error('zeroBounceVerifier: no key');
  return {
    name: 'zerobounce',
    async check(email) {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ api_key: key, email, timeout: String(timeoutS) }).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout((timeoutS + 5) * 1000),
      });
      if (!res.ok) throw new Error(`zerobounce: http ${res.status}`);
      const body = await res.json();
      // An account problem (bad key, no credits) comes back as { error } with 200: no answer, so the route refunds it.
      if (body?.error || !body?.status) throw new Error('zerobounce: no verdict');
      return { verdict: verdictOf(body) };
    },
  };
}
