// Client fill-in link (Christian 2026-10-29, via Halo): /of/<token> is the page, /of/api/<token> reads and takes the answers.
// It sits outside /rep and its Access check, so the token is the only key: every answer is about that one Order Form, and a
// missing, wrong, expired or turned-off token reads the same as any other (404). The client sees and edits only their own
// details, services and setup, term and payment, and the onboarding details; never the account list, notes, reps, or pricing
// beyond the agreed package. What they send waits in client_links until the rep accepts it. The portal sends nothing.
// Rate limits: per visitor per day (hashed IP), per link (requests and submissions). A hidden honeypot field drops bots.
import clientHtml from './client.html';
import CSS from '../base.css';
import LOGO from '../logo.txt';
import * as O from './orderform.js';
import { ONBOARDING_FIELDS } from './content.js';

export const LIMITS = { ipPerDay: 120, linkHits: 400, linkPosts: 10, bodyBytes: 16384 };
const SECURITY = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...SECURITY } });
const gone = () => json({ ok: false, message: 'This link is not valid any more. Ask your OmniSDR contact for a new one.' }, 404);
const obj = (v) => { try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };

async function visitorKey(req, env) {
  // Never derive this from a real secret: the hash prefix is stored. IP_SALT is optional; rows last one day either way.
  const ip = req.headers.get('cf-connecting-ip') || 'local', salt = env.IP_SALT || 'omnisdr-of';
  return 'of:' + new Date().toISOString().slice(0, 10) + ':' + (await O.tokenHash(salt + '|' + ip)).slice(0, 32);
}

// The agreed package as the client may see it: the plan, the price and the usage mix. No allowance, pay or notes.
const packageView = (p = {}) => ({ plan: p.plan === 'Custom' ? 'Custom Build' : p.plan || '', priceCents: p.priceCents ?? null,
  ...(p.minutes != null ? { minutes: p.minutes, texts: p.texts, threads: p.threads } : {}) });

