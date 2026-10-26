// B-11: Cloudflare Access JWT sign-in. No network: a generated RSA keypair and a stub key fetch stand in for the
// team's /cdn-cgi/access/certs. Covers the verifier, deny-by-default routing, HMAC routes, and that no dev bypass
// can reach the production entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, createSign, createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../db/src/migrate.mjs';
import { createApp, PUBLIC_ROUTES } from '../src/app.mjs';
import { pglitePool } from '../src/pool.mjs';
import { accessVerifier } from '../src/access.mjs';
import { seedDemo } from '../src/seed-demo.mjs';

const TEAM = 'acme.cloudflareaccess.com';
const AUD = 'aud-tag-1234';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(payload, { kid = 'k1', alg = 'RS256', key = privateKey, sigAlg = 'RSA-SHA256', hmac = null } = {}) {
  const signed = `${b64({ alg, kid, typ: 'JWT' })}.${b64(payload)}`;
  const sig = hmac ? createHmac('sha256', hmac).update(signed).digest('base64url')
    : alg === 'none' ? '' : createSign(sigAlg).update(signed).sign(key).toString('base64url');
  return alg === 'none' ? `${signed}.x` : `${signed}.${sig}`;
}
const claims = (email = 'maya@example.com', over = {}) => {
  const t = Math.floor(Date.now() / 1000);
  return { iss: `https://${TEAM}`, aud: [AUD], email, iat: t - 10, nbf: t - 10, exp: t + 3600, ...over };
};
const reason = async (p) => { try { await p; return 'accepted'; } catch (e) { return e.reason ?? `${e.status ?? ''} ${e.message}`.trim(); } };

function verifierWith(keysFn, clock = { t: Date.now() }) {
  const calls = { n: 0 };
  const fetchKeys = async () => { calls.n++; return keysFn(); };
  return { verify: accessVerifier({ teamDomain: TEAM, aud: AUD, fetchKeys, now: () => clock.t }), calls, clock };
}
const goodKeys = () => [{ kid: 'k1', key: publicKey }];

test('a valid token gives the lower-cased email and an email-derived uid', async () => {
  const { verify } = verifierWith(goodKeys);
  assert.deepEqual(await verify(jwt(claims('Maya@Example.com'))), { uid: 'access:maya@example.com', email: 'maya@example.com' });
});

test('aud may be a string or a list; the AUD tag must be in it', async () => {
  const { verify } = verifierWith(goodKeys);
  assert.equal(await reason(verify(jwt(claims('a@b.co', { aud: AUD })))), 'accepted');
  assert.equal(await reason(verify(jwt(claims('a@b.co', { aud: ['x', AUD] })))), 'accepted');
  assert.equal(await reason(verify(jwt(claims('a@b.co', { aud: ['x'] })))), 'wrong audience');
  assert.equal(await reason(verify(jwt(claims('a@b.co', { aud: undefined })))), 'wrong audience');
});

test('expired, not-yet-valid, wrong issuer, bad signature are refused; 30 s of skew is allowed', async () => {
  const { verify } = verifierWith(goodKeys);
  const t = Math.floor(Date.now() / 1000);
  assert.equal(await reason(verify(jwt(claims('a@b.co', { exp: t - 120 })))), 'expired');
  assert.equal(await reason(verify(jwt(claims('a@b.co', { exp: t - 10 })))), 'accepted', 'within skew');
  assert.equal(await reason(verify(jwt(claims('a@b.co', { exp: undefined })))), 'expired');
  assert.equal(await reason(verify(jwt(claims('a@b.co', { nbf: t + 300 })))), 'not yet valid');
  assert.equal(await reason(verify(jwt(claims('a@b.co', { nbf: t + 10 })))), 'accepted', 'within skew');
  assert.equal(await reason(verify(jwt(claims('a@b.co', { iss: 'https://evil.cloudflareaccess.com' })))), 'wrong issuer');
  assert.equal(await reason(verify(jwt(claims('a@b.co'), { key: other.privateKey }))), 'bad signature');
});

