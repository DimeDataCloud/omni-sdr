// ICP proposal (SPEC §1 step 3; Station 09): past clients + what the business says → a proposed ideal customer profile
// whose every trait cites the client rows (or the business's own notes) that show it. The model only proposes; the
// person edits and saves through the versioned ICP route (S8: a saved version never changes, campaigns stay pinned).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const ICP_PROMPT_ID = 'icp@1';
const PROMPT = readFileSync(new URL(`../../../ai/prompts/${ICP_PROMPT_ID}.md`, import.meta.url), 'utf8');
export const ICP_PROMPT_SHA = createHash('sha256').update(PROMPT, 'utf8').digest('hex').slice(0, 16);
export const ICP_TIER = 'pro';            // ICP proposal is a Pro task (DECISIONS 2026-09-28, models by task)
export const ICP_CREDITS = 2;             // action credits per proposal: a placeholder until prices are decided
const KINDS = new Set(['industry', 'title', 'size', 'region', 'other']);
const FIELDS = ['company', 'title', 'industry', 'size', 'city', 'region', 'website', 'notes'];

/** Rows numbered from 1, only the known fields, each value trimmed and capped. */
export function cleanRows(rows) {
  return rows.slice(0, 200).map((r, i) => ({ row: i + 1,
    ...Object.fromEntries(FIELDS.filter((f) => typeof r?.[f] === 'string' && r[f].trim()).map((f) => [f, r[f].trim().slice(0, 200)])) }))
    .filter((r) => Object.keys(r).length > 1);
}

const block = (tag, value) => `<${tag}>\n${JSON.stringify(value, null, 1).replace(/</g, '\\u003c')}\n</${tag}>`;

export function buildIcpRequest({ rows, notes }) {
  return { tier: ICP_TIER, system: PROMPT, messages: [{ role: 'user', text: [
    `Task: propose one ideal customer profile from these ${rows.length} past clients.`, block('clients', rows), block('notes', notes ?? ''),
  ].join('\n\n') }] };
}

/** The model's answer → a proposal whose every trait cites real rows (or the notes), or problems. */
export function parseIcp(text, rows, { hasNotes = false } = {}) {
  let d;
  try { d = JSON.parse(String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return { proposal: null, problems: ['not_json'] }; }
  const problems = [];
  const valid = new Set(rows.map((r) => r.row));
  const traits = [];
  for (const t of Array.isArray(d?.traits) ? d.traits.slice(0, 30) : []) {
    const value = typeof t?.value === 'string' ? t.value.trim().slice(0, 120) : '';
    if (!value || !KINDS.has(t.kind)) { problems.push('malformed_trait'); continue; }
    const cited = [...new Set((Array.isArray(t.rows) ? t.rows : []).filter((n) => Number.isInteger(n)))];
    const real = cited.filter((n) => valid.has(n));
    if (real.length < cited.length) problems.push(`unknown_rows:${value.slice(0, 30)}`);
    const fromNotes = t.notes === true && hasNotes;
    if (!real.length && !fromNotes) { problems.push(`uncited:${value.slice(0, 30)}`); continue; }   // no support: dropped
    traits.push({ kind: t.kind, value, rows: real.sort((a, b) => a - b), notes: fromNotes, weak: real.length <= 1 && !fromNotes ? true : t.weak === true });
  }
  if (!traits.length) return { proposal: null, problems: [...problems, 'no_supported_traits'] };
  return { proposal: { name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 120) : 'Ideal customer',
    summary: typeof d.summary === 'string' ? d.summary.trim().slice(0, 300) : '', traits }, problems };
}
