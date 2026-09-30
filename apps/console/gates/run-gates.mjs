// The suite's quality gates. Every gate prints its denominator, so a pass over nothing can't look green.
//   node gates/run-gates.mjs            all gates against a fresh production build (vite preview)
//   node gates/run-gates.mjs --url=https://…   browser gates against a deployed copy (needs a session cookie via OMNI_SESSION)
// Exit code 1 if any gate fails. Screenshots land in gates/out/ for the visual review pass.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'gates', 'out');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const REMOTE = arg('url');
const ONLY = arg('only'); // e.g. --only=static,axe
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch { return false; } });

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
if (!REMOTE && (want('bundle') || want('browser'))) {
  await new Promise((res, rej) => { const p = spawn('npx', ['vite', 'build'], { cwd: ROOT, shell: true, stdio: 'ignore' }); p.on('exit', (c) => (c ? rej(new Error('build failed')) : res())); });
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  const gz = initial.reduce((s, f) => s + gzipSync(readFileSync(join(ROOT, 'dist', f))).length, 0);
  const secretish = walk(join(ROOT, 'dist')).filter((f) => /\.(js|html|css)$/.test(f)).filter((f) => /PASSWORD_HASH|SESSION_SECRET|BEGIN PRIVATE KEY|sk_live_|AIza[0-9A-Za-z_-]{20}/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
  gate(`initial JS ≤ 260 KB gzip (is ${(gz / 1024).toFixed(1)} KB)`, gz > 260 * 1024 ? [`${(gz / 1024).toFixed(1)} KB`] : [], initial.length);
  gate('no secrets in the bundle', secretish, walk(join(ROOT, 'dist')).length);
  if (want('browser')) {
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    BASE = 'http://127.0.0.1:4173';
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(BASE)).ok; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    if (!up) throw new Error(`preview server never answered at ${BASE}`);
  }
}

// ── Browser gates ─────────────────────────────────────────────────────────────────────────────
const PERSONAS = {
  admin: { email: 'maya@example.com', pages: ['home', 'approvals', 'inbox', 'meetings', 'leads', 'analytics', 'studio', 'connections', 'settings'] },
  operator: { email: 'sam@example.com', pages: ['home', 'approvals', 'inbox', 'meetings', 'leads', 'analytics', 'studio', 'connections', 'settings'] },
  reviewer: { email: 'riley@example.com', pages: ['home', 'approvals', 'inbox', 'meetings', 'analytics', 'studio', 'connections', 'settings'] },
  client: { email: 'client@example.com', pages: ['approvals', 'meetings', 'analytics'] },
};
const ALL = ['home', 'approvals', 'inbox', 'meetings', 'leads', 'analytics', 'studio', 'connections', 'settings'];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const FORBIDDEN = [/open rate/i, /\bopened\b/i, /SOC ?2/i, /send now/i, /auto-?send/i, /coming soon/i, /send via gmail/i, /AI-verified/i, /\bsupercharge/i, /\bseamless/i];

const wantRoutes = !ONLY || want('browser') || want('routes');
const wantFlows = !ONLY || want('browser') || want('flows');
if ((wantRoutes || wantFlows) && BASE) {
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
            const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
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
    await step('inbox: book from a meeting request ends up in Meetings', async () => {
      await page.goto(`${BASE}/w/${ws}/inbox`); await settle(page);
      await page.evaluate(() => [...document.querySelectorAll('article button')].find((b) => /^Book/.test(b.textContent.trim())).click());
      await page.waitForSelector('[role=dialog]');
      await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => /Book meeting/.test(b.textContent)).click());
      await settle(page);
      await page.goto(`${BASE}/w/${ws}/meetings`); await settle(page);
      if (!/Lena Ortiz/.test(await page.evaluate(() => document.body.innerText))) throw new Error('booked meeting not listed');
    });
    await step('palette: Ctrl K opens and jumps', async () => {
      await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
      await page.waitForSelector('[cmdk-input]', { timeout: 3000 });
      await page.type('[cmdk-input]', 'Analytics'); await page.keyboard.press('Enter'); await settle(page);
      if (!/\/analytics$/.test(page.url())) throw new Error(`landed on ${page.url()}`);
    });
    await step('g i jumps to Inbox', async () => { await page.keyboard.press('g'); await page.keyboard.press('i'); await settle(page); if (!/\/inbox$/.test(page.url())) throw new Error(page.url()); });
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
    const { ctx, page } = await open('reviewer', 'light', 'desktop');
    await page.goto(`${BASE}/`); await page.waitForFunction(() => /\/w\/[^/]+\/home/.test(location.pathname)); await settle(page);
    await step('reviewer has no composer', async () => { if (await page.$('#composer')) throw new Error('composer shown to a reviewer'); });
    await ctx.close();
  }
  gate('flows: keyboard approvals, gate on edit, chat, booking, palette, hold', flow, flowSteps);
  await browser.close();
}
if (server) { server.kill(); spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], { shell: true, stdio: 'ignore' }); }

writeFileSync(join(ROOT, 'gates', 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE ?? null, results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed${failed.length ? `; failing: ${failed.map((f) => f.name).join(' | ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
