const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8787';
const PASS = process.env.DEV_PASSCODE || 'test-passcode';
const results = [];
const ok = (n, c, d = '') => { results.push([c ? 'PASS' : 'FAIL', n, d]); };
async function call(page, lines) { for (const l of lines) { await page.fill('#msg', l); await page.press('#msg', 'Enter'); await page.waitForTimeout(850); } }
const agentText = async (page) => (await page.$$eval('.bubble.a', n => n.map(x => x.textContent))).join(' || ');
(async () => {
  const b = await chromium.launch();
  const mk = async (opts = {}) => { const c = await b.newContext(opts); const p = await c.newPage(); const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e))); p._errs = errs; return p; };
  const startCall = async (p) => { await p.goto(BASE + '/tryme'); await p.click('#start'); await p.waitForSelector('#live:not([hidden])'); };

  // 1 happy path
  let p = await mk(); await p.goto(BASE + '/tryme');
  ok('demo page loads with title', (await p.title()).includes('Demo'));
  await p.click('#start'); await p.waitForSelector('#live:not([hidden])');
  let t = await agentText(p);
  ok('greeting names business, says automated and recorded', /Riverbend Bath/.test(t) && /automated/.test(t) && /recorded/.test(t), t.slice(0, 160));
  await call(p, ['I want to convert my tub to a walk-in shower', 'the primary bath, about 5 by 8', 'I need it done next month, my mom had a fall', 'my name is Sarah Lee', '615 555 0199', '37221', 'the Tuesday one', 'yes that is right']);
  t = await agentText(p);
  ok('agent read back details', /Let me read that back/.test(t) && /Sarah Lee/.test(t) && /37221/.test(t));
  ok('booked panel shows slot', /Tuesday at 10:00 AM/.test(await p.textContent('#booked')));
  const cap = await p.textContent('#cap');
  ok('captured card has name, phone, zip', /Sarah Lee/.test(cap) && /615-555-0199/.test(cap) && /37221/.test(cap), cap.replace(/\s+/g, ' '));
  ok('hot flag set (fall + next month)', /Hot lead/.test(await p.textContent('#flags')));
  const sms = await p.textContent('#ownerSms');
  ok('owner text is HOT and labeled simulated', /HOT:/.test(sms) && /Simulated/i.test(await p.textContent('body')), sms.slice(0, 120));
  ok('no console errors on demo (CSP etc.)', p._errs.length === 0, p._errs.join(' | '));
  await p.screenshot({ path: 'tests/shot-demo-light.png', fullPage: true });

  // 2 edge cases
  p = await mk(); await startCall(p);
  await call(p, ['are you an AI?', 'how much will a full remodel cost?', 'can I talk to a real person', 'full remodel please', 'guest bath small', 'whenever', 'Tom', '12345', 'not sure', '37205']);
  await p.waitForTimeout(1200);
  t = await agentText(p);
  ok('admits to being automated when asked', /Yeah, I am an automated assistant/.test(t));
  ok('re-asks the current question after AI answer', (t.match(/What kind of bathroom project/g) || []).length >= 2);
  ok('price deflected with no number', /free quote/.test(t) && !/\$\s?\d/.test(t));
  ok('human request flagged', /Wants a human/.test(await p.textContent('#flags')));
  ok('bad phone retried once then accepted as unverified', /did not get all ten digits/.test(t) && /unverified/.test(await p.textContent('#cap')));
  ok('flow continues to slot offer', /Which works better/.test(t));


  // 2b agent-logic regressions from the security audit
  p = await mk(); await startCall(p);
  await call(p, ['basement bathroom remodel', 'primary, 6x9', 'this fall is fine', 'Ann', '615-555-0123', '37215']); await p.waitForTimeout(1200);
  t = await agentText(p);
  ok('basement bathroom remodel is NOT rejected as out of scope', !/outside what we do/.test(t) && /Which works better/.test(t));
  ok('"this fall" does not flag a hot lead', !/Hot lead/.test(await p.textContent('#flags')));
  await call(p, ['not Tuesday, Wednesday please']); await p.waitForTimeout(700);
  ok('"not Tuesday, Wednesday" books Wednesday', /Wednesday at 2:00 PM/.test(await p.textContent('#booked')));
  await call(p, ['no that is wrong']); t = await agentText(p);
  ok('replying "no" at confirm does not claim a firm booking', /Tentative/.test(await p.textContent('#booked')) && /tentative/.test(t) && /Caller said the details were wrong/.test(await p.textContent('#ownerSms')));

  p = await mk(); await startCall(p);
  await call(p, ['waterproof tile and a new vanity', 'half bath', 'soon', 'Bo', '615-555-0124', 'no idea', 'not sure']); await p.waitForTimeout(800);
  t = await agentText(p);
  ok('"waterproof" is not mistaken for roof', !/outside what we do/.test(t));
  ok('unknown zip never reaches booking', /could not confirm your area/.test(t) && !/Which works better/.test(t) && /Not booked/.test(await p.textContent('#booked')));

  p = await mk(); await startCall(p);
  await p.fill('#msg', 'I need a leak fixed'); await p.press('#msg', 'Enter'); await p.fill('#msg', 'it is the primary bath'); await p.press('#msg', 'Enter');
  await p.waitForTimeout(2500); t = await agentText(p);
  ok('two rapid messages are handled in order, not both at the same step', /Which bathroom is it/.test(t) && /when are you hoping/.test(t), t.slice(-200));
  await p.click('#end'); const before = (await p.$$('.bubble.a')).length; await p.waitForTimeout(1500);
  ok('agent stays silent after hang up', (await p.$$('.bubble.a')).length === before);

  // 3 out of scope
  p = await mk(); await startCall(p);
  await call(p, ['I need my kitchen redone', 'Pat']); t = await agentText(p);
  ok('out-of-scope declined politely and call ends', /outside what we do/.test(t) && await p.isVisible('#over'));
  ok('out-of-scope owner text, no booking', /Out of scope/.test(await p.textContent('#ownerSms')) && /Not booked/.test(await p.textContent('#booked')));

  // 4 out of area
  p = await mk(); await startCall(p);
  await call(p, ['new tile and a vanity', 'half bath', 'just planning', 'Lee', '615-555-0111', '90210']); t = await agentText(p);
  ok('out-of-area zip not booked', /outside our service area/.test(t) && /Out of area/.test(await p.textContent('#flags')) && /Not booked/.test(await p.textContent('#booked')));

  // 5 CHASE tab
  p = await mk(); await p.goto(BASE + '/tryme'); await p.click('#t2'); await p.click('#lf button[type=submit]');
  await p.waitForTimeout(1800);
  ok('first text arrives in seconds, says automated and STOP', /Reply STOP/.test(await p.textContent('#thread')) && /Automated/.test(await p.textContent('#thread')));
  await p.click('[data-a=stop]'); await p.waitForTimeout(11000);
  const th = await p.textContent('#thread');
  ok('STOP halts follow-ups and records opt-out', /Opt-out recorded/.test(th) && !/Last note from/.test(th) && (th.match(/Agent ·/g) || []).length === 1, th.slice(0, 200));
  ok('chase labeled simulated', /Simulated, not sent/.test(await p.textContent('#p2')));

  // 6 mobile + dark
  const m = await mk({ viewport: { width: 375, height: 800 }, colorScheme: 'dark' }); await m.goto(BASE + '/tryme');
  const sw = await m.evaluate(() => document.documentElement.scrollWidth); ok('no horizontal scroll at 375px', sw <= 376, 'scrollWidth=' + sw);
  await m.screenshot({ path: 'tests/shot-demo-mobile-dark.png', fullPage: true });

  // 7 dev portal
  p = await mk(); await p.goto(BASE + '/tryme/dev');
  ok('dev portal shows login first', await p.isVisible('#gate') && !await p.isVisible('#app'));
  await p.fill('#pc', 'wrong'); await p.click('#lf button'); await p.waitForTimeout(400);
  ok('wrong passcode rejected', await p.isVisible('#le'));
  await p.fill('#pc', PASS); await p.click('#lf button'); await p.waitForSelector('#app:not([hidden])');
  const used = await p.textContent('#used'); ok('dev stats render', /\d+ \/ \d+/.test(used), used);
  ok('dev lists sessions', (await p.$$('#sess tr')).length >= 3);
  await p.waitForTimeout(300); ok('dev tenant config shows hard stops and discovery questions', /hardStops/.test(await p.textContent('#tenant')) && /discovery/.test(await p.textContent('#tenant')));
  ok('dev flags missing prod config', /Check/.test(await p.textContent('#checks')));
  ok('dev shows Durable Object storage', /Durable Object/.test(await p.textContent('#store')));
  await p.click('#kill'); await p.waitForTimeout(500);
  ok('kill switch shows paused', /paused/.test(await p.textContent('#killState')));
  const d = await mk(); await d.goto(BASE + '/tryme'); await d.click('#start'); await d.waitForTimeout(600);
  ok('demo refuses new sessions while paused', await d.isVisible('#startErr') && /paused/.test(await d.textContent('#startErr')));
  await p.click('#kill'); await p.waitForTimeout(500);
  ok('resume works', /live/.test(await p.textContent('#killState')));
  const e2 = p._errs.filter(x => !/401/.test(x)); ok('no console errors on dev portal (expected 401 on wrong passcode ignored)', e2.length === 0, e2.join(' | '));
  await p.screenshot({ path: 'tests/shot-dev.png', fullPage: true });

  // 8 API security
  const get = (u, o) => fetch(BASE + u, o);
  ok('dev API 401 without cookie', (await get('/api/dev/stats')).status === 401);
  ok('tenants API 401 without cookie', (await get('/api/dev/tenants')).status === 401);
  const r = await get('/'); const h = r.headers; const csp = h.get('content-security-policy') || '';
  ok('CSP uses nonce, no unsafe-inline scripts', /script-src 'self' 'nonce-/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp));
  ok('noindex, nosniff, frame deny', /noindex/.test(h.get('x-robots-tag')) && h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY');
  ok('token endpoint off by default', (await get('/api/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"sid":"x"}' })).status === 501);
  ok('unknown route 404', (await get('/nope')).status === 404);
  const html = await r.text(); ok('no secrets in served HTML', !/AIza|sk-|GEMINI_API_KEY|test-passcode/.test(html));
  await b.close();
  let f = 0; for (const [s, n, d] of results) { if (s === 'FAIL') f++; console.log(s, n, d ? '— ' + d : ''); }
  console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
