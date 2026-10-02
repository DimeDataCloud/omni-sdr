// Competitor research (Station 10): the model suggests (with Google Search grounding) and writes battlecards from
// snapshots of the competitor's own pages. Every battlecard statement must quote its snapshot word for word; one
// that doesn't is dropped here, so nothing uncited reaches a person (the station's guardrail).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { numbersIn } from '../../../gate/src/check.mjs';

const prompt = (id) => readFileSync(new URL(`../../../ai/prompts/${id}.md`, import.meta.url), 'utf8');
const sha16 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
export const SUGGEST = { id: 'competitors@1', text: prompt('competitors@1') };
export const CARD = { id: 'battlecard@1', text: prompt('battlecard@1') };
SUGGEST.sha = sha16(SUGGEST.text); CARD.sha = sha16(CARD.text);
export const SUGGEST_CREDITS = 1;
export const CARD_CREDITS = 2;              // per competitor researched: placeholders until prices are decided
export const SECTIONS = ['targets', 'claims', 'pricing', 'strengths', 'weaknesses', 'where_we_win'];

const block = (tag, value) => `<${tag}>\n${JSON.stringify(value, null, 1).replace(/</g, '\\u003c')}\n</${tag}>`;
const json = (text) => JSON.parse(String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));

/** A hostname from what a person typed or a model returned; null when it isn't a plausible public site. */
export function domainOf(raw) {
  try {
    const u = new URL(/^https?:\/\//i.test(String(raw)) ? String(raw) : `https://${raw}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]+\.[a-z]{2,63}$/.test(h) && !/\.(local|internal|localhost|test|invalid)$/.test(h) ? h : null;
  } catch { return null; }
}

export function suggestRequest(business) {
  return { tier: 'pro', grounded: true, system: SUGGEST.text, messages: [{ role: 'user', text: `Task: suggest competitors.\n\n${block('business', business)}` }] };
}

export function parseSuggestions(text, { exclude = [] } = {}) {
  let d; try { d = json(text); } catch { return []; }
  const seen = new Set(exclude);
  const out = [];
  for (const s of Array.isArray(d?.suggestions) ? d.suggestions.slice(0, 3) : []) {
    const domain = domainOf(s?.website);
    const name = typeof s?.name === 'string' ? s.name.trim().slice(0, 120) : '';
    const reason = typeof s?.reason === 'string' ? s.reason.trim().slice(0, 500) : '';
    if (!domain || !name || reason.length < 15 || seen.has(domain)) continue;   // no reason, no suggestion
    seen.add(domain);
    out.push({ name, domain, reason });
  }
  return out;
}

/** The visible text of a page: no scripts, styles or tags; entities decoded; whitespace collapsed; capped. */
export function pageText(html) {
  return String(html ?? '')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h\d|tr|section|article|br)>/gi, '. ').replace(/<br\s*\/?>/gi, '. ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').replace(/(\.\s*){2,}/g, '. ').trim().slice(0, 20000);
}

/** Up to `max` more pages worth reading on the same site: pricing first, then about/services. */
export function morePages(html, baseUrl, max = 2) {
  const base = new URL(baseUrl);
  const links = [...String(html ?? '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => { try { return { url: new URL(m[1], base), label: m[2].replace(/<[^>]+>/g, ' ').toLowerCase() }; } catch { return null; } })
    .filter((x) => x && x.url.hostname === base.hostname && /^https?:$/.test(x.url.protocol) && x.url.pathname !== base.pathname);
  const rank = (x) => (/pric|plans|cost/.test(x.url.pathname + x.label) ? 0 : /about|service|solution|product|feature/.test(x.url.pathname + x.label) ? 1 : 9);
  const picked = [];
  for (const x of links.filter((l) => rank(l) < 9).sort((a, b) => rank(a) - rank(b))) {
    const href = `${x.url.origin}${x.url.pathname}`;
    if (!picked.includes(href)) picked.push(href);
    if (picked.length >= max) break;
  }
  return picked;
}

export function cardRequest({ us, snapshots }) {
  return { tier: 'pro', system: CARD.text, messages: [{ role: 'user', text: [
    'Task: write the battlecard.', block('us', us), block('pages', snapshots.map((s) => ({ id: s.ref, url: s.url, text: s.text }))),
  ].join('\n\n') }] };
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/** Keep only statements whose quote is really on the page they cite. Returns { doc, kept, dropped, refs }. */
export function validateCard(text, snapshots) {
  let d; try { d = json(text); } catch { return { doc: null, kept: 0, dropped: 0, refs: [] }; }
  const byRef = new Map(snapshots.map((s) => [s.ref, { ...s, ntext: norm(s.text) }]));
  let kept = 0; let dropped = 0; const used = new Set();
  // `said` is what the card will assert. Its numbers (prices, terms, counts) must be in the quote itself: a quote that
  // is on the page but says something else can't carry "$499 a month, 2-year contract" (#54 audit P2-1).
  const check = (x, said) => {
    const snap = byRef.get(x?.cite);
    const quote = typeof x?.quote === 'string' ? x.quote.trim() : '';
    if (!snap || quote.length < 8 || quote.length > 300 || !snap.ntext.includes(norm(quote))) { dropped++; return null; }
    const inQuote = new Set(numbersIn(quote));
    if (numbersIn(said).some((n) => !inQuote.has(n))) { dropped++; return null; }
    kept++; used.add(snap.ref);
    return { cite: snap.ref, snapshotId: snap.id, url: snap.url, quote: quote.slice(0, 300) };
  };
  const doc = {};
  for (const sec of SECTIONS) {
    doc[sec] = [];
    for (const x of Array.isArray(d?.[sec]) ? d[sec].slice(0, 12) : []) {
      const t = typeof x?.text === 'string' ? x.text.trim().slice(0, 300) : '';
      const c = t ? check(x, t) : (dropped++, null);
      if (c) doc[sec].push({ text: t, ...c });
    }
  }
  doc.objection_handlers = [];
  for (const x of Array.isArray(d?.objection_handlers) ? d.objection_handlers.slice(0, 8) : []) {
    const o = typeof x?.objection === 'string' ? x.objection.trim().slice(0, 200) : '';
    const a = typeof x?.answer === 'string' ? x.answer.trim().slice(0, 400) : '';
    const c = o && a ? check(x, a) : (dropped++, null);
    if (c) doc.objection_handlers.push({ objection: o, answer: a, ...c });
  }
  return { doc, kept, dropped, refs: snapshots.filter((s) => used.has(s.ref)).map((s) => ({ ref: s.ref, snapshotId: s.id, url: s.url, sha: s.sha, fetchedAt: s.fetchedAt })) };
}

/** What changed between two battlecard versions, statement by statement (Station 10: a re-run shows the change). */
export function diffCards(prev, next) {
  const key = (x) => norm(x.text ?? `${x.objection} → ${x.answer}`);
  const out = {};
  for (const sec of [...SECTIONS, 'objection_handlers']) {
    const a = new Set((prev?.[sec] ?? []).map(key)); const b = new Set((next?.[sec] ?? []).map(key));
    const added = (next?.[sec] ?? []).filter((x) => !a.has(key(x))).map((x) => x.text ?? x.objection);
    const removed = (prev?.[sec] ?? []).filter((x) => !b.has(key(x))).map((x) => x.text ?? x.objection);
    if (added.length || removed.length) out[sec] = { added, removed };
  }
  return out;
}
