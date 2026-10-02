// The suite's quality gates. Every gate prints its denominator, so a pass over nothing can't look green.
//   node gates/run-gates.mjs            all gates against a fresh production build (vite preview)
//   node gates/run-gates.mjs --url=https://…   browser gates against a deployed copy (needs a session cookie via OMNI_SESSION)
//   --only=quality (or idle,motion,fonts,inp,tabwalk,visual) runs the Phase 0 quality gates; --update-baselines rewrites the visual baselines
// Exit code 1 if any gate fails. Screenshots land in gates/out/ for the visual review pass.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import { runQuality } from './quality.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'gates', 'out');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const REMOTE = arg('url');
const ONLY = arg('only'); // e.g. --only=static,axe
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => { try { return p && statSync(p).isFile(); } catch { return false; } });

const results = [];
function gate(name, failures, denominator, notes = []) {
  const ok = failures.length === 0 && denominator > 0;
  results.push({ name, ok, failures, denominator, notes });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${denominator} checked${failures.length ? `, ${failures.length} failed` : ''})`);
  for (const f of failures.slice(0, 25)) console.log(`        - ${f}`);
  if (failures.length > 25) console.log(`        … ${failures.length - 25} more`);
  for (const n of notes) console.log(`        note: ${n}`);
}
const want = (g) => !ONLY || ONLY.split(',').includes(g);
const QUALITY = ['idle', 'motion', 'fonts', 'inp', 'tabwalk', 'visual'];
const wantQ = (g) => !ONLY || ONLY.split(',').some((x) => x === g || x === 'quality');
const wantQuality = QUALITY.some(wantQ);
const wantRoutes = !ONLY || want('browser') || want('routes');
const wantFlows = !ONLY || want('browser') || want('flows');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

// ── Static gates ──────────────────────────────────────────────────────────────────────────────
if (want('static') && !REMOTE) {
  const src = walk(join(ROOT, 'src')).filter((f) => /\.(tsx?|css)$/.test(f));
  const code = src.filter((f) => !/styles[\\/]tokens\.css$|styles[\\/]app\.css$/.test(f));
  // Tokens only: no raw hex outside the token files (meta theme-color in theme.ts is the one place CSS vars can't reach).
  const hex = [];
  for (const f of code) {
    if (/lib[\\/]theme\.ts$/.test(f)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/#[0-9a-fA-F]{3,8}\b/.test(l.replace(/\/\/.*$/, '')) && !/href=|`#\$\{|'#'/.test(l)) hex.push(`${relative(ROOT, f)}:${i + 1}`); });
  }
  gate('tokens only (no raw hex in components)', hex, code.length);
  // No Tailwind default palette: color comes from tokens.
  const PAL = /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/;
  const pal = [];
  for (const f of code.filter((x) => x.endsWith('.tsx'))) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { const m = l.match(PAL); if (m) pal.push(`${relative(ROOT, f)}:${i + 1} ${m[0]}`); });
  gate('no default Tailwind palette classes', pal, code.filter((x) => x.endsWith('.tsx')).length);
  // Untrusted text is never HTML.
  const html = code.filter((f) => /dangerouslySetInnerHTML|innerHTML\s*=/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
  gate('no HTML injection sinks', html, code.length);
}

// ── Build + bundle budget ─────────────────────────────────────────────────────────────────────
let server;
let BASE = REMOTE;
if (!REMOTE && (want('bundle') || wantRoutes || wantFlows || wantQuality)) {
  await new Promise((res, rej) => { const p = spawn('npx', ['vite', 'build'], { cwd: ROOT, shell: true, stdio: 'ignore' }); p.on('exit', (c) => (c ? rej(new Error('build failed')) : res())); });
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  const gz = initial.reduce((s, f) => s + gzipSync(readFileSync(join(ROOT, 'dist', f))).length, 0);
  const secretish = walk(join(ROOT, 'dist')).filter((f) => /\.(js|html|css)$/.test(f)).filter((f) => /PASSWORD_HASH|SESSION_SECRET|BEGIN PRIVATE KEY|sk_live_|AIza[0-9A-Za-z_-]{20}/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
  gate(`initial JS ≤ 260 KB gzip (is ${(gz / 1024).toFixed(1)} KB)`, gz > 260 * 1024 ? [`${(gz / 1024).toFixed(1)} KB`] : [], initial.length);
  gate('no secrets in the bundle', secretish, walk(join(ROOT, 'dist')).length);
  // The minifier once merged backdrop-filter into -webkit-backdrop-filter only, so no glass surface ever blurred in
  // Chrome (found 2026-09-30). Every rule that asks for a backdrop blur must keep the unprefixed property.
  const css = walk(join(ROOT, 'dist')).filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const blurRules = [...css.matchAll(/([^{}]+)\{([^{}]*-webkit-backdrop-filter:[^{}]*)\}/g)];
  gate('backdrop blur keeps the unprefixed property after minify', blurRules.filter((m) => !/(^|;)backdrop-filter:/.test(m[2])).map((m) => m[1].trim().slice(0, 60)), blurRules.length);
  if (wantRoutes || wantFlows || wantQuality) {
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    BASE = 'http://127.0.0.1:4173';
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(BASE)).ok; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    if (!up) throw new Error(`preview server never answered at ${BASE}`);
  }
}

