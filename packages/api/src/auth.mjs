// Identity: verify the ID token the browser got from Identity Platform / Firebase Auth (Google or email-link
// sign-in), with no SDK. Rules from https://firebase.google.com/docs/auth/admin/verify-id-tokens
// ("Verify ID tokens using a third-party JWT library"): RS256, kid from Google's securetoken certs,
// aud = project id, iss = https://securetoken.google.com/<project id>, exp in the future, iat and auth_time
// in the past, sub a non-empty string. We also require a verified email, because invites match on it.
import { createVerify, X509Certificate, createPublicKey } from 'node:crypto';

export const SECURETOKEN_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const SKEW_S = 60;

export class AuthError extends Error {
  constructor(reason) { super(`unauthenticated: ${reason}`); this.name = 'AuthError'; this.reason = reason; }
}

const b64urlJson = (part) => {
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { return null; }
};

// Google's certs, cached for the max-age the response carries (they rotate daily).
export function googleKeySource({ fetchImpl = fetch, url = SECURETOKEN_CERTS_URL, now = () => Date.now() } = {}) {
  let cache = { keys: null, expires: 0 };
  let inflight = null;
  let lastForced = -Infinity; // an unknown kid forces a refresh at most once a minute, so made-up kids can't drive fetches
  async function load() {
    const res = await fetchImpl(url);
    if (!res.ok) throw new AuthError(`signing keys unavailable (${res.status})`);
    const certs = await res.json();
    const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '') ?? [])[1] ?? 3600);
    const keys = new Map(Object.entries(certs).map(([kid, pem]) => [kid, new X509Certificate(pem).publicKey]));
    cache = { keys, expires: now() + Math.min(maxAge, 86400) * 1000 };
    return keys;
  }
  return async function getKey(kid) {
    if (!cache.keys || now() >= cache.expires) {
      inflight ??= load().finally(() => { inflight = null; });
      await inflight;
    }
    let key = cache.keys.get(kid);
    if (!key && now() - lastForced >= 60000) {   // a key rotated in before our cache expired: refresh once
      lastForced = now();
      inflight ??= load().finally(() => { inflight = null; });
      key = (await inflight).get(kid);
    }
    return key ?? null;
  };
}

// Tests and the dev server supply their own keys: { kid: KeyObject | PEM }.
export function staticKeySource(keys) {
  const map = new Map(Object.entries(keys).map(([kid, k]) => [kid, typeof k === 'string' ? createPublicKey(k) : k]));
  return async (kid) => map.get(kid) ?? null;
}

/**
 * @returns {Promise<{ uid: string, email: string }>}
 */
export async function verifyIdToken(token, { projectId, getKey, nowMs = Date.now() }) {
  if (!projectId) throw new AuthError('no project configured');
  if (typeof token !== 'string' || token.length > 8192) throw new AuthError('malformed token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('malformed token');
  const [h, p, s] = parts;
  const header = b64urlJson(h);
  const payload = b64urlJson(p);
  if (!header || !payload || typeof payload !== 'object') throw new AuthError('malformed token');
  if (header.alg !== 'RS256') throw new AuthError('wrong algorithm');     // rejects "none" and HS256 key confusion
  if (typeof header.kid !== 'string') throw new AuthError('no key id');
  const key = await getKey(header.kid);
  if (!key) throw new AuthError('unknown key id');
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(key, Buffer.from(s, 'base64url'));
  if (!ok) throw new AuthError('bad signature');

  const now = Math.floor(nowMs / 1000);
  if (payload.aud !== projectId) throw new AuthError('wrong audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError('wrong issuer');
  if (typeof payload.exp !== 'number' || payload.exp <= now - SKEW_S) throw new AuthError('expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + SKEW_S) throw new AuthError('issued in the future');
  if (typeof payload.auth_time !== 'number' || payload.auth_time > now + SKEW_S) throw new AuthError('authenticated in the future');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new AuthError('no subject');
  if (typeof payload.email !== 'string' || payload.email_verified !== true) throw new AuthError('email not verified');
  return { uid: payload.sub, email: payload.email.toLowerCase() };
}

// Dev only: "Bearer dev:<email>". server.mjs refuses to start with this on in production or on a
// non-loopback address; see dev.mjs.
export function devVerifier() {
  return async (token) => {
    const m = /^dev:([^@\s]+@[^@\s]+\.[^@\s]+)$/.exec(token ?? '');
    if (!m) throw new AuthError('dev token must be dev:<email>');
    return { uid: `dev:${m[1].toLowerCase()}`, email: m[1].toLowerCase() };
  };
}

export function firebaseVerifier({ projectId, getKey = googleKeySource() }) {
  return (token) => verifyIdToken(token, { projectId, getKey });
}