test('only RS256: alg none and HS256 signed with the public key are refused', async () => {
  const { verify } = verifierWith(goodKeys);
  assert.equal(await reason(verify(jwt(claims(), { alg: 'none' }))), 'alg must be RS256');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(await reason(verify(jwt(claims(), { alg: 'HS256', hmac: pem }))), 'alg must be RS256');
  assert.equal(await reason(verify(jwt(claims(), { alg: 'RS512' }))), 'alg must be RS256');
  assert.equal(await reason(verify('not.a.jwt')), 'malformed token');
  assert.equal(await reason(verify('')), 'malformed token');
});

test('a token with no email is 403, not 401', async () => {
  const { verify } = verifierWith(goodKeys);
  assert.match(await reason(verify(jwt(claims(undefined, { email: undefined })))), /^403 /);
  assert.match(await reason(verify(jwt(claims(undefined, { email: 42 })))), /^403 /);
});

test('unknown kid: one refetch a minute at most, then 401; a rotated-in key is picked up', async () => {
  let live = goodKeys();
  const { verify, calls, clock } = verifierWith(() => live);
  assert.equal(await reason(verify(jwt(claims()))), 'accepted');
  assert.equal(calls.n, 1);
  for (let i = 0; i < 20; i++) assert.equal(await reason(verify(jwt(claims(), { kid: `made-up-${i}` }))), 'unknown key id');
  assert.equal(calls.n, 1, 'inside a minute of the load, made-up kids cause no fetch');
  clock.t += 61000;
  for (let i = 0; i < 20; i++) await reason(verify(jwt(claims(), { kid: `made-up-${i}` })));
  assert.equal(calls.n, 2, 'one refetch for the whole burst');
  live = [...goodKeys(), { kid: 'k2', key: other.publicKey }];
  assert.equal(await reason(verify(jwt(claims(), { kid: 'k2', key: other.privateKey }))), 'unknown key id', 'rate limited, not yet');
  clock.t += 61000;
  assert.equal(await reason(verify(jwt(claims(), { kid: 'k2', key: other.privateKey }))), 'accepted');
});

test('JWKS down: no cache → 401 (fail closed); with a cache → keeps working past the TTL', async () => {
  const down = verifierWith(() => { throw new Error('boom'); });
  assert.equal(await reason(down.verify(jwt(claims()))), 'signing keys unavailable');

  let up = true;
  const { verify, calls, clock } = verifierWith(() => { if (!up) throw new Error('boom'); return goodKeys(); });
  assert.equal(await reason(verify(jwt(claims()))), 'accepted');
  up = false;
  clock.t += 2 * 3600000;
  assert.equal(await reason(verify(jwt(claims('a@b.co', { exp: Math.floor(clock.t / 1000) + 3600, iat: Math.floor(clock.t / 1000), nbf: undefined })))), 'accepted');
  const before = calls.n;
  for (let i = 0; i < 10; i++) await reason(verify(jwt(claims('a@b.co', { exp: Math.floor(clock.t / 1000) + 3600, nbf: undefined }))));
  assert.equal(calls.n, before, 'a down endpoint is not hammered: retry waits a minute');
});

// ---- over HTTP ----
const HMAC = 'test-inbound-secret';
async function startAccessApi({ extra = null } = {}) {
  const db = new PGlite();
  await migrate(db);
  const demo = await seedDemo(db);
  // The demo seeds dev-keyed users; Access keys users by access:<email>.
  await db.query(`UPDATE users SET idp_uid = 'access:' || email`);
  const app = createApp({
    pool: pglitePool(db),
    verifyToken: accessVerifier({ teamDomain: TEAM, aud: AUD, fetchKeys: async () => goodKeys() }),
    extraRoutes: extra,
    config: { inboundSecret: HMAC, appUrl: 'https://app.test' },
  });
  const server = createServer((req, res) => { app.handle(req, res); }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, headers = {}, body } = {}) => {
    const h = { ...headers };
    if (token) h['cf-access-jwt-assertion'] = token;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body });
    const text = await res.text();
    return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  return { call, db, demo, stop: () => new Promise((r) => server.close(r)) };
}

