// Diagnostic (not a gate): replays the INP gate's script and, for every slow interaction, reports whether it changed
// the DOM and whether a long task overlapped it. Tells a slow render apart from a wait for an unrelated frame.
//   node gates/diag-inp.mjs <base-url> [runs]
import puppeteer from 'puppeteer-core';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const RUNS = Number(process.argv[3] ?? 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (let run = 1; run <= RUNS; run++) {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => {
    window.__ev = []; window.__lt = []; window.__mut = [];
    new MutationObserver((m) => { window.__mut.push([performance.now(), m.length]); }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ name: e.name, start: e.startTime, dur: e.duration, ps: e.processingStart, pe: e.processingEnd, path: location.pathname + location.search }); })
      .observe({ type: 'event', durationThreshold: 16, buffered: true });
    try { localStorage.setItem('omni-demo-persona', 'maya@example.com'); } catch { /* */ }
  });
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => /\/w\/[^/]+\/\w+/.test(location.pathname));
  const ws = new URL(p.url()).pathname.split('/')[2];
  await sleep(2500);
  const cdp = await p.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const marks = [];
  const act = async (name, fn) => { marks.push([name, await p.evaluate(() => performance.now())]); await fn(); await sleep(450); };
  const nav = (k) => act(`nav ${k}`, () => p.click(`nav[aria-label=Main] a[href="/w/${ws}/${k}"]`));
  const key = (k) => act(`key ${k}`, () => p.keyboard.press(k));
  await nav('approvals'); await key('j'); await key('j'); await key('k');
  await nav('inbox'); await key('j'); await key('j');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await sleep(500);
  const { ev, lt, mut } = await p.evaluate(() => ({ ev: window.__ev, lt: window.__lt, mut: window.__mut }));
  const rows = ev.filter((e) => e.name === 'keydown' || e.name === 'click' || e.name === 'pointerdown').map((e) => {
    const end = e.start + e.dur;
    const owner = [...marks].reverse().find(([, t]) => t <= e.start)?.[0] ?? '?';
    const muts = mut.filter(([t]) => t >= e.start && t <= end).reduce((a, [, n]) => a + n, 0);
    const firstMut = mut.find(([t]) => t >= e.start && t <= end);
    const longs = lt.filter(([s, d]) => s < end && s + d > e.start).map(([s, d]) => `${Math.round(s - e.start)}+${Math.round(d)}`);
    return `${owner.padEnd(14)} ${e.name.padEnd(11)} ${String(Math.round(e.dur)).padStart(4)} ms  wait ${Math.round(e.ps - e.start)} run ${Math.round(e.pe - e.ps)} paint ${Math.round(end - e.pe)}  mutations ${muts}${firstMut ? ` (first +${Math.round(firstMut[0] - e.start)} ms)` : ''}  long tasks [${longs.join(', ')}]  ${e.path}`;
  });
  console.log(`── run ${run}`); for (const r of rows) console.log(r);
  await ctx.close();
}
await b.close();
