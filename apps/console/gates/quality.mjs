// Quality gates added by UI-REVISION-PLAN Phase 0. Each one prints its denominator through `gate()`.
//   idle        nothing animates when nothing is happening (rAF callbacks + running animations = 0)
//   motion      under prefers-reduced-motion, nothing moves on entrance and nothing loops
//   fonts       font bytes for a full tour of the app stay inside the budget
//   inp         Interaction to Next Paint over a scripted run on a 4x-throttled CPU
//   tabwalk     every visible control is reachable by Tab and shows a focus ring
//   visual      screenshots match committed baselines (frozen clock, reduced motion); --update-baselines rewrites them
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export const FONT_BUDGET_KB = 120; // measured 2026-09-30: Inter 48 + JetBrains Mono 21 + Instrument Serif 21 + 22 (italic) = 112 KB
export const INP_MAX_MS = 150;
const VR_THRESHOLD = 0.001; // share of pixels allowed to differ
// Tuesday 2026-09-29 14:00 UTC: inside business hours in every seeded timezone, so SLA and meeting copy is stable.
const FROZEN = Date.UTC(2026, 8, 29, 14, 0, 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Counts every requestAnimationFrame callback from the first script on, so a loop that never stops is visible.
function instrument() {
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { window.__raf++; return raf(cb); };
}
function freezeClock(t) {
  const Real = Date;
  class Frozen extends Real { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }
  window.Date = Frozen;
}
const running = () => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.transitionProperty || a.id || 'waapi');

