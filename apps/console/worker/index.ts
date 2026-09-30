// The suite's front door: one sign-in in front of every file, security headers on every response.
// Nothing is public except the sign-in page and its logo.
//
// Credentials:
//   LOGIN_EMAIL, SESSION_SECRET  Worker secrets (values only in ~/.halo-keys/omnisdr-suite.* and Cloudflare)
//   PASSWORD_HASH                Worker secret: the first (temporary) password
//   AUTH (KV) "password"         the password the owner set in /auth/password; wins over PASSWORD_HASH once present
//   AUTH (KV) "pwver"            bumped on every password change; sessions carry it, so a change signs everyone else out
// Hash format:   pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>   (100,000 iterations is the Workers maximum)
// Session:       __Host-omni_session = v2.<expires ms>.<nonce>.<pwver>.<hmac b64url>   (HttpOnly, Secure, SameSite=Strict, Path=/)

import { appCsp } from './csp.ts';

interface Kv { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> }
interface Env {
  ASSETS: Fetcher;
  LOGIN_EMAIL?: string;
  PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  AUTH?: Kv;
  LOGIN_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

const COOKIE = '__Host-omni_session';
const SESSION_MS = 12 * 3600e3;
const ITERATIONS = 100000;
const MIN_PASSWORD = 12;
const enc = new TextEncoder();

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)));
const b64url = (b: ArrayBuffer) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randomB64url = (n = 16) => b64url(crypto.getRandomValues(new Uint8Array(n)).buffer);

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}
/** Constant-time equality of two strings via their HMACs (equal length by construction). */
async function same(secret: string, a: string, b: string) {
  const [x, y] = await Promise.all([hmac(secret, a), hmac(secret, b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}
async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}
async function passwordOk(stored: string, password: string) {
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2-sha256' || !iter || !salt || !hash) return false;
  const bits = await pbkdf2(password, unb64(salt), Number(iter));
  const want = unb64(hash);
  return want.byteLength === bits.byteLength && crypto.subtle.timingSafeEqual(bits, want);
}
async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

const storedHash = async (env: Env) => (await env.AUTH?.get('password')) ?? env.PASSWORD_HASH ?? null;
const pwVersion = async (env: Env) => (await env.AUTH?.get('pwver')) ?? '0';

async function newSession(secret: string, ver: string) {
  const body = `v2.${Date.now() + SESSION_MS}.${randomB64url()}.${ver}`;
  return `${body}.${b64url(await hmac(secret, body))}`;
}
async function validSession(env: Env, cookie: string | undefined) {
  if (!cookie || !env.SESSION_SECRET) return false;
  const parts = cookie.split('.');
  if (parts.length !== 5 || parts[0] !== 'v2') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now() || exp > Date.now() + SESSION_MS + 60e3) return false;
  if (!(await same(env.SESSION_SECRET, parts[4], b64url(await hmac(env.SESSION_SECRET, parts.slice(0, 4).join('.')))))) return false;
  return parts[3] === (await pwVersion(env)); // a password change ends every older session
}
const readCookie = (req: Request, name: string) =>
  req.headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
const sessionCookie = (token: string) => `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;

/** Only same-site relative paths; never `//host` or a scheme. */
const safeNext = (n: string | null) => (n && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(n) && !n.startsWith('/auth/') ? n : '/');

function headers(h: Headers, { html, nonce }: { html: boolean; nonce?: string }) {
  h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  if (html) {
    h.set('Content-Security-Policy', appCsp(nonce));
    h.set('Cache-Control', 'no-store');
  }
  return h;
}
function respond(body: BodyInit | null, init: ResponseInit & { html?: boolean; nonce?: string } = {}) {
  const h = headers(new Headers(init.headers), { html: init.html ?? false, nonce: init.nonce });
  return new Response(body, { status: init.status ?? 200, headers: h });
}
const redirect = (to: string, extra: Record<string, string> = {}) => respond(null, { status: 303, headers: { location: to, 'cache-control': 'no-store', ...extra } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
type Field = { name: string; label: string; type: string; autocomplete: string; hint?: string };
function page(nonce: string, o: { title: string; heading: string; sub: string; error?: string; notice?: string; action: string; hidden?: Record<string, string>; fields: Field[]; submit: string; foot: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#F7F5F0"><title>${esc(o.title)} · Omni-SDR</title>
<link rel="icon" type="image/svg+xml" href="/auth/logo-mark-small.svg">
<style nonce="${nonce}">
:root{--bg:#F7F5F0;--surface:#fff;--text:#1A1A1A;--muted:#5C6459;--line:#E8E4D9;--control:#8F8878;--fill:#A3FFB4;--fill-h:#7BFF93;--ink:#166534;--danger:#B42318;--danger-soft:#FDE8E6;--ok-soft:#DCFCE7;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0F100E;--surface:#1A1B19;--text:#F2F0EA;--muted:#A8AFA4;--line:#2A2C28;--control:#6B7568;--fill:#7BFF93;--fill-h:#A3FFB4;--ink:#7BFF93;--danger:#F87171;--danger-soft:#3B1414;--ok-soft:#133A20;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:14px/22px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;
background-image:radial-gradient(600px 600px at -10% -20%,color-mix(in srgb,var(--fill) 45%,transparent),transparent 70%),radial-gradient(700px 700px at 110% 120%,color-mix(in srgb,var(--fill-h) 30%,transparent),transparent 70%)}
main{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:32px 28px;box-shadow:0 16px 48px rgba(0,0,0,.08);animation:in .4s cubic-bezier(.2,.8,.2,1)}
@keyframes in{from{opacity:0;transform:translateY(10px)}}@media (prefers-reduced-motion:reduce){main{animation:none}}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}.brand img{width:36px;height:36px}.brand b{font-size:18px}
h1{font-size:22px;line-height:30px;margin:0 0 4px;font-weight:600;letter-spacing:-.012em}p.sub{margin:0 0 20px;color:var(--muted)}
label{display:block;font-weight:500;font-size:13px;margin:14px 0 6px}.hint{margin:6px 0 0;font-size:12px;line-height:16px;color:var(--muted)}
input{width:100%;height:44px;border:1px solid var(--control);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:var(--surface);color:var(--text)}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
button{width:100%;height:44px;margin-top:22px;border:0;border-radius:8px;background:var(--fill);color:#1A1A1A;font:inherit;font-weight:600;cursor:pointer;transition:background .12s}
button:hover{background:var(--fill-h)}
.err{margin:0 0 4px;padding:10px 12px;border-radius:8px;background:var(--danger-soft);color:var(--danger);font-weight:500}
.ok{margin:0 0 4px;padding:10px 12px;border-radius:8px;background:var(--ok-soft);color:var(--ink);font-weight:500}
.foot{margin:18px 0 0;font-size:12px;line-height:16px;color:var(--muted)}.foot a{color:var(--ink)}
</style></head><body><main>
<div class="brand"><img src="/auth/logo.svg" alt=""><b>Omni-SDR</b></div>
<h1>${esc(o.heading)}</h1><p class="sub">${esc(o.sub)}</p>
${o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : ''}${o.notice ? `<p class="ok" role="status">${esc(o.notice)}</p>` : ''}
<form method="post" action="${o.action}">
${Object.entries(o.hidden ?? {}).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')}
${o.fields.map((f, i) => `<label for="${f.name}">${esc(f.label)}</label><input id="${f.name}" name="${f.name}" type="${f.type}" autocomplete="${f.autocomplete}" required${i === 0 ? ' autofocus' : ''}${f.hint ? ` aria-describedby="${f.name}-h"` : ''}>${f.hint ? `<p class="hint" id="${f.name}-h">${esc(f.hint)}</p>` : ''}`).join('\n')}
<button type="submit">${esc(o.submit)}</button></form>
<p class="foot">${o.foot}</p>
</main></body></html>`;
}
const html = (body: string, nonce: string) => respond(body, { html: true, nonce, headers: { 'content-type': 'text/html; charset=utf-8' } });

const LOGIN_ERRORS: Record<string, string> = { '1': "That email and password don't match.", rate: 'Too many attempts. Wait a minute and try again.', config: 'Sign-in is not configured yet.' };
const PW_ERRORS: Record<string, string> = {
  current: "Your current password isn't right.", short: `Use at least ${MIN_PASSWORD} characters.`, long: 'Use at most 128 characters.',
  match: "The two new passwords don't match.", same: 'Choose a password different from the current one.', email: "Don't use your email address as the password.",
  rate: 'Too many attempts. Wait a minute and try again.', store: 'Password changes are not available yet.',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return redirect(`https://${url.host}${path}${url.search}`);

    // Public: the sign-in page and its two logo files.
    if (path === '/auth/logo.svg' || path === '/auth/logo-mark-small.svg') {
      const r = await env.ASSETS.fetch(new Request(new URL(path.replace('/auth', ''), url.origin)));
      return respond(r.body, { status: r.status, headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
    }
    if (path === '/auth/login' && req.method === 'GET') {
      const nonce = randomB64url();
      return html(page(nonce, {
        title: 'Sign in', heading: 'Sign in to the suite', sub: 'Private preview. Access is limited to invited accounts.',
        error: LOGIN_ERRORS[url.searchParams.get('e') ?? ''], notice: url.searchParams.get('changed') ? 'Password changed. Sign in with your new password.' : undefined,
        action: '/auth/login', hidden: { next: safeNext(url.searchParams.get('next')) }, submit: 'Sign in',
        fields: [{ name: 'email', label: 'Email', type: 'email', autocomplete: 'username' }, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' }],
        foot: 'Sessions last 12 hours. The suite runs on demo data; nothing here contacts real people.',
      }), nonce);
    }

    const signedIn = await validSession(env, readCookie(req, COOKIE));

    if (path === '/auth/password' && req.method === 'GET') {
      if (!signedIn) return redirect('/auth/login');
      const nonce = randomB64url();
      return html(page(nonce, {
        title: 'Change password', heading: 'Change your password', sub: 'Saving signs out every other device.', error: PW_ERRORS[url.searchParams.get('e') ?? ''],
        action: '/auth/password', submit: 'Save new password',
        fields: [
          { name: 'current', label: 'Current password', type: 'password', autocomplete: 'current-password' },
          { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password', hint: `At least ${MIN_PASSWORD} characters. A few unrelated words works well.` },
          { name: 'confirm', label: 'New password again', type: 'password', autocomplete: 'new-password' },
        ],
        foot: '<a href="/">Back to the suite</a>',
      }), nonce);
    }

    if (path.startsWith('/auth/') && req.method === 'POST') {
      // CSRF: SameSite=Strict plus an exact Origin match.
      if (req.headers.get('origin') !== url.origin) return respond('Forbidden', { status: 403 });
      if (path === '/auth/logout') return redirect('/auth/login', { 'set-cookie': `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0` });
      if (path !== '/auth/login' && path !== '/auth/password') return respond('Not found', { status: 404 });
      const hash = await storedHash(env);
      if (!hash || !env.SESSION_SECRET || !env.LOGIN_EMAIL) return redirect(path === '/auth/login' ? '/auth/login?e=config' : '/auth/password?e=store');
      const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
      const back = path === '/auth/login' ? '/auth/login?e=' : '/auth/password?e=';
      if (env.LOGIN_LIMITER && !(await env.LOGIN_LIMITER.limit({ key: `auth:${ip}` })).success) return redirect(`${back}rate`);
      const form = await req.formData().catch(() => null);
      const field = (k: string, max = 256) => String(form?.get(k) ?? '').slice(0, max);

      if (path === '/auth/login') {
        const email = field('email', 254).trim().toLowerCase();
        const next = safeNext(field('next') || '/');
        // Always run both checks so timing doesn't reveal which one failed.
        const [emailOk, passOk] = await Promise.all([same(env.SESSION_SECRET, email, env.LOGIN_EMAIL.toLowerCase()), passwordOk(hash, field('password'))]);
        if (!(emailOk && passOk)) return redirect(`/auth/login?e=1${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`);
        return redirect(next, { 'set-cookie': sessionCookie(await newSession(env.SESSION_SECRET, await pwVersion(env))) });
      }

      // /auth/password: signed in, knows the current password, new one passes the rules.
      if (!signedIn) return redirect('/auth/login');
      if (!env.AUTH) return redirect('/auth/password?e=store');
      const current = field('current'); const next = String(form?.get('password') ?? ''); const confirm = String(form?.get('confirm') ?? '');
      if (!(await passwordOk(hash, current))) return redirect('/auth/password?e=current');
      if (next.length < MIN_PASSWORD) return redirect('/auth/password?e=short');
      if (next.length > 128) return redirect('/auth/password?e=long');
      if (next !== confirm) return redirect('/auth/password?e=match');
      if (next === current) return redirect('/auth/password?e=same');
      if (next.trim().toLowerCase() === env.LOGIN_EMAIL.toLowerCase()) return redirect('/auth/password?e=email');
      await env.AUTH.put('password', await hashPassword(next));
      const ver = String(Number(await pwVersion(env)) + 1);
      await env.AUTH.put('pwver', ver);
      // This device stays signed in on the new version; every other session is now stale.
      return redirect('/?password=changed', { 'set-cookie': sessionCookie(await newSession(env.SESSION_SECRET, ver)) });
    }

    // Everything else needs a session.
    if (!signedIn) {
      const wantsPage = req.method === 'GET' && (req.headers.get('accept') ?? '').includes('text/html');
      return wantsPage ? redirect(`/auth/login${path !== '/' ? `?next=${encodeURIComponent(path + url.search)}` : ''}`) : respond('Sign in required', { status: 401, headers: { 'cache-control': 'no-store' } });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond('Method not allowed', { status: 405 });
    const r = await env.ASSETS.fetch(req);
    const ct = r.headers.get('content-type') ?? '';
    const res = respond(r.body, { status: r.status, html: ct.includes('text/html'), headers: r.headers });
    // Hashed build assets can be cached by this browser only (they sit behind the sign-in).
    if (path.startsWith('/assets/')) res.headers.set('Cache-Control', 'private, max-age=31536000, immutable');
    return res;
  },
};
