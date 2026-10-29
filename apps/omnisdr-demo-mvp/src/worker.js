import demoHtml from './demo.html';
import devHtml from './dev.html';
import CSS from './base.css';
import LOGO from './logo.txt';
import entryHtml from './entry.html';
import salesDeckHtml from './sales-deck.html';
import SLIDES from './sales-slides.js';
import { TENANTS, DEFAULT_TENANT } from './tenant.js';
import { buildInstruction, bookSlotTool } from './engine-instruction.js';
import { handleRep } from './rep/index.js';

/* ---------- helpers ---------- */
const enc = new TextEncoder();
const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...extra } });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hmac(secret, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
async function safeEqual(secret, a, b) {
  const [x, y] = await Promise.all([hmac(secret, String(a)), hmac(secret, String(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}
const salt = (env) => env.IP_SALT || env.DEV_PASSCODE || 'omnisdr-demo';
const ipHash = async (env, req) => hex(await hmac(salt(env), req.headers.get('cf-connecting-ip') || 'local')).slice(0, 32);

class TooLarge extends Error {}
// Read a JSON object body with a hard byte cap (works for chunked bodies too). Non-objects become {}.
async function readJson(req, cap = 4096) {
  if (!req.body) return {};
  const reader = req.body.getReader(); const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.byteLength; if (n > cap) { try { await reader.cancel(); } catch (e) {} throw new TooLarge(); }
    chunks.push(value);
  }
  const all = new Uint8Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  try { const v = JSON.parse(new TextDecoder().decode(all)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; }
}

const voiceOn = (env) => !!env.RETELL_API_KEY && /^agent_[a-f0-9]{20,}$/.test(String(env.RETELL_AGENT_ID || ''));
function page(html, env) {
  const voice = html === demoHtml && voiceOn(env);
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  let body = html.replaceAll('__NONCE__', nonce).replace('__CSS__', CSS).replace('__LOGO__', LOGO.trim());
  if (voice) body = body.replace('<meta name="robots"', '<meta name="voice" content="1"><meta name="robots"');
  if (env.TURNSTILE_SITEKEY) body = body.replace('<meta name="robots"', '<meta name="ts-key" content="' + String(env.TURNSTILE_SITEKEY).replace(/[^\w-]/g, '') + '"><meta name="robots"');
  return new Response(body, { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow',
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'self' 'nonce-" + nonce + "' https://challenges.cloudflare.com" + (voice ? ' https://cdn.jsdelivr.net' : '') + "; style-src 'self' 'nonce-" + nonce + "'; img-src 'self' data:; connect-src 'self' wss://generativelanguage.googleapis.com" + (voice ? ' https://api.retellai.com https://*.retellai.com wss://*.retellai.com wss://*.livekit.cloud https://*.livekit.cloud' : '') + "; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  } });
}

/* ---------- Durable Object: all state, serialized (no races) ---------- */
const DAY = 864e5;
export class Gate {
  constructor(state) { this.s = state.storage; this.lastPurge = 0; }
  async purge(now) {
    if (now - this.lastPurge < 60000) return; this.lastPurge = now;
    const old = new Date(now - 3 * DAY).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    for (const [k, v] of await this.s.list({ prefix: 's:' })) if (now - Date.parse(v.at) > 30 * DAY) await this.s.delete(k);
    for (const [k] of await this.s.list({ prefix: 'day:' })) if (k.slice(4) < old) await this.s.delete(k);
    for (const [k] of await this.s.list({ prefix: 'ip:' })) if (k.split(':')[1] < old) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'ds:' })) if (v < now) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'vtok:' })) if (now - v > 2 * DAY) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'vstream:' })) if (now - v > 2 * DAY) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'vcall:' })) if (now - v.at > 2 * DAY) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'tok:' })) if (now - v > 2 * DAY) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'lf:' })) if (v.until < now && now - v.last > 15 * 60000) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'sl:' })) if (v.until < now && now - v.last > 15 * 60000) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'ss:' })) if (v < now) await this.s.delete(k);
  }
  async fetch(req) {
    const b = await req.json(); const now = Date.now(); await this.purge(now); const s = this.s; const R = (o, st = 200) => json(o, st);
    switch (b.op) {
      case 'start': { // atomic: caps check + session create
        if ((await s.get('kill')) === true) return R({ ok: false, reason: 'paused' }, 503);
        const dk = 'day:' + b.day, ik = 'ip:' + b.day + ':' + b.ip;
        const dn = (await s.get(dk)) || 0, inn = (await s.get(ik)) || 0;
        if (dn >= b.dayCap) return R({ ok: false, reason: 'daily-cap' }, 429);
        if (inn >= b.ipCap) return R({ ok: false, reason: 'ip-cap' }, 429);
        await s.put(dk, dn + 1); await s.put(ik, inn + 1);
        await s.put('s:' + b.sid, { sid: b.sid, tenant: b.tenant, at: new Date(now).toISOString(), max: b.max, events: [] });
        return R({ ok: true });
      }
      case 'event': {
        const rec = await s.get('s:' + b.sid); if (!rec) return R({ ok: false }, 404);
        if (now - Date.parse(rec.at) > (rec.max + 60) * 1000) return R({ ok: false, reason: 'expired' }, 410);
        if (rec.events.length < 200) { rec.events.push(b.ev); await s.put('s:' + b.sid, rec); }
        return R({ ok: true });
      }
      case 'token': {
        const rec = await s.get('s:' + b.sid); if (!rec) return R({ ok: false }, 404);
        const left = rec.max * 1000 - (now - Date.parse(rec.at)); // A1: an expired session can no longer mint; the token may not outlive the session
        if (left <= 0) return R({ ok: false, reason: 'expired' }, 410);
        if ((await s.get('kill')) === true) return R({ ok: false }, 503);
        if (await s.get('tok:' + b.sid)) return R({ ok: false, reason: 'used' }, 429);
        // Lifetime test-mint ceiling (G2). 'mints' is NOT touched by resetday; only the ENGINE_B_TEST_MINTS var moves it. b.ceiling is null when lifted.
        const used = (await s.get('mints')) || 0;
        if (b.ceiling != null && used >= b.ceiling) return R({ ok: false, reason: 'test-ceiling' }, 429);
        await s.put('tok:' + b.sid, now); await s.put('mints', used + 1);
        return R({ ok: true, leftMs: left, tenant: rec.tenant });
      }
      case 'vtoken': { // Retell voice call: same session rules as 'token', its own marker and lifetime counter ('vcalls', not cleared by resetday)
        const rec = await s.get('s:' + b.sid); if (!rec) return R({ ok: false }, 404);
        const left = rec.max * 1000 - (now - Date.parse(rec.at));
        if (left <= 0) return R({ ok: false, reason: 'expired' }, 410);
        if ((await s.get('kill')) === true) return R({ ok: false, reason: 'paused' }, 503);
        if (await s.get('vtok:' + b.sid)) return R({ ok: false, reason: 'used' }, 429);
        const used = (await s.get('vcalls')) || 0;
        if (b.ceiling != null && used >= b.ceiling) return R({ ok: false, reason: 'test-ceiling' }, 429);
        await s.put('vtok:' + b.sid, now); await s.put('vcalls', used + 1);
        return R({ ok: true, leftMs: left });
      }
      case 'vcall': { await s.put('vcall:' + b.sid, { id: b.callId, at: now }); return R({ ok: true }); }
      case 'vstream': { // one live stream per session; returns the Retell call id minted for it
        const c = await s.get('vcall:' + b.sid); if (!c) return R({ ok: false }, 404);
        if (await s.get('vstream:' + b.sid)) return R({ ok: false, reason: 'used' }, 429);
        await s.put('vstream:' + b.sid, now); return R({ ok: true, callId: c.id });
      }
      case 'stats': {
        const list = [...(await s.list({ prefix: 's:' })).values()].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 25);
        return R({ mints: (await s.get('mints')) || 0, vcalls: (await s.get('vcalls')) || 0, used: (await s.get('day:' + b.day)) || 0, killed: (await s.get('kill')) === true, sessions: list.map((r) => ({ sid: r.sid.slice(0, 8), tenant: r.tenant, at: r.at, events: r.events.length, last: r.events.at(-1)?.type || '' })) });
      }
      case 'resetday': { // dev portal: zero today's daily and per-ip counters (session log is kept)
        await s.delete('day:' + b.day); for (const [k] of await s.list({ prefix: 'ip:' + b.day + ':' })) await s.delete(k); return R({ ok: true });
      }
      case 'kill': await s.put('kill', b.on === true); return R({ ok: true, killed: b.on === true });
      case 'killed': return R({ killed: (await s.get('kill')) === true });
      case 'lcheck': { // atomic check-and-reserve: the attempt is counted BEFORE the passcode is evaluated, so a parallel burst cannot get more than 5 guesses per window
        const f = (await s.get('lf:' + b.ip)) || { n: 0, until: 0, last: 0 };
        if (f.until > now) return R({ blocked: true });
        f.n += 1; f.last = now; if (f.n >= 5) { f.until = now + 15 * 60000; f.n = 0; }
        await s.put('lf:' + b.ip, f); return R({ blocked: false });
      }
      case 'lok': await s.delete('lf:' + b.ip); return R({ ok: true });
      case 'dscreate': await s.put('ds:' + b.id, now + 8 * 3600000); return R({ ok: true });
      case 'dscheck': { const e = await s.get('ds:' + b.id); return R({ ok: !!e && e > now }); }
      // Sales deck: own keys (sl: throttle, ss: sessions), never shared with the dev login throttle (lf:/ds:) or the demo caps (day:/ip:).
      case 'slcheck': {
        const f = (await s.get('sl:' + b.ip)) || { n: 0, until: 0, last: 0 };
        if (f.until > now) return R({ blocked: true });
        f.n += 1; f.last = now; if (f.n >= 5) { f.until = now + 15 * 60000; f.n = 0; }
        await s.put('sl:' + b.ip, f); return R({ blocked: false });
      }
      case 'slok': await s.delete('sl:' + b.ip); return R({ ok: true });
      case 'sscreate': await s.put('ss:' + b.id, now + 8 * 3600000); return R({ ok: true });
      case 'sscheck': { const e = await s.get('ss:' + b.id); return R({ ok: !!e && e > now }); }
      case 'ssdelete': await s.delete('ss:' + b.id); return R({ ok: true });
      case 'dsdelete': await s.delete('ds:' + b.id); return R({ ok: true });
    }
    return R({ ok: false }, 400);
  }
}
const gate = (env, op) => env.GATE.get(env.GATE.idFromName('main')).fetch('https://gate/', { method: 'POST', body: JSON.stringify(op) }).then((r) => r.json().then((j) => { j._s = r.status; return j; }));

