// Gmail connect (docs/claude/SENDER-PLAN.md §2): Google OAuth 2.0 for a web server app, with PKCE, `gmail.send` only.
// https://developers.google.com/identity/protocols/oauth2/web-server
//
// The redirect lands on the console (suite.omnisdr.com/connect/google), which posts { code, state } to the API with
// the signed-in person's ID token. The API checks the state was minted for that same person, workspace and org, so a
// stranger can't trick someone into connecting their Gmail to the stranger's workspace (the state names the user).
// The PKCE verifier is derived from the state with a server-only secret, so nothing has to be stored between the
// two steps and the verifier never reaches the browser.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';
const ALLOWED = new Set([GMAIL_SEND, 'openid', 'email', 'https://www.googleapis.com/auth/userinfo.email']);
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const STATE_TTL_MS = 10 * 60 * 1000;

export class ConnectError extends Error {
  constructor(code, message) { super(message); this.name = 'ConnectError'; this.code = code; }
}

const mac = (secret, s) => createHmac('sha256', secret).update(s).digest('base64url');

/** A signed, expiring state naming who started the connect, for which workspace. */
export function mintState(secret, { orgId, workspaceId, userId, now = Date.now() }) {
  const body = Buffer.from(JSON.stringify({ o: orgId, w: workspaceId, u: userId, n: randomBytes(12).toString('base64url'), e: now + STATE_TTL_MS })).toString('base64url');
  return `${body}.${mac(secret, `state.${body}`)}`;
}

/** The state's claims, if it is ours, unexpired, and minted for exactly this person and workspace. */
export function checkState(secret, state, { orgId, workspaceId, userId, now = Date.now() }) {
  const [body, sig, extra] = String(state ?? '').split('.');
  if (!body || !sig || extra !== undefined) throw new ConnectError('bad_state', 'this connect link is not valid');
  const want = Buffer.from(mac(secret, `state.${body}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new ConnectError('bad_state', 'this connect link is not valid');
  let c;
  try { c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new ConnectError('bad_state', 'this connect link is not valid'); }
  if (!(c.e > now)) throw new ConnectError('expired_state', 'this connect link has expired; start again');
  if (c.o !== orgId || c.w !== workspaceId || c.u !== userId) throw new ConnectError('wrong_user', 'this connect link was started by someone else');
  return c;
}

const verifierFor = (secret, state) => mac(secret, `pkce.${state}`);   // 43 chars of base64url: a valid PKCE verifier

export function authUrl({ clientId, redirectUri, secret, state, loginHint }) {
  const challenge = createHash('sha256').update(verifierFor(secret, state)).digest('base64url');
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: `openid email ${GMAIL_SEND}`,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state,
    code_challenge: challenge, code_challenge_method: 'S256', ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${AUTH}?${q}`;
}

/** Exchange the code. Refuses unless gmail.send was granted and nothing beyond identity was. */
export async function exchangeCode({ code, state, clientId, clientSecret, redirectUri, secret, fetchImpl = fetch }) {
  const res = await fetchImpl(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifierFor(secret, state) }) });
  const t = await res.json().catch(() => ({}));
  if (!res.ok) throw new ConnectError('exchange_failed', `Google refused the code (${t.error ?? res.status})`);
  const scopes = String(t.scope ?? '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(GMAIL_SEND)) throw new ConnectError('scope_missing', 'Sending permission was not granted. Connect again and allow "Send email on your behalf".');
  const extra = scopes.filter((s) => !ALLOWED.has(s));
  if (extra.length) throw new ConnectError('scope_extra', `unexpected scopes granted: ${extra.join(' ')}`);
  if (!t.refresh_token) throw new ConnectError('no_refresh_token', 'Google returned no refresh token; remove Omni-SDR from your Google account permissions and connect again');
  // The ID token came straight from Google's token endpoint over TLS, so its claims can be read without a signature
  // check (OpenID Connect Core §3.1.3.7, rule 6).
  const claims = JSON.parse(Buffer.from(String(t.id_token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8') || '{}');
  if (!claims.email || claims.email_verified !== true) throw new ConnectError('no_email', 'Google did not return a verified address for this account');
  return { refreshToken: t.refresh_token, scopes, email: String(claims.email).toLowerCase() };
}

/** A short-lived access token for one send run. */
export async function accessToken({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  const res = await fetchImpl(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }) });
  const t = await res.json().catch(() => ({}));
  if (!res.ok || !t.access_token) {
    const e = new ConnectError('refresh_failed', `token refresh failed (${t.error ?? res.status})`);
    e.kind = t.error === 'invalid_grant' ? 'auth' : 'transient';   // invalid_grant: revoked or expired → reconnect
    throw e;
  }
  return t.access_token;
}

export async function revoke({ token, fetchImpl = fetch }) {
  const res = await fetchImpl(REVOKE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
  return res.ok || res.status === 400;   // 400: already revoked or expired
}
