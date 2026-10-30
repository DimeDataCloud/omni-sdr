// Order Forms for the guided deal flow (Christian 2026-10-29, via Halo). One record holds what the filed Order Form says,
// typed once: the package (quote), client details, services and setup, term and payment, and the signing date. Field labels
// follow the Order Form template's own layout; this file writes no legal wording. Prices and the usage mix come from
// content.js and mix.js only, so a price change lands in one place. The record also carries exactly what omni-invoice's
// record_order_form needs, so invoicing reads it instead of a PDF.
import * as C from './content.js';
import * as M from './mix.js';

export const PLANS = ['Pilot', 'Lite', 'Standard', 'Plus', 'Custom', 'Agency'];
// Reps quote the Pilot only (PRICES level 1). The plans, custom work and agency deals are priced by Christian (levels 2 to 4
// carry no quotable amount), so only an admin may put them on an Order Form, with the agreed price.
export const REP_PLANS = ['Pilot'];
const PLAN_ALLOWANCE = Object.fromEntries(M.MIX.plans.map((p) => [p.label, p.allowanceCents]));

const choice = (options) => ({ kind: 'choice', options });
// Legal's wording (PR 195 review, Brain-Shared e323064), used as written. One copy, read by both pages.
export const NOTES = {
  term: 'Start: date of signature (setup begins). Usage and the Pilot Period start at go-live. Cancellation: either party, written notice at least 30 days before the end of a billing period.',
  signing: 'No e-signature here. The client and Christian each sign the Order Form. Record the date each signed and where the fully signed copy is filed. Do not file until both signatures are on it.',
  summary: 'This is a summary of the details entered in the portal. It is not the Order Form. The signed OmniSDR Order Form controls.',
  numbers: 'You authorize OmniSDR to receive and answer calls forwarded from these numbers, and to place calls and send texts from them or from numbers OmniSDR obtains for you, as configured under the Agreement.',
  requests: 'Questions or requests for OmniSDR (not part of the Agreement unless OmniSDR writes it into the signed Order Form)',
  pilotFee: 'Pilot fee, plus tax, paid at signing.',
  intro: 'Describe only what the Order Form and Agreement say. Do not promise results or terms that are not written in it.',
};
// `help` shows under a field on both pages.
// `admin: true` fields are set by an admin only: a rep is refused, the client never sees them, and a rep's save keeps them.
export const SECTIONS = {
  client: [
    { key: 'legalName', label: 'Legal name', max: 160, req: true },
    { key: 'tradingName', label: 'Trading name', max: 160 },
    { key: 'entityType', label: 'Entity type', max: 80 },
    { key: 'entityState', label: 'State of formation', max: 40 },
    { key: 'address', label: 'Address', max: 200, req: true },
    { key: 'city', label: 'City', max: 80, req: true },
    { key: 'state', label: 'State', kind: 'state', req: true },
    { key: 'zip', label: 'ZIP', max: 10, req: true },
    { key: 'signerName', label: 'Signer', max: 120, req: true },
    { key: 'signerTitle', label: 'Signer title', max: 80 },
    { key: 'noticeEmail', label: 'Notice email', kind: 'email' },
    { key: 'billingName', label: 'Billing contact', max: 120 },
    { key: 'billingEmail', label: 'Billing email', kind: 'email', req: true },
  ],
  services: [
    { key: 'answer', label: 'ANSWER: inbound AI call answering, transfers, messages, booking', kind: 'bool' },
    { key: 'followUp', label: 'Follow-up: texts and emails to people who called or wrote to Client', kind: 'bool' },
    // An intent flag only: outbound stays off until the signed Outbound Compliance Attestation is in (the go-live gate).
    { key: 'chase', label: "CHASE: outbound calls and texts to Client's leads (needs the signed Outbound Compliance Attestation before go-live)", kind: 'bool' },
    { key: 'numbers', label: 'Client number(s) to be answered', max: 200, help: NOTES.numbers },
    { key: 'setup', label: 'Setup', ...choice({ forward_no_answer: 'Forward on no answer/busy', forward_all: 'Forward all calls', port: 'Port number to Provider', new_number: 'New number from Provider' }) },
    { key: 'locations', label: 'Locations', max: 200 },
    { key: 'integrations', label: 'Integrations (calendar, CRM, email)', max: 200 },
  ],
  term: [
    // Stripe's own mandate on the payment page is the card or ACH authorization; nothing here stands in for it.
    // ACH is preferred, so it is listed first; card is optional (legal, PR 195). The label carries the MSA sentence once.
    { key: 'paymentMethod', label: 'Payment method (on file and charged automatically under MSA Section 5.3)', ...choice({ ach: 'ACH (bank), preferred', card: 'Card' }), req: true },
    // Choices, not free text, so no one can write in a term the Agreement does not have. The start is shown as NOTES.term.
    { key: 'initialTerm', label: 'Initial term', ...choice({ pilot: 'The Pilot Period (30 days from go-live)', one_month: 'One month (no pilot)' }), req: true },
    { key: 'renewal', label: 'Renewal', ...choice({ month_to_month: 'Month to month' }), req: true },
    { key: 'specialTerms', label: 'Special terms (admin only). State which section of the Agreement each term changes. Promises not written here are not part of the Agreement.', max: 1000, admin: true },
  ],
  // Both parties sign; the form is signed on the later of the two dates. Christian's date is an admin's to record.
  signing: [
    { key: 'clientSignedAt', label: 'Date the client signed', kind: 'date', req: true },
    { key: 'providerSignedAt', label: 'Date Christian signed for OmniSDR', kind: 'date', req: true, admin: true },
    { key: 'filedLocation', label: 'Where the fully signed copy is filed', max: 300 },
  ],
};
// What the client may fill in through their link: never the package (the agreed quote) or the signing record.
export const CLIENT_SECTIONS = ['client', 'services', 'term'];
export const clientFields = (name) => SECTIONS[name].filter((f) => !f.admin);
export const formNumber = (n) => 'OF-' + String(n).padStart(4, '0');