function page() {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const html = clientHtml.replaceAll('__NONCE__', nonce).replace('__CSS__', CSS).replaceAll('__LOGO__', LOGO.trim());
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY,
    'strict-transport-security': 'max-age=63072000; includeSubDomains', 'permissions-policy': 'microphone=(), camera=(), geolocation=()',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` } });
}

export async function handleClient(req, env) {
  const u = new URL(req.url), p = u.pathname, m = req.method;
  try {
    if (!env.REP_DB) return json({ ok: false, message: 'Not available' }, 503);
    const D = env.REP_DB, t = new Date().toISOString();
    const seen = await D.prepare('INSERT INTO public_hits (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n').bind(await visitorKey(req, env)).first();
    if (seen && seen.n > LIMITS.ipPerDay) return json({ ok: false, message: 'Too many requests today. Try again tomorrow.' }, 429);
    // Keys start with the day, so earlier days sort first; now and then drop them so the table stays one day long.
    if (Math.random() < 0.02) await D.prepare('DELETE FROM public_hits WHERE key < ?').bind('of:' + t.slice(0, 10)).run();

    const pageMatch = p.match(/^\/of\/([^/]+)\/?$/), apiMatch = p.match(/^\/of\/api\/([^/]+)$/);
    if (pageMatch && pageMatch[1] !== 'api') return m === 'GET' && O.isToken(pageMatch[1]) ? page() : gone();
    if (!apiMatch || !O.isToken(apiMatch[1])) return gone();

    const link = await D.prepare('SELECT * FROM client_links WHERE token_hash = ?').bind(await O.tokenHash(apiMatch[1])).first();
    if (!link || link.revoked_at || link.expires_at <= t) return gone();
    if (link.hits >= LIMITS.linkHits) return json({ ok: false, message: 'This link has been opened too many times. Ask your OmniSDR contact for a new one.' }, 429);
    await D.prepare('UPDATE client_links SET hits = hits + 1 WHERE token_hash = ?').bind(link.token_hash).run();
    const f = await D.prepare('SELECT * FROM order_forms WHERE id = ?').bind(link.order_form_id).first();
    if (!f || !['draft', 'client_review'].includes(f.status)) return gone();
    const data = obj(f.data), label = O.formNumber(f.number);

    if (m === 'GET') {
      const acct = await D.prepare('SELECT onboarding FROM accounts WHERE id = ?').bind(f.account_id).first();
      const sent = link.submitted_at && !link.reviewed_at ? obj(link.submission) : {}; // their own answers back, while they wait
      const values = Object.fromEntries(O.CLIENT_SECTIONS.map((n) => [n, { ...(data[n] || {}), ...(sent[n] || {}) }]));
      values.onboarding = { ...obj(acct && acct.onboarding), ...(sent.onboarding || {}) };
      return json({ ok: true, number: label, expiresAt: link.expires_at, submittedAt: link.submitted_at, package: packageView(data.package),
        sections: Object.fromEntries(O.CLIENT_SECTIONS.map((n) => [n, O.SECTIONS[n]])), onboardingFields: ONBOARDING_FIELDS, values });
    }
    if (m === 'POST') {
      const o = req.headers.get('origin'); if (o && o !== u.origin) return json({ ok: false, message: 'Cross-site request refused' }, 403);
      if (!(req.headers.get('content-type') || '').startsWith('application/json')) return json({ ok: false, message: 'Send JSON' }, 415);
      const text = await req.text(); if (text.length > LIMITS.bodyBytes) return json({ ok: false, message: 'Request too large' }, 413);
      let b; try { b = JSON.parse(text); } catch { return json({ ok: false, message: 'That was not valid' }, 400); }
      if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ ok: false, message: 'That was not valid' }, 400);
      if (link.posts >= LIMITS.linkPosts) return json({ ok: false, message: 'This link has taken its answers. Contact your OmniSDR rep to change them.' }, 429);
      // A person never sees the `website` field; a filled one is thanked and dropped, so a bot learns nothing.
      if (typeof b.website === 'string' && b.website.trim()) return json({ ok: true });
      const sub = {};
      try { for (const n of O.CLIENT_SECTIONS) sub[n] = O.cleanSection(n, b[n]); } catch (e) { if (e instanceof O.FieldError) return json({ ok: false, message: e.message }, 400); throw e; }
      sub.onboarding = {};
      for (const fld of ONBOARDING_FIELDS) {
        const v = (b.onboarding || {})[fld.key];
        if (v == null || v === '') continue;
        if (typeof v !== 'string' || v.length > 1000) return json({ ok: false, message: `${fld.label} is limited to 1000 characters` }, 400);
        if (v.trim()) sub.onboarding[fld.key] = v.trim();
      }
      await D.batch([
        D.prepare('UPDATE client_links SET submission = ?, submitted_at = ?, reviewed_at = NULL, posts = posts + 1 WHERE token_hash = ?').bind(JSON.stringify(sub), t, link.token_hash),
        D.prepare("UPDATE order_forms SET status = 'client_review', updated_at = ? WHERE id = ? AND status = 'draft'").bind(t, f.id),
        D.prepare("INSERT INTO activities (id, account_id, rep_email, kind, body, created_at) VALUES (?, ?, NULL, 'note', ?, ?)").bind(crypto.randomUUID(), f.account_id, `Client filled in Order Form ${label}: review it`, t),
        D.prepare('INSERT INTO audit (actor, action, entity, entity_id, before, after, at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('client_link', 'client_submit', 'order_form', f.id, null, JSON.stringify({ sections: Object.keys(sub) }), t),
      ]);
      return json({ ok: true });
    }
    return json({ ok: false, message: 'Not allowed' }, 405);
  } catch {
    return json({ ok: false, message: 'Something went wrong. Try again.' }, 500);
  }
}