test('over HTTP: header only; a known email gets its tenant; an unknown email gets nothing', async () => {
  const api = await startAccessApi();
  try {
    assert.equal((await api.call('GET', '/v1/me')).status, 401, 'no header');
    const viaBearer = await api.call('GET', '/v1/me', { headers: { authorization: `Bearer ${jwt(claims())}` } });
    assert.equal(viaBearer.status, 401, 'Authorization is not read');
    assert.equal((await api.call('GET', '/v1/me', { token: 'garbage' })).status, 401);
    const maya = await api.call('GET', '/v1/me', { token: jwt(claims('maya@example.com')) });
    assert.equal(maya.status, 200);
    assert.equal(maya.json.orgs.length, 1);
    const ws = `/v1/o/${api.demo.org}/w/${api.demo.workspaces[0]}`;
    const stranger = jwt(claims('stranger@example.com'));
    assert.deepEqual((await api.call('GET', '/v1/me', { token: stranger })).json.orgs, []);
    const denied = await api.call('GET', `${ws}/settings`, { token: stranger });
    assert.equal(denied.status, 403, 'no membership, no tenant data');
    const write = await api.call('POST', `${ws}/invites`, { token: stranger, body: JSON.stringify({ email: 'x@y.co', role: 'operator' }) });
    assert.equal(write.status, 403, 'no membership, no tenant write');
    assert.equal((await api.call('GET', '/v1/me', { token: jwt(claims(undefined, { email: undefined })) })).status, 403);
  } finally { await api.stop(); }
});

test('the public allowlist is exact, and those routes need no JWT', async () => {
  assert.deepEqual([...PUBLIC_ROUTES].sort(), ['GET /healthz', 'GET /u/:token', 'GET /v1/health', 'POST /internal/inbound', 'POST /internal/mail-events', 'POST /u/:token'].sort());
  const api = await startAccessApi();
  try {
    assert.equal((await api.call('GET', '/healthz')).status, 200);
    assert.equal((await api.call('GET', '/v1/health')).status, 200);
    assert.equal((await api.call('GET', '/u/abcdefghijklmnopqrstuv')).status, 200);
    assert.equal((await api.call('POST', '/u/abcdefghijklmnopqrstuv')).status, 200);
  } finally { await api.stop(); }
});

test('deny by default: a new route, even one that asks for no auth, is 401 with no detail', async () => {
  const api = await startAccessApi({ extra: (r) => {
    r.get('/v1/throwaway', { auth: 'none' }, () => ({ secret: 'leaked' }));
    r.get('/v1/throwaway-default', () => ({ secret: 'leaked' }));
    r.post('/internal/throwaway', { auth: 'internal', body: 'raw' }, () => ({ secret: 'leaked' }));
  } });
  try {
    for (const [m, p] of [['GET', '/v1/throwaway'], ['GET', '/v1/throwaway-default'], ['POST', '/internal/throwaway']]) {
      const r = await api.call(m, p);
      assert.equal(r.status, 401, `${m} ${p}`);
      assert.ok(!r.text.includes('leaked'));
    }
    const ok = await api.call('GET', '/v1/throwaway', { token: jwt(claims('maya@example.com')) });
    assert.equal(ok.status, 200, 'with a valid JWT it is an ordinary user route');
  } finally { await api.stop(); }
});