// ── Browser gates ─────────────────────────────────────────────────────────────────────────────
const PERSONAS = {
  admin: { email: 'maya@example.com', pages: ['home', 'approvals', 'inbox', 'meetings', 'leads', 'analytics', 'studio', 'agents', 'data', 'connections', 'settings'] },
  operator: { email: 'sam@example.com', pages: ['home', 'approvals', 'inbox', 'meetings', 'leads', 'analytics', 'studio', 'agents', 'data', 'connections', 'settings'] },
  reviewer: { email: 'riley@example.com', pages: ['home', 'approvals', 'inbox', 'meetings', 'analytics', 'studio', 'agents', 'data', 'connections', 'settings'] },
  client: { email: 'client@example.com', pages: ['approvals', 'meetings', 'analytics'] },
};
const ALL = ['home', 'approvals', 'inbox', 'meetings', 'leads', 'analytics', 'studio', 'agents', 'data', 'connections', 'settings'];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const FORBIDDEN = [/open rate/i, /\bopened\b/i, /SOC ?2/i, /send now/i, /auto-?send/i, /coming soon/i, /send via gmail/i, /AI-verified/i, /\bsupercharge/i, /\bseamless/i];

if ((wantRoutes || wantFlows || wantQuality) && BASE) {
  if (!CHROME) throw new Error('No Chrome or Edge found for the browser gates');
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'] });
  const axeSrc = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
  const axeFails = []; const consoleFails = []; const termFails = []; const overflowFails = []; const roleFails = []; const brandFails = []; const targetFails = [];
  let pagesChecked = 0; let roleChecks = 0;

  async function open(persona, theme, vp) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(VIEWPORTS[vp]);
    if (process.env.OMNI_SESSION && REMOTE) await page.setCookie({ name: '__Host-omni_session', value: process.env.OMNI_SESSION, url: REMOTE, path: '/', secure: true, httpOnly: true, sameSite: 'Strict' });
    await page.evaluateOnNewDocument((email, t) => { try { localStorage.setItem('omni-demo-persona', email); localStorage.setItem('omni-theme', t); } catch { /* */ } }, PERSONAS[persona].email, theme);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    return { ctx, page, errors };
  }
  const settle = (page) => page.waitForNetworkIdle({ idleTime: 400, timeout: 15000 }).catch(() => {}).then(() => new Promise((r) => setTimeout(r, 900)));

  if (wantRoutes) await Promise.all(Object.entries(PERSONAS).map(async ([persona, def]) => {
    for (const theme of ['light', 'dark']) {
      for (const vp of Object.keys(VIEWPORTS)) {
        const { ctx, page, errors } = await open(persona, theme, vp);
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => /\/w\/[^/]+\/\w+/.test(location.pathname), { timeout: 15000 });
        const ws = new URL(page.url()).pathname.split('/')[2];
        for (const route of ALL) {
          await page.goto(`${BASE}/w/${ws}/${route}`, { waitUntil: 'domcontentloaded' });
          await settle(page);
          const visible = def.pages.includes(route);
          const text = await page.evaluate(() => document.body.innerText);
          const denied = /You don't have access/.test(text);
          roleChecks++;
          if (visible === denied) roleFails.push(`${persona} ${route}: expected ${visible ? 'access' : 'no access'}`);
          if (!visible) continue;
          pagesChecked++;
          const tag = `${persona}/${route}/${theme}/${vp}`;
          await page.screenshot({ path: join(OUT, `${persona}-${route}-${theme}-${vp}.png`), fullPage: vp === 'desktop' ? false : true });
          await page.evaluate(axeSrc);
          const ax = await page.evaluate(async () => {
            const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
            return r.violations.map((v) => `${v.id} ×${v.nodes.length}: ${v.nodes[0]?.target?.join(' ')} ${v.nodes[0]?.failureSummary?.split('\n')[1]?.trim() ?? ''}`);
          });
          for (const v of ax) axeFails.push(`${tag} ${v}`);
          for (const re of FORBIDDEN) if (re.test(text)) termFails.push(`${tag} "${text.match(re)[0]}"`);
          if (persona === 'client' && /Omni-SDR/.test(text + (await page.title()))) brandFails.push(`${tag} shows "Omni-SDR"`);
          if (vp === 'phone') {
            // clientWidth, not innerWidth: mobile emulation widens innerWidth to fit content that overflows, which hid a 87px overflow.
            const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            if (o > 1) overflowFails.push(`${tag} scrolls sideways by ${o}px`);
            const small = await page.evaluate(() => [...document.querySelectorAll('button, [role=tab], input:not([type=hidden]), select, a[href]')].map((e) => (e.tagName === 'INPUT' && e.closest('label')) || e)
              .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width && r.height && cs.visibility !== 'hidden' && !e.closest('.sr-only') && !(e.tagName === 'A' && cs.display === 'inline'); })
              .filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; })
              .map((e) => `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`));
            for (const s of small) targetFails.push(`${tag} ${s}`);
          }
        }
        for (const e of errors) consoleFails.push(`${persona}/${theme}/${vp}: ${e.slice(0, 200)}`);
        await ctx.close();
      }
    }
  }));
  if (wantRoutes) {
  gate('role visibility matches the permission matrix', roleFails, roleChecks);
  gate('axe: WCAG 2.2 AA, 0 violations', [...new Set(axeFails)], pagesChecked);
  gate('no console errors', [...new Set(consoleFails)], pagesChecked);
  gate('forbidden terms absent from rendered text', termFails, pagesChecked * FORBIDDEN.length);
  gate('client views are white-label', brandFails, pagesChecked);
  gate('phone: no sideways scroll', overflowFails, pagesChecked / 2);
  gate('phone: targets ≥ 24px (WCAG 2.5.8)', [...new Set(targetFails)], pagesChecked / 2);
  }

  // ── Flows ──
  if (wantFlows) {
  const flow = [];
  let flowSteps = 0;
  const step = async (name, fn) => { flowSteps++; try { await fn(); } catch (e) { flow.push(`${name}: ${e.message.split('\n')[0]}`); } };
  {
    const { ctx, page, errors } = await open('admin', 'light', 'desktop');
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /\/w\/[^/]+\/home/.test(location.pathname));
    const ws = new URL(page.url()).pathname.split('/')[2];
    const reviewCount = () => page.evaluate(() => Number([...document.querySelectorAll('[role=tab]')].find((t) => /In review/.test(t.textContent))?.textContent.match(/\d+/)?.[0] ?? -1));
    await step('approvals: A approves the open card', async () => {
      await page.goto(`${BASE}/w/${ws}/approvals`); await settle(page);
      const before = await reviewCount();
      if (before < 2) throw new Error(`only ${before} in review`);
      // Record every toast as it appears: a slow network settle can outlive the toast itself.
      await page.evaluate(() => { window.__toasts = []; new MutationObserver(() => document.querySelectorAll('[data-sonner-toast]').forEach((t) => window.__toasts.push(t.textContent))).observe(document.body, { subtree: true, childList: true, characterData: true }); });
      await page.keyboard.press('a'); await settle(page);
      const after = await reviewCount();
      if (after !== before - 1) throw new Error(`count ${before} → ${after}`);
      if (!/Approved\. It sends in the next window|Approved step \d+\. Now step \d+\./.test(await page.evaluate(() => window.__toasts.join(' ')))) throw new Error('no confirmation toast');
    });
    await step('approvals: Z undoes an approval; a kept one commits when the window closes', async () => {
      const start = await reviewCount();
      await page.keyboard.press('a'); await new Promise((r) => setTimeout(r, 400));
      const before = await reviewCount();
      if (before !== start - 1) throw new Error(`approve: count ${start} → ${before} (not in the same frame)`);
      await page.keyboard.press('z'); await new Promise((r) => setTimeout(r, 400));
      if (await reviewCount() !== start) throw new Error(`undo: count ${before} → ${await reviewCount()}`);
      if (!/Undone\. Nothing was sent\./.test(await page.evaluate(() => window.__toasts.join(' ')))) throw new Error('no undo confirmation');
      await page.keyboard.press('a'); await new Promise((r) => setTimeout(r, 400));
      if (await reviewCount() !== before) throw new Error(`re-approve: count ${start} → ${await reviewCount()}`);
      await new Promise((r) => setTimeout(r, 7000)); // past the 6 s undo window: the approval reaches the store
      await page.goto(`${BASE}/w/${ws}/approvals`); await settle(page);
      if (await reviewCount() !== before) throw new Error(`after reload the count is ${await reviewCount()}, expected ${before} (approval never committed)`);
      await page.evaluate(() => { window.__toasts = []; new MutationObserver(() => document.querySelectorAll('[data-sonner-toast]').forEach((t) => window.__toasts.push(t.textContent))).observe(document.body, { subtree: true, childList: true, characterData: true }); });
    });
    await step('focus: J lands on the next draft\'s name; A keeps focus in a card, never on <body>', async () => {
      await page.keyboard.press('j'); await new Promise((r) => setTimeout(r, 500));
      const f = await page.evaluate(() => { const a = document.activeElement; const card = a?.closest('article'); return { tag: a?.tagName, text: a?.textContent, label: card?.getAttribute('aria-label') }; });
      if (f.tag !== 'H2' || !f.label || f.label !== `Draft to ${f.text}`) throw new Error(`focus on ${f.tag} "${f.text}" in "${f.label}"`);
      await page.keyboard.press('a'); await new Promise((r) => setTimeout(r, 500));
      const g = await page.evaluate(() => ({ tag: document.activeElement?.tagName, inCard: Boolean(document.activeElement?.closest('article')) }));
      if (!g.inCard) throw new Error(`after approve, focus is on ${g.tag}`);
      await page.keyboard.press('z'); await new Promise((r) => setTimeout(r, 400));
    });
    await step('palette + ? sheet: both list this draft\'s actions from one registry, and the palette runs them', async () => {
      const start = await reviewCount();
      await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
      await page.waitForSelector('[cmdk-input]', { timeout: 3000 });
      const groups = await page.evaluate(() => [...document.querySelectorAll('[cmdk-group]')].map((g) => g.querySelector('[cmdk-group-heading]')?.textContent));
      if (groups[0] !== 'This page') throw new Error(`first group is "${groups[0]}"`);
      await page.type('[cmdk-input]', 'approve the draft'); await page.keyboard.press('Enter'); await new Promise((r) => setTimeout(r, 500));
      if (await reviewCount() !== start - 1) throw new Error(`palette approve: count ${start} → ${await reviewCount()}`);
      await page.keyboard.press('z'); await new Promise((r) => setTimeout(r, 400));
      if (await reviewCount() !== start) throw new Error(`undo after palette approve: ${await reviewCount()}`);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('?'); await page.waitForSelector('[role=dialog]', { timeout: 3000 });
      const sheet = await page.$eval('[role=dialog]', (d) => d.textContent); // textContent: .label upper-cases what innerText returns
      if (!/On this page/.test(sheet) || !/Approve the draft to/.test(sheet) || sheet.indexOf('On this page') > sheet.indexOf('Everywhere')) throw new Error('? sheet does not lead with this page\'s keys');
      await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 300));
    });
    await step('approvals: D opens the reject sheet, Esc closes it', async () => {
      await page.keyboard.press('d'); await page.waitForSelector('[role=dialog]', { timeout: 3000 });
      if (!/Reject this draft/.test(await page.$eval('[role=dialog]', (d) => d.textContent))) throw new Error('wrong dialog');
      await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 400));
      if (await page.$('[role=dialog]')) throw new Error('dialog stayed open');
    });
    await step('approvals: E edits, save re-runs the gate and blocks an unsupported number', async () => {
      await page.keyboard.press('e'); await page.waitForSelector('textarea', { timeout: 3000 });
      await page.$eval('textarea', (t) => t.focus());
      await page.keyboard.press('End'); await page.keyboard.type(' We doubled bookings for 40 practices.');
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Save and re-check/.test(b.textContent)).click());
      await settle(page);
      const t = await page.evaluate(() => document.body.innerText);
      if (!/Blocked by the claims gate/.test(t) || !/tab=blocked/.test(page.url())) throw new Error('edit was not re-gated into Blocked');
    });
    await step('approvals: blocked drafts have no Approve button', async () => {
      await page.goto(`${BASE}/w/${ws}/approvals?tab=blocked`); await settle(page);
      const n = await page.evaluate(() => document.querySelectorAll('article').length);
      if (!n) throw new Error('no blocked card rendered');
      if (await page.evaluate(() => [...document.querySelectorAll('article button')].some((b) => /^Approve/.test(b.textContent.trim())))) throw new Error('Approve shown on a blocked draft');
    });
    await step('home: asking an agent gets a data-backed answer', async () => {
      await page.goto(`${BASE}/w/${ws}/home`); await settle(page);
      await page.type('#composer', 'What needs me today?'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => /most urgent first/.test(document.querySelector('[role=log]')?.innerText ?? ''), { timeout: 8000 });
    });
    // Phase 3: Home's agent core, briefing, composer and "Ask about this".
    await step('home: the agent core has 6 stage arcs and one tick per send in the day\'s budget', async () => {
      await page.goto(`${BASE}/w/${ws}/home`); await settle(page);
      const r = await page.evaluate(() => ({ arcs: document.querySelectorAll('.ring-fill').length, ticks: document.querySelectorAll('.ring-tick').length,
        label: document.querySelector('svg[role=img][aria-label^="Today:"]')?.getAttribute('aria-label') ?? '' }));
      const cap = Number(r.label.match(/of (\d+) sends/)?.[1] ?? -1);
      if (r.arcs !== 6) throw new Error(`${r.arcs} stage arcs`);
      if (cap <= 0 || cap > 120 || r.ticks !== cap) throw new Error(`${r.ticks} ticks for a budget of ${cap}`);
    });
    await step('home: the briefing\'s lead count opens a list with exactly that many rows', async () => {
      const text = await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby=brief-h] a')].find((a) => /new lead/.test(a.textContent))?.textContent ?? '');
      const n = Number(text.match(/\d+/)?.[0] ?? 0);
      if (!n) throw new Error('the briefing lists no new leads');
      await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby=brief-h] a')].find((a) => /new lead/.test(a.textContent)).click());
      await settle(page);
      if (!/\/leads\?since=/.test(page.url())) throw new Error(`landed on ${page.url()}`);
      const rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
      if (rows !== n) throw new Error(`the briefing says ${n}, the list shows ${rows}`);
    });
    await step('home: Tab takes the ghost suggestion, and Report mode answers with the numbers', async () => {
      await page.goto(`${BASE}/w/${ws}/home`); await settle(page);
      await page.focus('#composer'); await page.keyboard.press('Tab');
      const s = await page.$eval('#composer', (t) => ({ v: t.value, p: t.placeholder }));
      if (!s.p || s.v !== s.p) throw new Error(`composer holds "${s.v}", the suggestion was "${s.p}"`);
      await page.click('[role=radio][title="Report"]');
      await page.$eval('#composer', (t) => { t.focus(); t.select(); });
      await page.keyboard.type('Anything new?'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => /Last 30 days: \d+ sent/.test(document.querySelector('[role=log]')?.innerText ?? ''), { timeout: 8000 });
    });
    await step('ask about this: Q on a draft attaches it on Home; the answer is about that draft', async () => {
      await page.goto(`${BASE}/w/${ws}/approvals`); await settle(page);
      const name = await page.$eval('article[aria-label^="Draft to"] h2', (h) => h.textContent);
      await page.keyboard.press('q'); await settle(page);
      if (!/\/home$/.test(new URL(page.url()).pathname)) throw new Error(`Q landed on ${page.url()}`);
      if (!(await page.$eval('form', (f) => f.textContent)).includes(name)) throw new Error(`no chip for ${name} in the composer`);
      if (await page.evaluate(() => document.activeElement?.id) !== 'composer') throw new Error('focus is not in the composer');
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
      await page.waitForFunction((n) => (document.querySelector('[role=log]')?.innerText ?? '').includes(`draft to ${n}`), { timeout: 8000 }, name);
    });
    await step('home: dismissing the briefing holds after a reload', async () => {
      await page.goto(`${BASE}/w/${ws}/home`); await settle(page);
      await page.click('button[aria-label="Dismiss until tomorrow"]');
      await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page);
      if (await page.$('#brief-h')) throw new Error('the briefing came back');
    });
    await step('inbox: book from a meeting request ends up in Meetings', async () => {
      await page.goto(`${BASE}/w/${ws}/inbox`); await settle(page);
      await page.evaluate(() => [...document.querySelectorAll('article button')].find((b) => /^Book/.test(b.textContent.trim())).click());
      await page.waitForSelector('[role=dialog]');
      await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => /Book meeting/.test(b.textContent)).click());
      await settle(page);
      await page.goto(`${BASE}/w/${ws}/meetings`); await settle(page);
      if (!/Lena Ortiz/.test(await page.evaluate(() => document.body.innerText))) throw new Error('booked meeting not listed');
    });
    await step('leads: Shift-click selects a range, the bulk bar counts it, Esc clears', async () => {
      await page.goto(`${BASE}/w/${ws}/leads`); await settle(page);
      const boxes = await page.$$('tbody input[type=checkbox]');
      if (boxes.length < 4) throw new Error(`${boxes.length} rows`);
      await boxes[0].click();
      await page.keyboard.down('Shift'); await boxes[3].click(); await page.keyboard.up('Shift');
      const bar = await page.$eval('[role=region][aria-label="Bulk actions"]', (e) => e.textContent).catch(() => '');
      if (!/4 selected/.test(bar)) throw new Error(`bulk bar says "${bar}"`);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 300));
      if (await page.$('[role=region][aria-label="Bulk actions"]')) throw new Error('Esc did not clear the selection');
    });
    await step('palette: Ctrl K opens and jumps', async () => {
      await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
      await page.waitForSelector('[cmdk-input]', { timeout: 3000 });
      await page.type('[cmdk-input]', 'Analytics'); await page.keyboard.press('Enter'); await settle(page);
      if (!/\/analytics$/.test(page.url())) throw new Error(`landed on ${page.url()}`);
    });
    await step('g i jumps to Inbox', async () => { await page.keyboard.press('g'); await page.keyboard.press('i'); await settle(page); if (!/\/inbox$/.test(page.url())) throw new Error(page.url()); });
    await step('focus: a route change lands on the page title', async () => {
      const f = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent }));
      if (f.tag !== 'H1' || f.text !== 'Inbox') throw new Error(`focus on ${f.tag} "${f.text}"`);
    });
    await step('inbox: J past the last reply bumps the open row instead of doing nothing', async () => {
      const n = await page.evaluate(() => document.querySelectorAll('[data-kbd-list] > li').length);
      if (n < 1) throw new Error('no replies listed');
      for (let i = 0; i < n - 1; i++) { await page.keyboard.press('j'); await new Promise((r) => setTimeout(r, 300)); }
      await page.keyboard.press('j');
      const bumped = await page.evaluate(() => document.querySelector('[data-kbd-list] [data-bump="down"] [aria-current="true"]') !== null);
      if (!bumped) throw new Error(`J on reply ${n} of ${n} changed nothing on screen`);
    });
    await step('palette: "Ask an agent" fills the composer and sends nothing', async () => {
      const ask = 'Summarize replies from this week';
      await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
      await page.waitForSelector('[cmdk-input]', { timeout: 3000 });
      await page.type('[cmdk-input]', ask);
      await page.waitForFunction((t) => [...document.querySelectorAll('[cmdk-item]')].some((i) => i.textContent.startsWith('Ask ') && i.textContent.includes(t)), { timeout: 3000 }, ask);
      await page.evaluate((t) => [...document.querySelectorAll('[cmdk-item]')].find((i) => i.textContent.startsWith('Ask ') && i.textContent.includes(t)).click(), ask);
      await settle(page);
      if (!/\/home\?agent=/.test(page.url())) throw new Error(`landed on ${page.url()}`);
      const s = await page.evaluate(() => ({ v: document.querySelector('#composer')?.value, focused: document.activeElement?.id, log: document.querySelector('[role=log]')?.innerText ?? '' }));
      if (s.v !== ask) throw new Error(`composer holds "${s.v}"`);
      if (s.focused !== 'composer') throw new Error(`focus on #${s.focused}`);
      if (s.log.includes(ask)) throw new Error('the question was sent without the person pressing Ask');
    });
    await step('pause all sending shows the hold banner', async () => {
      await page.goto(`${BASE}/w/${ws}/home`); await settle(page);
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Pause all sending/.test(b.textContent)).click());
      await page.waitForSelector('[role=dialog]');
      await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => /Pause sending/.test(b.textContent)).click());
      await settle(page);
      if (!/Sending is paused for this workspace/.test(await page.evaluate(() => document.body.innerText))) throw new Error('no hold banner');
    });
    for (const e of errors) flow.push(`console: ${e.slice(0, 200)}`);
    await ctx.close();
  }
  // The real front door: a browser with no cookie types into the sign-in form (the cookie-injected runs above skip it).
  if (REMOTE && process.env.OMNI_EMAIL && process.env.OMNI_PASSWORD) {
    for (const vp of Object.keys(VIEWPORTS)) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport(VIEWPORTS[vp]);
      await step(`sign in through the form (${vp})`, async () => {
        await page.goto(`${REMOTE}/`, { waitUntil: 'domcontentloaded' });
        if (!/\/auth\/login/.test(page.url())) throw new Error(`not sent to sign-in: ${page.url()}`);
        await page.type('#email', process.env.OMNI_EMAIL);
        await page.type('#password', process.env.OMNI_PASSWORD);
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type=submit]')]);
        await page.waitForFunction(() => /\/w\/[^/]+\/\w+/.test(location.pathname), { timeout: 15000 });
        const text = await page.evaluate(() => document.body.innerText);
        if (/refused|Forbidden/i.test(text)) throw new Error('sign-in refused');
      });
      await ctx.close();
    }
  }
  {
    const { ctx, page } = await open('admin', 'light', 'phone');
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => /\/w\/[^/]+\/home/.test(location.pathname)); await settle(page);
    const ws = new URL(page.url()).pathname.split('/')[2];
    await step('phone: Ask on a reply opens the agent that knows it, with the reply attached', async () => {
      await page.goto(`${BASE}/w/${ws}/inbox`); await settle(page);
      await page.evaluate(() => document.querySelector('[data-kbd-list] li button').click()); await settle(page);
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Ask an agent about the reply/.test(b.getAttribute('aria-label') ?? '')).click());
      await settle(page);
      if (!/\/home\?agent=/.test(page.url())) throw new Error(`landed on ${page.url()}`);
      if (!/the reply from/i.test(await page.$eval('form', (f) => f.textContent))) throw new Error('the reply is not attached');
    });
    await ctx.close();
  }
  // Workspace sections and the Setup harness (WORKSPACE-PLAN.md).
  {
    const { ctx, page, errors } = await open('admin', 'light', 'desktop');
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /\/w\/[^/]+\/\w+/.test(location.pathname), { timeout: 15000 });
    const ws = new URL(page.url()).pathname.split('/')[2];
    const pick = (sel, re) => page.evaluate((s, r) => { const el = [...document.querySelectorAll(s)].find((b) => new RegExp(r).test(b.textContent.trim())); if (!el) throw new Error(`no ${s} matching ${r}`); el.click(); }, sel, re);
    await step('sections: six in the top bar; a section shows its pages as tabs and remembers the last one', async () => {
      await page.goto(`${BASE}/w/${ws}/approvals`); await settle(page);
      const top = await page.$$eval('header nav[aria-label=Main] a', (a) => a.map((x) => x.textContent.replace(/\d+$/, '').trim()));
      if (top.join('|') !== 'Home|Outbound|Inbound|Marketing|Results|Setup') throw new Error(`top bar reads ${top.join(', ')}`);
      const tabs = await page.$$eval('nav[aria-label="Outbound pages"] a', (a) => a.map((x) => x.textContent.replace(/\d+$/, '').trim()));
      if (tabs.join('|') !== 'Approvals|Leads') throw new Error(`Outbound tabs read ${tabs.join(', ')}`);
      await page.click(`nav[aria-label="Outbound pages"] a[href="/w/${ws}/leads"]`); await settle(page);
      await page.click('header nav[aria-label=Main] a[data-section=inbound]'); await settle(page);
      const back = await page.$eval('header nav[aria-label=Main] a[data-section=outbound]', (a) => a.getAttribute('href'));
      if (!back.endsWith('/leads')) throw new Error(`Outbound now links to ${back}, not the last page used`);
    });
    await step('setup: autonomy above "Draft for approval" is locked, with the reason', async () => {
      await page.goto(`${BASE}/w/${ws}/agents`); await settle(page);
      await page.click('ul li button.card'); await page.waitForSelector('[role=dialog]');
      await pick('[role=dialog] [role=tab]', '^Autonomy');
      const r = await page.$$eval('[role=dialog] input[name=autonomy]', (x) => x.map((i) => `${i.value}:${i.disabled ? 'locked' : 'open'}:${i.checked ? 'on' : ''}`));
      if (r.join(',') !== 'suggest:open:,draft:open:on,guardrails:locked:,autopilot:locked:') throw new Error(`autonomy reads ${r.join(',')}`);
      if (!/Needs Trust Level 2/.test(await page.$eval('[role=dialog]', (d) => d.innerText))) throw new Error('no reason shown for the lock');
    });
    let agentName = '';
    await step('setup: data access set on an agent shows up in Data, and in the access matrix', async () => {
      agentName = await page.$eval('[role=dialog] h2', (h) => h.textContent);
      await pick('[role=dialog] [role=tab]', '^Data');
      await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] [role=switch]')].length > 5, { timeout: 5000 });
      const sw = await page.evaluateHandle(() => [...document.querySelectorAll('[role=dialog] li')].find((li) => /^Media library/.test(li.innerText))?.querySelector('[role=switch]'));
      if (await sw.evaluate((b) => b.getAttribute('aria-checked')) === 'true') throw new Error('already reads Media library');
      await sw.click();
      await pick('[role=dialog] button', '^Save$'); await settle(page);
      await page.goto(`${BASE}/w/${ws}/data`); await settle(page);
      const card = await page.evaluate(() => [...document.querySelectorAll('ul li button.card')].find((b) => /^Media library/.test(b.innerText))?.innerText ?? '');
      if (!card.includes(agentName)) throw new Error(`Media library card reads "${card.replace(/\s+/g, ' ')}"`);
      await pick('[role=tab]', '^Access by agent'); await settle(page);
      if (!(await page.$eval(`input[aria-label="${agentName} reads Media library"]`, (i) => i.checked))) throw new Error('the matrix disagrees');
      await page.click(`input[aria-label="${agentName} reads Media library"]`); await settle(page);
      if (await page.$eval(`input[aria-label="${agentName} reads Media library"]`, (i) => i.checked)) throw new Error('unticking in the matrix did not stick');
    });
    await step('setup: an agent\'s performance shows its numbers and the corrections people made', async () => {
      await page.goto(`${BASE}/w/${ws}/agents`); await settle(page);
      await pick('ul li button.card', 'Sales Outbound'); await page.waitForSelector('[role=dialog]');
      await pick('[role=dialog] [role=tab]', '^Performance');
      await page.waitForFunction(() => /Approval rate/.test(document.querySelector('[role=dialog]')?.innerText ?? ''), { timeout: 5000 });
      const t = await page.$eval('[role=dialog]', (d) => d.innerText);
      if (!/Corrections/.test(t)) throw new Error('no corrections section');
    });
    for (const e of errors) flow.push(`console: ${e.slice(0, 200)}`);
    await ctx.close();
  }
  // Studio (STUDIO-PLAN.md): generate → library → edit → review, the flag-off path, and the old agent links.
  {
    const { ctx, page, errors } = await open('admin', 'light', 'desktop');
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /\/w\/[^/]+\/\w+/.test(location.pathname), { timeout: 15000 });
    const ws = new URL(page.url()).pathname.split('/')[2];
    const studioText = () => page.evaluate(() => document.body.innerText);
    const clickText = (sel, re) => page.evaluate((s, r) => { const el = [...document.querySelectorAll(s)].find((b) => new RegExp(r).test(b.textContent.trim())); if (!el) throw new Error(`no ${s} matching ${r}`); el.click(); }, sel, re);
    let made = '';
    await step('studio: a product shot costs what it says, renders, and lands in the Library as a draft', async () => {
      await page.goto(`${BASE}/w/${ws}/studio`); await settle(page);
      const credits = async () => Number((await page.$eval('[aria-label$="media credits left"]', (e) => e.getAttribute('aria-label'))).match(/\d+/)[0]);
      const before = await credits();
      const cost = Number((await studioText()).match(/≈ (\d+) media credits/)[1]);
      await clickText('[role=radiogroup][aria-label="What to make"] [role=radio]', '^Product shot');
      await page.$eval('form[aria-label="Create media"] textarea', (t) => t.focus());
      await page.keyboard.type('Kit on a podium, soft light');
      await clickText('form[aria-label="Create media"] button[type=submit]', '^Generate');
      await page.waitForFunction(() => document.querySelectorAll('[role=status]').length > 0 && /Rendering/.test(document.body.innerText), { timeout: 4000 });
      await page.waitForFunction(() => !/Rendering (image|video)…/.test(document.body.innerText), { timeout: 10000 });
      await settle(page);
      const after = await credits();
      if (before - after !== cost) throw new Error(`charged ${before - after}, the estimate said ${cost}`);
      made = await page.$eval('section[aria-labelledby=results-h] ul li button[aria-label^="Open "]', (b) => b.getAttribute('aria-label').replace(/^Open /, ''));
      if (!/^Kit on a podium/.test(made)) throw new Error(`newest result is "${made}"`);
      await page.goto(`${BASE}/w/${ws}/studio?view=library`); await settle(page);
      const card = await page.evaluate((n) => [...document.querySelectorAll('ul[aria-label=Media] li')].find((li) => li.textContent.includes(n))?.innerText ?? '', made);
      if (!/Draft/.test(card) || !/Demo sample/.test(card)) throw new Error(`library card reads "${card.replace(/\s+/g, ' ')}"`);
    });
    await step('studio: the editor crops to a channel, saves v2 without touching v1, and sends it for review', async () => {
      await page.click(`button[aria-label="Open ${made}"]`); await page.waitForSelector('[role=dialog] [aria-label="Edit panel"]'); await settle(page);
      await clickText('[role=dialog] button[aria-pressed]', '^Vertical 9:16');
      await clickText('[role=dialog] button', '^Save version');
      await page.waitForFunction(() => /v2 of 2/.test(document.querySelector('[role=dialog]')?.innerText ?? ''), { timeout: 5000 });
      await clickText('[role=dialog] [role=tab]', 'Versions');
      const v = await page.$eval('[role=dialog] ol[aria-label^="Versions"]', (o) => o.innerText);
      if (!/v1 · Generated/.test(v) || !/v2 · Cropped to 9:16/.test(v)) throw new Error(`versions read "${v.replace(/\s+/g, ' ')}"`);
      await clickText('[role=dialog] button', '^Send for review');
      await page.waitForFunction(() => /In review/.test(document.querySelector('[role=dialog] header')?.innerText ?? ''), { timeout: 5000 });
    });
    await step('studio: approving needs a review state; a sent-back item carries its note', async () => {
      await clickText('[role=dialog] button', '^Request changes');
      await page.type('[role=dialog] textarea', 'Make the logo bigger.');
      await clickText('[role=dialog] button', '^Send back');
      await page.waitForFunction(() => /Changes requested/.test(document.querySelector('[role=dialog]')?.innerText ?? '') && /Make the logo bigger/.test(document.querySelector('[role=dialog]')?.innerText ?? ''), { timeout: 5000 });
      if (await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].some((b) => b.textContent.trim() === 'Approve'))) throw new Error('Approve offered on an item that is not in review');
      await clickText('[role=dialog] button', '^Send for review');
      await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] button')].some((b) => b.textContent.trim() === 'Approve'), { timeout: 5000 });
      await clickText('[role=dialog] button', '^Approve$');
      await page.waitForFunction(() => /Approved/.test(document.querySelector('[role=dialog] header')?.innerText ?? ''), { timeout: 5000 });
      await page.keyboard.press('Escape'); await settle(page);
    });
    await step('studio: video offers camera moves and a start frame, and charges by length', async () => {
      await page.goto(`${BASE}/w/${ws}/studio`); await settle(page);
      await clickText('[role=radiogroup][aria-label="What to make"] [role=radio]', '^Video');
      const n = await page.$$eval('[role=radiogroup][aria-label="Camera move"] [role=radio]', (x) => x.length);
      if (n !== 10) throw new Error(`${n} camera moves`);
      if (!/Start frame/.test(await studioText())) throw new Error('no start frame picker');
      await clickText('[role=tab]', '^8s');
      if (!/≈ 48 media credits/.test(await studioText())) throw new Error('an 8-second video should estimate 48 credits');
    });
    await step('studio: with generation off, Create offers upload and no Generate button', async () => {
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('omni-demo-world')); s.world.org.featureFlags.imageGeneration = false; s.world.org.featureFlags.videoGeneration = false; localStorage.setItem('omni-demo-world', JSON.stringify(s)); });
      await page.goto(`${BASE}/w/${ws}/studio`); await settle(page);
      const t = await studioText();
      if (!/Generation is off for this workspace/.test(t)) throw new Error('no flag-off notice');
      if (await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^Generate/.test(b.textContent.trim())))) throw new Error('Generate shown with the flags off');
      if (!/Choose files/.test(t)) throw new Error('no upload offered');
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('omni-demo-world')); s.world.org.featureFlags.imageGeneration = true; s.world.org.featureFlags.videoGeneration = true; localStorage.setItem('omni-demo-world', JSON.stringify(s)); });
    });
    await step('studio: a project plays its sequence clip by clip', async () => {
      await page.goto(`${BASE}/w/${ws}/studio?view=projects`); await settle(page);
      await clickText('ul li button', 'Whitening kit launch'); await settle(page);
      await clickText('button', '^Play sequence');
      await page.waitForFunction(() => /Clip 1 of 2/.test(document.body.innerText), { timeout: 3000 });
      await page.waitForFunction(() => /Clip 2 of 2/.test(document.body.innerText), { timeout: 9000 });
      await clickText('button', '^Stop');
    });
    await step('agents: old Studio agent links land on the Agents page', async () => {
      await page.goto(`${BASE}/w/${ws}/studio?tab=routines`); await settle(page);
      if (!/\/agents\?tab=routines$/.test(page.url())) throw new Error(`landed on ${page.url()}`);
      if (!/Morning|routine/i.test(await studioText())) throw new Error('no routines listed');
    });
    for (const e of errors) flow.push(`console: ${e.slice(0, 200)}`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open('reviewer', 'light', 'desktop');
    await page.goto(`${BASE}/`); await page.waitForFunction(() => /\/w\/[^/]+\/home/.test(location.pathname)); await settle(page);
    await step('reviewer has no composer', async () => { if (await page.$('#composer')) throw new Error('composer shown to a reviewer'); });
    await step('reviewer has no Ask buttons (asking an agent is operator work)', async () => {
      await page.goto(page.url().replace(/\/home.*$/, '/approvals')); await settle(page);
      if (await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^Ask an agent/.test(b.getAttribute('aria-label') ?? '')))) throw new Error('Ask shown to a reviewer');
    });
    await step('reviewer: Studio opens on the review queue, with no Generate or Upload', async () => {
      await page.goto(page.url().replace(/\/approvals.*$/, '/studio?view=library')); await settle(page);
      const t = await page.evaluate(() => document.body.innerText);
      if (/Choose files/.test(t) || await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^Generate/.test(b.textContent.trim())))) throw new Error('reviewer can make media');
      if (await page.$eval('[role=tablist][aria-label="Review state"] [aria-selected=true]', (b) => b.textContent).then((x) => !/^In review/.test(x))) throw new Error('library does not open on the review queue');
    });
    await ctx.close();
  }
  gate('flows: keyboard approvals, gate on edit, chat, booking, palette, hold, Home core, Ask about this, Studio, sections and Setup', flow, flowSteps);
  }
  if (wantQuality) await runQuality({ browser, BASE, ROOT, OUT, gate, want: wantQ, open, settle, REMOTE, ALL });
  await browser.close();
}
if (server) { server.kill(); spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], { shell: true, stdio: 'ignore' }); }

writeFileSync(join(ROOT, 'gates', 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE ?? null, results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed${failed.length ? `; failing: ${failed.map((f) => f.name).join(' | ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
