import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDraft, numbersIn } from '../src/check.mjs';

const NOW = new Date('2026-09-28T12:00:00Z');
const FUTURE = '2026-10-28T00:00:00Z';
const evidence = new Map([
  ['e1', { contact_id: 'c1', facts: { rating: 3.2, review_count: 41, booking: false, revenue_loss: { value: 4000 }, contact: { form: null, text: null } }, expires_at: FUTURE }],
  ['e-other', { contact_id: 'c2', facts: { rating: 4.9 }, expires_at: FUTURE }],
  ['e-old', { contact_id: 'c1', facts: { rating: 3.2 }, expires_at: '2026-09-01T00:00:00Z' }],
]);
const ctx = { contactId: 'c1', evidence, now: NOW, competitors: ['Acme Dental Marketing'] };

// The known-good draft every sabotage case mutates exactly once.
const GOOD = Object.freeze({
  step: 0,
  subject: 'Your booking page',
  body: 'Hi Pat. Your Google rating is 3.2 from 41 reviews. Your site has no online booking. Worth a look?',
  claims: [
    { text: 'rating is 3.2', evidence_id: 'e1', fact_key: 'rating' },
    { text: '41 reviews', evidence_id: 'e1', fact_key: 'review_count' },
  ],
});
const withClaims = (claims) => ({ ...GOOD, claims });
const addSentence = (s) => ({ ...GOOD, body: `${GOOD.body} ${s}` });

test('positive controls: the known-good draft passes; an evidence-free follow-up passes', () => {
  assert.deepEqual(checkDraft(GOOD, ctx).findings, []);
  const followUp = { step: 1, subject: 'Worth a look?', body: 'Following up on my note about your booking page. Worth a look?', claims: [] };
  assert.deepEqual(checkDraft(followUp, ctx).findings, []);
});

test('sabotage suite: every seeded bad draft is blocked, each for the expected reason', () => {
  const cases = [
    ['invented number in a claim', withClaims([{ ...GOOD.claims[0] }, { text: '45 reviews', evidence_id: 'e1', fact_key: 'review_count' }]), 'number_mismatch'],
    ['unknown evidence id', withClaims([{ ...GOOD.claims[0], evidence_id: 'nope' }, GOOD.claims[1]]), 'evidence_not_found'],
    ["another contact's evidence", withClaims([{ ...GOOD.claims[0], evidence_id: 'e-other' }, GOOD.claims[1]]), 'evidence_wrong_contact'],
    ['expired evidence', withClaims([{ ...GOOD.claims[0], evidence_id: 'e-old' }, GOOD.claims[1]]), 'evidence_expired'],
    ['fact key not on the evidence', withClaims([{ ...GOOD.claims[0], fact_key: 'stars' }, GOOD.claims[1]]), 'fact_missing'],
    ['fact recorded as unknown (null)', withClaims([{ ...GOOD.claims[0], fact_key: 'contact.text' }, GOOD.claims[1]]), 'fact_missing'],
    ['uncited superlative', addSentence("We're the best agency in Nashville."), 'unsupported_sentence'],
    ['uncited percentage', addSentence('Clients see 30% more bookings.'), 'unsupported_sentence'],
    ['extra number in a claimed sentence', { ...GOOD, body: GOOD.body.replace('41 reviews', '41 reviews and 12 photos') }, 'unsupported_number'],
    ['number in the subject', { ...GOOD, subject: '3 ideas for your booking page' }, 'unsupported_sentence'],
    ['revenue loss without a registered formula', { ...addSentence("You're losing $4,000 a month."),
      claims: [...GOOD.claims, { text: '$4,000', evidence_id: 'e1', fact_key: 'revenue_loss' }] }, 'revenue_formula_required'],
    ['implied prior contact', addSentence('As we discussed, the fix is quick.'), 'implied_prior_contact'],
    ['"following up" on a first touch', addSentence('Following up here.'), 'implied_prior_contact'],
    ['Re: subject on a first touch', { ...GOOD, subject: 'Re: your booking page' }, 'implied_prior_contact'],
    ['generic filler', { ...GOOD, body: `Hope this email finds you well. ${GOOD.body}` }, 'banned_filler'],
    ['competitor named', addSentence('Unlike Acme Dental Marketing, we build it in a week.'), 'competitor_named'],
    ['claims not an array', { ...GOOD, claims: 'rating is 3.2' }, 'claims_malformed'],
    ['claim missing fields', withClaims([{ text: 'rating is 3.2' }, GOOD.claims[1]]), 'claim_malformed'],
    ['tenant-asset claim (not supported yet)', withClaims([...GOOD.claims, { text: 'x', evidence_id: 'e1', fact_key: 'rating', source: 'tenant_asset' }]), 'tenant_claims_unsupported'],
    ['claim that is not in the body (padding)', withClaims([...GOOD.claims, { text: 'no online booking at all', evidence_id: 'e1', fact_key: 'booking' }]), 'claim_not_in_body'],
    ['first touch with no evidence', { step: 0, subject: 'Quick idea', body: 'I build booking pages. Want one?', claims: [] }, 'no_evidence'],
    ['no clock passed in', GOOD, 'no_clock', { ...ctx, now: undefined }],
  ];
  let blocked = 0;
  for (const [label, draft, code, c = ctx] of cases) {
    const v = checkDraft(draft, c);
    assert.equal(v.passed, false, `${label}: passed`);
    assert.ok(v.findings.some((f) => f.code === code), `${label}: expected ${code}, got ${v.findings.map((f) => f.code).join(', ')}`);
    blocked++;
  }
  console.log(`  gate: blocked ${blocked} of ${cases.length} seeded bad drafts`);
  assert.ok(cases.length >= 20, 'the sabotage set must not shrink');
});

test('determinism: the same inputs give the same verdict', () => {
  const a = JSON.stringify(checkDraft(addSentence('Clients see 30% more bookings.'), ctx));
  const b = JSON.stringify(checkDraft(addSentence('Clients see 30% more bookings.'), ctx));
  assert.equal(a, b);
});

test('numbersIn: currency, thousands separators, decimals and percentages', () => {
  assert.deepEqual(numbersIn('$4,000 and 3.2 stars, 30% of 41'), [4000, 3.2, 30, 41]);
  assert.deepEqual(numbersIn('no digits here'), []);
});
