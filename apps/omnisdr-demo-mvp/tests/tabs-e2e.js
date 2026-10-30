// The account page's five tabs, end to end, in a fresh browser context (no cache): each tab renders content, each form
// saves, and the stage moves. Sample data only. Needs a local server with REP_DEV_EMAIL set and the rep migrations
// applied to its local state. Usage: BASE=http://127.0.0.1:8791 [OUT=dir] [CHROME=path] node tests/tabs-e2e.js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787', OUT = process.env.OUT || '';
const H = { 'x-rep': '1', origin: BASE };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  for (const [name, vp] of [['desktop', { width: 1100, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: name === 'phone' ? 2 : 1 }), p = await ctx.newPage();
    const problems = [];
    p.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 160)); });
    p.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
    const api = async (path, method = 'GET', data) => (await p.request.fetch(BASE + '/rep/api' + path, { method, headers: H, data })).json();
    const newAccount = async (tag) => (await api('/accounts', 'POST', { business: `Ridge Remodeling ${tag}`, niche: 'Remodeler', phone: '555-010-0199', email: 'office@ridgeremodeling.example', address: '200 Sample Road', city: 'Hoboken', state: 'NJ', zip: '07030', contact: { name: 'Sam Example', role: 'Owner' } })).account;
    const tab = async (k) => { await p.click(`.tab[data-t="${k}"]`); await p.waitForTimeout(300); };
    const panel = (k) => p.evaluate((k) => { const el = document.querySelector(`[data-p="${k}"]`); const r = el.getBoundingClientRect(); return { h: Math.round(r.height), top: el.parentElement.id, text: el.innerText.trim().length }; }, k);
    const toastSaid = () => p.waitForFunction(() => { const t = document.querySelector('#toast'); return t && !t.hidden && t.textContent; }, null, { timeout: 5000 }).then(() => p.textContent('#toast'));

    // 1. Every tab renders real content, and every panel is a direct child of the view (none nested in another tab).
    const a = await newAccount(name);
    await p.goto(`${BASE}/rep#account/${a.id}`); await p.waitForSelector('.tab');
    for (const [k, label] of [['0', 'Overview'], ['4', 'Qualify'], ['1', 'Activity'], ['3', 'Close'], ['2', 'Onboard']]) {
      await tab(k); const r = await panel(k);
      check(r.h > 100 && r.text > 40 && r.top === 'view', `${name}: ${label} renders (height ${r.h}px, ${r.text} chars, parent #${r.top})`);
      if (OUT) await p.screenshot({ path: `${OUT}/tab-${k}-${label.toLowerCase()}-${name}.png`, fullPage: true });
    }

    // 2. Qualify: the free-check steps come from content, the math updates, Save audit saves, and demo booked moves the stage.
    await tab('4');
    check((await p.locator('#qualifyTab ol li').count()) >= 3, `${name}: Qualify shows the free-check steps`);
    await p.fill('#q_leadSources', 'Google and referrals'); await p.fill('#q_jobValue', '450'); await p.fill('#q_missed', '8');
    check(/\$3,600/.test(await p.textContent('#q_est')), `${name}: lost-job math reads 8 x $450 = $3,600`);
    await p.click('#qSave'); check(/Audit saved/.test(await toastSaid()), `${name}: Save audit confirms`);
    let acct = (await api('/accounts/' + a.id)).account;
    check(acct.audit.leadSources === 'Google and referrals' && acct.audit.jobValue === '450' && acct.audit.missed === '8', `${name}: the audit is saved on the server`);
    await p.waitForSelector('#qRun'); await p.click('#qRun'); await p.waitForTimeout(800);
    check((await api('/accounts/' + a.id)).account.stage === 'results_call', `${name}: Save and mark demo booked moves the stage to Demo booked`);

    // 3. Activity: a note saves to the timeline.
    await p.waitForSelector('.tab'); await tab('1');
    await p.fill('#nt input[name=body]', 'Called the owner about the free check'); await p.click('#nt button');
    await p.waitForTimeout(800);
    check((await api('/accounts/' + a.id)).activities.some((v) => v.body === 'Called the owner about the free check'), `${name}: an Activity note saves`);

    // 4. Onboard: the fields save to the account.
    await p.waitForSelector('.tab'); await tab('2');
    const firstOb = await p.getAttribute('#of textarea', 'name');
    await p.fill(`#of textarea[name="${firstOb}"]`, 'Mon to Sat, 7 to 6'); await p.click('#of button');
    await p.waitForTimeout(800);
    check((await api('/accounts/' + a.id)).account.onboarding[firstOb] === 'Mon to Sat, 7 to 6', `${name}: Onboard saves (${firstOb})`);

    // 5. Close: Start the Order Form opens the guided flow; on another account, Quick close records the sale.
    await p.waitForSelector('.tab'); await tab('3');
    await p.click('#ofStart'); await p.waitForSelector('#ofForm', { timeout: 8000 });
    check(/#deal\//.test(p.url()), `${name}: Close starts the Order Form (${p.url().split('#')[1].slice(0, 12)}...)`);
    const c = await newAccount(name + ' quick');
    await p.goto(`${BASE}/rep#account/${c.id}`); await p.waitForSelector('.tab'); await tab('3');
    await p.click('#df button[type=submit], #df button:not([type=button])'); await p.waitForTimeout(1000);
    check((await api('/accounts/' + c.id)).account.stage === 'onboarding', `${name}: Quick close records the sale and moves the stage to Onboarding`);

    check(problems.length === 0, `${name}: no page errors, CSP errors or failed requests${problems.length ? ': ' + problems.join(' | ') : ''}`);
    await ctx.close();
  }
  await b.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
