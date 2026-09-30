// Diagnostic (not a gate): long tasks after client-side navigation to each route on a 4x-throttled CPU.
//   node gates/diag-longtasks.mjs <base-url>
import puppeteer from 'puppeteer-core';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
await p.evaluateOnNewDocument(() => {
  window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  try { localStorage.setItem('omni-demo-persona', 'maya@example.com'); } catch { /* */ }
});
await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => /\/w\/[^/]+\/\w+/.test(location.pathname));
const ws = new URL(p.url()).pathname.split('/')[2];
await sleep(2500);
const cdp = await p.createCDPSession();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
for (const r of ['approvals', 'inbox', 'leads', 'analytics', 'meetings', 'home']) {
  await p.evaluate(() => { window.__lt = []; window.__t0 = performance.now(); });
  await p.click(`nav[aria-label=Main] a[href="/w/${ws}/${r}"]`);
  await sleep(3000);
  const lt = await p.evaluate(() => window.__lt.map(([s, d]) => `+${Math.round(s - window.__t0)}ms:${d}ms`));
  console.log(r.padEnd(10), lt.join('  ') || 'no long tasks');
}
await b.close();
