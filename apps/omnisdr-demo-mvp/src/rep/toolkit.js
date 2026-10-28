// Rep toolkit (Christian 2026-10-27: "make sure this has everything a sales rep could need").
// From SALES-DECK-COPY slides 8 to 21. Message templates are starter wording for the rep to adjust; {business},
// {name} and {rep} are filled from the account on the account page, the rest stay as blanks to fill in.

export const TEMPLATES = [
  { id: 'text1', kind: 'text', label: 'First touch, text', body: "Hi {name}, it's {rep} with OmniSDR. Quick one about {business}: when a lead fills out your form after hours, who gets back to them? We time that for free if you want the number." },
  { id: 'email1', kind: 'email', label: 'First touch, email', body: "Subject: Your web form at {business}\n\nHi {name},\n\nI'm {rep} with OmniSDR. We help local service businesses answer every lead fast, at any hour.\n\nOne question: when a lead comes in while you're on a job, how long until someone gets back to them?\n\nWe can time your own form and phone line for free and send you the numbers. Worth a look?\n\n{rep}\nOmniSDR" },
  { id: 'vm1', kind: 'call', label: 'Voicemail', body: "Hi {name}, it's {rep} with OmniSDR. Quick question about how {business} handles leads that come in after hours. We time that for free and hand you the numbers. I'll try you again tomorrow, or text me back at this number." },
  { id: 'dm1', kind: 'text', label: 'First touch, social DM', body: "Hi {name}, {rep} here with OmniSDR. Saw the {business} page. When someone messages you while you're teaching or on a job, who answers? We time that for free if you want the number." },
  { id: 'book1', kind: 'email', label: 'Demo booked, confirmation', body: "Hi {name}, thanks for the time. We're set for [day and time]. Before then I'll run the free check on {business}: one call to your main line and one test through your web form, so I can show you your own numbers. Nothing else will be contacted. Talk soon, {rep}" },
  { id: 'follow1', kind: 'text', label: 'Follow-up, no reply', body: "Hi {name}, {rep} again. Still happy to time your form and phone for {business}, free, and send you the numbers. Want me to?" },
  { id: 'recap1', kind: 'email', label: 'After the demo, recap', body: "Hi {name},\n\nThanks for the call. Your numbers from the free check:\n- Phone: [what happened]\n- Web form: first reply after [time]\n\nYou said a typical job is worth [amount]. By your numbers, that is what one missed lead costs.\n\nThe next step is the 30-day pilot, $499 plus tax, measured in booked jobs with a report at day 14. I'll send the agreement and invoice once you say go.\n\n{rep}\nOmniSDR" },
];

export const QUALIFY = {
  signals: ['Running ads (check the ad libraries)', "A lead form or 'get a quote' button on the site", 'Reviews that mention slow replies or no callback', 'A voicemail greeting or unanswered DMs'],
  green: ['Pays for leads', 'Answers their own phone', "Says 'I miss calls on jobs'", 'Reviews mention slow replies'],
  red: ['No ads, no forms and few leads', 'A team already covers nights', 'Owner cannot be reached', 'The typical job is very small', 'Wants a custom build or licensed advice in the script', 'Wants a free trial'],
  redRule: 'Two or more red flags: thank them and move on.',
  skip: ['Franchise where head office controls phones or vendors', 'Crowded answering niches: HVAC and plumbing answering, med spas, hearing clinics'],
  niches: [
    { niche: 'Generator dealers', line: 'When the power goes out, a homeowner calls three dealers and books the first one that answers. We answer for you, at any hour.' },
    { niche: 'Martial arts schools', line: 'A parent messages while you are teaching. We answer them and offer a trial class before they message the next school.' },
    { niche: 'Remodelers', line: 'We follow up on every estimate you wrote and reply to every lead you paid for.' },
  ],
};

export const DISCOVERY = {
  opener: 'I help local service businesses answer every lead fast, at any hour. Before I tell you anything, I would like to understand how it works for you today. Can I ask a few questions?',
  questions: [
    { ask: 'Where do your leads come from?', tells: 'Whether they already pay for lead flow. Ads, forms and directories are the fit.' },
    { ask: 'What happens when a lead comes in at night or while you are on a job?', tells: 'Where the gap is and who covers it.' },
    { ask: 'How fast does the first reply go out, honestly?', tells: 'Their own view of speed. Compare it with the free check.' },
    { ask: 'Who replies today: owner, staff, a tool?', tells: 'Who decides and who feels the pain.' },
    { ask: 'What is an average job worth?', tells: 'The number for the lost-job math.' },
    { ask: 'How many leads do you think slip each month?', tells: "Their sense of the leak. 'No idea' is fine." },
    { ask: 'What have you tried to fix it?', tells: 'Past tools, past failures, objections coming.' },
    { ask: 'Who else decides?', tells: 'Whether you need a second person on the call.' },
    { ask: 'If we showed you the real numbers, what would you do?', tells: 'Whether they act on proof.' },
  ],
  tip: 'Ask, then be quiet. Write down their exact words; you will use them later on the call.',
};

