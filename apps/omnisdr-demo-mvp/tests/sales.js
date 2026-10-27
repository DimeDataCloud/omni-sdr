// Sales deck gate. Needs a fresh server started with: --var SALES_PASSCODE:test-sales --var DEV_PASSCODE:test-passcode --var IP_CAP:5 --var DAILY_CAP:8
// The real passcode is never in the repo: this uses a test value passed to the instance by run.sh.
const BASE = process.env.BASE || 'http://localhost:8787';
const PASS = process.env.SALES_PASSCODE || 'test-sales';
const DEVPASS = process.env.DEV_PASSCODE || 'test-passcode';
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const J = { 'content-type': 'application/json' };
const post = (u, b, h = {}) => fetch(BASE + u, { method: 'POST', headers: { ...J, ...h }, body: typeof b === 'string' ? b : JSON.stringify(b) });
const get = (u, h = {}) => fetch(BASE + u, { redirect: 'manual', headers: h });
(async () => {
  // 1 unauthenticated: login page only, no deck content
  const a = await get('/'); const at = await a.text();
  ok('GET / without a session is the entry page with the prompt', a.status === 200 && /id="lf"/.test(at) && /data-mode="login"/.test(at));
  ok('entry page carries no links, deck markup or slide data', !/href=/.test(at) && !/id="sd"|id="slide"|Slide copy pending|Speaker notes/.test(at));
  ok('entry page is noindex', /noindex/.test(a.headers.get('x-robots-tag') || '') && /name="robots"/.test(at));
  ok('entry page never contains the passcode', !at.includes(PASS));
  ok('entry page honours reduced motion (css and js)', /prefers-reduced-motion:reduce/.test(at) && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(at));
  ok('entry chat has a log region and a labelled password input with autocomplete off', /role="log"/.test(at) && /<label class="sr" for="pc">Passcode<\/label>/.test(at) && /id="pc" type="password" autocomplete="off"/.test(at));
  ok('entry page has no timestamps or clocks', !/Date\(|toLocale|setInterval|<time/.test(at));
  ok('password bubble is a fixed mask, value never logged or written', /you\('\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022'\)/.test(at) && !/console\./.test(at) && /p\.value=''/.test(at));
  ok('a tapped choice becomes the visitor bubble before navigating', /you\(c\[0\]\);say\('Opening '/.test(at));
  ok('entry page never echoes typed input into the chat', !/you\(p\.value|you\(body/.test(at));
  ok('entry page has no external assets', !/(src|href)="https?:/.test(at) && !/<link /.test(at));
  const sr = await get('/sales'); ok('GET /sales without a session redirects to /', sr.status === 302 && sr.headers.get('location') === '/');
  const tr = await get('/tryme'); ok('GET /tryme without a session redirects to /', tr.status === 302 && tr.headers.get('location') === '/');
  const td = await get('/tryme/dev'); ok('/tryme/dev keeps its own login (not session gated)', td.status === 200 && /id="pc"/.test(await td.text()));
  // 2 wrong passcodes: same status and body for any input, input never echoed
  const ip1 = { 'cf-connecting-ip': '31.1.1.1' };
  const w = [];
  for (const b of [{ passcode: 'ZZ-echo-1' }, { passcode: '' }, { passcode: 123 }, {}, 'null']) { const r = await post('/api/sales/login', b, ip1); w.push([r.status, await r.text()]); }
  ok('wrong inputs give one status and one body', new Set(w.slice(0, 5).map((x) => x.join('|'))).size === 1 && w[0][0] === 401, JSON.stringify(w.map((x) => x[0])));
  ok('input is not echoed', !w.some((x) => /ZZ-echo-1/.test(x[1])));
  // 3 throttle: lockout after 5, right passcode refused while locked
  const ip2 = { 'cf-connecting-ip': '31.2.2.2' }; let last = 0;
  for (let i = 0; i < 6; i++) last = (await post('/api/sales/login', { passcode: 'nope' + i }, ip2)).status;
  ok('sixth miss is 429', last === 429, String(last));
  ok('right passcode refused while locked out', (await post('/api/sales/login', { passcode: PASS }, ip2)).status === 429);
  // 4 independence: a sales lockout does not touch dev login or demo caps; a dev lockout does not touch sales
  ok('dev login works for the sales-locked ip', (await post('/api/dev/login', { passcode: DEVPASS }, ip2)).status === 200);
  ok('demo session start works for the sales-locked ip', (await post('/api/session', {}, ip2)).status === 200);
  const ip3 = { 'cf-connecting-ip': '31.3.3.3' };
  for (let i = 0; i < 6; i++) await post('/api/dev/login', { passcode: 'x' + i }, ip3);
  ok('dev lockout leaves sales login open', (await post('/api/sales/login', { passcode: PASS }, ip3)).status === 200);
  // 5 burst: parallel guesses cannot exceed 5
  const ip4 = { 'cf-connecting-ip': '31.4.4.4' };
  const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => post('/api/sales/login', { passcode: 'b' + i }, ip4).then((r) => r.status)));
  ok('burst: exactly 5 attempts evaluated', burst.filter((s) => s === 401).length === 5 && burst.filter((s) => s === 429).length === 25, JSON.stringify(burst.filter((s) => s === 401).length));
  ok('x-forwarded-for does not rotate the throttle', (await post('/api/sales/login', { passcode: 'q' }, { ...ip4, 'x-forwarded-for': '9.9.9.9' })).status === 429);
  // 6 correct login: cookie flags, deck served
  const lg = await post('/api/sales/login', { passcode: PASS }, { 'cf-connecting-ip': '31.5.5.5' });
  const sc = lg.headers.get('set-cookie') || ''; const ck = sc.split(';')[0];
  ok('correct passcode returns 200', lg.status === 200);
  ok('cookie is HttpOnly, Secure, SameSite=Strict, 8h', /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Strict/.test(sc) && /Max-Age=28800/.test(sc), sc.replace(/=[a-f0-9]{64}/, '=<id>'));
  const pr = await (await get('/', { cookie: ck })).text();
  ok('with the cookie / is the portal chat: no password form, reply buttons target /tryme, /sales and /rep', /data-mode="portal"/.test(pr) && !/id="lf"/.test(pr) && /'Try me','\/tryme'/.test(pr) && /'Sales','\/sales'/.test(pr) && /'Rep dashboard','\/rep'/.test(pr));
  ok('with the cookie /tryme serves the demo', /id="start"/.test(await (await get('/tryme', { cookie: ck })).text()));
  const d = await get('/sales', { cookie: ck }); const dt = await d.text();
  ok('with the cookie /sales serves the deck', d.status === 200 && /id="slide"/.test(dt) && /id="sd"/.test(dt));
  ok('deck is noindex and no-store', /noindex/.test(d.headers.get('x-robots-tag') || '') && d.headers.get('cache-control') === 'no-store');
  ok('deck html does not contain the passcode', !dt.includes(PASS));
  ok('deck has no em dashes', !dt.includes('\u2014'));
  for (const c of ['sales=' + 'a'.repeat(64), 'xsales=' + ck.split('=')[1], 'sales=short', 'dev=' + ck.split('=')[1]]) { const f = await get('/sales', { cookie: c }); const e = await (await get('/', { cookie: c })).text(); ok('forged cookie gets nothing: ' + c.slice(0, 10), f.status === 302 && (await get('/tryme', { cookie: c })).status === 302 && /id="lf"/.test(e)); }
  ok('cross-site login refused', (await post('/api/sales/login', { passcode: PASS }, { origin: 'https://evil.example', 'cf-connecting-ip': '31.6.6.6' })).status === 403);
  ok('non-JSON login refused', (await fetch(BASE + '/api/sales/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: PASS })).status === 415);
  // 7 logout revokes server-side
  await post('/api/sales/logout', {}, { cookie: ck });
  ok('logout revokes the session', (await get('/sales', { cookie: ck })).status === 302 && (await get('/tryme', { cookie: ck })).status === 302);
  // 8 flag: TRYME_GATED=off is checked in tests/tryme-open.js on its own instance
  // 9 public pages unaffected
  ok('/robots.txt and /healthz still open', (await get('/robots.txt')).status === 200 && (await get('/healthz')).status === 200);
  let f = 0; for (const [s, n, dd] of R) { if (s === 'FAIL') f++; console.log(s, n, dd ? '- ' + dd : ''); }
  console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
