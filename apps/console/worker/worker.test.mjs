// The sign-in Worker under Node (workerd has no win32-arm64 build). Throwaway test credentials only.
// node --experimental-strip-types --test worker/worker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

// Workers-only API, polyfilled with the same contract (throws on unequal lengths).
crypto.subtle.timingSafeEqual ??= (a, b) => {
  const x = Buffer.from(a instanceof ArrayBuffer ? a : a.buffer, a.byteOffset ?? 0, a.byteLength);
  const y = Buffer.from(b instanceof ArrayBuffer ? b : b.buffer, b.byteOffset ?? 0, b.byteLength);
  if (x.length !== y.length) throw new TypeError('lengths differ');
  return timingSafeEqual(x, y);
};
const { default: worker } = await import('./index.ts');

const PASSWORD = 'test-pass-word-only';
const salt = randomBytes(16);
let limited = 0;
const kv = new Map();
const env = {
  LOGIN_EMAIL: 'owner@example.com',
  PASSWORD_HASH: `pbkdf2-sha256$1000$${salt.toString('base64')}$${pbkdf2Sync(PASSWORD, salt, 1000, 32, 'sha256').toString('base64')}`,
  SESSION_SECRET: randomBytes(32).toString('base64url'),
  LOGIN_LIMITER: { limit: async () => ({ success: limited-- <= 0 }) },
  AUTH: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } },
  ASSETS: { fetch: async (r) => new Response(new URL(r.url).pathname.endsWith('.js') ? 'js' : '<!doctype html>app', { headers: { 'content-type': new URL(r.url).pathname.endsWith('.js') ? 'text/javascript' : 'text/html' } }) },
};
const O = 'https://suite.omnisdr.com';
const get = (path, headers = {}) => worker.fetch(new Request(O + path, { headers: { accept: 'text/html', ...headers } }), env);
const login = (fields, origin = O) => worker.fetch(new Request(`${O}/auth/login`, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields) }), env);
const cookieOf = (r) => r.headers.get('set-cookie')?.split(';')[0];

test('everything but the sign-in page needs a session', async () => {
  const page = await get('/w/x/approvals');
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/auth/login?next=%2Fw%2Fx%2Fapprovals');
  const asset = await worker.fetch(new Request(`${O}/assets/index.js`), env);
  assert.equal(asset.status, 401);
  assert.equal((await get('/auth/login')).status, 200);
});

test('wrong email or password is refused with one generic message', async () => {
  for (const f of [{ email: 'owner@example.com', password: 'nope' }, { email: 'other@example.com', password: PASSWORD }, {}]) {
    const r = await login(f);
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /^\/auth\/login\?e=1/);
    assert.equal(r.headers.get('set-cookie'), null);
  }
});

