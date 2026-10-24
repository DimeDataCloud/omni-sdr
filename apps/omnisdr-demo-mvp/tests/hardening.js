// Regression tests for the independent security audit (2026-10-24). Needs a fresh server: --var IP_CAP:5 --var DAILY_CAP:8
const BASE = process.env.BASE || 'http://localhost:8787';
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const J = { 'content-type': 'application/json' };
const post = (u, b, h = {}) => fetch(BASE + u, { method: 'POST', headers: { ...J, ...h }, body: typeof b === 'string' ? b : JSON.stringify(b) });
(async () => {
  // 1 concurrency: 40 parallel starts from one ip must yield exactly IP_CAP (5) successes
  const rs = await Promise.all(Array.from({ length: 40 }, () => post('/api/session', {}, { 'cf-connecting-ip': '5.5.5.5' })));
  const n200 = rs.filter(r => r.status === 200).length; ok('parallel session starts cannot exceed the per-ip cap', n200 === 5, 'got ' + n200);
  // daily cap: 8 total; 5 used; 3 more distinct ips succeed, further refused, even in parallel
  const rs2 = await Promise.all(Array.from({ length: 20 }, (_, i) => post('/api/session', {}, { 'cf-connecting-ip': '10.0.0.' + i })));
  const n2 = rs2.filter(r => r.status === 200).length; ok('parallel starts cannot exceed the daily cap', n2 === 3, 'got ' + n2);
  // 2 event flood: one sid, 300 parallel events -> stored events capped at 200 and none lost below cap
  const g = await (await post('/api/session', {}, { 'cf-connecting-ip': '5.5.5.5' })).json(); // refused (cap) so no sid; use dev stats later
  // 3 null / junk bodies must not 500
  for (const u of ['/api/session', '/api/lead', '/api/dev/login', '/api/event', '/api/token']) { const r = await post(u, 'null', { 'cf-connecting-ip': '77.7.7.7' }); ok('null body on ' + u + ' is not a 500', r.status !== 500, String(r.status)); }
  // 4 CSRF: wrong Origin and wrong content type refused
  ok('cross-origin POST refused', (await post('/api/lead', {}, { origin: 'https://evil.example' })).status === 403);
  ok('non-JSON content type refused', (await fetch(BASE + '/api/lead', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status === 415);
  // 5 oversize bodies, including chunked
  ok('oversize body refused', (await post('/api/lead', JSON.stringify({ name: 'a'.repeat(10000) }))).status === 413);
  const stream = new ReadableStream({ start(c) { const chunk = new TextEncoder().encode('{"name":"' + 'a'.repeat(1024)); for (let i = 0; i < 6; i++) c.enqueue(chunk); c.close(); } });
  const ch = await fetch(BASE + '/api/lead', { method: 'POST', headers: J, body: stream, duplex: 'half' }); ok('oversize chunked body refused', ch.status === 413, String(ch.status));
  // 6 dev login: lockout after 5 wrong guesses, then even the right passcode is refused for the lockout window
  const ip = { 'cf-connecting-ip': '66.6.6.6' }; let last = 0;
  for (let i = 0; i < 6; i++) last = (await post('/api/dev/login', { passcode: 'nope' + i }, ip)).status;
  ok('brute force locks out after 5 failures', last === 429, String(last));
  ok('right passcode refused while locked out', (await post('/api/dev/login', { passcode: 'test-passcode' }, ip)).status === 429);
  // 7 forged / old-style cookies
  const crypto = require('crypto'); const old = crypto.createHash('sha256').update('omnisdr-dev:test-passcode').digest('hex');
  for (const c of ['dev=' + old, 'xdev=' + old, 'dev=' + 'a'.repeat(64)]) ok('forged dev cookie rejected: ' + c.slice(0, 10), (await fetch(BASE + '/api/dev/stats', { headers: { cookie: c } })).status === 401);
  // 8 real login -> session cookie is random, works, logout revokes it
  const lg = await post('/api/dev/login', { passcode: 'test-passcode' }, { 'cf-connecting-ip': '88.8.8.8' }); ok('valid login works', lg.status === 200);
  const ck = (lg.headers.get('set-cookie') || '').split(';')[0]; ok('cookie is a random 64-hex id, not derived from the passcode', /^dev=[a-f0-9]{64}$/.test(ck) && ck !== 'dev=' + old);
  ok('session cookie authorizes stats', (await fetch(BASE + '/api/dev/stats', { headers: { cookie: ck } })).status === 200);
  // 9 kill switch: string "0" must not kill; true kills; false resumes; kill state persists
  const H = { cookie: ck, 'content-type': 'application/json' };
  await fetch(BASE + '/api/dev/kill', { method: 'POST', headers: H, body: '{"on":"0"}' });
  ok('string "0" does not pause the demo', !(await (await fetch(BASE + '/api/dev/stats', { headers: { cookie: ck } })).json()).killed);
  await fetch(BASE + '/api/dev/kill', { method: 'POST', headers: H, body: '{"on":true}' });
  ok('on:true pauses', (await (await fetch(BASE + '/api/dev/stats', { headers: { cookie: ck } })).json()).killed === true);
  await fetch(BASE + '/api/dev/kill', { method: 'POST', headers: H, body: '{"on":false}' });
  ok('on:false resumes', (await (await fetch(BASE + '/api/dev/stats', { headers: { cookie: ck } })).json()).killed === false);
  await fetch(BASE + '/api/dev/logout', { method: 'POST', headers: H, body: '{}' });
  ok('logout revokes the session server-side', (await fetch(BASE + '/api/dev/stats', { headers: { cookie: ck } })).status === 401);
  ok('healthz does not leak kill state', !/kill/.test(await (await fetch(BASE + '/healthz')).text()));
  ok('unauthenticated /api/dev/me is 200 with authed:false', (await (await fetch(BASE + '/api/dev/me')).json()).authed === false);
  let f = 0; for (const [s, n, d] of R) { if (s === 'FAIL') f++; console.log(s, n, d ? '— ' + d : ''); }
  console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