/* ---------- auth ---------- */
const cookie = (req, name) => (req.headers.get('cookie') || '').split(/;\s*/).map((c) => c.split('=')).find((p) => p[0] === name)?.[1];
async function devAuthed(req, env) { const id = cookie(req, 'dev'); if (!id || !/^[a-f0-9]{64}$/.test(id)) return false; return (await gate(env, { op: 'dscheck', id })).ok === true; }

async function salesAuthed(req, env) { const id = cookie(req, 'sales'); if (!id || !/^[a-f0-9]{64}$/.test(id)) return false; return (await gate(env, { op: 'sscheck', id })).ok === true; }
// The deck copy is injected only here, after a valid session. '<' is escaped so slide text can never close the script tag.
function deckPage(env) { return page(salesDeckHtml.replace('__SLIDES__', () => JSON.stringify(SLIDES).replace(/</g, '\\u003c')), env); }
async function salesLogin(req, env, b) {
  const ih = await ipHash(env, req);
  if ((await gate(env, { op: 'slcheck', ip: ih })).blocked) return json({ ok: false, message: 'Too many attempts. Wait 15 minutes.' }, 429);
  // Always run the compare, even with no secret set or a non-string input, so every wrong answer costs the same. An unset secret fails closed.
  const given = typeof b.passcode === 'string' ? b.passcode : '', want = typeof env.SALES_PASSCODE === 'string' ? env.SALES_PASSCODE : '';
  const same = await safeEqual(salt(env), given, want);
  if (!(same && want !== '')) return json({ ok: false, message: 'Wrong passcode.' }, 401);
  await gate(env, { op: 'slok', ip: ih });
  const id = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await gate(env, { op: 'sscreate', id });
  return json({ ok: true }, 200, { 'set-cookie': 'sales=' + id + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800' });
}

const triedGated = (env) => !['off', '0', 'false', 'no'].includes(String(env.TRYME_GATED ?? '').trim().toLowerCase());
// Branded 404 for browsers (Accept: text/html); API and script callers keep the JSON 404.
const NOT_FOUND_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#F7F5F0"><title>Page not found · OmniSDR</title><style nonce="__NONCE__">__CSS__</style></head><body><div class="wrap"><header class="top"><div class="brand">__LOGO__<b>OmniSDR</b></div></header><main class="card"><h1>That page is not here.</h1><p class="muted">Check the address, or start from the front door.</p><p><a class="btn" href="/">Go to the front door</a></p></main></div></body></html>';
const notFoundPage = (env) => { const r = page(NOT_FOUND_HTML, env); return new Response(r.body, { status: 404, headers: r.headers }); };
const toEntry = () => new Response(null, { status: 302, headers: { location: '/', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
const LOGIN_PANEL = '<form class="row" id="lf"><label class="sr" for="pc">Passcode</label><input id="pc" type="password" autocomplete="off" placeholder="Passcode" required><button class="btn" id="sb" type="submit">Send</button></form>';
const PORTAL_PANEL = '<div class="out-row"><button class="btn ghost" id="so" type="button">Sign out</button></div>';
// The gate decision is made here, on the server. The chat is only presentation: /tryme and /sales are gated by the session cookie regardless of what the page shows.
function entryPage(authed, env) { return page(entryHtml.replace('__MODE__', authed ? 'portal' : 'login').replace('__PANEL__', () => (authed ? PORTAL_PANEL : LOGIN_PANEL)), env); }

/* ---------- handlers ---------- */
const publicTenant = (id) => { const t = TENANTS[id]; return { id: t.id, business: t.business, owner: t.owner, persona: t.persona, niche: t.niche, hours: t.hours, serviceZips: t.serviceZips, services: t.services, outOfScope: t.outOfScope, estimate: t.estimate, slots: t.slots, hot: t.hot, license: t.license }; };
const pickTenant = (id) => (typeof id === 'string' && Object.hasOwn(TENANTS, id)) ? id : DEFAULT_TENANT;
// Real booking link comes from Christian; until then one mailto, one constant.
const BOOK_URL = 'mailto:getomnisdr@gmail.com';
const BOOK_HOW = 'To book a live walkthrough, email ' + BOOK_URL.slice('mailto:'.length) + '.';
const MSG = {
  paused: 'The demo is paused right now. ' + BOOK_HOW,
  'daily-cap': "Today's demo sessions are used up. Try again tomorrow. " + BOOK_HOW,
  'ip-cap': 'You have used your demo sessions for today. Try again tomorrow. ' + BOOK_HOW
};

async function newSession(req, env, body) {
  // Fail closed: the widget is shown whenever TURNSTILE_SITEKEY is set, so a missing secret must not silently disable the check.
  if (env.TURNSTILE_SITEKEY && !env.TURNSTILE_SECRET) return json({ ok: false, reason: 'bot', message: 'Bot check is unavailable. Try again later.' }, 503);
  if (env.TURNSTILE_SECRET) {
    const f = new FormData(); f.append('secret', env.TURNSTILE_SECRET); f.append('response', String(body.turnstile || '')); const ip = req.headers.get('cf-connecting-ip'); if (ip) f.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f }).then((r) => r.json()).catch(() => ({}));
    if (!r.success) return json({ ok: false, reason: 'bot', message: 'Bot check failed. Reload and try again.' }, 403);
  }
  const tenant = pickTenant(body.tenant), sid = crypto.randomUUID(), max = +(env.SESSION_SECONDS || 180);
  const r = await gate(env, { op: 'start', sid, tenant, max, day: today(), ip: await ipHash(env, req), dayCap: +(env.DAILY_CAP || 10), ipCap: +(env.IP_CAP || 2) });
  if (!r.ok) return json({ ok: false, reason: r.reason, message: MSG[r.reason] || 'Could not start the demo.' }, r._s);
  return json({ ok: true, sid, maxSeconds: max, tenant: publicTenant(tenant), engineB: env.ENGINE_B === '1' && !!env.GEMINI_API_KEY });
}

async function logEvent(env, b) {
  if (typeof b.sid !== 'string' || typeof b.type !== 'string') return json({ ok: false }, 400);
  const ev = { t: Date.now(), type: b.type.slice(0, 40), data: JSON.stringify(b.data ?? '').slice(0, 600) };
  const r = await gate(env, { op: 'event', sid: b.sid.slice(0, 64), ev });
  return json({ ok: r.ok === true }, r._s);
}


// Federal holidays, on the date and on the day observed (Saturday holiday: Friday before; Sunday: Monday after).
function isFederalHoliday(y, m, d) {
  const nth = (mo, wd, n) => { let c = 0; for (let day = 1; day <= 31; day++) { const dt = new Date(Date.UTC(y, mo, day)); if (dt.getUTCMonth() !== mo) break; if (dt.getUTCDay() === wd && ++c === n) return day; } };
  const last = (mo, wd) => { for (let day = 31; day >= 1; day--) { const dt = new Date(Date.UTC(y, mo, day)); if (dt.getUTCMonth() === mo && dt.getUTCDay() === wd) return day; } };
  const fixed = [[0, 1], [5, 19], [6, 4], [10, 11], [11, 25]];
  const floating = [[0, nth(0, 1, 3)], [1, nth(1, 1, 3)], [4, last(4, 1)], [8, nth(8, 1, 1)], [9, nth(9, 1, 2)], [10, nth(10, 4, 4)]];
  const here = Date.UTC(y, m, d);
  for (const [mo, day] of fixed) { const wd = new Date(Date.UTC(y, mo, day)).getUTCDay(); const obs = wd === 6 ? day - 1 : wd === 0 ? day + 1 : day; if (here === Date.UTC(y, mo, day) || here === Date.UTC(y, mo, obs)) return true; }
  for (const [mo, day] of floating) if (here === Date.UTC(y, mo, day)) return true;
  return false;
}
// Send window (legal ruling, Compliance Addendum B6): 9 AM to 8 PM, Monday to Saturday, no federal holidays.
// A first reply to the lead's own request may still go inside 9 AM to 8 PM on a Sunday or holiday.
function sendState(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', weekday: 'short' }).formatToParts(now).map((x) => [x.type, x.value]));
  const hr = Number(p.hour);
  if (hr < 9 || hr >= 20) return 'closed';
  return p.weekday === 'Sun' || isFederalHoliday(Number(p.year), Number(p.month) - 1, Number(p.day)) ? 'off_day' : 'open';
}

// CHASE simulation: returns the planned cadence for the chosen tenant. Nothing is sent anywhere.
function chasePlan(b) {
  const t = TENANTS[pickTenant(b.tenant)];
  const name = (String(b.name || 'there').replace(/[^\w' -]/g, '').slice(0, 40).split(' ')[0]) || 'there';
  const state = sendState(new Date());
  const quiet = state !== 'open';
  const steps = [
    { at: 'Text 1 · inside 2 minutes', text: `Hi ${name}, it's ${t.persona} with ${t.business}. Thanks for reaching out about your bathroom. Are you looking at a tub-to-shower swap, or a bigger remodel? (Automated assistant. Reply STOP to opt out.)` },
    { at: 'Text 2 · 12+ hours later', text: `${name}, ${t.owner} can come by for ${t.estimate}. Does ${t.slots[0]} or ${t.slots[1]} work? ${t.business}. Reply STOP to opt out.` },
    { at: 'Text 3 · 1 day after text 2', text: `Hi ${name}, still thinking about the bathroom? I can hold ${t.slots[2]} for you. Just reply with a time that works. ${t.business}. Reply STOP to opt out.` },
    { at: 'Text 4 · 3 days after text 3, last', text: `Last note from ${t.business}, ${name}. If the timing is off, no worries. Reply any time and we'll pick it back up. Reply STOP to opt out.` }
  ];
  const note = state === 'open' ? 'Inside the send window: the first text goes out within 2 minutes. The thread below plays in fast forward; real follow-ups are spaced over days.'
    : state === 'off_day' ? 'Sunday or holiday: the first text still goes within 2 minutes because it answers your own request. Follow-ups wait for the next sending day.'
    : 'Outside sending hours (9 AM to 8 PM, Monday to Saturday, no federal holidays; shown here in Central time). The first text waits until 9 AM on the next sending day.';
  return { ok: true, simulated: true, quietHoursNow: quiet, note, stepsNote: 'Times shown are the earliest. Waits for sending hours can push any step later.', steps, rules: ['Stops on reply, booking, STOP, wrong number, or when a staff member takes over', 'At most 4 texts in 7 days, follow-ups at least 12 hours apart', 'Texts go out 9 AM to 8 PM recipient local time, Monday to Saturday, never on federal holidays', 'Every text names the business and says Reply STOP to opt out'] };
}

// Token mint verified against the live Gemini API 2026-10-24 (200, setupComplete, audio back); the browser audio client does not exist yet. One token per session, session must exist, cap-free because the session already passed caps.
async function mintToken(env, b) {
  if (env.ENGINE_B !== '1' || !env.GEMINI_API_KEY) return json({ ok: false, message: 'Not available.' }, 501);
  if (typeof b.sid !== 'string') return json({ ok: false, message: 'Start a session first.' }, 400);
  const g = await gate(env, { op: 'token', sid: b.sid.slice(0, 64), ceiling: testMintCeiling(env) });
  if (!g.ok) return json({ ok: false, reason: g.reason, message: g.reason === 'used' ? 'Token already issued for this session.' : g.reason === 'expired' ? 'Session expired.' : 'Not available.' }, g._s);
  // Nothing from the request body past sid is used: model, instruction, tools and times are all server-side (checklist E10, F5).
  const t = TENANTS[g.tenant] || TENANTS[DEFAULT_TENANT], model = 'models/gemini-3.8-live', now = Date.now();
  const life = Math.min(180000, g.leftMs); // the token may not outlive the session (A1) and never exceeds 3 min
  // REST field is bidiGenerateContentSetup (liveConnectConstraints is the SDK's name for it); endpoint is v1beta. Verified against the live API 2026-10-24.
  // UNVERIFIED: that tools and systemInstruction are locked by the token without lockAdditionalFields, and that sessionResumption stays off; check with the LIVE_GEMINI test.
  const body = { uses: 1, expireTime: new Date(now + life).toISOString(), newSessionExpireTime: new Date(now + Math.min(60000, life)).toISOString(),
    bidiGenerateContentSetup: { model, generationConfig: { responseModalities: ['AUDIO'] }, systemInstruction: { parts: [{ text: buildInstruction(t) }] }, tools: bookSlotTool(t) } };
  const r = await fetch(geminiBase(env) + '/v1beta/auth_tokens', { method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (!r || !r.ok) return json({ ok: false, message: 'Token request failed.' }, 502);
  const j = await r.json().catch(() => null); if (!j || typeof j.name !== 'string') return json({ ok: false, message: 'Token request failed.' }, 502);
  return json({ ok: true, token: j.name, model });
}

// Retell web call for the OmniSDR waitlist agent (POST /v3/create-web-call; v2 was retired 2026-09-30; SDK 3.0.2 RetellWebClient takes the same accessToken). The API key never leaves the Worker; the browser gets a one-use access token. The agent itself caps the call at 3 minutes.
// Spend is bounded three ways: the session caps (daily, per IP, kill switch), this lifetime ceiling, and the agent's own duration cap. No RETELL_API_KEY secret means the tab does not appear.
async function mintVoice(env, b) {
  if (!voiceOn(env)) return json({ ok: false, message: 'Not available.' }, 501);
  if (typeof b.sid !== 'string') return json({ ok: false, message: 'Start a session first.' }, 400);
  const g = await gate(env, { op: 'vtoken', sid: b.sid.slice(0, 64), ceiling: voiceCeiling(env) });
  if (!g.ok) return json({ ok: false, reason: g.reason, message: g.reason === 'used' ? 'The voice call for this session was already started.' : g.reason === 'expired' ? 'Session expired.' : g.reason === 'paused' ? 'The demo is paused.' : 'The voice demo has reached its test limit.' }, g._s);
  const r = await fetch(retellBase(env) + '/v3/create-web-call', { method: 'POST', headers: { authorization: 'Bearer ' + env.RETELL_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ agent_id: env.RETELL_AGENT_ID, metadata: { source: 'demo-panel', session: b.sid.slice(0, 8) } }) }).catch(() => null);
  if (!r || !r.ok) return json({ ok: false, message: 'Could not start the voice call.' }, 502);
  const j = await r.json().catch(() => null); if (!j || typeof j.access_token !== 'string' || typeof j.call_id !== 'string') return json({ ok: false, message: 'Could not start the voice call.' }, 502);
  // The v3 SDK starts the call from this create-web-call response (token, transport, ICE servers); only those fields go to the browser, never the API key.
  await gate(env, { op: 'vcall', sid: b.sid.slice(0, 64), callId: j.call_id });
  const call = { call_id: j.call_id, access_token: j.access_token, transport: j.transport, ice_servers: j.ice_servers, expires_at: j.expires_at };
  return json({ ok: true, call, agentId: env.RETELL_AGENT_ID, maxSeconds: Math.min(180, Math.floor(g.leftMs / 1000)) });
}
// Live call panel: relays Retell's monitor websocket (server side, the key stays here) to the page as server-sent events, then adds the call latency Retell reports once the call ends.
// Only the fields the panel shows are forwarded (speaker, text, time); one stream per session; hard stop at 200 s.
async function voiceStream(env, sid) {
  if (!voiceOn(env)) return json({ ok: false }, 501);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sid)) return json({ ok: false }, 400);
  const g = await gate(env, { op: 'vstream', sid }); if (!g.ok) return json({ ok: false }, g._s || 404);
  const base = retellBase(env), auth = { authorization: 'Bearer ' + env.RETELL_API_KEY };
  const enc = new TextEncoder(); let ws = null, closed = false;
  const body = new ReadableStream({
    async start(ctl) {
      const send = (o) => { if (!closed) try { ctl.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n')); } catch { closed = true; } };
      const done = () => { if (!closed) { closed = true; try { ws && ws.close(); } catch {} try { ctl.close(); } catch {} } };
      const stop = setTimeout(done, 200000);
      for (let i = 0; i < 6 && !ws && !closed; i++) { // the call must be ongoing before the monitor accepts, so retry briefly
        const r = await fetch(base + '/v2/monitor-call/' + g.callId, { headers: { ...auth, Upgrade: 'websocket' } }).catch(() => null);
        if (r && r.webSocket) { ws = r.webSocket; ws.accept(); } else await new Promise((ok) => setTimeout(ok, 1000));
      }
      if (!ws) { send({ t: 'err' }); clearTimeout(stop); return done(); }
      let ended = false;
      const finish = async () => {
        if (ended) return; ended = true;
        send({ t: 'end' });
        for (let i = 0; i < 5 && !closed; i++) { // Retell computes latency after the call ends
          const r = await fetch(base + '/v2/get-call/' + g.callId, { headers: auth }).catch(() => null);
          const c = r && r.ok ? await r.json().catch(() => null) : null; const l = c && c.latency;
          if (l && l.e2e && l.e2e.p50 != null) { const p = (x) => x && x.p50 != null ? Math.round(x.p50) : null; send({ t: 'lat', e2e: p(l.e2e), llm: p(l.llm), tts: p(l.tts), asr: p(l.asr), turns: l.e2e.num ?? null }); break; }
          await new Promise((ok) => setTimeout(ok, 2000));
        }
        clearTimeout(stop); done();
      };
      ws.addEventListener('message', (ev) => {
        let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
        if (m.type === 'call_ended') return void finish();
        if (m.type !== 'transcript_snapshot' && m.type !== 'transcript_updated') return;
        for (const it of m.transcripts || []) if ((it.role === 'user' || it.role === 'agent') && typeof it.content === 'string' && typeof it.id === 'string')
          send({ t: 'tx', id: it.id.slice(0, 40), role: it.role, text: it.content.slice(0, 400), sec: typeof it.time_sec === 'number' ? it.time_sec : null });
      });
      ws.addEventListener('close', () => void finish());
      ws.addEventListener('error', () => void finish());
    },
    cancel() { closed = true; try { ws && ws.close(); } catch {} },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
// RETELL_BASE exists so the offline test can point at a local mock; honoured ONLY for localhost or the real Retell host, so a bad var can never send the API key elsewhere.
function retellBase(env) {
  const v = String(env.RETELL_BASE || '').replace(/\/+$/, '');
  return /^(https:\/\/api\.retellai\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/.test(v) ? v : 'https://api.retellai.com';
}
// Lifetime voice-call ceiling, default 2 calls (about $1.50 at the 3 minute cap and $0.23 a minute). 'off' lifts it. reset-today never clears it.
function voiceCeiling(env) {
  const v = String(env.RETELL_TEST_CALLS ?? '').trim().toLowerCase();
  if (v === 'off') return null;
  const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 2;
}

// Google base URL. GEMINI_BASE exists so the offline tests can point at a local mock; it is honoured ONLY for localhost or the real Google host, so a bad var can never send the API key elsewhere.
function geminiBase(env) {
  const v = String(env.GEMINI_BASE || '').replace(/\/+$/, '');
  return /^(https:\/\/generativelanguage\.googleapis\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/.test(v) ? v : 'https://generativelanguage.googleapis.com';
}
// Lifetime test-mint ceiling (G2): bounds our TEST spend, not the public product. Default 36 = 2x headroom on floor($5 / (3 min x $0.023/min)) = 72.
// Price source: https://ai.google.dev/gemini-api/docs/pricing (read 2026-10-24, page dated 2026-10-22): gemini-3.8-live audio in $0.005/min, audio out $0.018/min, free tier $0.
// UNVERIFIED: thinking-token and transcription-token charges are not covered by that arithmetic. Lift for go-live only by setting ENGINE_B_TEST_MINTS to 'off'; reset-today never clears the counter.
function testMintCeiling(env) {
  const v = String(env.ENGINE_B_TEST_MINTS ?? '').trim().toLowerCase();
  if (v === 'off') return null;
  const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 36;
}

export default {
  async fetch(req, env) {
    // HEAD answers like GET without a body, so link previews and uptime checks do not see a 404.
    if (req.method === 'HEAD') { const r = await this.fetch(new Request(req, { method: 'GET' }), env); return new Response(null, { status: r.status, headers: r.headers }); }
    try {
      const u = new URL(req.url), p = u.pathname, m = req.method;
      if (p === '/rep' || p.startsWith('/rep/')) return handleRep(req, env); // rep portal: own auth (Access JWT + reps row), own CSP; see src/rep/index.js
      if (m === 'GET' && p === '/tryme') return (!triedGated(env) || (await salesAuthed(req, env))) ? page(demoHtml, env) : toEntry();
      if (m === 'GET' && p === '/tryme/dev') return page(devHtml, env);
      if (m === 'GET' && p === '/dev') return new Response(null, { status: 302, headers: { location: '/tryme/dev' + u.search, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
      if (m === 'GET' && p === '/') return entryPage(await salesAuthed(req, env), env);
      if (m === 'GET' && p === '/sales') return (await salesAuthed(req, env)) ? deckPage(env) : toEntry();
      if (m === 'GET' && p === '/healthz') return json({ ok: true });
      if (m === 'GET' && p === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
      if (m === 'GET' && p === '/api/voice/stream') return voiceStream(env, u.searchParams.get('sid') || '');
      if (m === 'GET' && p === '/api/dev/me') return json({ ok: true, authed: await devAuthed(req, env) });

      if (m === 'POST' && p.startsWith('/api/')) {
        const origin = req.headers.get('origin');
        if (origin && origin !== u.origin) return json({ ok: false, message: 'Cross-site request refused.' }, 403);
        if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json({ ok: false, message: 'JSON only.' }, 415);
        const b = await readJson(req);
        if (p === '/api/session') return newSession(req, env, b);
        if (p === '/api/event') return logEvent(env, b);
        if (p === '/api/lead') return json(chasePlan(b));
        if (p === '/api/token') return mintToken(env, b);
        if (p === '/api/voice') return mintVoice(env, b);
        if (p === '/api/sales/login') return salesLogin(req, env, b);
        if (p === '/api/sales/logout') { const sid = cookie(req, 'sales'); if (sid && /^[a-f0-9]{64}$/.test(sid)) await gate(env, { op: 'ssdelete', id: sid }); return json({ ok: true }, 200, { 'set-cookie': 'sales=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' }); }
        if (p === '/api/dev/login') {
          const ih = await ipHash(env, req);
          if ((await gate(env, { op: 'lcheck', ip: ih })).blocked) return json({ ok: false, message: 'Too many attempts. Wait 15 minutes.' }, 429);
          const ok = !!env.DEV_PASSCODE && typeof b.passcode === 'string' && await safeEqual(salt(env), b.passcode, env.DEV_PASSCODE);
          if (!ok) return json({ ok: false, message: 'Wrong passcode.' }, 401);
          await gate(env, { op: 'lok', ip: ih });
          const id = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
          await gate(env, { op: 'dscreate', id });
          return json({ ok: true }, 200, { 'set-cookie': 'dev=' + id + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800' });
        }
        if (p.startsWith('/api/dev/')) {
          if (!await devAuthed(req, env)) return json({ ok: false, message: 'Not signed in.' }, 401);
          if (p === '/api/dev/reset-today') return json(await gate(env, { op: 'resetday', day: today() }));
          if (p === '/api/dev/kill') return json(await gate(env, { op: 'kill', on: b.on === true }));
          if (p === '/api/dev/logout') { await gate(env, { op: 'dsdelete', id: cookie(req, 'dev') }); return json({ ok: true }, 200, { 'set-cookie': 'dev=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' }); }
        }
      }
      if (m === 'GET' && p.startsWith('/api/dev/')) {
        if (!await devAuthed(req, env)) return json({ ok: false, message: 'Not signed in.' }, 401);
        if (p === '/api/dev/stats') {
          const g = await gate(env, { op: 'stats', day: today() });
          return json({ ok: true, testMints: { used: g.mints, ceiling: testMintCeiling(env) }, voiceCalls: { used: g.vcalls, ceiling: voiceCeiling(env) }, day: today(), usedToday: g.used, dailyCap: +(env.DAILY_CAP || 10), ipCap: +(env.IP_CAP || 2), sessionSeconds: +(env.SESSION_SECONDS || 180), killed: g.killed, storage: 'Durable Object', checks: { turnstile: !!env.TURNSTILE_SECRET, turnstileKey: !!env.TURNSTILE_SITEKEY, geminiKey: !!env.GEMINI_API_KEY, engineB: env.ENGINE_B === '1', devPasscode: !!env.DEV_PASSCODE }, tenants: Object.keys(TENANTS), sessions: g.sessions });
        }
        if (p === '/api/dev/tenants') return json({ ok: true, tenants: TENANTS });
      }
      if (m === 'GET' && !p.startsWith('/api/') && (req.headers.get('accept') || '').includes('text/html')) return notFoundPage(env);
      return json({ ok: false, message: 'Not found' }, 404);
    } catch (e) {
      if (e instanceof TooLarge) return json({ ok: false, message: 'Request too large' }, 413);
      return json({ ok: false, message: 'Something went wrong.' }, 500);
    }
  }
};
