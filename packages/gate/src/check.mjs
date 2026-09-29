// Claims gate check (INFRA §12.1). Pure and deterministic: same inputs, same verdict, no clock
// reads, no model calls. Fails closed: anything it can't prove is a finding, and any finding
// blocks the draft.
//
// Input draft: { subject, body, step, claims: [{ text, evidence_id, fact_key, source? }] }
// Input ctx:   { contactId, evidence: Map<id, {contact_id, facts, expires_at}>, now: Date,
//                competitors: string[] }
// Output:      { passed, version, findings: [{ code, detail }] }

export const GATE_VERSION = 'gate-1';

// §12.1 #5: revenue-loss figures only from a registered formula with its inputs attached.
// Empty until a formula is specified and tested; until then every revenue-loss figure is blocked.
export const REVENUE_FORMULAS = Object.freeze(new Set([]));

const NUMBER = /(?<![\w.])\$?\d[\d,]*(?:\.\d+)?%?/g;
const SUPERLATIVE = /\b(best|worst|fastest|slowest|cheapest|most|least|leading|largest|biggest|highest|lowest|guaranteed?|number one|the only)\b|#1\b/i;
const REVENUE_LOSS = /\b(los(e|es|ing|t)|leav(e|es|ing)|miss(es|ing|ed)?|leak(s|ing)?|wast(e|es|ing))\b/i;

// §12.1 #4. Implied prior contact is banned on a first touch; generic filler is banned everywhere.
const PRIOR_CONTACT_ALWAYS = [
  'as we discussed', 'as discussed', 'per our conversation', 'per our call', 'great talking', 'great chatting',
  'as promised', 'you requested', 'you asked for', 'thanks for your interest', 'nice to meet you again',
];
const PRIOR_CONTACT_FIRST_TOUCH = ['following up', 'circling back', 'my last email', 'my previous email', 'just checking in'];
const FILLER = [
  'hope this email finds you well', 'hope this message finds you well', "hope you're doing well", 'hope you are doing well',
  'touch base', 'circle back', 'synergy', 'pick your brain', 'quick question for you', 'came across your',
  'stumbled upon your', 'help businesses like yours',
];

const firstTouchOf = (d) => !(Number(d?.step) > 0);
const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
export function numbersIn(text) {
  return (String(text ?? '').match(NUMBER) ?? []).map((n) => Number(n.replace(/[$,%]/g, '')));
}
function sentences(subject, body) {
  const parts = [];
  if (subject) parts.push(String(subject));
  for (const s of String(body ?? '').split(/(?<=[.!?])\s+|\n+/)) if (s.trim()) parts.push(s.trim());
  return parts;
}
function factAt(facts, key) {
  if (typeof key !== 'string' || !key) return undefined;
  return key.split('.').reduce((o, k) => (o !== null && typeof o === 'object' && k in o ? o[k] : undefined), facts);
}
function factNumbers(value) {
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') return numbersIn(value);
  if (value && typeof value === 'object' && 'value' in value) return factNumbers(value.value);
  return [];
}

export function checkDraft(draft, ctx) {
  const findings = [];
  const add = (code, detail) => findings.push({ code, detail });
  const claims = Array.isArray(draft?.claims) ? draft.claims : null;
  if (!claims) add('claims_malformed', 'claims is not an array');
  if (!(ctx?.now instanceof Date)) add('no_clock', 'ctx.now is required (the check never reads the clock itself)');

  // #1, #2, #6: each claim is backed by this contact's unexpired evidence, and its numbers match the fact.
  const valid = [];
  for (const [i, c] of (claims ?? []).entries()) {
    const at = `claims[${i}]`;
    if (!c || typeof c.text !== 'string' || !c.text.trim() || typeof c.evidence_id !== 'string' || typeof c.fact_key !== 'string') {
      add('claim_malformed', `${at} needs text, evidence_id and fact_key`); continue;
    }
    if (c.source && c.source !== 'evidence') { add('tenant_claims_unsupported', `${at} source ${c.source}: tenant-asset claims arrive with Station 18`); continue; }
    const ev = ctx?.evidence?.get(c.evidence_id);
    if (!ev) { add('evidence_not_found', `${at} evidence ${c.evidence_id}`); continue; }
    if (ev.contact_id !== ctx.contactId) { add('evidence_wrong_contact', `${at} evidence belongs to another contact`); continue; }
    if (!(new Date(ev.expires_at) > ctx.now)) { add('evidence_expired', `${at} evidence expired ${ev.expires_at}`); continue; }
    const value = factAt(ev.facts, c.fact_key);
    if (value === undefined) { add('fact_missing', `${at} fact_key ${c.fact_key} not on evidence`); continue; }
    const have = factNumbers(value);
    const wrong = numbersIn(c.text).filter((n) => !have.includes(n));
    if (wrong.length) { add('number_mismatch', `${at} ${wrong.join(', ')} not in fact ${c.fact_key}=${JSON.stringify(value)}`); continue; }
    valid.push({ ...c, value, ntext: norm(c.text) });
  }

  // #3: every sentence with a number, $, % or superlative is covered by a valid claim, number for number.
  const sents = sentences(draft?.subject, draft?.body);
  const nsents = sents.map(norm);
  for (const c of valid) {
    if (!nsents.some((s) => s.includes(c.ntext))) add('claim_not_in_body', `claim "${c.text}" does not appear in the draft`);
  }
  for (const [i, s] of sents.entries()) {
    const nums = numbersIn(s);
    const risky = nums.length > 0 || /[$%]/.test(s) || SUPERLATIVE.test(s);
    if (!risky) continue;
    const covering = valid.filter((c) => nsents[i].includes(c.ntext));
    if (!covering.length) { add('unsupported_sentence', s); continue; }
    const claimed = covering.flatMap((c) => numbersIn(c.text));
    const loose = nums.filter((n) => !claimed.includes(n));
    if (loose.length) add('unsupported_number', `${loose.join(', ')} in: ${s}`);
    // #5: a money figure framed as a loss must come from a registered formula with inputs.
    if (/\$/.test(s) && REVENUE_LOSS.test(s)) {
      const ok = covering.some((c) => c.value && typeof c.value === 'object' && REVENUE_FORMULAS.has(c.value.formula)
        && c.value.inputs && typeof c.value.inputs === 'object');
      if (!ok) add('revenue_formula_required', s);
    }
  }

  // Evidence-first (INFRA §11, guide Station 12): a first touch must rest on at least one verified fact.
  // Proposal pending Christian: follow-ups (step > 0) may be evidence-free ("worth a look?").
  if (firstTouchOf(draft) && valid.length === 0) add('no_evidence', 'a first-touch draft must cite at least one fact');

  // #4: banned phrases and competitor names.
  const whole = norm(`${draft?.subject ?? ''} ${draft?.body ?? ''}`);
  const firstTouch = firstTouchOf(draft);
  for (const p of [...PRIOR_CONTACT_ALWAYS, ...(firstTouch ? PRIOR_CONTACT_FIRST_TOUCH : [])]) {
    if (whole.includes(p)) add('implied_prior_contact', p);
  }
  if (firstTouch && /^\s*(re|fwd?):/i.test(String(draft?.subject ?? ''))) add('implied_prior_contact', 'subject starts with Re:/Fwd:');
  for (const p of FILLER) if (whole.includes(p)) add('banned_filler', p);
  for (const name of ctx?.competitors ?? []) {
    const n = norm(name);
    if (n && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(whole)) add('competitor_named', name);
  }

  return { passed: findings.length === 0, version: GATE_VERSION, findings };
}
