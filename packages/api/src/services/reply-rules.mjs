// Pure reply rules shared by the API (services/inbox.mjs) and the browser demo (apps/console): classification
// and business-hours SLA. No Node or database imports, so both runtimes load the same code.

// Order matters: the safest reading wins when a reply matches several ("not interested, remove me" → unsubscribe).
const RULES = [
  ['unsubscribe', /\b(unsubscribe|remove me|take me off|opt[- ]?out|stop (emailing|contacting|sending|messaging)|do not (contact|email|message)|don'?t (contact|email|message)|no more (emails?|messages))\b|^\s*stop\s*[.!]?\s*$/im],  // m: a line that is just "stop"; without it the anchor sat on the subject and a bare STOP reply was missed (found 2026-10-02)
  ['bounce', /\b(undeliverable|delivery status notification|mail delivery (failed|subsystem)|address not found|mailbox (unavailable|not found)|recipient address rejected)\b/i],
  ['out_of_office', /\b(out of (the )?office|on (annual |parental )?leave|on vacation|auto(matic)?[- ]?reply|away (until|from)|currently away|limited access to email)\b/i],
  ['wrong_person', /\b(wrong person|not the right (person|contact)|no longer (with|at|work)|left the company)\b/i],
  ['not_interested', /\b(not interested|no thanks|no,? thank you|not a (good )?fit|not right now|we('| a)re all set|pass on this)\b/i],
  ['meeting_request', /\b((book|schedule|set up|hop on|jump on|grab) (a |some )?(call|meeting|time|demo|chat)|let'?s (talk|chat|meet|connect)|send (me |over )?(a |your |some )?(calendar|link|invite|times|availability)|(are you|you) (free|available)|what (times?|does your calendar))\b/i],
  ['referral', /\b(reach out to|talk to|contact|loop(ing)? in|cc'?(ing|d)?)\b.{0,40}@/i],
  ['question', /\?/],
];

// ─── Reply cleaning ────────────────────────────────────────────────────────────────────────────────────────────
// What the person wrote, without the thread they replied to, their signature or a legal disclaimer. The rules and
// the decider read the cleaned text; the raw body stays stored for people. Found 2026-10-02: a reply that quotes our
// own email carries our footer ("Unsubscribe: https://…"), so "Thursday works" was classified as an opt-out.
// Biased to keep text: only lines that are clearly quoted or boilerplate go, so an opt-out written below a quote
// (bottom-posting) still counts.
const ATTRIBUTION = /^(on\b.{0,300}\bwrote:|el\b.{0,300}\bescribi[oó]:|le\b.{0,300}\ba écrit\s*:|am\b.{0,300}\bschrieb\b.{0,200}:)\s*$/i;
const ORIGINAL_HEADER = /^(-{2,}\s*(original message|forwarded message|mensaje original)\s*-{2,}|_{8,})\s*$/i;
const OUTLOOK_FROM = /^\*?(from|de|von):\*?\s.+$/i;
const OUTLOOK_NEXT = /^\*?(sent|date|to|subject|enviado|fecha|para|asunto|gesendet|an|betreff):\*?\s/i;
const MOBILE_SIG = /^(sent from my \w+|sent from (outlook|mail|yahoo mail)( for \w+)?|get outlook for \w+|enviado desde mi \w+)\b.*$/i;
const OUR_FOOTER = /^unsubscribe:\s*https?:\/\/\S+\/u\/\S+\s*$/i;
const DISCLAIMER = /^(confidentiality notice|disclaimer|privileged (and|&) confidential|this (e-?mail|message|communication)( and any (files|attachments)( transmitted with it)?)? (is|are|may (be|contain))\b.*\bconfidential)/i;

export function cleanReplyBody(body = '') {
  let lines = String(body).replace(/\r\n?/g, '\n').split('\n');
  const hasText = (ls) => ls.some((l) => l.trim() && !/^\s*>/.test(l));
  // Gmail can wrap the attribution onto two lines ("On Tue, … <a@b.c>" / "wrote:"): join it before matching.
  for (let i = 0; i < lines.length - 1; i++) if (/^\s*wrote:\s*$/i.test(lines[i + 1]) && /^\s*on\b/i.test(lines[i])) { lines[i] = `${lines[i].trim()} wrote:`; lines.splice(i + 1, 1); }
  // An unquoted original below the reply (Outlook, "Original Message"): cut from its header down, but only when the
  // person wrote something above it; otherwise the "header" may be their own words.
  for (let i = 0; i < lines.length; i++) {
    const outlook = OUTLOOK_FROM.test(lines[i].trim()) && lines.slice(i + 1, i + 4).some((l) => OUTLOOK_NEXT.test(l.trim()));
    if ((ORIGINAL_HEADER.test(lines[i].trim()) || outlook) && hasText(lines.slice(0, i))) { lines = lines.slice(0, i); break; }
  }
  // Quoted lines and the attribution line go wherever they are, so text written below a quote is kept.
  lines = lines.filter((l) => !/^\s*>/.test(l) && !ATTRIBUTION.test(l.trim()) && !OUR_FOOTER.test(l.trim()) && !MOBILE_SIG.test(l.trim()));
  // A signature ("-- " on its own line) or a disclaimer runs to the end: cut it when something is left above.
  const sig = lines.findIndex((l, i) => (/^--\s*$/.test(l) || DISCLAIMER.test(l.trim())) && hasText(lines.slice(0, i)));
  if (sig > 0) lines = lines.slice(0, sig);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function classifyReply({ subject = '', body = '', from = '' }) {
  const text = `${subject}\n${cleanReplyBody(body)}`;
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
