// The ZeroBounce adapter: the key never goes in a URL, and only a plain "valid" on a non-catch-all domain is 'valid'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { zeroBounceVerifier, verdictOf } from '../src/services/zerobounce.mjs';

const KEY = 'test-key-not-real';

test('mapping: catch-all, accept-all and unknown never become valid; traps, abuse and do-not-mail are invalid', () => {
  const cases = [
    [{ status: 'valid', sub_status: '', catchall_domain: false }, 'valid'],
    [{ status: 'valid', sub_status: 'alias_address' }, 'valid'],
    [{ status: 'valid', sub_status: '', catchall_domain: true }, 'risky'],
    [{ status: 'valid', sub_status: '', catchall_domain: 'true' }, 'risky'],
    [{ status: 'valid', sub_status: 'accept_all' }, 'risky'],
    [{ status: 'valid', sub_status: 'role_based_catch_all' }, 'risky'],
    [{ status: 'valid', sub_status: 'role_based_accept_all' }, 'risky'],   // seen from the live API's sandbox, 2026-10-03
    [{ status: 'catch-all', sub_status: '' }, 'risky'],
    [{ status: 'unknown', sub_status: 'greylisted' }, 'unknown'],
    [{ status: 'invalid', sub_status: 'mailbox_not_found' }, 'invalid'],
    [{ status: 'spamtrap', sub_status: '' }, 'invalid'],
    [{ status: 'abuse', sub_status: '' }, 'invalid'],
    [{ status: 'do_not_mail', sub_status: 'disposable' }, 'invalid'],
    [{ status: 'do_not_mail', sub_status: 'role_based' }, 'risky'],
    [{ status: 'VALID-ish' }, 'unknown'],
    [{}, 'unknown'],
    [null, 'unknown'],
  ];
  for (const [r, want] of cases) assert.equal(verdictOf(r), want, JSON.stringify(r));
});

test('request: POST to ZeroBounce with the key in the body only; errors and non-answers throw (the route refunds them)', async () => {
  const calls = [];
  const reply = (body, status = 200) => async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); };
  const v = zeroBounceVerifier({ key: KEY, fetchImpl: reply({ address: 'pat@clinic.example', status: 'valid', sub_status: '', catchall_domain: false }) });
  assert.equal(v.name, 'zerobounce');
  assert.deepEqual(await v.check('pat@clinic.example'), { verdict: 'valid' });
  const [c] = calls;
  assert.equal(c.url, 'https://api.zerobounce.net/v2/validate');
  assert.ok(!c.url.includes(KEY) && !c.url.includes('?'), 'the key is never in the URL');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.redirect, 'error', 'a redirect could carry the body elsewhere');
  const sent = new URLSearchParams(c.init.body);
  assert.deepEqual([sent.get('api_key'), sent.get('email')], [KEY, 'pat@clinic.example']);
  for (const fetchImpl of [reply({ error: 'Invalid API key' }), reply({}), reply({ status: 'valid' }, 500), reply({ address: 'other@clinic.example', status: 'valid' })]) {
    await assert.rejects(zeroBounceVerifier({ key: KEY, fetchImpl }).check('pat@clinic.example'));
  }
  const err = await zeroBounceVerifier({ key: KEY, fetchImpl: reply({}, 401) }).check('a@b.example').catch((e) => e);
  assert.doesNotMatch(String(err?.message), new RegExp(KEY), 'the key never appears in an error');
  assert.throws(() => zeroBounceVerifier({ key: '' }), /no key/);
});

test('server.mjs: OMNI_VERIFY=zerobounce without the key in OMNI_SENDER_SECRETS refuses to start (never a silent off)', () => {
  const server = new URL('../src/server.mjs', import.meta.url).href;
  const run = (extra) => spawnSync(process.execPath, ['-e', `import(${JSON.stringify(server)}).then((m) => m.main?.())`], {
    env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', OMNI_VERIFY: 'zerobounce', ...extra }, encoding: 'utf8', timeout: 20000 });
  for (const secrets of [undefined, 'not json', JSON.stringify({ mailboxKey: 'x' })]) {
    const r = run(secrets === undefined ? {} : { OMNI_SENDER_SECRETS: secrets });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing zeroBounceKey in OMNI_SENDER_SECRETS/);
  }
});
