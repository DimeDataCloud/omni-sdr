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
    { key: 'chase', label: "CHASE: outbound calls and texts to Client's leads", kind: 'bool' },
    { key: 'numbers', label: 'Client number(s) to be answered', max: 200 },
    { key: 'setup', label: 'Setup', ...choice({ forward_no_answer: 'Forward on no answer/busy', forward_all: 'Forward all calls', port: 'Port number to Provider', new_number: 'New number from Provider' }) },
    { key: 'locations', label: 'Locations', max: 200 },
    { key: 'integrations', label: 'Integrations (calendar, CRM, email)', max: 200 },
  ],
  term: [
    { key: 'paymentMethod', label: 'Payment method', ...choice({ card: 'Card', ach: 'ACH (bank)' }), req: true },
    { key: 'startDate', label: 'Start date', max: 80 },
    { key: 'initialTerm', label: 'Initial term', max: 80 },
    { key: 'renewal', label: 'Renewal', max: 80 },
    { key: 'specialTerms', label: 'Special terms', max: 1000 },
  ],
  signing: [
    { key: 'signedAt', label: 'Signing date', kind: 'date', req: true },
    { key: 'filedLocation', label: 'Where the signed copy is filed', max: 300 },
  ],
};
// What the client may fill in through their link: never the package (the agreed quote) or the signing record.
export const CLIENT_SECTIONS = ['client', 'services', 'term'];
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

/** One section from untrusted input: only its own keys, each cleaned. Unknown keys are dropped. */
export function cleanSection(name, input) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) fail(`${name} must be an object`);
  const out = {};
  for (const f of SECTIONS[name]) { const v = clean(f, input[f.key]); if (v !== undefined) out[f.key] = v; }
  return out;
}

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
    term: {},
    signing: {},
  };
}

/** The fields omni-invoice's record_order_form takes, from a filed (or nearly filed) form. */
export function invoiceRecord(form) {
  const d = form.data, p = d.package || {}, c = d.client || {}, t = d.term || {}, s = d.signing || {};
  return {
    clientName: c.legalName || '', customerEmail: c.billingEmail || '', plan: p.plan === 'Custom' ? 'Custom Build' : p.plan || '',
    orderFormDate: s.signedAt || '', isSigned: !!s.signedAt, state: c.state || '', paymentMethod: t.paymentMethod || 'unknown',
    orderFormNumber: formNumber(form.number), addressLine1: c.address || '', city: c.city || '', postalCode: c.zip || '',
    // The slider's own default reads as the default mix; any other point on it is an adjusted one (both are slider points).
    ...(p.minutes != null ? { voiceMinutes: p.minutes, texts: p.texts, aiThreads: p.threads, usageMix: p.mixPosition === M.resolveMix(p.allowanceCents, null)?.position ? 'default' : 'adjusted' } : {}),
    term: [t.initialTerm, t.renewal].filter(Boolean).join(', '), memo: '',
  };
}

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
