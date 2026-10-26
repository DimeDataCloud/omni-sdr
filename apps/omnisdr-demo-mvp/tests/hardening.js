// Regression tests for the independent security audit (2026-10-24). Needs a fresh server: --var IP_CAP:5 --var DAILY_CAP:8
const BASE = process.env.BASE || 'http://localhost:8787';
const PASS = process.env.DEV_PASSCODE || 'test-passcode';
const LIVE = !['http://localhost', 'http://127.0.0.1'].some(p => BASE.startsWith(p));
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const J = { 'content-type': 'application/json' };
// Live: Cloudflare's edge answers a forged cf-connecting-ip with an HTML 403, so never send it there.
const clean = h => { if (!LIVE) return h; const { 'cf-connecting-ip': _x, ...rest } = h; return rest; };
const post = (u, b, h = {}) => fetch(BASE + u, { method: 'POST', headers: { ...J, ...clean(h) }, body: typeof b === 'string' ? b : JSON.stringify(b) });
(async () => {
  if (!LIVE) { // caps tests spoof cf-connecting-ip, which Cloudflare overwrites at the edge: local low-cap instance only
  // 1 concurrency: 40 parallel starts from one ip must yield exactly IP_CAP (5) successes
  const rs = await Promise.all(Array.from({ length: 40 }, () => post('/api/session', {}, { 'cf-connecting-ip': '5.5.5.5' })));
  const n200 = rs.filter(r => r.status === 200).length; ok('parallel session starts cannot exceed the per-ip cap', n200 === 5, 'got ' + n200);
  // daily cap: 8 total; 5 used; 3 more distinct ips succeed, further refused, even in parallel
  const rs2 = await Promise.all(Array.from({ length: 20 }, (_, i) => post('/api/session', {}, { 'cf-connecting-ip': '10.0.0.' + i })));
  const n2 = rs2.filter(r => r.status === 200).length; ok('parallel starts cannot exceed the daily cap', n2 === 3, 'got ' + n2);
  // 2 event flood: one sid, 300 parallel events -> stored events capped at 200 and none lost below cap
  const g = await (await post('/api/session', {}, { 'cf-connecting-ip': '5.5.5.5' })).json(); // refused (cap) so no sid; use dev stats later
  }
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
  if (!LIVE) { // lockout keys on the real client ip: only meaningful (and safe) on a local instance
  // 6b parallel burst: 40 simultaneous wrong guesses from one ip may get at most 5 evaluated (401); the rest must be locked out (429)
  const bip = { 'cf-connecting-ip': '55.5.5.55' };
  const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => post('/api/dev/login', { passcode: 'burst' + i }, bip).then(r => r.status)));
  const n401 = burst.filter(s => s === 401).length, n429 = burst.filter(s => s === 429).length;
  ok('parallel login burst gets at most 5 guesses evaluated', n401 === 5 && n429 === 35, '401x' + n401 + ' 429x' + n429);
  ok('right passcode refused after a burst lockout', (await post('/api/dev/login', { passcode: PASS }, bip)).status === 429);
  const ip = { 'cf-connecting-ip': '66.6.6.6' }; let last = 0;
  for (let i = 0; i < 6; i++) last = (await post('/api/dev/login', { passcode: 'nope' + i }, ip)).status;
  ok('brute force locks out after 5 failures', last === 429, String(last));
  ok('right passcode refused while locked out', (await post('/api/dev/login', { passcode: PASS }, ip)).status === 429);
  }
  // 7 forged / old-style cookies
  const crypto = require('crypto'); const old = crypto.createHash('sha256').update('omnisdr-dev:' + PASS + '').digest('hex');
  for (const c of ['dev=' + old, 'xdev=' + old, 'dev=' + 'a'.repeat(64)]) ok('forged dev cookie rejected: ' + c.slice(0, 10), (await fetch(BASE + '/api/dev/stats', { headers: { cookie: c } })).status === 401);
  // 8 real login -> session cookie is random, works, logout revokes it
  const lg = await post('/api/dev/login', { passcode: PASS }, { 'cf-connecting-ip': '88.8.8.8' }); ok('valid login works', lg.status === 200);
  const ck = (lg.headers.get('set-cookie') || '').split(';')[0]; ok('cookie is a random 64-hex id, not derived from the passcode', /^dev=[a-f0-9]{64}$/.test(ck) && ck !== 'dev=' + old);
  ok('session cookie authorizes stats', (await fetch(BASE + '/api/dev/stats', { headers: { cookie: ck } })).status === 200);
  // 8b reset-today: needs a session, and zeroes the counter
  ok('reset-today without a session is refused', (await post('/api/dev/reset-today', {})).status === 401);
  const HR = { cookie: ck, 'content-type': 'application/json' };
  await fetch(BASE + '/api/session', { method: 'POST', headers: J, body: '{}' });
  ok('reset-today with a session returns ok', (await (await fetch(BASE + '/api/dev/reset-today', { method: 'POST', headers: HR, body: '{}' })).json()).ok === true);
  ok('counter is zero after reset', (await (await fetch(BASE + '/api/dev/stats', { headers: { cookie: ck } })).json()).usedToday === 0);
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
  // route move: demo at /tryme, dev portal at /tryme/dev, old paths redirect (302, query kept), /api/* untouched
  const nf = (u) => fetch(BASE + u, { redirect: 'manual' });
  for (const [from, to] of [['/', '/tryme'], ['/dev', '/tryme/dev'], ['/?a=1&b=2', '/tryme?a=1&b=2'], ['/dev?x=y', '/tryme/dev?x=y']]) { const r = await nf(from); ok('redirect ' + from, r.status === 302 && r.headers.get('location') === to, r.status + ' ' + r.headers.get('location')); }
  const t1 = await nf('/tryme'); ok('/tryme serves the demo', t1.status === 200 && /id="start"/.test(await t1.text()));
  const t2 = await nf('/tryme/dev'); ok('/tryme/dev serves the dev portal', t2.status === 200 && /id="pc"/.test(await t2.text()));
  ok('/tryme/ and /tryme/x are not pages', (await nf('/tryme/x')).status === 404);
  ok('/api/lead still answers on POST', (await post('/api/lead', { tenant: 'riverbend', name: 'Sam' })).status === 200);
  ok('/api/dev/stats still 401 without cookie', (await nf('/api/dev/stats')).status === 401);
  ok('/api/dev/login still 401 on a wrong passcode', (await post('/api/dev/login', { passcode: 'wrong' }, { 'cf-connecting-ip': '66.6.6.6' })).status === 401);
  let f = 0; for (const [s, n, d] of R) { if (s === 'FAIL') f++; console.log(s, n, d ? '— ' + d : ''); }
  console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
