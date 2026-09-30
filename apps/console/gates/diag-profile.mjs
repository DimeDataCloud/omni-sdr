// Diagnostic (not a gate): CPU profile of a client-side navigation, top self-time functions.
//   node gates/diag-profile.mjs <base-url> <route>
import puppeteer from 'puppeteer-core';
const [BASE = 'http://127.0.0.1:4173', ROUTE = 'analytics'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
await p.evaluateOnNewDocument(() => { try { localStorage.setItem('omni-demo-persona', 'maya@example.com'); } catch { /* */ } });
await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => /\/w\/[^/]+\/\w+/.test(location.pathname));
const ws = new URL(p.url()).pathname.split('/')[2];
await sleep(2500);
const cdp = await p.createCDPSession();
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await cdp.send('Profiler.start');
await p.click(`nav[aria-label=Main] a[href="/w/${ws}/${ROUTE}"]`);
await sleep(2000);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas; const samples = profile.samples;
for (let i = 0; i < samples.length; i++) { const n = byId.get(samples[i]); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); }
const top = [...self].filter(([k]) => !/\(idle\)|\(program\)|\(garbage/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [k, us] of top) console.log(`${(us / 1000).toFixed(1).padStart(7)} ms  ${k}`);
console.log('idle/program/gc:', [...self].filter(([k]) => /\(idle\)|\(program\)|\(garbage/.test(k)).map(([k, v]) => `${k.split(' ')[0]} ${(v / 1000).toFixed(0)}ms`).join(', '));
await b.close();
