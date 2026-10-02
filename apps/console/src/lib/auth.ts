// Sign-in for the real API (G5): Identity Platform email links, through its REST API, with no SDK.
// https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/sendOobCode
// https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/signInWithEmailLink
// https://firebase.google.com/docs/reference/rest/auth#section-refresh-token
//
// The browser key (VITE_OMNI_IDP_KEY) is public by design: it is restricted to identitytoolkit + securetoken and to
// the https://suite.omnisdr.com/* referrer. The page's Referrer-Policy is same-origin, which sends no Referer to
// Google, so these calls ask for `strict-origin` themselves; the key's referrer check needs it.
//
// The refresh token lives in localStorage, as the Firebase SDK keeps it in IndexedDB: the CSP allows scripts from
// 'self' only, so no third-party script can read it. Signing out forgets it on this device.

const KEY = import.meta.env.VITE_OMNI_IDP_KEY as string | undefined;
const IDT = 'https://identitytoolkit.googleapis.com/v1/accounts';
const STS = 'https://securetoken.googleapis.com/v1/token';
const STORE = 'omni.auth';
const PENDING = 'omni.signin.email';
export const FINISH_PATH = '/signin/finish';

interface Tokens { idToken: string; refreshToken: string; expiresAt: number; email: string }

export class SignInError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const get = <T>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const set = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: signed in for this tab only */ } };

let tokens: Tokens | null = get<Tokens>(STORE);
const listeners = new Set<() => void>();
const changed = () => { for (const fn of listeners) fn(); };
export const onAuthChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
/** Dev and local checks only: sign in as a dev-server account (`dev:<email>` tokens, which production refuses). */
export const DEV_AS = import.meta.env.DEV ? import.meta.env.VITE_OMNI_DEV_AS : undefined;
export const signedInEmail = () => DEV_AS ?? tokens?.email ?? null;
export const configured = () => Boolean(KEY);

// Identity Platform's error codes, in words a person can act on.
const WORDS: Record<string, string> = {
  INVALID_EMAIL: 'That email address isn’t valid.',
  INVALID_OOB_CODE: 'This sign-in link was already used or has expired. Ask for a new one.',
  EXPIRED_OOB_CODE: 'This sign-in link has expired. Ask for a new one.',
  USER_DISABLED: 'This account is disabled.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Wait a few minutes and try again.',
  TOKEN_EXPIRED: 'You were signed out. Sign in again.',
  INVALID_REFRESH_TOKEN: 'You were signed out. Sign in again.',
};

async function call<T>(url: string, body: Record<string, unknown> | URLSearchParams): Promise<T> {
  if (!KEY) throw new SignInError('not_configured', 'Sign-in isn’t configured for this build.');
  const form = body instanceof URLSearchParams;
  let res: Response;
  try {
    res = await fetch(`${url}?key=${encodeURIComponent(KEY)}`, {
      method: 'POST', referrerPolicy: 'strict-origin', credentials: 'omit',
      headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? body : JSON.stringify(body),
    });
  } catch {
    throw new SignInError('network', 'Couldn’t reach the sign-in service. Check your connection.');
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(out?.error?.message ?? 'UNKNOWN').split(/[ :]/)[0];
    throw new SignInError(code, WORDS[code] ?? 'Sign-in failed. Try again.');
  }
  return out as T;
}

/** Email a one-time sign-in link. The link comes back to FINISH_PATH on this origin. */
export async function sendLink(email: string, next = '/') {
  const continueUrl = new URL(FINISH_PATH, window.location.origin);
  if (next !== '/') continueUrl.searchParams.set('next', next);
  await call(`${IDT}:sendOobCode`, { requestType: 'EMAIL_SIGNIN', email, continueUrl: continueUrl.href, canHandleCodeInApp: true });
  set(PENDING, email);
}

/** The email the link was sent to on this device, if any (another device must type it again). */
export const pendingEmail = () => get<string>(PENDING);

/** The sign-in parameters of an email link, or null if this URL isn't one. */
export function linkParams(href: string) {
  const u = new URL(href);
  const oobCode = u.searchParams.get('oobCode');
  return u.searchParams.get('mode') === 'signIn' && oobCode ? { oobCode, next: safeNext(u.searchParams.get('next')) } : null;
}

/** Only a path on this origin, so a crafted link can't send a signed-in person elsewhere. */
export function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

export async function finish(email: string, oobCode: string) {
  const r = await call<{ idToken: string; refreshToken: string; expiresIn: string; email: string }>(`${IDT}:signInWithEmailLink`, { email, oobCode });
  tokens = { idToken: r.idToken, refreshToken: r.refreshToken, expiresAt: Date.now() + Number(r.expiresIn) * 1000, email: r.email };
  set(STORE, tokens);
  set(PENDING, null);
  changed();
}

let refreshing: Promise<string> | null = null;
/** A current ID token, refreshed a minute before it expires; null when signed out. */
export async function idToken(force = false): Promise<string | null> {
  if (!tokens) return null;
  if (!force && tokens.expiresAt - Date.now() > 60_000) return tokens.idToken;
  refreshing ??= (async () => {
    try {
      const r = await call<{ id_token: string; refresh_token: string; expires_in: string }>(STS,
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens!.refreshToken }));
      tokens = { ...tokens!, idToken: r.id_token, refreshToken: r.refresh_token, expiresAt: Date.now() + Number(r.expires_in) * 1000 };
      set(STORE, tokens);
      return tokens.idToken;
    } catch (e) {
      // A revoked or expired refresh token signs out; a network error keeps the session for the next try.
      if (e instanceof SignInError && e.code !== 'network') signOut();
      throw e;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export function signOut() {
  tokens = null;
  set(STORE, null);
  changed();
}