test('HMAC routes keep their own check: a valid JWT is no substitute, and a good signature needs no JWT', async () => {
  const api = await startAccessApi();
  try {
    const raw = JSON.stringify({ to: 'x@y.co', body: 'hi', receivedAt: new Date().toISOString() });
    const ts = Math.floor(Date.now() / 1000);
    const sign = (secret) => `sha256=${createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex')}`;
    const hdr = (sig) => ({ 'content-type': 'application/json', 'x-omni-timestamp': String(ts), 'x-omni-signature': sig });
    const jwtOnly = await api.call('POST', '/internal/inbound', { token: jwt(claims('maya@example.com')), headers: { 'content-type': 'application/json' }, body: raw });
    assert.equal(jwtOnly.status, 401, 'valid JWT, no signature');
    const bad = await api.call('POST', '/internal/inbound', { token: jwt(claims('maya@example.com')), headers: hdr(sign('wrong-secret')), body: raw });
    assert.equal(bad.status, 401, 'valid JWT, bad signature');
    const signedOnly = await api.call('POST', '/internal/inbound', { headers: hdr(sign(HMAC)), body: raw });
    assert.notEqual(signedOnly.status, 401, 'good signature, no JWT: past auth');
  } finally { await api.stop(); }
});

// ---- the production entry has no way in around Access ----
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
function importsOf(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const next = new URL(m[1], `file:///${file.replace(/\\/g, '/')}`);
    const p = fileURLToPath(next);
    if (existsSync(p) && p.endsWith('.mjs')) importsOf(p, seen);
  }
  return seen;
}

test('server.mjs never imports dev.mjs, seed-demo.mjs or the dev verifier, and has no bypass flag', () => {
  const files = [...importsOf(`${SRC}server.mjs`)].map((f) => f.replace(/\\/g, '/'));
  assert.ok(files.some((f) => f.endsWith('/access.mjs')), 'the walk reaches access.mjs');
  for (const bad of ['/dev.mjs', '/seed-demo.mjs', '/devfakes.mjs']) assert.ok(!files.some((f) => f.endsWith(bad)), `server.mjs reaches ${bad}`);
  const server = readFileSync(`${SRC}server.mjs`, 'utf8');
  assert.ok(!/devVerifier|firebaseVerifier|OMNI_FIREBASE_PROJECT|tokenFrom/.test(server), 'no dev/legacy sign-in wired in server.mjs');
  assert.ok(!/DEV_AUTH|AUTH_BYPASS|SKIP_AUTH|NO_AUTH/i.test(server), 'no bypass flag');
});

test('the image build context excludes dev.mjs and seed-demo.mjs', () => {
  const ignore = readFileSync(fileURLToPath(new URL('../Dockerfile.dockerignore', import.meta.url)), 'utf8').split(/\r?\n/);
  assert.ok(ignore.includes('packages/api/src/dev.mjs'));
  assert.ok(ignore.includes('packages/api/src/seed-demo.mjs'));
});

test('mixed-case and padded emails are one user; the uid cannot cross-link', async () => {
  const api = await startAccessApi();
  try {
    const before = Number((await api.db.query(`SELECT count(*) n FROM users`)).rows[0].n);
    const a = await api.call('GET', '/v1/me', { token: jwt(claims('Maya@Example.com')) });
    const b = await api.call('GET', '/v1/me', { token: jwt(claims('  MAYA@example.COM ')) });
    assert.equal(a.status, 200);
    assert.deepEqual(a.json.orgs.map((o) => o.id), b.json.orgs.map((o) => o.id));
    assert.equal(a.json.orgs.length, 1, 'mapped to the seeded maya');
    assert.equal(Number((await api.db.query(`SELECT count(*) n FROM users`)).rows[0].n), before, 'no second users row');
    const { identityFor } = await import('../src/access.mjs');
    assert.deepEqual(identityFor(' Maya@Example.com '), { uid: 'access:maya@example.com', email: 'maya@example.com' });
    assert.notEqual(identityFor('maya@example.com').uid, identityFor('maya2@example.com').uid);
  } finally { await api.stop(); }
});

test('production default allowlist: POST /v1/hooks/:id is 401 without a JWT (hooks closed until a later card)', async () => {
  const api = await startAccessApi();
  try {
    const r = await api.call('POST', `/v1/hooks/${api.demo.org}`, { body: '{}' });
    assert.equal(r.status, 401);
    assert.ok(!PUBLIC_ROUTES.has('POST /v1/hooks/:id'));
  } finally { await api.stop(); }
});
