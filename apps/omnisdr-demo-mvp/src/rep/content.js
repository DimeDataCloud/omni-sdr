// Rep playbook copy and the draft price ladder. Ported from apps/console/src/features/sales/playbookData.ts and
// apps/console/src/lib/api/demo/sales.ts (DEFAULT_PRICES), which transcribe SALES-DECK-COPY slides 13, 17, 18 and 22.
// When the copy file changes, change this file in the same PR. Every amount is DRAFT until Christian sets the final flag.

export const PRICES = {
  isFinal: true,
  effectiveDate: null,
  // Christian 2026-10-29: reps quote all four plans. A pilot is the first 30 days of a plan, not a separate product.
  // There is no Custom Build. Levels are stable ids for the deals API; the Order Form (orderform.js) is the quoting tool.
  levels: [
    { level: 0, label: 'Free proof', what: 'Missed-call audit and response-time test, then a 20-minute results call', amountCents: 0, unit: 'free', quotable: true },
    { level: 1, label: 'Lite', what: 'One location. $299 a month, plus tax. The first 30 days are the pilot period.', amountCents: 29900, unit: 'per_month', quotable: true },
    { level: 2, label: 'Standard', what: 'One location. $499 a month, plus tax. The first 30 days are the pilot period.', amountCents: 49900, unit: 'per_month', quotable: true },
    { level: 3, label: 'Plus', what: 'One location. $899 a month, plus tax. The first 30 days are the pilot period.', amountCents: 89900, unit: 'per_month', quotable: true },
    { level: 4, label: 'Agency', what: 'Single or multi-location, over $1,000 a month, ACH only. Each location takes a plan or an over-$1,000 custom package.', amountCents: null, unit: 'per_month', quotable: true },
  ],
};

// Christian 2026-10-29. The pay pool is the OmniSDR partnership pool: price minus payment fees minus the client's
// credit allowance. The split is officially 50/50; the per-plan targets below are for planning and easy math.
// Sales tax is billed to the client on top. No surcharge for card payments.
export const PAY = {
  repShare: 0.5,
  note: "You earn 50% of the pay pool every month the client stays: the price minus payment fees and the client's credit allowance (their usage budget at our cost). Sales tax is added to the client's bill, so it never comes out of your pay. The per-plan targets are for planning; the official split is 50/50.",
  table: [
    { plan: 'Lite ($299)', allowance: '$75', each: 'target $80 (50/50 official)' },
    { plan: 'Standard ($499)', allowance: '$150', each: 'target $150 (50/50 official)' },
    { plan: 'Plus ($899)', allowance: '$350', each: 'target $250 (50/50 official)' },
    { plan: 'Agency (over $1,000 a month)', allowance: 'Built per quote', each: '$150 for the first location, $100 for each added one' },
  ],
};
// Pilot pricing (Christian 2026-10-27): $499 floor, the rep sets any price above it, and the credit allowance is 35% of
// price rounded to $5 (the confirmed rule; $175 at $499). Fees use the card gross-up from CREDIT-ALLOWANCE-MODEL (about 4.54%).
// maxCents only catches typos; a bigger job is an agency or custom quote for Christian.
// Christian 2026-10-27: from $899 (the Plus price) the allowance is at least $330, the Plus allowance; 35% takes over above $943.
export const PILOT = { minCents: 49900, maxCents: 500000, allowanceRate: 0.35, feeRate: 0.0454, plusFromCents: 89900, plusAllowanceCents: 33000 };
export function pilotSplit(priceCents) {
  const rate = Math.round((priceCents * PILOT.allowanceRate) / 500) * 500;
  const allowanceCents = priceCents >= PILOT.plusFromCents ? Math.max(rate, PILOT.plusAllowanceCents) : rate;
  const eachCents = Math.round((priceCents - priceCents * PILOT.feeRate - allowanceCents) / 2);
  return { allowanceCents, eachCents };
}
export const TAX_NOTE = "Prices are before sales tax. Tax is added to the client's bill.";

// Rep guide "Pricing" chapter (v6, Christian 2026-10-29). Who may quote what.
// Reps quote all four plans. A pilot is the first 30 days of a plan, not a separate product. There is no Custom Build.
export const PRICING_GUIDE = {
  lede: 'Reps quote Lite $299, Standard $499, Plus $899 a month, or Agency over $1,000. A pilot is the first 30 days of a plan, not a separate product. Confirm with Christian before quoting any number.',
  quote: [
    { level: 0, rule: 'Yes. Offer it on every first touch.' },
    { level: 1, rule: 'Yes. Quote the plan price plus tax: Lite $299, Standard $499, Plus $899 a month. The first 30 days are the pilot period.' },
    { level: 2, rule: 'Yes. Same plans, same prices.' },
    { level: 3, rule: 'Not yet. Do not say a number.' },
    { level: 4, rule: 'Yes. Over $1,000 a month, ACH only. Single or multi-location; each location takes a plan or an over-$1,000 custom package.' },
  ],
  rule: "You never offer a discount or a free trial. Change terms, never the price. Sales tax goes on the owner's bill. No surcharge for card payments.",
  say: '"We price against one job, not against software. What is a typical job worth to you?"',
};

