// Diagnostic (not a gate): devtools timeline trace of one keystroke into the Home composer, 4x CPU.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (let run = 0; run < 3; run++) {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('omni-demo-persona', 'maya@example.com'); } catch { /* */ } });
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => /\/w\/[^/]+\/home/.test(location.pathname));
  await sleep(2500);
  const cdp = await p.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.click('#composer'); await sleep(450);
  const path = `gates/out/trace-${run}.json`;
  await p.tracing.start({ path, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu'] });
  await p.keyboard.type('a'); await sleep(900);
  await p.tracing.stop();
  const ev = JSON.parse(readFileSync(path, 'utf8')).traceEvents;
  const keyup = ev.find((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'keyup');
  const t0 = keyup?.ts ?? ev[0].ts;
  const agg = new Map();
  for (const e of ev) if (e.ph === 'X' && e.ts >= t0 && e.dur > 2000) { const k = e.name; agg.set(k, (agg.get(k) ?? 0) + e.dur); }
  const top = [...agg].sort((a, c) => c[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${(v / 1000).toFixed(0)}ms`);
  const frames = ev.filter((e) => /DrawFrame|PipelineReporter|Commit/.test(e.name) && e.ts >= t0).slice(0, 6).map((e) => `${e.name}@+${((e.ts - t0) / 1000).toFixed(0)}`);
  console.log(`run ${run}: keyup ${keyup ? 'found' : 'missing'} | ${top.join(', ')}\n   ${frames.join(' ')}`);
  await ctx.close();
}
await b.close();
