// Sequence generation (SPEC §1 step 6; Stations 12 and 24). One model call per lead writes its emails from the
// lead's own evidence; every draft then goes through the claims gate like a hand-written one. Nothing here sends,
// approves, or lets the model touch the database: the model returns text, this file checks its shape, and the gate
// judges what it says.
//
// Injection containment (SPEC §10): the offer, the prospect and the facts go in labelled data blocks, as JSON, and
// the prompt says data is never instructions. No tools run. A model that cites a fact we didn't give it gets that
// citation dropped, so the gate blocks the claim.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const PROMPT_ID = 'sequence@1';
const PROMPT = readFileSync(new URL(`../../../ai/prompts/${PROMPT_ID}.md`, import.meta.url), 'utf8');
export const PROMPT_SHA = createHash('sha256').update(PROMPT, 'utf8').digest('hex').slice(0, 16);
export const TIER = 'flash';               // per-lead drafts (DECISIONS 2026-09-28, models by task)
export const CREDITS_PER_LEAD = 1;         // action credits per lead per run: a placeholder until prices are decided

/**
 * Every sentence a draft may cite, from this contact's unexpired evidence: the `text` leaves of each evidence row's
 * facts (the enricher's "Your homepage offers online booking through Calendly."), id'd F1, F2… for the model.
 */
export function citableFacts(evidenceRows) {
  const out = [];
  const walk = (node, path, ev) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, val] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      if (k === 'text' && typeof val === 'string' && val.trim() && val.length <= 300) {
        out.push({ id: `F${out.length + 1}`, evidenceId: ev.id, factKey: p, text: val.trim() });
      } else if (val && typeof val === 'object' && !Array.isArray(val)) walk(val, p, ev);
    }
  };
  for (const ev of evidenceRows) walk(typeof ev.facts === 'string' ? JSON.parse(ev.facts) : ev.facts, '', ev);
  return out.slice(0, 20);
}

const block = (tag, value) => `<${tag}>\n${JSON.stringify(value, null, 1).replace(/</g, '\\u003c')}\n</${tag}>`;

export function buildRequest({ steps, offer, prospect, facts }) {
  return {
    tier: TIER,
    system: PROMPT,
    messages: [{ role: 'user', text: [
      `Task: write ${steps} email${steps === 1 ? '' : 's'}: the first email${steps > 1 ? ` and ${steps - 1} follow-up${steps > 2 ? 's' : ''}` : ''}.`,
      block('offer', offer),
      block('prospect', prospect),
      block('facts', facts.map((f) => ({ id: f.id, sentence: f.text }))),
    ].join('\n\n') }],
  };
}

/**
 * The model's answer → drafts with claims, or problems. Shape only; the gate decides what's true.
 * @returns { drafts: [{ step, subject, body, claims }], problems: string[] }
 */
export function parseSequence(text, facts, steps) {
  const problems = [];
  let data;
  try {
    data = JSON.parse(String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return { drafts: [], problems: ['not_json'] };
  }
  const emails = Array.isArray(data?.emails) ? data.emails : null;
  if (!emails) return { drafts: [], problems: ['no_emails'] };
  if (emails.length === 0) return { drafts: [], problems: ['declined'] };
  if (emails.length < steps) problems.push(`short:${emails.length}/${steps}`);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const drafts = [];
  for (const [step, e] of emails.slice(0, steps).entries()) {
    const subject = typeof e?.subject === 'string' ? e.subject.trim().slice(0, 200) : '';
    const body = typeof e?.body === 'string' ? e.body.trim() : '';
    if (!subject || body.length < 10 || body.length > 4000) { problems.push(`malformed:${step}`); break; }
    const cites = Array.isArray(e.cites) ? [...new Set(e.cites.filter((x) => typeof x === 'string'))] : [];
    const claims = [];
    for (const id of cites) {
      const f = byId.get(id);
      if (!f) { problems.push(`unknown_fact:${step}:${String(id).slice(0, 20)}`); continue; }
      claims.push({ text: f.text, evidence_id: f.evidenceId, fact_key: f.factKey });
    }
    drafts.push({ step, subject, body, claims });
  }
  return { drafts, problems };
}
