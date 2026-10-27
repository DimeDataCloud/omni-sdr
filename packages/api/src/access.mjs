// Identity behind Cloudflare Access: verify the JWT Access puts in the Cf-Access-Jwt-Assertion header, with no SDK.
// Rules from https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/ [VERIFY]:
// RS256 only, iss = https://<team>.cloudflareaccess.com, aud contains the application's AUD tag, exp/nbf in range,
// key picked by the token's kid from public_certs[] at /cdn-cgi/access/certs. The email claim keys the user.
// Fails closed: any doubt is a 401; a verified token with no email is a 403.
import { createVerify, X509Certificate } from 'node:crypto';
import { AuthError } from './auth.mjs';
import { HttpError } from './errors.mjs';

// The one place an email becomes an identity: trimmed and lower-cased once, so 'Maya@X.com' and ' maya@x.com' are the
// same user and the uid can't be used to link two people.
export const identityFor = (email) => {
  const e = String(email).trim().toLowerCase();
  return { uid: `access:${e}`, email: e };
};

export const ACCESS_HEADER = 'cf-access-jwt-assertion';
const SKEW_S = 30;
const KEY_TTL_MS = 3600000;      // cached keys are re-read hourly (Access rotates every 6 weeks, old key valid 7 days)
const FORCED_REFETCH_MS = 60000; // an unknown kid triggers at most one refetch a minute

// The only place identity is read from a request: the Access header, nothing else.
export const accessToken = (req) => {
  const v = req.headers[ACCESS_HEADER];
  return typeof v === 'string' && v ? v : null;
};

// Production key fetch: public_certs[] ({ kid, cert }) → [{ kid, key }].
export function certsFetcher({ teamDomain, fetchImpl = fetch }) {
  return async () => {
    const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`access certs unavailable (${res.status})`);
    const body = await res.json();
    if (!Array.isArray(body.public_certs)) throw new Error('access certs: no public_certs');
    return body.public_certs.map((c) => ({ kid: c.kid, key: new X509Certificate(c.cert).publicKey }));
  };
}

const parts = (token) => {
  const p = String(token ?? '').split('.');
  if (p.length !== 3 || p.some((x) => !x)) throw new AuthError('malformed token');
  // Header and payload must each be a JSON object: 'null', a number or an array would otherwise throw a TypeError (a 500) below.
  const json = (s) => {
    let v;
    try { v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { throw new AuthError('malformed token'); }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new AuthError('malformed token');
    return v;
  };
  return { head: json(p[0]), payload: json(p[1]), signed: `${p[0]}.${p[1]}`, sig: Buffer.from(p[2], 'base64url') };
};

/**
 * @param teamDomain  e.g. "acme.cloudflareaccess.com"
 * @param aud         the Access application's AUD tag
 * @param fetchKeys   async () => [{ kid, key: KeyObject }]  (default: the team's certs endpoint)
 * @returns async (token) => { uid, email }
 */
export function accessVerifier({ teamDomain, aud, fetchKeys = certsFetcher({ teamDomain }), now = () => Date.now() }) {
  if (!teamDomain || !aud) throw new Error('accessVerifier needs teamDomain and aud');
  const iss = `https://${teamDomain}`;
  let keys = null;
  let loadedAt = -Infinity;
  let lastForced = -Infinity;
  let inflight = null;
  let failedAt = -Infinity;   // last failed fetch; with no cached keys, requests inside the minute fail closed without refetching

  function refresh() {
    inflight ??= (async () => {
      try {
        keys = new Map((await fetchKeys()).map((k) => [k.kid, k.key]));
        loadedAt = now();
        failedAt = -Infinity;
      } catch {
        failedAt = now();
        // Keep serving cached keys, and don't hammer a down endpoint: retry in a minute.
        loadedAt = now() - KEY_TTL_MS + FORCED_REFETCH_MS;
      }
    })().finally(() => { inflight = null; });
    return inflight;
  }
  async function getKey(kid) {
    if (!keys && now() - failedAt < FORCED_REFETCH_MS) throw new AuthError('signing keys unavailable');   // backoff: don't hammer a down endpoint
    if (!keys || now() - loadedAt >= KEY_TTL_MS) {
      const first = !keys;
      await refresh();
      if (first) lastForced = now();
    }
    if (!keys) throw new AuthError('signing keys unavailable');   // fail closed
    let key = keys.get(kid);
    if (!key && now() - lastForced >= FORCED_REFETCH_MS) {         // rotated in before our cache expired
      lastForced = now();
      await refresh();
      key = keys.get(kid);
    }
    if (!key) throw new AuthError('unknown key id');
    return key;
  }

  return async function verify(token) {
    const { head, payload, signed, sig } = parts(token);
    if (head.alg !== 'RS256') throw new AuthError('alg must be RS256');
    if (typeof head.kid !== 'string' || !head.kid) throw new AuthError('no key id');
    const key = await getKey(head.kid);
    if (!createVerify('RSA-SHA256').update(signed).verify(key, sig)) throw new AuthError('bad signature');
    const t = Math.floor(now() / 1000);
    if (payload.iss !== iss) throw new AuthError('wrong issuer');
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) throw new AuthError('wrong audience');
    if (typeof payload.exp !== 'number' || payload.exp <= t - SKEW_S) throw new AuthError('expired');
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > t + SKEW_S)) throw new AuthError('not yet valid');
    // The same shape ensure_user() requires (0005): an address it would reject must be refused here, not become a 500 on /v1/me.
    if (typeof payload.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email.trim())) throw new HttpError(403, 'forbidden', 'no email on this identity');
    return identityFor(payload.email);
  };
}
