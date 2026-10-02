// The free Gemini API adapter (demo data only, Christian 2026-10-02 item 4b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { geminiApiModel, ModelError } from '../src/services/model.mjs';

const MODELS = { flash_lite: 'lite-x', flash: 'flash-x', pro: 'pro-x' };

test('gemini_api: the request shape, the key only in its header, the tier picks the model', async () => {
  let seen;
  const m = geminiApiModel({ key: 'k-test-not-real', models: MODELS, fetchImpl: async (url, init) => { seen = { url, init };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'there' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } })); } });
  const out = await m.generate({ tier: 'pro', system: 'Be brief.', messages: [{ role: 'user', text: 'Hi' }] });
  assert.deepEqual(out, { text: 'Hello there', model: 'pro-x', usage: { inputTokens: 5, outputTokens: 2 } });
  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/models/pro-x:generateContent');
  assert.equal(seen.init.headers['x-goog-api-key'], 'k-test-not-real');
  assert.ok(!seen.url.includes('k-test') && !seen.init.body.includes('k-test'), 'the key is never in the URL or body');
  assert.deepEqual(JSON.parse(seen.init.body).contents, [{ role: 'user', parts: [{ text: 'Hi' }] }]);
});

test('gemini_api: stops at its daily budget per model and starts again the next day; no grounding; errors are ModelErrors', async () => {
  let calls = 0; let day = '2026-10-02T10:00:00Z';
  const m = geminiApiModel({ key: 'k', models: MODELS, perDay: 2, now: () => new Date(day),
    fetchImpl: async () => { calls++; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })); } });
  const ask = (tier = 'flash') => m.generate({ tier, system: 's', messages: [{ role: 'user', text: 'x' }] });
  await ask(); await ask();
  await assert.rejects(ask(), (e) => e instanceof ModelError && /daily demo budget of 2/.test(e.message));
  await ask('pro');   // another model has its own budget
  assert.equal(calls, 3, 'the refused call never reached Google');
  day = '2026-10-03T00:00:01Z';
  await ask();
  await assert.rejects(m.generate({ tier: 'flash', system: 's', messages: [], grounded: true }), /needs Vertex/);
  const bad = geminiApiModel({ key: 'k', models: MODELS, fetchImpl: async () => new Response('{}', { status: 429 }) });
  await assert.rejects(bad.generate({ tier: 'flash', system: 's', messages: [] }), (e) => e instanceof ModelError && /gemini_api 429/.test(e.message));
  assert.throws(() => geminiApiModel({ models: MODELS }), /needs a key/);
});

test('server.mjs refuses gemini_api unless the deployment says its data is demo-only', () => {
  const server = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
  const run = (extra) => spawnSync(process.execPath, ['-e', `import(${JSON.stringify(server)}).then((m) => m.main?.())`], {
    env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', OMNI_MODEL: 'gemini_api', ...extra }, encoding: 'utf8', timeout: 20000 });
  const r = run({});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /demo data only: set OMNI_DATA_IS_DEMO=1/);
});