test('the right login gets a strict, host-only, http-only session that opens the app', async () => {
  const r = await login({ email: 'OWNER@example.com ', password: PASSWORD, next: '/w/x/inbox' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/w/x/inbox');
  const sc = r.headers.get('set-cookie');
  for (const attr of ['__Host-omni_session=', 'Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=43200']) assert.ok(sc.includes(attr), attr);
  assert.ok(!/Domain=/i.test(sc));
  const app = await get('/w/x/inbox', { cookie: cookieOf(r) });
  assert.equal(app.status, 200);
  assert.match(app.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(app.headers.get('strict-transport-security'), /max-age=63072000/);
});

test('a tampered, forged or expired cookie is refused', async () => {
  const good = cookieOf(await login({ email: 'owner@example.com', password: PASSWORD }));
  const [name, value] = good.split('=');
  const parts = value.split('.');
  const forged = [
    `${name}=${parts[0]}.${Date.now() + 9e9}.${parts[2]}.${parts[3]}.${parts[4]}`,   // extended expiry, old signature
    `${name}=${parts.slice(0, 4).join('.')}.AAAA`,                                    // bad signature
    `${name}=v2.${Date.now() - 1000}.${parts[2]}.${parts[3]}.${parts[4]}`,           // expired
    `${name}=${parts[0]}.${parts[1]}.${parts[2]}.7.${parts[4]}`,                      // different password version
    `${name}=garbage`,
  ];
  for (const c of forged) assert.equal((await get('/', { cookie: c })).status, 303, c.slice(0, 40));
});

test('cross-site posts are refused (CSRF), and next can never leave the site', async () => {
  assert.equal((await login({ email: 'owner@example.com', password: PASSWORD }, 'https://evil.example')).status, 403);
  for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example', '/auth/logout']) {
    const r = await login({ email: 'owner@example.com', password: PASSWORD, next });
    assert.equal(r.headers.get('location'), '/', next);
  }
});

test('login attempts are rate limited', async () => {
  limited = 1;
  const r = await login({ email: 'owner@example.com', password: PASSWORD });
  assert.equal(r.headers.get('location'), '/auth/login?e=rate');
  assert.equal(r.headers.get('set-cookie'), null);
});

test('missing secrets fail closed', async () => {
  const r = await worker.fetch(new Request(`${O}/auth/login`, { method: 'POST', headers: { origin: O }, body: new URLSearchParams({ email: 'a', password: 'b' }) }),
    { ...env, PASSWORD_HASH: undefined });
  assert.equal(r.headers.get('location'), '/auth/login?e=config');
  assert.equal((await worker.fetch(new Request(`${O}/`, { headers: { accept: 'text/html' } }), { ...env, SESSION_SECRET: undefined })).status, 303);
});

test('logout clears the cookie', async () => {
  const r = await worker.fetch(new Request(`${O}/auth/logout`, { method: 'POST', headers: { origin: O } }), env);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

test('a correctly signed cookie with an expiry past the 12-hour window is refused', async () => {
  const { createHmac } = await import('node:crypto');
  const body = `v2.${Date.now() + 30 * 86400e3}.nonce.0`;
  const sig = createHmac('sha256', env.SESSION_SECRET).update(body).digest('base64url');
  assert.equal((await get('/', { cookie: `__Host-omni_session=${body}.${sig}` })).status, 303);
  const okBody = `v2.${Date.now() + 3600e3}.nonce.0`;
  const okSig = createHmac('sha256', env.SESSION_SECRET).update(okBody).digest('base64url');
  assert.equal((await get('/', { cookie: `__Host-omni_session=${okBody}.${okSig}` })).status, 200, 'control: a signed in-window cookie opens');
});

const change = (cookie, fields, origin = O) => worker.fetch(new Request(`${O}/auth/password`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields) }), env);

test('change password: rules are enforced and nothing is stored on failure', async () => {
  kv.clear();
  const c = cookieOf(await login({ email: 'owner@example.com', password: PASSWORD }));
  const cases = [
    [{ current: 'wrong', password: 'a-long-new-password', confirm: 'a-long-new-password' }, 'current'],
    [{ current: PASSWORD, password: 'short', confirm: 'short' }, 'short'],
    [{ current: PASSWORD, password: 'a-long-new-password', confirm: 'a-long-new-passwurd' }, 'match'],
    [{ current: PASSWORD, password: PASSWORD, confirm: PASSWORD }, 'same'],
    [{ current: PASSWORD, password: 'owner@example.com', confirm: 'owner@example.com' }, 'email'],
  ];
  for (const [f, code] of cases) assert.equal((await change(c, f)).headers.get('location'), `/auth/password?e=${code}`, code);
  assert.equal(kv.size, 0);
  assert.equal((await change(undefined, { current: PASSWORD, password: 'a-long-new-password', confirm: 'a-long-new-password' })).headers.get('location'), '/auth/login');
  assert.equal((await change(c, { current: PASSWORD, password: 'a-long-new-password', confirm: 'a-long-new-password' }, 'https://evil.example')).status, 403);
  assert.equal(kv.size, 0);
});

test('change password: the new one works, the old one stops, and other sessions end', async () => {
  kv.clear();
  const phone = cookieOf(await login({ email: 'owner@example.com', password: PASSWORD }));
  const laptop = cookieOf(await login({ email: 'owner@example.com', password: PASSWORD }));
  const r = await change(laptop, { current: PASSWORD, password: 'correct horse battery', confirm: 'correct horse battery' });
  assert.equal(r.headers.get('location'), '/?password=changed');
  assert.ok(!kv.get('password').includes('correct'), 'stored as a hash');
  assert.equal((await get('/', { cookie: cookieOf(r) })).status, 200, 'this device stays signed in');
  assert.equal((await get('/', { cookie: phone })).status, 303, 'other sessions are signed out');
  assert.match((await login({ email: 'owner@example.com', password: PASSWORD })).headers.get('location'), /e=1/, 'old password refused');
  assert.equal((await login({ email: 'owner@example.com', password: 'correct horse battery' })).headers.get('location'), '/', 'new password works');
  kv.clear();
});

test('the password page needs a session', async () => {
  assert.equal((await get('/auth/password')).headers.get('location'), '/auth/login');
  const c = cookieOf(await login({ email: 'owner@example.com', password: PASSWORD }));
  const p = await get('/auth/password', { cookie: c });
  assert.equal(p.status, 200);
  assert.match(await p.text(), /autocomplete="new-password"/);
});

// The request a real browser sends from the form: Origin is "null" under some referrer policies; Sec-Fetch-Site is not.
const browserLogin = (headers) => worker.fetch(new Request(`${O}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams({ email: 'owner@example.com', password: PASSWORD }) }), env);

test('a same-site form post signs in even when the browser sends Origin: null', async () => {
  for (const h of [{ origin: 'null', 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'same-origin' }, { origin: O, 'sec-fetch-site': 'same-origin' }]) {
    const r = await browserLogin(h);
    assert.equal(r.headers.get('location'), '/', JSON.stringify(h));
  }
});

test('cross-site posts are refused however the origin is hidden', async () => {
  for (const h of [{ origin: 'null', 'sec-fetch-site': 'cross-site' }, { origin: 'null' }, {}, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }]) {
    assert.equal((await browserLogin(h)).status, 403, JSON.stringify(h));
  }
});

test('pages keep the origin on same-site posts (never no-referrer)', async () => {
  assert.equal((await get('/auth/login')).headers.get('referrer-policy'), 'same-origin');
});

test('identity mode (G5): the app is served without the password gate, with every security header; /auth/* retires', async () => {
  const idEnv = { ...env, APP_AUTH: 'identity' };
  const page = await worker.fetch(new Request(`${O}/w/x/approvals`, { headers: { accept: 'text/html' } }), idEnv);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.match(page.headers.get('content-security-policy') ?? '', /connect-src [^;]*https:\/\/identitytoolkit\.googleapis\.com/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('strict-transport-security'), 'max-age=63072000; includeSubDomains');
  const asset = await worker.fetch(new Request(`${O}/assets/index.js`), idEnv);
  assert.equal(asset.status, 200);
  for (const p of ['/auth/login', '/auth/password']) {
    const r = await worker.fetch(new Request(O + p, { headers: { accept: 'text/html' } }), idEnv);
    assert.deepEqual([r.status, r.headers.get('location')], [303, '/'], p);
  }
  // A password post can't sign anyone in any more, and logout clears the old cookie.
  const post = await worker.fetch(new Request(`${O}/auth/login`, { method: 'POST', headers: { origin: O, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'owner@example.com', password: PASSWORD }) }), idEnv);
  assert.equal(post.headers.get('set-cookie'), null);
  const out = await worker.fetch(new Request(`${O}/auth/logout`, { method: 'POST', headers: { origin: O } }), idEnv);
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
  // Writes to the app's own origin are still refused: the Worker serves files only.
  assert.equal((await worker.fetch(new Request(`${O}/w/x`, { method: 'POST' }), idEnv)).status, 405);
  // Without the flag, nothing changed: the gate still holds.
  assert.equal((await get('/w/x/approvals')).status, 303);
});
