// Diagnostic (not a gate): profiles the first keystroke into the Home composer on a 4x CPU, several fresh runs.
//   node gates/diag-type.mjs <base-url>
import puppeteer from 'puppeteer-core';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const CSS = process.argv[3] ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (let run = 0; run < 3; run++) {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => {
    try { localStorage.setItem('omni-demo-persona', 'maya@example.com'); } catch { /* */ }
    window.__ev = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push([e.name, Math.round(e.duration), Math.round(e.processingStart - e.startTime), Math.round(e.processingEnd - e.processingStart)]); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => /\/w\/[^/]+\/home/.test(location.pathname));
  if (CSS) await p.addStyleTag({ content: CSS });
  await sleep(2500);
  const cdp = await p.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const MODE = process.argv[4] ?? 'type';
  if (MODE === 'type') { await p.click('#composer'); await sleep(450); }
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  await p.evaluate(() => { window.__ev = []; });
  if (MODE === 'type') await p.keyboard.type('a'); else { await p.keyboard.down('Control'); await p.keyboard.press('k'); await p.keyboard.up('Control'); }
  await sleep(900);
  const { profile } = await cdp.send('Profiler.stop');
  const ev = await p.evaluate(() => window.__ev);
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((s, i) => { const f = byId.get(s).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0)); });
  const top = [...self].filter(([k]) => !/\(idle\)/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`);
  console.log(`run ${run}: events ${JSON.stringify(ev)}\n   ${top.join('\n   ')}`);
  await ctx.close();
}
await b.close();
