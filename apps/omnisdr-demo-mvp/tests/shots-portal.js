// Screenshots of the guided deal flow: the Close tab, each Order Form step, the client link page, the client-review banner,
// hand-off and the print view. Sample data only (.example addresses). Needs a local server with REP_DEV_EMAIL set and the
// rep migrations applied to its local state. Usage: BASE=http://127.0.0.1:8791 OUT=dir [ROLE=rep] node tests/shots-portal.js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787', OUT = process.env.OUT || 'tests/shots/portal-redesign', ROLE = process.env.ROLE || 'admin';
fs.mkdirSync(OUT, { recursive: true });
const H = { 'x-rep': '1', origin: BASE };
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const sizes = [['desktop', { width: 1100, height: 900 }], ['phone', { width: 390, height: 844 }]];
  for (const scheme of ROLE === 'rep' ? ['light'] : ['light', 'dark']) for (const [name, vp] of sizes) {
    if (scheme === 'dark' && name === 'phone') continue;
    const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: name === 'phone' ? 2 : 1 }), p = await ctx.newPage();
    const api = async (path, method = 'GET', data) => (await p.request.fetch(BASE + '/rep/api' + path, { method, headers: H, data })).json();
    const shot = async (label, opts = {}) => { await p.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; }); await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${label}-${ROLE === 'rep' ? 'rep-' : ''}${scheme}-${name}.png`, fullPage: true, ...opts }); };
    const a = (await api('/accounts', 'POST', { business: 'Ridge Remodeling LLC', niche: 'Remodeler', phone: '555-010-0199', email: 'office@ridgeremodeling.example', address: '200 Sample Road', city: 'Hoboken', state: 'NJ', zip: '07030', contact: { name: 'Sam Example', role: 'Owner' } })).account;
    await p.goto(BASE + '/rep#account/' + a.id + '/close'); await p.waitForSelector('#ofStart'); await shot('close-tab');
    await p.click('#ofStart'); await p.waitForSelector('#ofForm'); await p.waitForSelector('#ofMix:not([hidden])'); await shot('step-package');
    if (ROLE === 'rep') { await ctx.close(); continue; }
    const fid = p.url().split('#deal/')[1].split('/')[0];
    for (const s of ['client', 'services', 'term']) { await p.click(`[data-step="${s}"]`); await p.waitForSelector('#ofForm'); await shot('step-' + s); }
    await api(`/order-forms/${fid}`, 'PATCH', { term: { paymentMethod: 'card', initialTerm: '30-day pilot' } });
    await p.goto(BASE + `/rep#deal/${fid}/review`); await p.waitForSelector('#ofSheet'); await shot('step-review');
    // The client's side: their page from the link, then the rep's review banner.
    const url = (await api(`/order-forms/${fid}/link`, 'POST', {})).url.replace(/^https?:\/\/[^/]+/, BASE);
    const c = await (await b.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: name === 'phone' ? 2 : 1 })).newPage();
    await c.goto(url); await c.waitForSelector('#go'); await c.waitForTimeout(350); await c.screenshot({ path: `${OUT}/client-page-${scheme}-${name}.png`, fullPage: true });
    await c.fill('#client_entityType', 'LLC'); await c.fill('#client_signerTitle', 'Owner'); await c.fill('#ob_hours', 'Mon to Sat, 7 to 6'); await c.click('#go'); await c.waitForSelector('.done');
    await c.waitForTimeout(350); await c.screenshot({ path: `${OUT}/client-page-sent-${scheme}-${name}.png` }); await c.context().close();
    await p.goto(BASE + `/rep#deal/${fid}/client`); await p.waitForSelector('.attn'); await shot('client-review-banner');
    await p.click('details.card summary'); await p.click('[data-link="new"]'); await p.waitForSelector('#ofUrl'); await p.locator('details.card').scrollIntoViewIfNeeded(); await shot('client-link', { fullPage: false });
    await api(`/order-forms/${fid}/client`, 'POST', { action: 'accept' });
    await api(`/order-forms/${fid}`, 'PATCH', { signing: { signedAt: '2026-10-29', filedLocation: 'Shared drive, Clients, OF number' } });
    await api(`/order-forms/${fid}/file`, 'POST', {});
    await p.goto(BASE + `/rep#deal/${fid}/handoff`); await p.waitForFunction(() => document.querySelector('#ofInv') && document.querySelector('#ofInv').textContent.startsWith('{')); await shot('step-handoff');
    await p.goto(BASE + `/rep#orderform/${fid}`); await p.waitForSelector('.sheet'); await p.emulateMedia({ media: 'print' }); await shot('print-view'); await p.emulateMedia({ media: 'screen' });
    console.log(scheme, name, 'done', fid);
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
