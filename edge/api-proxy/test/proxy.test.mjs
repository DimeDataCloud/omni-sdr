// node --test test/proxy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const ORIGIN = 'https://omni-api-abc123-uc.a.run.app';

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return fn(calls).finally(() => { globalThis.fetch = real; });
}

test('passes method, path, query, body and auth through; drops hop and Cloudflare headers', () => withFetch(
  async () => new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' } }),
  async (calls) => {
    const req = new Request('https://api.omnisdr.com/v1/o/x/w/y/contacts?limit=5', { method: 'POST', body: '{"a":1}',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' } });
    const res = await worker.fetch(req, { ORIGIN });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', 'API headers pass through');
    const [c] = calls;
    assert.equal(c.url, `${ORIGIN}/v1/o/x/w/y/contacts?limit=5`);
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.redirect, 'manual');
    assert.equal(c.init.headers.get('authorization'), 'Bearer t');
    assert.equal(c.init.headers.get('x-forwarded-for'), null, 'a caller-supplied XFF never reaches the API');
    assert.equal(c.init.headers.get('cf-connecting-ip'), null);
    assert.equal(c.init.headers.get('x-forwarded-host'), 'api.omnisdr.com');
    assert.equal(await new Response(c.init.body).text(), '{"a":1}');
  }));

test('a redirect to the run.app origin is rewritten to the public name; others are left alone', () => withFetch(
  async (url) => new Response(null, { status: 303, headers: { location: url.endsWith('/a') ? `${ORIGIN}/u/done`
    : url.endsWith('/c') ? `${ORIGIN}.evil.example/x` : 'https://example.com/x' } }),
  async () => {
    assert.equal((await worker.fetch(new Request('https://api.omnisdr.com/a'), { ORIGIN })).headers.get('location'), 'https://api.omnisdr.com/u/done');
    assert.equal((await worker.fetch(new Request('https://api.omnisdr.com/b'), { ORIGIN })).headers.get('location'), 'https://example.com/x');
    assert.equal((await worker.fetch(new Request('https://api.omnisdr.com/c'), { ORIGIN })).headers.get('location'), `${ORIGIN}.evil.example/x`,
      'a host that only shares the prefix is not the origin');
  }));

test('refuses to run with no or a non-run.app origin; an unreachable API is a clean 502', async () => {
  for (const env of [{}, { ORIGIN: 'https://evil.example' }, { ORIGIN: 'http://omni-api.a.run.app' }]) {
    assert.equal((await worker.fetch(new Request('https://api.omnisdr.com/v1/health'), env)).status, 503, JSON.stringify(env));
  }
  await withFetch(async () => { throw new TypeError('network'); }, async () => {
    const r = await worker.fetch(new Request('https://api.omnisdr.com/v1/health'), { ORIGIN });
    assert.equal(r.status, 502);
    assert.doesNotMatch(await r.text(), /run\.app/, 'the origin is not named to callers');
  });
});

test('signs the caller\'s own address for the API (#55) and drops any client-IP headers the caller sent', () => withFetch(
  async () => new Response('{}', { status: 200 }),
  async (calls) => {
    const { createHmac } = await import('node:crypto');
    const SECRET = 'test-edge-secret-not-real';
    const req = new Request('https://api.omnisdr.com/v1/me', { headers: { 'cf-connecting-ip': '203.0.113.7',
      'x-omni-client-ip': '198.51.100.1', 'x-omni-client-ts': '1', 'x-omni-client-sig': 'f'.repeat(64) } });
    await worker.fetch(req, { ORIGIN, EDGE_SECRET: SECRET });
    const h = calls[0].init.headers;
    assert.equal(h.get('x-omni-client-ip'), '203.0.113.7', 'the connecting address, not the forged one');
    const ts = h.get('x-omni-client-ts');
    assert.ok(Math.abs(Number(ts) - Date.now() / 1000) < 5);
    assert.equal(h.get('x-omni-client-sig'), createHmac('sha256', SECRET).update(`203.0.113.7.${ts}`).digest('hex'), 'the format app.mjs edgeIp verifies');
    // Without the secret nothing is signed, and the forged headers still never reach the API.
    await worker.fetch(req, { ORIGIN });
    const h2 = calls[1].init.headers;
    assert.deepEqual([h2.get('x-omni-client-ip'), h2.get('x-omni-client-ts'), h2.get('x-omni-client-sig')], [null, null, null]);
  }));
