// Identity for /rep and /rep/api: verify the JWT Cloudflare Access puts in Cf-Access-Jwt-Assertion, inside the Worker.
// Port of Backend's B-11 packages/api/src/access.mjs to WebCrypto (Workers have no node:crypto X509), same rules:
// RS256 only, iss = https://<team>, aud contains the application's AUD tag, exp/nbf within 30 s skew, key by kid from
// /cdn-cgi/access/certs (JWK form, `keys`). Fails closed: any doubt is a 401; a verified token with no email is a 403.
// [VERIFY] https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export const ACCESS_HEADER = 'cf-access-jwt-assertion';
const SKEW_S = 30;
const KEY_TTL_MS = 3600000;      // re-read hourly; Access rotates keys every 6 weeks and keeps the old one valid 7 days
const FORCED_REFETCH_MS = 60000; // an unknown kid triggers at most one refetch a minute

export class AccessError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const deny = (msg) => new AccessError(401, msg);

/** The one place an email becomes an identity: trimmed and lower-cased once. */
export const identityFor = (email) => String(email).trim().toLowerCase();

const b64url = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

function parts(token) {
  const p = String(token ?? '').split('.');
  if (p.length !== 3 || p.some((x) => !x)) throw deny('malformed token');
  const json = (s) => { try { return JSON.parse(new TextDecoder().decode(b64url(s))); } catch { throw deny('malformed token'); } };
  let sig;
  try { sig = b64url(p[2]); } catch { throw deny('malformed token'); }
  return { head: json(p[0]), payload: json(p[1]), signed: new TextEncoder().encode(`${p[0]}.${p[1]}`), sig };
}

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

/** Production key fetch: the team's JWKS → [{ kid, key: CryptoKey }]. */
export function certsFetcher({ teamDomain, fetchImpl = fetch }) {
  return async () => {
    const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`access certs unavailable (${res.status})`);
    const body = await res.json();
    if (!Array.isArray(body.keys)) throw new Error('access certs: no keys');
    return Promise.all(body.keys.filter((k) => k.kty === 'RSA' && k.kid).map(async (k) => ({
      kid: k.kid, key: await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, ALG, false, ['verify']),
    })));
  };
}

/**
 * @param teamDomain e.g. "omnisdr.cloudflareaccess.com"
 * @param aud        the Access application's AUD tag
 * @returns async (token) => email (lower-cased)
 */
export function accessVerifier({ teamDomain, aud, fetchKeys = certsFetcher({ teamDomain }), now = () => Date.now() }) {
  if (!teamDomain || !aud) throw new Error('accessVerifier needs teamDomain and aud');
  const iss = `https://${teamDomain}`;
  let keys = null, loadedAt = -Infinity, lastForced = -Infinity, inflight = null;

  function refresh() {
    inflight ??= (async () => {
      try { keys = new Map((await fetchKeys()).map((k) => [k.kid, k.key])); loadedAt = now(); }
      catch { loadedAt = now() - KEY_TTL_MS + FORCED_REFETCH_MS; } // keep cached keys; retry in a minute
    })().finally(() => { inflight = null; });
    return inflight;
  }
  async function getKey(kid) {
    if (!keys || now() - loadedAt >= KEY_TTL_MS) { const first = !keys; await refresh(); if (first) lastForced = now(); }
    if (!keys) throw deny('signing keys unavailable');
    let key = keys.get(kid);
    if (!key && now() - lastForced >= FORCED_REFETCH_MS) { lastForced = now(); await refresh(); key = keys.get(kid); }
    if (!key) throw deny('unknown key id');
    return key;
  }

  return async function verify(token) {
    const { head, payload, signed, sig } = parts(token);
    if (head.alg !== 'RS256') throw deny('alg must be RS256');
    if (typeof head.kid !== 'string' || !head.kid) throw deny('no key id');
    const key = await getKey(head.kid);
    if (!(await crypto.subtle.verify(ALG, key, sig, signed))) throw deny('bad signature');
    const t = Math.floor(now() / 1000);
    if (payload.iss !== iss) throw deny('wrong issuer');
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) throw deny('wrong audience');
    if (typeof payload.exp !== 'number' || payload.exp <= t - SKEW_S) throw deny('expired');
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > t + SKEW_S)) throw deny('not yet valid');
    if (typeof payload.email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(payload.email.trim())) throw new AccessError(403, 'no email on this identity');
    return identityFor(payload.email);
  };
}
