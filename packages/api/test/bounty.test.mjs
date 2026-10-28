// Regressions for the 2026-10-02 bug bounty (docs/claude/BUG-BOUNTY-2026-10-02.md).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApi, claimsFor, signJwt, KEYS } from './helpers.mjs';
import { createApp } from '../src/app.mjs';
import { googleKeySource, verifyIdToken } from '../src/auth.mjs';

const api = await startApi();
after(() => api.stop());

test('malformed %-encoding in a path is a 404, not a 500 with a stack trace', async () => {
  for (const p of ['/v1/o/%E0%A4%A/w/x/settings', '/u/%E0%A4%A']) {
    const r = await api.call('GET', p, { as: null });
    assert.equal(r.status, 404, p);
  }
  assert.ok(!api.logs.some((l) => l.level === 'error'), 'nothing logged as an internal error');
});

test('trusted proxy hops: the client IP is the n-th X-Forwarded-For entry from the end', async () => {
  const mk = (trustProxy) => {
    const app = createApp({ pool: { acquire: async () => ({ client: {}, release() {} }) }, verifyToken: async () => { throw new Error('x'); },
      tokenFrom: (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null,
      config: { trustProxy }, log: () => {} });
    const s = createServer((req, res) => app.handle(req, res));
    return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
  };
  // The 30-per-minute sign-in-failure bucket is keyed by IP: count which IP each failure lands on via 429s.
  async function failuresUntilLimited(server, xffFor) {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 1; i <= 40; i++) {
      const r = await fetch(`${base}/v1/me`, { headers: { authorization: 'Bearer junk', 'x-forwarded-for': xffFor(i) } });
      if (r.status === 429) return i;
    }
    return null;
  }
  // Behind Cloudflare and Cloud Run (2 hops): different users arrive via the same Cloudflare IP.
  const two = await mk(2); const one = await mk(1);
  try {
    assert.equal(await failuresUntilLimited(two, (i) => `198.51.100.${i}, 104.16.0.1`), null, 'with 2 hops each user has their own bucket');
    assert.equal(await failuresUntilLimited(one, (i) => `198.51.100.${i}, 104.16.0.1`), 31, 'with 1 hop the proxy IP is shared (the old behaviour)');
  } finally { two.close(); one.close(); }
});

test('made-up key ids force at most one certificate refresh a minute', async () => {
  let fetches = 0; let clock = 0;
  const src = googleKeySource({ fetchImpl: async () => { fetches++; return { ok: true, headers: new Map([['cache-control', 'max-age=3600']]), json: async () => ({}) }; }, now: () => clock });
  for (let i = 0; i < 50; i++) await verifyIdToken(signJwt(claimsFor('x@example.com'), { kid: `made-up-${i}` }), { projectId: 'omni-test', getKey: src }).catch(() => {});
  assert.equal(fetches, 2, 'one load plus one forced refresh, not 50');
  clock += 61_000;
  await verifyIdToken(signJwt(claimsFor('x@example.com'), { kid: 'made-up-late' }), { projectId: 'omni-test', getKey: src }).catch(() => {});
  assert.equal(fetches, 3, 'after a minute a new kid may refresh again');
});

test('a bogus kid can\'t hold the refresh slot against a real rotation; repeating it costs no fetch', async () => {
  let fetches = 0; let clock = 0; let certs = { k1: 'current' };
  const src = googleKeySource({
    fetchImpl: async () => { fetches++; return { ok: true, headers: new Map([['cache-control', 'max-age=3600']]), json: async () => ({ ...certs }) }; },
    now: () => clock, toKey: () => KEYS.k1,
  });
  const ok = (kid) => verifyIdToken(signJwt(claimsFor('x@example.com'), { kid }), { projectId: 'omni-test', getKey: src });
  await ok('k1');
  assert.equal(fetches, 1);
  await ok('attacker-1').catch(() => {});              // takes the forced refresh
  assert.equal(fetches, 2);
  certs = { k1: 'current', k2: 'rotated' };            // Google rotates right after
  clock += 10_000;
  await ok('k2');                                      // waits 10 s at most, not a minute
  assert.equal(fetches, 3);
  for (let i = 0; i < 10; i++) { clock += 10_000; await ok('attacker-1').catch(() => {}); }   // to 110 s after it was marked
  assert.equal(fetches, 3, 'a kid already found missing is not fetched again for 2 minutes');
  clock += 15_000;   // past the 2-minute window: a kid Google publishes late is locked out no longer than this
  await ok('attacker-1').catch(() => {});
  assert.equal(fetches, 4, 'after 2 minutes the kid may be looked up again');
});

test('api.omnisdr.com (#52 audit): a signed client IP from the Worker gives each caller its own bucket; forged, stale or unconfigured is ignored', async () => {
  const { createHmac } = await import('node:crypto');
  const SECRET = 'edge-test-secret';
  const mk = (edgeSecret) => {
    const app = createApp({ pool: { acquire: async () => ({ client: {}, release() {} }) }, verifyToken: async () => { throw new Error('x'); },
      tokenFrom: (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null,
      config: { trustProxy: 1, ...(edgeSecret ? { edgeSecret } : {}) }, log: () => {} });
    const s = createServer((req, res) => app.handle(req, res));
    return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
  };
  const signed = (ip, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) => ({ 'x-omni-client-ip': ip, 'x-omni-client-ts': String(ts),
    'x-omni-client-sig': createHmac('sha256', secret).update(`${ip}.${ts}`).digest('hex') });
  // Everyone arrives from one Cloudflare egress address (the last X-Forwarded-For hop Google appends).
  async function untilLimited(server, headersFor) {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 1; i <= 40; i++) {
      const r = await fetch(`${base}/v1/me`, { headers: { authorization: 'Bearer junk', 'x-forwarded-for': '104.16.0.1', ...headersFor(i) } });
      if (r.status === 429) return i;
    }
    return null;
  }
  const on = await mk(SECRET); const off = await mk(null); const forged = await mk(SECRET); const stale = await mk(SECRET);
  try {
    assert.equal(await untilLimited(on, (i) => signed(`198.51.100.${i}`)), null, 'signed: each caller has its own bucket');
    assert.equal(await untilLimited(forged, (i) => signed(`198.51.100.${i}`, { secret: 'guess' })), 31, 'forged signature: the shared egress bucket');
    assert.equal(await untilLimited(stale, (i) => signed(`198.51.100.${i}`, { ts: Math.floor(Date.now() / 1000) - 120 })), 31, 'stale: ignored');
    assert.equal(await untilLimited(off, (i) => signed(`198.51.100.${i}`)), 31, 'no secret configured: never trusted');
  } finally { on.close(); off.close(); forged.close(); stale.close(); }
});
