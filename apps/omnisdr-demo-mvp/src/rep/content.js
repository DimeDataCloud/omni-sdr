// Rep playbook copy and the draft price ladder. Ported from apps/console/src/features/sales/playbookData.ts and
// apps/console/src/lib/api/demo/sales.ts (DEFAULT_PRICES), which transcribe SALES-DECK-COPY slides 13, 17, 18 and 22.
// When the copy file changes, change this file in the same PR. Every amount is DRAFT until Christian sets the final flag.

export const PRICES = {
  isFinal: false,
  effectiveDate: null,
  // SALES-DECK-COPY slide 13 and CREDIT-ALLOWANCE-MODEL (2026-10-27). A rep quotes and closes Level 1 only until Christian
  // marks prices final; Levels 2 to 4 carry no closable amount here, so only an admin can record them.
  levels: [
    { level: 0, label: 'Free proof', what: 'Missed-call audit and response-time test, then a 20-minute results call', amountCents: 0, unit: 'free', quotable: true },
    { level: 1, label: 'Pilot', what: 'One system, 30 days, results report at day 14. No setup fee', amountCents: 49900, unit: 'one_time', quotable: true },
    { level: 2, label: 'Usage plan', what: 'Lite, Standard or Plus, chosen from the pilot numbers. Internal: $299, $499 or $899 a month. Do not quote', amountCents: null, unit: 'per_month', quotable: false },
    { level: 3, label: 'Outcome pricing', what: 'Remodelers first. A fee per kept appointment plus a monthly floor. Do not quote', amountCents: null, unit: 'per_kept_appointment', quotable: false },
    { level: 4, label: 'Agency and custom', what: 'Multi-location or larger jobs, $999 a month and up, ACH only. Christian quotes it; send him the owner's needs', amountCents: null, unit: 'per_month', quotable: false },
  ],
};

// Christian 2026-10-27. Pool = price minus payment fees minus the client's credit allowance; rep 50%, dev 50%, every month.
// Sales tax is billed to the client on top. Figures are DRAFT with the prices (CREDIT-ALLOWANCE-MODEL sections 6 and 8).
export const PAY = {
  repShare: 0.5,
  note: 'You earn 50% of the pay pool every month the client stays: the price minus payment fees and the client's credit allowance (their usage budget at our cost). Sales tax is added to the client's bill, so it never comes out of your pay. All figures are draft until prices are final.',
  table: [
    { plan: 'Pilot or Standard ($499)', allowance: '$175', each: 'about $151' },
    { plan: 'Lite ($299)', allowance: '$105', each: 'about $90' },
    { plan: 'Plus ($899)', allowance: '$330', each: 'about $264' },
    { plan: 'Agency ($999 a month and up)', allowance: 'Built per quote', each: '$150 for the first location, $100 for each added one' },
  ],
};
export const TAX_NOTE = 'Prices are before sales tax. Tax is added to the client's bill.';

export const OBJECTIONS = [
  { id: 'price', heard: '"$499 is a lot."', answer: 'Fair question. The pilot price is a draft, and it is set against one job, not against software. What is a typical job worth to you? [listen] If a typical job is worth more than the pilot, one extra booked job covers it. We measure booked jobs and show you at day 14.' },
  { id: 'crm', heard: '"We already have a CRM or software that does this."', answer: 'Good, keep it. We do not replace it. We sit in front of it and handle the first reply, the follow-up and the booking. A CRM stores leads. It does not answer them at 9 pm. Can I time your form so we both see what actually happens?' },
  { id: 'person', heard: '"AI feels cheap. My customers want a person."', answer: 'They do, and they get one. We aim for a fast first reply so nobody is left waiting, and a person takes over the moment the lead asks, the job is big, or it is a complaint. For the first week you approve every message before it goes. Would you rather a lead wait six hours for a person, or hear back in minutes and then reach a person?' },
  { id: 'fast', heard: '"We answer fast enough."', answer: 'Great, then the free check will show it. We time your own form and your own line and give you the numbers. If you are fast, you will know. If there is a gap at night or on a job, you will see that too. Who covers after hours today?' },
  { id: 'spam', heard: '"I worry about spam."', answer: 'Same concern we have. Every message needs a recorded reason to contact that person, and a lead with none gets no first message. Every message carries a stop option and stop requests are honored. There are daily limits, and in week one you approve each message. No blasting, no bought lists.' },
  { id: 'wrong', heard: '"What if it says something wrong?"', answer: 'It only works from a playbook we build with you: your services, your hours, what it may say and what it may not. Prices and special cases go to a person. For the first week nothing goes out without your approval, and you can take over any conversation at any time. We review the week together.' },
  { id: 'info', heard: '"Send me info."', answer: 'Info does not book jobs. Let me run the free check first. It takes me one call and one form, and you will see your own numbers.' },
  { id: 'small', heard: '"I am too small."', answer: 'Small is who this fits. You are the bottleneck, and one booked job changes your month.' },
];
export const OBJECTION_METHOD = 'Agree with the concern, answer in two sentences, bring it back to their own numbers, ask one question. Never argue. Never use a statistic, a competitor\'s price, a guarantee or a discount in an answer.';

export const NEVER_SAY = [
  'No guarantees of bookings, revenue or results.',
  'No statistics we cannot source. Use the owner\'s own audit number.',
  'No channel that is not live. Check with Christian.',
  'Never offer a discount or a free trial. The only discount that exists is on an agency quote, and only Christian approves it, in writing.',
  'No competitor prices.',
  'No legal or compliance promises.',
];
export const SWAPS = [
  { instead: 'We guarantee more bookings', say: 'We measure booked jobs and show you at day 14.' },
  { instead: 'Studies show fast replies win far more leads', say: 'We will time your own leads.' },
  { instead: 'We do Instagram and texting', say: 'Those channels need approval from the platform or carrier. They are coming, and they are added when cleared. Here is what is ready now.' },
  { instead: 'I can do it for less', say: 'The draft pilot price is $499. I do not set prices. Let me confirm the final price with Christian.' },
  { instead: 'Try it free for a week', say: 'The free proof is the free part. The pilot is the proof you pay for.' },
  { instead: 'We are cheaper than X', say: 'We price against one job, not against software.' },
  { instead: 'It is fully compliant', say: 'It is built around consent and opt-out, and you approve every message in week one.' },
];

export const OPENER = 'Hi, is this the owner? This is [your name] with OmniSDR. Quick one: when a lead fills out your form or calls while you are on a job, how long until somebody gets back to them? [listen] We time that for free. One call and one form, and you get your own numbers. Worth a look?';

export const DEMO_STEPS = [
  'Open it on your own screen first, the same day. Never share a screen into something you have not tested that day.',
  'Pick the sample business closest to the prospect\'s trade.',
  'Start a session, play the lead, and let the prospect watch the reply.',
  'Point at three things: how quickly it replies, how it asks the qualifying questions, and where it hands off to a person.',
  'Then go straight back to their own numbers from the audit.',
];
export const DEMO_LIMITS = 'About 10 sessions a day across the site, 2 per visitor, about 3 minutes each. If the demo says it is paused or at its limit, say so, move on, and use the slides. Never try to work around a limit.';

// What the dev portal needs to start onboarding; the rep fills it with the owner on the call after the yes.
export const ONBOARDING_FIELDS = [
  { key: 'hours', label: 'Business hours' },
  { key: 'services', label: 'Services and typical job value' },
  { key: 'leadSources', label: 'Where leads come from (calls, forms, ads, DMs)' },
  { key: 'alertPhone', label: 'Mobile number for owner alerts' },
  { key: 'backupContact', label: 'Backup person for handoffs' },
  { key: 'calendar', label: 'Calendar or booking link' },
  { key: 'handoff', label: 'How far the system goes: booking, payment or resolution' },
  { key: 'faq', label: 'Five common questions and answers' },
  { key: 'a2p', label: 'Legal business name and EIN for carrier registration' },
];
