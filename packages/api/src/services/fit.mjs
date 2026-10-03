// The fit score (Station 9): deterministic from the ICP's traits, never a model call, so the same lead and ICP version
// always give the same score. A trait counts only when the lead has something to judge it by; one we can't judge
// (a size band, "other") is left out rather than scored as a miss. Weak traits (one cited row) count half.
const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'that', 'this', 'area', 'region', 'metro', 'greater', 'city', 'county',
  'practice', 'practices', 'business', 'businesses', 'company', 'companies', 'owner', 'owners', 'small', 'local', 'office', 'offices']);
const words = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
  .filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.replace(/(ies)$/, 'y').replace(/s$/, ''));

/**
 * @param icp   { id, version, data: { traits: [{ kind, value, weak }] } }
 * @param lead  { company, title, text, place } — text is what the lead's own site says; place is where it is
 * @returns     { score: 0–100 | null, fit: { icp, version, matched: [..], missed: [..] } }
 */
export function fitScore(icp, lead) {
  const about = new Set(words(`${lead.company ?? ''} ${lead.text ?? ''}`));
  const where = new Set(words(lead.place));
  const title = new Set(words(lead.title));
  let got = 0; let total = 0; const matched = []; const missed = [];
  for (const t of icp?.data?.traits ?? []) {
    const pool = t.kind === 'industry' ? about : t.kind === 'region' ? where : t.kind === 'title' ? title : null;
    const want = words(t.value);
    if (!pool || !pool.size || !want.length) continue;
    const w = t.weak ? 0.5 : 1;
    total += w;
    if (want.some((x) => pool.has(x))) { got += w; matched.push(`${t.kind}: ${t.value}`); } else missed.push(`${t.kind}: ${t.value}`);
  }
  return { score: total ? Math.round((100 * got) / total) : null, fit: { icp: icp?.id ?? null, version: icp?.version ?? null, matched, missed } };
}
