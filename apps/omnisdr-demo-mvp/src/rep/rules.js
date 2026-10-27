// What a logged call does to the account (Call Room, DESIGN-rep-portal). POST /rep/api/calls runs this and writes the call,
// the stage change and the follow-up task in one D1 batch, so a call and its consequences land together or not at all.

export const STAGES = ['new', 'contacted', 'audit_run', 'results_call', 'proposed', 'signed', 'onboarding', 'live', 'lost'];
export const OPEN_STAGES = ['new', 'contacted', 'audit_run', 'results_call', 'proposed'];
export const OUTCOMES = ['no_answer', 'voicemail', 'callback_scheduled', 'interested', 'not_interested', 'text_sent', 'email_sent'];

const DAY = 86400000;
export const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString();

/** Forward-only move: returns `to` if it is later in the pipeline than `from`, else null. 'lost' is never reached this way. */
export const advance = (from, to) => (STAGES.indexOf(to) > STAGES.indexOf(from) && to !== 'lost' ? to : null);

/**
 * @param outcome     one of OUTCOMES
 * @param stage       the account's stage before the call
 * @param callbackAt  ISO time the rep picked, only for callback_scheduled (validated by the route)
 * @param now         ISO time of the call
 * @returns { stage: string|null, task: { kind, title, dueAt }|null }  null stage = leave it; null task = no follow-up
 */
export function afterCall({ outcome, stage, callbackAt, now }) {
  const touched = advance(stage, 'contacted');
  const later = (days, title, kind = 'follow_up') => ({ kind, title, dueAt: addDays(now, days) });
  switch (outcome) {
    case 'no_answer': return { stage: touched, task: later(1, 'Call again') };
    case 'voicemail': return { stage: touched, task: later(2, 'Call again after the voicemail') };
    case 'callback_scheduled': return { stage: touched, task: { kind: 'callback', title: 'Call back at the time they asked', dueAt: callbackAt } };
    // Interested means the free proof is next: run the missed-call audit and book the results call.
    case 'interested': return { stage: touched, task: later(1, 'Run the free check and book the results call', 'demo') };
    // A no is final for this round, but a business that said no in a slow month can say yes later.
    case 'not_interested': return { stage: OPEN_STAGES.includes(stage) ? 'lost' : null, task: OPEN_STAGES.includes(stage) ? later(90, 'Check back in, it has been 90 days') : null };
    case 'text_sent': return { stage: touched, task: later(5, 'No reply to the text, follow up') };
    case 'email_sent': return { stage: touched, task: later(5, 'No reply to the email, follow up') };
    default: return { stage: null, task: null };
  }
}

/**
 * Standing rules (DJ CRM automation, idempotent through tasks.auto_key). Each returns the SQL that selects the accounts it
 * applies to and the task to create; the route inserts with ON CONFLICT DO NOTHING on the open auto_key index.
 * Run when a rep opens Today, so no cron is needed and a rule never fires for a rep who is not working.
 */
export const RULES = [
  { key: 'stale-contacted', days: 5, title: 'No reply in 5 days, follow up',
    where: "stage = 'contacted' AND COALESCE(last_touch_at, updated_at) < ?" },
  { key: 'stale-proposal', days: 7, title: 'Proposal sitting 7 days, ask for the decision',
    where: "stage = 'proposed' AND COALESCE(last_touch_at, updated_at) < ?" },
  { key: 'onboarding-open', days: 3, title: 'Signed 3 days ago, finish the onboarding details',
    where: "stage = 'signed' AND updated_at < ?" },
];
