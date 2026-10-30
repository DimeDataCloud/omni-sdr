// Screenshots of the allowance mix slider at both ends and the plan default, Standard ($499) and Plus ($899), phone and desktop.
// Needs a server with REP_DEV_EMAIL and REP_ADMIN_EMAIL set. Usage: BASE=http://127.0.0.1:8791 OUT=dir node tests/shots-mix.js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787', OUT = process.env.OUT || 'tests/shots';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  for (const [name, vp] of [['desktop', { width: 1100, height: 1000 }], ['phone', { width: 390, height: 1100 }]]) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    for (const [plan, price] of [['standard', '499'], ['plus', '899']]) {
      const a = await (await p.request.post(BASE + '/rep/api/accounts', { headers: { 'x-rep': '1', origin: BASE }, data: { business: `Ridge Remodeling ${plan}`, niche: 'Remodeler' } })).json();
      await p.goto(BASE + '/rep#account/' + a.account.id); await p.waitForSelector('#df', { state: 'attached' });
      const t = await p.evaluate(() => document.querySelector('#df').closest('[data-p]').dataset.p); await p.click('.tab[data-t="' + t + '"]');
      await p.evaluate(() => { const d = document.querySelector('#df').closest('details'); if (d) d.open = true; }); // the quick close sits under the Order Form
      await p.selectOption('#lv', '1'); await p.fill('#pc', price); await p.dispatchEvent('#pc', 'input');
      await p.waitForSelector('#mixbox:not([hidden])'); await p.waitForFunction((a) => document.querySelector('#mxAllow').textContent === a[0] && document.querySelector('#mxMin').textContent === a[1], plan === 'plus' ? ['$330', '600'] : ['$175', '300']);
      const shot = async (label) => { await p.locator('#mixbox').scrollIntoViewIfNeeded(); await p.waitForTimeout(150); await p.screenshot({ path: `${OUT}/mix-${plan}-${label}-${name}.png` }); };
      const max = Number(await p.getAttribute('#mx', 'max'));
      await shot('default');
      await p.fill('#mx', '0'); await shot('more-calls'); // left end
      await p.fill('#mx', String(max)); await shot('more-texts'); // right end
      console.log(name, plan, JSON.stringify(await p.evaluate(() => ({ min: document.querySelector('#mxMin').textContent, txt: document.querySelector('#mxTxt').textContent, vt: document.querySelector('#mx').getAttribute('aria-valuetext') }))));
      await p.click('#mxReset'); console.log(' reset ->', await p.getAttribute('#mx', 'aria-valuetext'));
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
