// Pure helpers: phone and name normalisation, niche classification, dedupe keys. No I/O, no globals.
export function normPhone(p) {
  if (!p) return null;
  const first = String(p).split(/[;,\/]|\bor\b/i)[0];
  let d = first.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10 || /^[01]/.test(d) || /^\d{3}[01]/.test(d)) return null; // NANP: area and exchange never start 0 or 1
  return d;
}
export const fmtPhone = (d) => (d ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : '');
export function normDomain(url) {
  if (!url) return null;
  try { const u = new URL(/^https?:/i.test(url) ? url : `https://${url}`); return u.hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}
export const normName = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(llc|inc|co|corp|corporation|company|ltd|the|and)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export function dedupeKey(l) {
  return normPhone(l.phone) ? `p:${normPhone(l.phone)}` : normDomain(l.website) ? `d:${normDomain(l.website)}` : `n:${normName(l.business)}|${String(l.street || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
export function classifyNiche(text, niches) {
  const hits = niches.filter((n) => new RegExp(n.kw, 'i').test(text));
  return hits.length ? hits[0] : null;
}
export function isChain(name, excl) {
  const n = String(name || '').toLowerCase();
  return excl.chainNames.some((c) => n.includes(c));
}
export function looksNonTrade(name, excl) {
  const words = String(name || '').toLowerCase().split(/[^a-z]+/);
  return excl.nonTradeNameHints.some((h) => (h.includes(' ') ? String(name).toLowerCase().includes(h) : words.includes(h)));
}
export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