export class FieldError extends Error {}
const fail = (msg) => { throw new FieldError(msg); };

// One field's value, cleaned, or undefined when empty. Throws FieldError on a value that cannot be right.
function clean(f, v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (f.kind === 'bool') return v === true || v === 'true' || v === 'on' || v === 1 ? true : v === false || v === 'false' || v === 0 ? false : fail(`${f.label}: yes or no`);
  if (typeof v !== 'string') fail(`${f.label} must be text`);
  const s = v.trim(); if (!s) return undefined;
  if (f.kind === 'choice') return Object.hasOwn(f.options, s) ? s : fail(`${f.label}: pick one of the options`);
  if (f.kind === 'state') return /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : fail(`${f.label}: two letters, like NJ`);
  if (f.kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200 ? s.toLowerCase() : fail(`${f.label} does not look right`);
  if (f.kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : fail(`${f.label}: a date`);
  return s.length <= f.max ? s : fail(`${f.label} is limited to ${f.max} characters`);
}

/**
 * One section from untrusted input: only its own keys, each cleaned. Unknown keys are dropped. `who` is 'admin', 'rep' or
 * 'client': an admin-only field from a rep is refused (FORBIDDEN), and from the client it is dropped like an unknown key.
 */
export function cleanSection(name, input, who = 'admin') {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) fail(`${name} must be an object`);
  const out = {};
  for (const f of SECTIONS[name]) {
    const v = clean(f, input[f.key]);
    if (v === undefined) continue;
    if (f.admin && who !== 'admin') { if (who === 'rep') fail('FORBIDDEN'); continue; }
    out[f.key] = v;
  }
  return out;
}

/** A section as a save leaves it: an admin's save replaces it; a rep's keeps what only an admin may set. */
export function saveSection(name, before, input, isAdmin) {
  const out = cleanSection(name, input, isAdmin ? 'admin' : 'rep');
  if (!isAdmin) for (const f of SECTIONS[name]) if (f.admin && (before || {})[f.key] != null) out[f.key] = before[f.key];
  return out;
}

/** The date the form counts as signed: the later of the two signatures, or '' until both are recorded. */
export function signedOn(data) {
  const s = (data && data.signing) || {};
  return s.clientSignedAt && s.providerSignedAt ? (s.clientSignedAt > s.providerSignedAt ? s.clientSignedAt : s.providerSignedAt) : '';
}
const optionLabel = (sec, key, v) => (SECTIONS[sec].find((f) => f.key === key).options || {})[v] || '';

/**
 * The package (the quote) from untrusted input, priced only from config. A rep may put the Pilot on the form at any price
 * from the floor up, with any position on the mix slider; everything else, and any discount or build fee, is an admin's.
 */
export function cleanPackage(input, isAdmin) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) fail('package must be an object');
  const plan = input.plan;
  if (!PLANS.includes(plan)) fail('Pick a plan');
  if (!isAdmin && !REP_PLANS.includes(plan)) fail('FORBIDDEN');
  const extra = ['discount', 'buildFee'].filter((k) => input[k] != null && String(input[k]).trim() !== '');
  if (extra.length && !isAdmin) fail('FORBIDDEN');
  const out = { plan };
  for (const k of extra) { const s = String(input[k]).trim(); if (s.length > 200) fail('A discount or build fee note is limited to 200 characters'); out[k] = s; }
  let price = input.priceCents;
  if (plan === 'Pilot') {
    price = price == null || price === '' ? C.PILOT.minCents : price;
    if (!Number.isInteger(price) || price < C.PILOT.minCents) fail('The pilot starts at $499');
    if (price > C.PILOT.maxCents) fail('That is above a pilot. Send it to Christian as a custom quote');
  } else if (price != null && price !== '') {
    if (!Number.isInteger(price) || price <= 0 || price > 10_000_000) fail('Enter the agreed price in cents');
  } else price = null;
  out.priceCents = price;
  const allowance = plan === 'Pilot' ? C.pilotSplit(price).allowanceCents : PLAN_ALLOWANCE[plan] ?? null;
  if (allowance != null) {
    const mix = M.resolveMix(allowance, input.mixPosition ?? null);
    if (mix === undefined) fail('That is not a position on the mix slider');
    if (mix) Object.assign(out, { allowanceCents: allowance, mixPosition: mix.position, minutes: mix.minutes, texts: mix.texts, threads: mix.threads });
  }
  return out;
}

