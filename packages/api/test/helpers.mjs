import { createServer } from 'node:http';
import { generateKeyPairSync, createSign, createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../db/src/migrate.mjs';
import { createApp } from '../src/app.mjs';
import { pglitePool } from '../src/pool.mjs';
import { firebaseVerifier, staticKeySource } from '../src/auth.mjs';
import { fakeModel } from '../src/services/model.mjs';
import { seedDemo } from '../src/seed-demo.mjs';

export const PROJECT = 'omni-test';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const KEYS = { k1: publicKey };
export { privateKey };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function signJwt(payload, { kid = 'k1', alg = 'RS256', key = privateKey } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' });
  const body = b64(payload);
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export function claimsFor(email, over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: `dev:${email}`, email, email_verified: true,
    iat: now - 10, auth_time: now - 10, exp: now + 3600, ...over };
}
export const tokenFor = (email, over) => signJwt(claimsFor(email, over));

export const INBOUND_SECRET = 'test-inbound-secret';

// A running API on an ephemeral port with the demo tenant. Returns helpers bound to it.
export async function startApi({ model = fakeModel(), config = {}, seed = true } = {}) {
  const db = new PGlite();
  await migrate(db);
  const demo = seed ? await seedDemo(db) : null;
  const logs = [];
  const app = createApp({
    pool: pglitePool(db),
    verifyToken: firebaseVerifier({ projectId: PROJECT, getKey: staticKeySource(KEYS) }),
    model,
    config: { corsOrigins: ['https://console.example'], inboundSecret: INBOUND_SECRET, appUrl: 'https://app.test', ...config },
    log: (e) => logs.push(e),
  });
  const server = createServer((req, res) => { app.handle(req, res); }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { as = 'maya@example.com', body, token, headers = {}, raw } = {}) {
    const h = { ...headers };
    const tok = token ?? (as ? tokenFor(as) : null);
    if (tok) h.authorization = `Bearer ${tok}`;
    if (body !== undefined && raw === undefined) h['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* html */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  function signedPost(path, payload, { secret = INBOUND_SECRET, ts = Math.floor(Date.now() / 1000) } = {}) {
    const raw = JSON.stringify(payload);
    const sig = createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex');
    return call('POST', path, { as: null, raw, headers: { 'content-type': 'application/json',
      'x-omni-timestamp': String(ts), 'x-omni-signature': `sha256=${sig}` } });
  }
  const signedInbound = (payload, opts) => signedPost('/internal/inbound', payload, opts);
  const signedMailEvent = (payload, opts) => signedPost('/internal/mail-events', payload, opts);

  const W = demo ? `/v1/o/${demo.org}/w/${demo.workspaces[0]}` : null;
  return {
    db, demo, base, call, signedPost, signedInbound, signedMailEvent, logs, W, model,
    ws: (i) => `/v1/o/${demo.org}/w/${demo.workspaces[i]}`,
    q: async (sql, params) => (await db.query(sql, params)).rows,
    stop: () => new Promise((r) => server.close(r)),
  };
}