export async function runQuality({ browser, BASE, ROOT, OUT, gate, want, open, settle, REMOTE, ALL }) {
  const updating = process.argv.includes('--update-baselines');
  const firstWs = async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /\/w\/[^/]+\/\w+/.test(location.pathname), { timeout: 15000 });
    return new URL(page.url()).pathname.split('/')[2];
  };
  // Waits until requestAnimationFrame goes quiet (entrances finish), up to `max` ms. Returns false if it never did.
  const quiet = async (page, max = 6000) => {
    const t0 = Date.now();
    let last = await page.evaluate(() => window.__raf);
    while (Date.now() - t0 < max) {
      await sleep(500);
      const now = await page.evaluate(() => window.__raf);
      if (now === last && (await page.evaluate(running)).length === 0) return true;
      last = now;
    }
    return false;
  };

  // ── Idle: 0 frames and 0 running animations once a screen has settled ──
  if (want('idle')) {
    const fails = []; let n = 0;
    await Promise.all(['desktop', 'phone'].map(async (vp) => {
      const { ctx, page } = await open('admin', 'light', vp);
      await page.evaluateOnNewDocument(instrument);
      const ws = await firstWs(page);
      for (const route of ALL) {
        await page.goto(`${BASE}/w/${ws}/${route}`, { waitUntil: 'domcontentloaded' });
        await settle(page); await quiet(page);
        const f0 = await page.evaluate(() => window.__raf);
        await sleep(2000);
        const frames = (await page.evaluate(() => window.__raf)) - f0;
        const anims = await page.evaluate(running);
        n++;
        if (frames || anims.length) fails.push(`${route}/${vp}: ${frames} frames in 2s, running: ${anims.join(', ') || 'none'}`);
      }
      await ctx.close();
    }));
    gate('idle: 0 frames/s and 0 running animations once settled', fails, n);
  }

  // ── Reduced motion: no transform animation on entrance, no looping animation, nothing running after ──
  if (want('motion')) {
    const fails = []; let n = 0;
    await Promise.all(['desktop', 'phone'].map(async (vp) => {
      const { ctx, page } = await open('admin', 'light', vp);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(instrument);
      // Records, from the first frame: CSS/WAAPI animations that move things or loop, and elements whose inline
      // geometry (transform, size) or SVG stroke dash takes more than two distinct values: a JS-driven tween.
      // Opacity is deliberately not tracked: a fade is allowed under reduced motion.
      await page.evaluateOnNewDocument(() => {
        window.__moved = new Set();
        const seen = new WeakMap();
        const tick = () => {
          for (const a of document.getAnimations()) {
            if (a.playState !== 'running') continue;
            const kf = a.effect?.getKeyframes?.() ?? [];
            const moves = kf.some((k) => k.transform || k.translate || k.scale || k.rotate);
            const loops = a.effect?.getTiming?.().iterations === Infinity;
            if (moves || loops) window.__moved.add(`${a.animationName || a.transitionProperty || 'waapi'}${loops ? ' (loops)' : ''}`);
          }
        };
        setInterval(tick, 40);
        const PROPS = ['transform', 'translate', 'scale', 'rotate', 'width', 'height'];
        new MutationObserver((ms) => {
          for (const m of ms) {
            const el = m.target;
            const vals = m.attributeName === 'style' ? PROPS.map((k) => el.style?.[k]).filter((v) => v && v !== 'none') : [el.getAttribute(m.attributeName)];
            if (!vals.length || vals[0] === null) continue;
            const bag = seen.get(el) ?? new Map(); const set = bag.get(m.attributeName) ?? new Set(); set.add(vals.join('|')); bag.set(m.attributeName, set); seen.set(el, bag);
            if (set.size > 2) window.__moved.add(`js tween (${m.attributeName}) on <${el.tagName.toLowerCase()} class="${String(el.className?.baseVal ?? el.className).slice(0, 40)}">`);
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style', 'stroke-dasharray', 'stroke-dashoffset'] });
      });
      const ws = await firstWs(page);
      for (const route of ALL) {
        await page.goto(`${BASE}/w/${ws}/${route}`, { waitUntil: 'domcontentloaded' });
        await settle(page); await quiet(page, 3000);
        const moved = await page.evaluate(() => { const m = [...window.__moved]; window.__moved.clear(); return m; });
        const still = await page.evaluate(running);
        n++;
        if (moved.length || still.length) fails.push(`${route}/${vp}: ${[...moved, ...still.map((s) => `${s} still running`)].join('; ')}`);
      }
      await ctx.close();
    }));
    gate('reduced motion: nothing moves, loops or keeps running', fails, n);
  }

  // ── Fonts: bytes for a tour of every route ──
  if (want('fonts')) {
    const { ctx, page } = await open('admin', 'light', 'desktop');
    // Cache off: a font that finished downloading on the "/" landing page was only revalidated on the first route,
    // and Chrome on Windows reported that 304 as 0 body bytes, so the gate summed 63.1 KB of 109.9 (found 2026-10-01).
    await page.setCacheEnabled(false);
    await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(5000));
    // Resource Timing, not response bodies: a body can be evicted once the next navigation starts.
    const files = new Map(); const fails = []; const used = new Set();
    const ws = await firstWs(page);
    for (const route of ALL) {
      await page.goto(`${BASE}/w/${ws}/${route}`, { waitUntil: 'domcontentloaded' }); await settle(page); await page.evaluate(() => document.fonts.ready);
      const { got, faces } = await page.evaluate(() => {
        const got = performance.getEntriesByType('resource').filter((e) => /\.(woff2?|ttf|otf)(\?|$)/.test(e.name)).map((e) => [e.name, e.encodedBodySize]);
        // Each face the page loaded, with the files its @font-face rule names (the browser takes the first it can use).
        const key = (fam, style, weight, range) => [fam.replace(/^["']|["']$/g, ''), style || 'normal', weight || 'normal', range || 'U+0-10FFFF'].join(' | ');
        const rules = new Map();
        const walk = (list, base) => { for (const r of list) {
          if (r.cssRules) walk(r.cssRules, base);
          if (!(r instanceof CSSFontFaceRule)) continue;
          const p = (k) => r.style.getPropertyValue(k);
          rules.set(key(p('font-family'), p('font-style'), p('font-weight'), p('unicode-range')), [...p('src').matchAll(/url\("?([^")]+)"?\)/g)].map((m) => new URL(m[1], base).href));
        } };
        for (const s of document.styleSheets) { try { walk(s.cssRules, s.href ?? location.href); } catch { /* a cross-origin sheet: its faces show up below as unmapped */ } }
        const faces = [...document.fonts].filter((f) => f.status !== 'unloaded').map((f) => { const k = key(f.family, f.style, f.weight, f.unicodeRange); return [k, `${f.family} ${f.style} ${f.weight}`, rules.get(k) ?? []]; });
        return { got, faces };
      });
      for (const [u, b] of got) files.set(u, Math.max(files.get(u) ?? 0, b));
      // A face in use must be counted on the route that uses it; 0 bytes means the measurement saw nothing.
      for (const [face, label, urls] of faces) {
        used.add(face);
        const bytes = Math.max(0, ...urls.map((u) => got.find(([g]) => g === u)?.[1] ?? 0));
        if (!urls.length) fails.push(`${route}: no @font-face file found for the face in use "${label}" (${face})`);
        else if (!bytes) fails.push(`${route}: face in use "${label}" counted at 0 bytes (${urls[0].split('/').pop()})`);
      }
    }
    const total = [...files.values()].reduce((a, b) => a + b, 0);
    const kb = (total / 1024).toFixed(1);
    const list = [...files].map(([u, b]) => `${u.split('/').pop()} ${(b / 1024).toFixed(1)}K`).join(', ');
    if (total > FONT_BUDGET_KB * 1024) fails.unshift(`${kb} KB: ${list}`);
    gate(`fonts ≤ ${FONT_BUDGET_KB} KB for every route (is ${kb} KB)`, fails, used.size, [`${used.size} faces in use, ${files.size} files counted: ${list}`]);
    await ctx.close();
  }

  // ── INP: worst interaction latency over a scripted run, CPU throttled 4x ──
  if (want('inp')) {
    const { ctx, page } = await open('admin', 'light', 'desktop');
    await page.evaluateOnNewDocument(() => {
      window.__inp = {}; window.__inpAt = {}; window.__idleKeyups = 0;
      // A keyup whose handler did no work (< 1 ms) and waited < 16 ms to run changes nothing on screen; its duration is
      // just the wait for the next unrelated frame (headless Chrome: the caret blink, ~570 ms). Measured 2026-09-30:
      // the same keystroke on a bare <textarea> reports no slow keyup, and removing every blur/transition did not change
      // it, while the keydown/keypress that draw the character took 32-48 ms. Any keyup that does work still counts.
      new PerformanceObserver((l) => { for (const e of l.getEntries()) {
        if (!e.interactionId) continue;
        if (e.name === 'keyup' && e.processingEnd - e.processingStart < 1 && e.processingStart - e.startTime < 16) { window.__idleKeyups++; continue; }
        if (e.duration > (window.__inp[e.interactionId] ?? 0)) (window.__inpWhy ??= {})[e.interactionId] = `${e.name}: wait ${Math.round(e.processingStart - e.startTime)} + run ${Math.round(e.processingEnd - e.processingStart)} + paint ${Math.round(e.startTime + e.duration - e.processingEnd)}`;
        window.__inp[e.interactionId] = Math.max(window.__inp[e.interactionId] ?? 0, e.duration); window.__inpAt[e.interactionId] ??= e.startTime;
      } })
        .observe({ type: 'event', durationThreshold: 16, buffered: true });
    });
    const ws = await firstWs(page);
    await settle(page);
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const failsRun = [];
    // Each interaction is attributed to the scripted step during which it started (entries can arrive late).
    const starts = [];
    const act = async (name, fn) => {
      starts.push([name, await page.evaluate(() => performance.now())]);
      try { await fn(); } catch (e) { failsRun.push(`${name}: ${e.message.split('\n')[0]}`); }
      await sleep(450);
    };
    // Pages sit in sections (WORKSPACE-PLAN.md): a page's own link is in the top bar or its section's tabs. When it
    // isn't on screen, the person opens its section first, then the tab, and both interactions are measured.
    const SECTION = { home: 'home', approvals: 'outbound', leads: 'outbound', inbox: 'inbound', meetings: 'inbound', analytics: 'results' };
    const nav = (k) => act(`nav ${k}`, async () => {
      const link = `nav a[href="/w/${ws}/${k}"]`;
      if (!(await page.$(link))) { await page.click(`nav[aria-label=Main] a[data-section="${SECTION[k]}"]`); await page.waitForSelector(link, { timeout: 3000 }); await sleep(450); }
      if (!(await page.$(link))) return; // the section link already landed on the page
      if (!(await page.evaluate((h) => location.pathname === h, `/w/${ws}/${k}`))) await page.click(link);
    });
    const key = (k, label = k) => act(`key ${label}`, () => page.keyboard.press(k));
    const tab = (re) => act(`tab ${re}`, () => page.evaluate((s) => [...document.querySelectorAll('[role=tab]')].find((t) => new RegExp(s).test(t.textContent)).click(), re));
    await nav('approvals'); await key('j'); await key('j'); await key('k');
    await tab('Blocked'); await tab('In review');
    await act('palette open', async () => { await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); });
    await key('Escape', 'palette close');
    await nav('inbox'); await key('j'); await key('j');
    await nav('leads');
    await act('select lead', () => page.click('tbody input[type=checkbox]'));
    await act('unselect lead', () => page.click('tbody input[type=checkbox]'));
    await nav('analytics'); await nav('meetings'); await nav('home');
    await act('composer focus', () => page.click('#composer'));
    await act('type', () => page.keyboard.type('a'));
    await act('account menu', () => page.click('[aria-label="Account menu"]'));
    await key('Escape', 'menu close');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await sleep(500);
    const { inpMap, at, idleKeyups, why } = await page.evaluate(() => ({ inpMap: window.__inp, at: window.__inpAt, idleKeyups: window.__idleKeyups, why: window.__inpWhy ?? {} }));
    const durs = Object.values(inpMap).sort((a, b) => b - a);
    const worstBy = new Map(); const failsWhy = [];
    for (const [id, d] of Object.entries(inpMap)) {
      const owner = [...starts].reverse().find(([, t]) => t <= at[id])?.[0] ?? 'before the script';
      worstBy.set(owner, Math.max(worstBy.get(owner) ?? 0, d));
      if (d >= INP_MAX_MS) failsWhy.push(`${owner} (${why[id] ?? '?'})`);
    }
    const byAct = [...worstBy];
    const inp = durs[0] ?? 0;
    const median = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
    const fails = [...failsRun];
    const slow = byAct.filter(([, v]) => v >= INP_MAX_MS).map(([k, v]) => `${k} ${Math.round(v)} ms`);
    if (inp >= INP_MAX_MS) fails.push(`INP ${Math.round(inp)} ms; over budget: ${slow.join(', ') || 'unattributed'}; breakdown: ${failsWhy.join('; ')}`);
    const top = [...byAct].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ');
    gate(`INP < ${INP_MAX_MS} ms on a 4x-throttled CPU (is ${Math.round(inp)} ms, median ${Math.round(median)} ms)`, fails, durs.length >= 15 ? durs.length : 0,
      [...(durs.length < 15 ? [`only ${durs.length} interactions recorded; need 15`] : []), `slowest: ${top} ms`, `${idleKeyups} no-work keyup(s) excluded (see comment)`]);
    await ctx.close();
  }

  // ── Tab walk: every visible control reachable by Tab, each with a visible focus indicator ──
  if (want('tabwalk')) {
    const fails = []; let n = 0;
    const { ctx, page } = await open('admin', 'light', 'desktop');
    const ws = await firstWs(page);
    for (const route of ALL) {
      await page.goto(`${BASE}/w/${ws}/${route}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await page.evaluate(() => {
        // Only what can be seen: an outline counts when its style isn't none and it has width and a non-transparent
        // color; a border color counts only where there is a border. (An outline-color change under outline-style:none
        // passed the first version of this gate: found by the sabotage run, 2026-09-30.)
        const clear = (col) => /rgba\([^)]*,\s*0\)$|transparent/.test(col);
        window.__twSig = (start) => { const out = []; let n = start; for (let d = 0; n && d < 4; d++, n = n.parentElement) {
          const c = getComputedStyle(n);
          const outline = c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0 && !clear(c.outlineColor) ? `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor} ${c.outlineOffset}` : 'none';
          const border = parseFloat(c.borderTopWidth) + parseFloat(c.borderBottomWidth) > 0 ? c.borderColor : '';
          out.push(`${outline}|${c.boxShadow}|${border}`);
        } return out.join('~'); };
      });
      const expected = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
        const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [tabindex]')]
          .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[inert], [aria-hidden=true]') && vis(el));
        els.forEach((el, i) => { el.dataset.tw = String(i); });
        return els.map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`);
      });
      n += expected.length;
      // Put the sequential-focus starting point at the very top (the app focuses <main> on route change).
      await page.evaluate(() => { const s = document.createElement('span'); s.tabIndex = -1; s.id = '__tw-start'; document.body.prepend(s); s.focus(); window.scrollTo(0, 0); });
      const reached = new Set(); const noRing = new Set(); const focusedSig = new Map();
      for (let i = 0; i < expected.length + 15; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          return { id: el.dataset.tw ?? null, sig: window.__twSig(el) };
        });
        if (!r) { if (reached.size) break; continue; }
        if (r.id !== null) { reached.add(r.id); focusedSig.set(r.id, r.sig); }
      }
      // A focus indicator is any change to outline, box-shadow or border on the element or its 3 nearest ancestors
      // (the composer draws its ring on the wrapper with :focus-within). Compare focused vs unfocused.
      for (const [id, fsig] of focusedSig) {
        const usig = await page.evaluate((i) => {
          const el = document.querySelector(`[data-tw="${i}"]`); if (!el) return null;
          document.getElementById('__tw-start')?.focus();
          return window.__twSig(el);
        }, id);
        if (usig !== null && usig === fsig) noRing.add(id);
      }
      expected.forEach((label, i) => {
        if (!reached.has(String(i))) fails.push(`${route}: unreachable by Tab: ${label}`);
        else if (noRing.has(String(i))) fails.push(`${route}: no visible focus ring: ${label}`);
      });
    }
    await ctx.close();
    gate('tab walk: every visible control reachable, each with a focus ring', fails, n);
  }

  // ── Visual regression against committed baselines ──
  if (want('visual') && !REMOTE) {
    const dir = join(ROOT, 'gates', 'baselines');
    mkdirSync(dir, { recursive: true });
    const fails = []; const notes = []; let n = 0;
    const shots = [['light', 'desktop'], ['light', 'phone'], ['dark', 'desktop']];
    await Promise.all(shots.map(async ([theme, vp]) => {
      const { ctx, page } = await open('admin', theme, vp);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(freezeClock, FROZEN);
      await page.setViewport({ ...page.viewport(), deviceScaleFactor: 1 });
      const ws = await firstWs(page);
      for (const route of ALL) {
        await page.goto(`${BASE}/w/${ws}/${route}`, { waitUntil: 'domcontentloaded' });
        await settle(page); await page.evaluate(() => document.fonts.ready); await sleep(400);
        const name = `${route}-${theme}-${vp}.png`;
        // Workspace ids are random per seed, so the URL is masked out of the comparison by never rendering it.
        const buf = Buffer.from(await page.screenshot({ type: 'png' }));
        n++;
        const base = join(dir, name);
        if (updating || !existsSync(base)) {
          if (!updating) fails.push(`${name}: no baseline (run with --update-baselines to create it)`);
          else { writeFileSync(base, buf); notes.push(`baseline written: ${name}`); }
          continue;
        }
        const a = PNG.sync.read(readFileSync(base)); const b = PNG.sync.read(buf);
        if (a.width !== b.width || a.height !== b.height) { fails.push(`${name}: size ${a.width}×${a.height} → ${b.width}×${b.height}`); continue; }
        const diff = new PNG({ width: a.width, height: a.height });
        const px = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
        const share = px / (a.width * a.height);
        if (share > VR_THRESHOLD) { fails.push(`${name}: ${(share * 100).toFixed(2)}% of pixels differ (diff in gates/out/vr-${name})`); writeFileSync(join(OUT, `vr-${name}`), PNG.sync.write(diff)); writeFileSync(join(OUT, `vr-new-${name}`), buf); }
      }
      await ctx.close();
    }));
    gate(`visual regression ≤ ${VR_THRESHOLD * 100}% pixels vs baselines${updating ? ' (baselines updated)' : ''}`, fails, n, notes.length > 3 ? [`${notes.length} baselines written`] : notes);
  }
}