/** What still stops a form from being filed, as labels. Empty when it can be filed. */
export function missing(data) {
  const out = [];
  const p = data.package || {};
  if (!p.plan) out.push('Plan');
  else if (p.priceCents == null) out.push('Agreed price');
  for (const name of ['client', 'term', 'signing']) for (const f of SECTIONS[name]) if (f.req && (data[name] || {})[f.key] == null) out.push(f.label);
  if (p.plan === 'Agency' && (data.term || {}).paymentMethod && data.term.paymentMethod !== 'ach') out.push('Payment method: Agency is ACH only');
  if (p.plan === 'Pilot' && (data.term || {}).initialTerm === 'one_month') out.push('Initial term: a Pilot package takes The Pilot Period');
  return out;
}

/** The account's own facts as a starting point, so nothing the portal already holds is typed again. */
export function prefill(account, contacts = []) {
  const primary = contacts.find((c) => c.is_primary) || contacts[0] || {};
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));
  return {
    package: cleanPackage({ plan: 'Pilot' }, false),
    client: pick({ legalName: account.business, tradingName: account.business, address: account.address, city: account.city,
      state: /^[A-Za-z]{2}$/.test(account.state || '') ? account.state.toUpperCase() : undefined, zip: account.zip,
      signerName: primary.name, signerTitle: primary.role, noticeEmail: primary.email || account.email, billingName: primary.name, billingEmail: account.email || primary.email }),
    services: pick({ answer: true, followUp: true, numbers: account.phone, setup: 'forward_no_answer', locations: account.city ? `1 (${account.city}${account.state ? ', ' + account.state : ''})` : undefined }),
    term: { renewal: 'month_to_month' }, // the only renewal there is; the initial term is picked with the owner
    signing: {},
  };
}

/** The fields omni-invoice's record_order_form takes, from a filed (or nearly filed) form. */
export function invoiceRecord(form) {
  const d = form.data, p = d.package || {}, c = d.client || {}, t = d.term || {}, signed = signedOn(d);
  return {
    clientName: c.legalName || '', customerEmail: c.billingEmail || '', plan: p.plan === 'Custom' ? 'Custom Build' : p.plan || '',
    orderFormDate: signed, isSigned: !!signed, state: c.state || '', paymentMethod: t.paymentMethod || 'unknown',
    orderFormNumber: formNumber(form.number), addressLine1: c.address || '', city: c.city || '', postalCode: c.zip || '',
    // The slider's own default reads as the default mix; any other point on it is an adjusted one (both are slider points).
    ...(p.minutes != null ? { voiceMinutes: p.minutes, texts: p.texts, aiThreads: p.threads, usageMix: p.mixPosition === M.resolveMix(p.allowanceCents, null)?.position ? 'default' : 'adjusted' } : {}),
    term: [optionLabel('term', 'initialTerm', t.initialTerm), optionLabel('term', 'renewal', t.renewal)].filter(Boolean).join(', '), memo: '',
  };
}

// Client answers are not kept once dealt with (legal, PR 195): reviewed ones lose their text, and ones still unreviewed
// when their link runs out are set aside (the form goes back to draft unless newer answers wait) and lose it too.
export const purgeAnswers = (D, t) => [
  D.prepare(`UPDATE order_forms SET status = 'draft', updated_at = ? WHERE status = 'client_review'
    AND id IN (SELECT order_form_id FROM client_links WHERE expires_at <= ? AND submitted_at IS NOT NULL AND reviewed_at IS NULL)
    AND id NOT IN (SELECT order_form_id FROM client_links WHERE expires_at > ? AND submitted_at IS NOT NULL AND reviewed_at IS NULL)`).bind(t, t, t),
  D.prepare('UPDATE client_links SET reviewed_at = ? WHERE expires_at <= ? AND submitted_at IS NOT NULL AND reviewed_at IS NULL').bind(t, t),
  D.prepare('UPDATE client_links SET submission = NULL WHERE submission IS NOT NULL AND reviewed_at IS NOT NULL'),
];

// ── client links ─────────────────────────────────────────────────────────────────────────────────────────────────────
// A link's token is 32 random bytes (base64url, 43 characters); only its SHA-256 is stored.
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function tokenHash(token) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export const isToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
export const LINK_DAYS = 7;
