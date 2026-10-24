import demoHtml from './demo.html';
import devHtml from './dev.html';
import CSS from './base.css';
import LOGO from './logo.txt';
import { TENANTS, DEFAULT_TENANT } from './tenant.js';
import { buildInstruction, bookSlotTool } from './engine-instruction.js';

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

function page(html, env) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  let body = html.replaceAll('__NONCE__', nonce).replace('__CSS__', CSS).replace('__LOGO__', LOGO.trim());
  if (env.TURNSTILE_SITEKEY) body = body.replace('<meta name="robots"', '<meta name="ts-key" content="' + String(env.TURNSTILE_SITEKEY).replace(/[^\w-]/g, '') + '"><meta name="robots"');
  return new Response(body, { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow',
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'self' 'nonce-" + nonce + "' https://challenges.cloudflare.com; style-src 'self' 'nonce-" + nonce + "'; img-src 'self' data:; connect-src 'self' wss://generativelanguage.googleapis.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
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
    for (const [k, v] of await this.s.list({ prefix: 'tok:' })) if (now - v > 2 * DAY) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'lf:' })) if (v.until < now && now - v.last > 15 * 60000) await this.s.delete(k);
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
      case 'stats': {
        const list = [...(await s.list({ prefix: 's:' })).values()].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 25);
        return R({ mints: (await s.get('mints')) || 0, used: (await s.get('day:' + b.day)) || 0, killed: (await s.get('kill')) === true, sessions: list.map((r) => ({ sid: r.sid.slice(0, 8), tenant: r.tenant, at: r.at, events: r.events.length, last: r.events.at(-1)?.type || '' })) });
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
      case 'dsdelete': await s.delete('ds:' + b.id); return R({ ok: true });
    }
    return R({ ok: false }, 400);
  }
}
const gate = (env, op) => env.GATE.get(env.GATE.idFromName('main')).fetch('https://gate/', { method: 'POST', body: JSON.stringify(op) }).then((r) => r.json().then((j) => { j._s = r.status; return j; }));

/* ---------- auth ---------- */
const cookie = (req, name) => (req.headers.get('cookie') || '').split(/;\s*/).map((c) => c.split('=')).find((p) => p[0] === name)?.[1];
async function devAuthed(req, env) { const id = cookie(req, 'dev'); if (!id || !/^[a-f0-9]{64}$/.test(id)) return false; return (await gate(env, { op: 'dscheck', id })).ok === true; }

/* ---------- handlers ---------- */
const publicTenant = (id) => { const t = TENANTS[id]; return { id: t.id, business: t.business, owner: t.owner, persona: t.persona, niche: t.niche, hours: t.hours, serviceZips: t.serviceZips, services: t.services, outOfScope: t.outOfScope, estimate: t.estimate, slots: t.slots, hot: t.hot, license: t.license }; };
const pickTenant = (id) => (typeof id === 'string' && Object.hasOwn(TENANTS, id)) ? id : DEFAULT_TENANT;
const MSG = {
  paused: 'The live demo is paused. Book a live demo with Dime Data instead.',
  'daily-cap': "Today's demo sessions are used up. Book a live demo and we'll walk you through it.",
  'ip-cap': 'You have used your demo sessions for today. Book a live demo for more.'
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

// CHASE simulation: returns the planned cadence for the chosen tenant. Nothing is sent anywhere.
function chasePlan(b) {
  const t = TENANTS[pickTenant(b.tenant)];
  const name = (String(b.name || 'there').replace(/[^\w' -]/g, '').slice(0, 40).split(' ')[0]) || 'there';
  const hr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })).getHours();
  const quiet = hr >= t.quietHours[0] || hr < t.quietHours[1];
  const steps = [
    { at: 'T+8 s', text: `Hi ${name}, it's ${t.persona} with ${t.business}. Thanks for reaching out about your bathroom. Are you looking at a tub-to-shower swap, or a bigger remodel? (Automated assistant. Reply STOP to opt out.)` },
    { at: 'T+4 min', text: `${name}, ${t.owner} can come by for ${t.estimate}. Does ${t.slots[0]} or ${t.slots[1]} work?` },
    { at: 'T+1 day', text: `Hi ${name}, still thinking about the bathroom? I can hold ${t.slots[2]} for you. Just reply with a time that works.` },
    { at: 'T+3 days', text: `Last note from ${t.business}, ${name}. If the timing is off, no worries. Reply any time and we'll pick it back up.` }
  ];
  return { ok: true, simulated: true, quietHoursNow: quiet, note: quiet ? 'It is quiet hours now: the first text is queued until 8 AM instead of sending in 8 seconds.' : 'Within hours: first text goes out in under 60 seconds.', steps, rules: ['Stops on reply, booking, STOP, or wrong number', 'Max 3 contacts per 24 hours', 'Quiet hours 9 PM to 8 AM local', 'Every text identifies the sender as automated and offers STOP'] };
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
    try {
      const u = new URL(req.url), p = u.pathname, m = req.method;
      if (m === 'GET' && p === '/') return page(demoHtml, env);
      if (m === 'GET' && p === '/dev') return page(devHtml, env);
      if (m === 'GET' && p === '/healthz') return json({ ok: true });
      if (m === 'GET' && p === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
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
          return json({ ok: true, testMints: { used: g.mints, ceiling: testMintCeiling(env) }, day: today(), usedToday: g.used, dailyCap: +(env.DAILY_CAP || 10), ipCap: +(env.IP_CAP || 2), sessionSeconds: +(env.SESSION_SECONDS || 180), killed: g.killed, storage: 'Durable Object', checks: { turnstile: !!env.TURNSTILE_SECRET, turnstileKey: !!env.TURNSTILE_SITEKEY, geminiKey: !!env.GEMINI_API_KEY, engineB: env.ENGINE_B === '1', devPasscode: !!env.DEV_PASSCODE }, tenants: Object.keys(TENANTS), sessions: g.sessions });
        }
        if (p === '/api/dev/tenants') return json({ ok: true, tenants: TENANTS });
      }
      return json({ ok: false, message: 'Not found' }, 404);
    } catch (e) {
      if (e instanceof TooLarge) return json({ ok: false, message: 'Request too large' }, 413);
      return json({ ok: false, message: 'Something went wrong.' }, 500);
    }
  }
};