export const AUDIT_STEPS = [
  'Pick a time when the owner is likely busy or the office is closed. Write down the time before you act.',
  'Call the main line once. Note the rings, voicemail or a live answer, the greeting, and whether a call or text comes back and how long it took.',
  "Submit the business's own web form once, with our clearly labelled test contact. Record the submit time and the first reply of any kind. An auto-reply counts separately from a real answer.",
  "Never repeat the call or the form. Never call a private mobile. Never use another person's details.",
  'Write it up in the Audit tab: their numbers, not ours.',
];

// Keys are stored as JSON on accounts.audit; the API accepts only these keys (see index.js).
export const AUDIT_FIELDS = [
  { key: 'leadSources', label: 'Lead sources seen (ads, form, directories, socials)', group: 'Research' },
  { key: 'reviews', label: 'Google rating and review count; slow-reply complaints, quoted', group: 'Research' },
  { key: 'hours', label: 'Posted hours and after-hours coverage', group: 'Research' },
  { key: 'other', label: 'Anything else worth knowing (team size, trucks, services, recent posts)', group: 'Research' },
  { key: 'callAt', label: 'Day and time of the call', group: 'Call test' },
  { key: 'callResult', label: 'What happened (rings, voicemail or live, greeting, callback and when)', group: 'Call test' },
  { key: 'formAt', label: 'Submitted at', group: 'Form test' },
  { key: 'formWait', label: 'First reply after (minutes or hours, or none)', group: 'Form test' },
  { key: 'formReply', label: 'What the reply was (auto-reply, person, nothing)', group: 'Form test' },
  { key: 'jobValue', label: 'Average job value in dollars, in their words', group: 'Lost-job math', num: true },
  { key: 'missed', label: 'Leads they think slip each month', group: 'Lost-job math', num: true },
];

export const RESULTS_CALL = [
  'Show their times first: what a caller heard and how long the form waited. Their numbers, not ours.',
  'Ask what a lost job is worth to them, and how many leads slip in a month.',
  'Do the math out loud: job value times leads missed. Say whose numbers they are: theirs.',
  'Run the demo so they watch a lead get answered and handed off.',
  'Offer the Level 1 pilot: 30 days, $499 plus tax, measured in booked jobs, report at day 14.',
];
export const RESULTS_SAY = 'The proof is free so the price conversation starts from your numbers, not mine.';
export const RESULTS_DONT = 'Do not say the audit predicts bookings. It shows the gap, nothing more. If every channel is fast, say so honestly; the filter fails and we move on.';

export const AFTER_YES = {
  owner: ['A mobile number for alerts', 'Access to the website or form', 'Access to any phone setup', 'A calendar or booking link', 'Five common questions and answers', 'The signed pilot agreement', 'The consent line added to their forms', 'A primary and a backup person for handoffs'],
  golive: ['A test lead on each channel gets a reply inside the window', 'Opt-out works', 'The owner alert arrives', 'The handoff works', 'Results shows the test'],
  timeline: 'Intake, then the setup call. Go-live in approval mode on the channels that are ready. Day 3: 15-minute check-in. Day 14: interim report. Day 30: results review and the monthly plan.',
  rule: 'Give no start date. A pilot starts after go-live with a person in the loop, and the owner is told so in writing.',
};

export const SAFETY = {
  line: 'It only contacts people you have a valid reason to contact: they filled in a form, they called, or you have the right to contact them. A lead with no recorded reason gets no first message. Every message carries a stop option, and in week one you approve every message before it goes.',
  dont: 'Never say it is legally guaranteed compliant. Say it is built to follow consent and opt-out rules and the owner approves everything first.',
};

export const DAILY = {
  log: ['Attempts', 'Conversations', 'Free checks run', 'Demos given', 'Pilots proposed', 'Pilots signed', 'The exact words of each objection, and the niche'],
  day: "15 minutes on yesterday's numbers, outreach blocks, calls and discovery, free checks, demos, then the end-of-day log.",
  who: [
    { what: 'Price, scope, anything not in this portal', who: 'Christian' },
    { what: 'Whether a channel is available', who: 'How it works, then Christian before you promise anything' },
    { what: 'Build or setup problems', who: 'Christian, who routes them' },
  ],
};

export const GLOSSARY = [
  ['First touch', 'The first reply to a new lead. We time it.'],
  ['Response window', 'How fast the first reply should go out. Default 2 minutes, set per business.'],
  ['Consent basis', "The reason we may contact this person: a form, a call, or the owner's right to contact them. No basis, no message."],
  ['Suppression', 'A do-not-contact list. Opt-outs, bounces and complaints are blocked.'],
  ['Handoff', 'A person takes over the conversation and the agent goes quiet.'],
  ['Approval mode', 'Every draft waits for a yes before it goes out. Week one.'],
  ['Playbook', "The client's rules for the agent: services, tone, and what must go to a person."],
  ['Send lock', 'The switch that keeps all sending off until Christian releases it.'],
  ['A2P (10DLC)', 'The carrier registration US business texting needs. It takes weeks and is outside our control.'],
  ['Credit allowance', "The client's monthly usage budget at our cost (minutes, texts, AI threads). It comes out before the pay split."],
];

export const BRAND = ["Spell it OmniSDR: one word, no space.", 'Never promise results, a start date, a price outside the pricing guide, or a discount.'];

export const RESOURCES = [
  { label: 'Live demo (Try me)', href: '/tryme' },
  { label: 'Front door', href: '/' },
];