// Christian 2026-10-27: the path to a yes, six steps (decisions/log).
export const PATH = [
  { title: 'First touch: book the demo', body: 'Short, about their business, one question. The only goal is a time on the calendar for the demo. Never a pitch in the first message.' },
  { title: 'Audit and demo prep', body: 'Research the business from public sources: website, Google reviews and Maps, ads, socials. Note every number you can find: hours, lead sources, review count, slow-reply complaints. Run the free check: call their line once and submit their form once at a busy time, and time the reply. Set up the demo with their trade and services.' },
  { title: 'Demo and free proof', body: 'Show their own numbers first: what a caller heard and how long a lead waited. Then run the demo so they watch a lead get answered. Ask what a lost job is worth and do the math with their number, labelled as an estimate.' },
  { title: 'Same call: discovery, proposal, sign prep', body: 'Stay on the call. Find who decides and where leads come from. Offer the Level 1 pilot, 30 days, from $499 plus tax, sized to their lead volume. If yes, confirm the details you need to send the agreement and invoice.' },
  { title: 'Scope and invoice', body: 'Write down what the pilot covers for this business, then send the pilot agreement and the invoice. Payment comes first. Consent language is agreed before anything goes live.' },
  { title: 'Onboard', body: 'Fill the onboarding tab with the owner, then a 45-minute setup call, every channel tested, and week one in approval mode.' },
];
// Rep guide "How it works" chapter (v6), from SYSTEM-DESIGN-speed-to-lead. Status labels follow the guide's "What is ready today".
export const HOW = {
  lede: "Every way a lead can reach the business gets a fast, on-brand reply in the lead's own channel. The owner gets a booked job or a hot handoff, with proof of how fast it happened.",
  flow: [
    { title: '1. Leads come in', items: ['Calls and missed calls', 'Web forms and ad forms', 'Email', 'Social comments and DMs (later)', 'An old customer list, with consent'] },
    { title: '2. One clean record', items: ['Duplicates merged', 'Consent checked: no reason to contact, no message', 'Opt-outs blocked on every channel'] },
    { title: '3. The agent follows the playbook', items: ["The client's services, hours and tone", 'What it may and may not say', 'Qualify, answer, book'] },
    { title: '4. A person when it matters', items: ['The lead asks for one', 'Urgent, big job, complaint', 'A price only a person may quote'] },
    { title: '5. Proof in their numbers', items: ['Time to first reply, per channel', 'Replies, bookings, recovered calls', 'A weekly report'] },
  ],
  channels: [
    { name: 'Voice receptionist', what: 'Answers calls 24/7, says it is an AI assistant, qualifies, books, texts the owner a summary, and transfers live when the caller asks or the job is big. It can also call a new form lead back within minutes.', status: 'In build', tone: 'warn' },
    { name: 'Web form and email', what: 'A form lead gets a reply and the owner gets an alert within seconds, any hour.', status: 'In build, first pilot channels', tone: 'warn' },
    { name: 'Text', what: 'Missed-call text-back and follow-up until the lead books, replies or opts out.', status: 'Carrier approval', tone: 'warn' },
    { name: 'Social', what: 'A comment or DM opens a private conversation that runs through to a booking. Automated messages say they are automated.', status: 'Later', tone: 'bad' },
  ],
  examples: [
    { title: 'A web form at 11:40 p.m.', body: 'The lead record is created in seconds, checked for duplicates and consent, and a reply goes out while the owner gets an alert. No answer in 5 minutes: the agent calls them back. The lead says "tomorrow morning": the agent offers two real open slots, books one and confirms. The owner sees it on their phone.' },
    { title: 'A missed call at 2 p.m.', body: 'The call is marked missed. We wait one minute in case the staff call back first. Still nobody: a text goes out, "Sorry we missed you, what do you need?", and the staff get a task. Urgent words in the reply go straight to a person.' },
  ],
  sections: [
    { title: 'Handing off to a person', body: 'The owner or a staff member gets an alert with a summary, the whole thread, what the lead wants and a suggested next move. They reply from their phone or the Inbox, and it goes out in the same channel the lead used. While a person has the thread, the agent stays quiet. If nobody picks up in time, the agent tells the lead when to expect a reply and alerts a backup contact. On a call, the agent offers a warm transfer; if no one answers, it takes a message and books a callback.' },
    { title: 'Through to the booking', body: "Real open slots from the client's calendar, a confirmation with an add-to-calendar link, and reminders 24 hours and 2 hours before. A no-show gets new slots; two misses hand it to a person." },
    { title: 'Through to payment (planned)', body: "The client can turn on a pay-now link, a deposit to hold the slot, or quote then invoice. The default is pay on site. Card details never touch OmniSDR, the money goes to the client's own account, and refunds and disputes are human-only. Not part of a pilot today." },
    { title: 'What the owner sees', body: 'Alerts on their phone for hot leads and bookings, with no app to learn. A web console with Approvals, one Inbox across every channel, Handoffs, Meetings, their Playbook and Results. A weekly report: leads in, time to first reply, replies, bookings and recovered calls, with any revenue figure labelled as an estimate.' },
    { title: 'Week one is in approval mode', body: 'Every channel starts off. The owner turns one on, and for the first week every message waits for their yes before it goes. After that they choose, channel by channel, when it sends on its own. They can take over any conversation at any time.' },
  ],
  ends: ['Booked', 'Paid or deposit taken', 'Handed to a person', 'Opted out', 'Closed', 'Follow-up limit reached'],
  endsNote: 'Nothing loops forever. A lead that goes quiet gets a capped number of follow-ups, inside quiet hours and daily limits, and then stops.',
  say: '"It answers in minutes, in the channel they used, and hands off to you the moment it should. For the first week you approve every message."',
};

export const PATH_GATE = 'The gate: after 20 real conversations in a niche, fewer than 2 paid pilots means we move to another niche. We rotate on facts, never by discounting.';

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
  { instead: 'I can do it for less', say: 'The pilot starts at $499 plus tax. That is the floor. What changes the price is how much it handles.' },
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
