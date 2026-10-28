// Screenshots of the entry (mid-animation), prompt, chooser and deck at phone and desktop width.
// Needs a server with --var SALES_PASSCODE:test-sales. Usage: BASE=... OUT=dir node tests/shots-entry.js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8787', OUT = process.env.OUT || 'tests/shots', PASS = process.env.SALES_PASSCODE || 'test-sales';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  for (const [name, vp] of [['phone', { width: 375, height: 800 }], ['desktop', { width: 1280, height: 800 }]]) {
    const c = await b.newContext({ viewport: vp, }); const p = await c.newPage();
    await p.goto(BASE + '/'); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/chat-typing-${name}.png` });
    await p.waitForTimeout(2200); await p.screenshot({ path: `${OUT}/chat-prompt-${name}.png` });
    await p.fill('#pc', 'wrong-one'); await p.press('#pc', 'Enter'); await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/chat-wrong-${name}.png` });
    await p.fill('#pc', PASS); await p.press('#pc', 'Enter'); await p.waitForSelector('.rb', { timeout: 6000 }); await p.screenshot({ path: `${OUT}/chat-choices-${name}.png` });
    await p.goto(BASE + '/sales'); await p.waitForSelector('#slide h1'); await p.screenshot({ path: `${OUT}/deck-${name}.png` });
    await p.keyboard.press('n'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
    await p.screenshot({ path: `${OUT}/deck-table-notes-${name}.png` });
    await c.close();
    // 429 state: its own client ip so the earlier attempts do not count
    const c2 = await b.newContext({ viewport: vp, extraHTTPHeaders: { 'cf-connecting-ip': name === 'phone' ? '9.9.9.1' : '9.9.9.2' } }); const q = await c2.newPage();
    await q.goto(BASE + '/'); await q.waitForSelector('#pc:not([disabled])');
    for (let i = 0; i < 6; i++) { await q.waitForFunction(() => !document.getElementById('pc').disabled || /wait 15 minutes/.test(document.getElementById('log').textContent)); if (await q.$eval('#pc', (e) => e.disabled)) break; await q.fill('#pc', 'nope' + i); await q.press('#pc', 'Enter'); await q.waitForTimeout(1300); }
    await q.waitForFunction(() => /wait 15 minutes/.test(document.getElementById('log').textContent), null, { timeout: 8000 }); await q.screenshot({ path: `${OUT}/chat-429-${name}.png` });
    await c2.close();
  }
  await b.close(); console.log('shots in ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
