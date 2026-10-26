// Screenshots of the entry (mid-animation), prompt, chooser and deck at phone and desktop width.
// Needs a server with --var SALES_PASSCODE:test-sales. Usage: BASE=... OUT=dir node tests/shots-entry.js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8787', OUT = process.env.OUT || 'tests/shots', PASS = process.env.SALES_PASSCODE || 'test-sales';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  for (const [name, vp] of [['phone', { width: 375, height: 800 }], ['desktop', { width: 1280, height: 800 }]]) {
    const c = await b.newContext({ viewport: vp }); const p = await c.newPage();
    await p.goto(BASE + '/'); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/entry-anim-${name}.png` });
    await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/entry-prompt-${name}.png` });
    await p.fill('#pc', PASS); await Promise.all([p.waitForNavigation(), p.click('#lf button[type=submit]')]);
    await p.waitForSelector('a.choice'); await p.screenshot({ path: `${OUT}/entry-chooser-${name}.png` });
    await p.goto(BASE + '/sales'); await p.waitForSelector('#slide h1'); await p.screenshot({ path: `${OUT}/deck-${name}.png` });
    await p.keyboard.press('n'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
    await p.screenshot({ path: `${OUT}/deck-table-notes-${name}.png` });
    const s = await c.newPage(); await s.goto(BASE + '/'); await s.keyboard.press('x'); await s.waitForTimeout(100); await s.screenshot({ path: `${OUT}/entry-skipped-${name}.png` });
    await c.close();
  }
  await b.close(); console.log('shots in ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
