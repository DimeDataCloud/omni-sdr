// Diagnostic (not a gate): Event Timing for one keystroke into a bare textarea on an empty page, 4x CPU.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (let run = 0; run < 5; run++) {
  const p = await b.newPage();
  await p.setContent('<textarea id=t></textarea><script>window.__ev=[];new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.interactionId)window.__ev.push([e.name,Math.round(e.duration)])}).observe({type:"event",durationThreshold:16,buffered:true})</script>');
  const cdp = await p.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.click('#t'); await sleep(450); await p.evaluate(() => { window.__ev = []; });
  await p.keyboard.type('a'); await sleep(900);
  console.log(`bare textarea run ${run}:`, JSON.stringify(await p.evaluate(() => window.__ev)));
  await p.close();
}
await b.close();
