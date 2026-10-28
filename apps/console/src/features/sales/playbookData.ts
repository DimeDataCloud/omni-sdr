// Rep playbook copy, transcribed from SALES-DECK-COPY slides 17, 18 and 22 (omnisdr-pivot). The copy file is the source;
// when it changes, change this file in the same PR. Plain data so a later build step can load it instead.

export interface Objection { id: string; heard: string; answer: string }
export const OBJECTIONS: Objection[] = [
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

export const NEVER_SAY: string[] = [
  'No guarantees of bookings, revenue or results.',
  'No statistics we cannot source. Use the owner\'s own audit number.',
  'No channel that is not live. Check with Christian.',
  'No discounts. No free trials. Ever.',
  'No competitor prices.',
  'No legal or compliance promises.',
];
export const SWAPS: { instead: string; say: string }[] = [
  { instead: 'We guarantee more bookings', say: 'We measure booked jobs and show you at day 14.' },
  { instead: 'Studies show fast replies win far more leads', say: 'We will time your own leads.' },
  { instead: 'We do Instagram and texting', say: 'Those channels need approval from the platform or carrier. They are coming, and they are added when cleared. Here is what is ready now.' },
  { instead: 'I can do it for less', say: 'The draft pilot price is $499. I do not discount. Let me confirm the final price with Christian.' },
  { instead: 'Try it free for a week', say: 'The free proof is the free part. The pilot is the proof you pay for.' },
  { instead: 'We are cheaper than X', say: 'We price against one job, not against software.' },
  { instead: 'It is fully compliant', say: 'It is built around consent and opt-out, and you approve every message in week one.' },
  { instead: 'We recovered $X for you', say: 'Estimated value, using your own job average.' },
];

export const DEMO_STEPS: string[] = [
  'Open it on your own screen first, the same day. Never share a screen into something you have not tested that day.',
  'Pick the sample business closest to the prospect\'s trade.',
  'Start a session, play the lead, and let the prospect watch the reply.',
  'Point at three things: how quickly it replies, how it asks the qualifying questions, and where it hands off to a person.',
  'Then go straight back to their own numbers from the audit.',
];
export const DEMO_SAY = 'The demo shows the idea. Your pilot is built from your own services and your own rules.';
export const DEMO_LIMITS = 'Code defaults, deployed values not rechecked: about 10 sessions a day across the site, 2 per visitor, and a session of about 3 minutes. If the demo says it is paused or at its limit, say so, move on, and use the slides. Never try to work around a limit.';
export const DEMO_DONT = 'Do not say the demo is a client\'s real data or a live result. Do not promise the owner\'s system will sound like the demo.';
