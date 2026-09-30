// Pure reply rules shared by the API (services/inbox.mjs) and the browser demo (apps/console): classification
// and business-hours SLA. No Node or database imports, so both runtimes load the same code.

// Order matters: the safest reading wins when a reply matches several ("not interested, remove me" → unsubscribe).
const RULES = [
  ['unsubscribe', /\b(unsubscribe|remove me|take me off|opt[- ]?out|stop (emailing|contacting|sending|messaging)|do not (contact|email|message)|don'?t (contact|email|message)|no more (emails?|messages))\b|^\s*stop\s*[.!]?\s*$/i],
  ['bounce', /\b(undeliverable|delivery status notification|mail delivery (failed|subsystem)|address not found|mailbox (unavailable|not found)|recipient address rejected)\b/i],
  ['out_of_office', /\b(out of (the )?office|on (annual |parental )?leave|on vacation|auto(matic)?[- ]?reply|away (until|from)|currently away|limited access to email)\b/i],
  ['wrong_person', /\b(wrong person|not the right (person|contact)|no longer (with|at|work)|left the company)\b/i],
  ['not_interested', /\b(not interested|no thanks|no,? thank you|not a (good )?fit|not right now|we('| a)re all set|pass on this)\b/i],
  ['meeting_request', /\b((book|schedule|set up|hop on|jump on|grab) (a |some )?(call|meeting|time|demo|chat)|let'?s (talk|chat|meet|connect)|send (me |over )?(a |your |some )?(calendar|link|invite|times|availability)|(are you|you) (free|available)|what (times?|does your calendar))\b/i],
  ['referral', /\b(reach out to|talk to|contact|loop(ing)? in|cc'?(ing|d)?)\b.{0,40}@/i],
  ['question', /\?/],
];

export function classifyReply({ subject = '', body = '', from = '' }) {
  const text = `${subject}\n${body}`;
  if (/^(mailer-daemon|postmaster)@/i.test(from)) return { intent: 'bounce', confidence: 0.9, by: 'rules-1' };
  for (const [intent, re] of RULES) if (re.test(text)) return { intent, confidence: 0.6, by: 'rules-1' };
  return { intent: 'unclassified', confidence: null, by: 'rules-1' };
}

// Business minutes in the workspace's time zone, Mon–Fri 09:00–17:00 (SPEC Station 16: 2 business hours).
export function addBusinessMinutes(start, minutes, timeZone, { open = 9, close = 17 } = {}) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let t = Math.ceil(start.getTime() / 60000) * 60000;
  let left = minutes;
  for (let guard = 0; left > 0 && guard < 60 * 24 * 21; guard++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    const h = Number(parts.hour);
    if (parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && h >= open && h < close) left--;
    t += 60000;
  }
  return new Date(t);
}

export const SLA_MINUTES = 120;
