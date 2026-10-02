// Pure reply rules shared by the API (services/inbox.mjs) and the browser demo (apps/console): classification
// and business-hours SLA. No Node or database imports, so both runtimes load the same code.

// Order matters: the safest reading wins when a reply matches several ("not interested, remove me" → unsubscribe).
const RULES = [
  ['unsubscribe', /\b(unsubscribe|remove (me|us)|take (me|us) off|opt[- ]?out|opt (me|us) out|(stop|quit) receiving (these|this|your|any|the)|drop (me|us) from|delete my (info|information|contact|details|email|address)|stop(ped)? (emailing|contacting|sending|messaging|reaching out)|(do not|don'?t|never) (contact|email|message|write to|follow up|reach out)|no more (emails?|messages)|qu[ií]t[ae]n?(me|nos)|elim[ií]n[ae]n?(me|nos)|dar(me|nos)? de baja|no me (escriban?|contacten?|env[ií]en))\b|take (this|my) (address|email)\b.{0,80}\boff\b|(ask|request) (that )?you (do not|don'?t|not|stop|never) (email|contact|message|write)|^\s*(stop|remove|unsubscribe)\s*[.!]?\s*$/im],  // m: a line that is just "stop"; without it the anchor sat on the subject and a bare STOP reply was missed (found 2026-10-02)
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

// A tail about to be cut that asks to stop (in anything but our own footer) is kept: an opt-out must never be lost
// to cleaning (found in the 2026-10-02 audit: "Thanks.\n--\nPlease remove me" lost its opt-out).
// Only a first-person request counts here; boilerplate such as "To unsubscribe from our newsletter" in a signature or
// disclaimer doesn't, or a meeting request with a corporate disclaimer would read as an opt-out.
const OPT_OUT_REQUEST = /\b(remove (me|us)|unsubscribe (me|us)|(stop|quit) receiving (these|this|your|any|the)|take (me|us) off|opt (me|us) out|drop (me|us) from|delete my (info|information|contact|details|email|address)|stop(ped)? (emailing|contacting|sending|messaging|reaching out)( to)? (me|us)|(do(n'?t| not)|never) (contact|email|message|write to) (me|us)|no more (emails?|messages)|qu[ií]t[ae]n?(me|nos)|elim[ií]n[ae]n?(me|nos)|dar(me|nos)? de baja|no me (escriban?|contacten?|env[ií]en))\b|take (this|my) (address|email)\b.{0,80}\boff\b|(ask|request) (that )?you (do not|don'?t|not|stop|never) (email|contact|message|write)|^\s*(stop|remove|unsubscribe)\s*[.!]?\s*$/im;
const optOutIn = (ls) => OPT_OUT_REQUEST.test(ls.filter((l) => !OUR_FOOTER.test(l.trim()) && !/^\s*>/.test(l)).join('\n'));

// The sender's own mailing-list boilerplate is not a request to us (L11, LAYA-DATA-2026-10-02: a meeting request
// whose signature said "To unsubscribe from our patient newsletter visit …" was suppressed). A line goes only when it
// names THEIR list ("our newsletter", "our mailing list", "email preferences") and asks nothing in the first person.
// Both are needed (claude-local's #41 audit: "this list", said by a prospect, means OUR list and must stay an opt-out):
// the line names the sender's own list ("our newsletter") AND reads as boilerplate (to unsubscribe / click / visit / a link).
const OWN_LIST = /\bour (\w+ ){0,2}(newsletter|mailing list|list|emails?|updates|marketing)\b/i;
const BOILERPLATE = /\bto (unsubscribe|opt[- ]?out|stop receiving)\b|\bclick\b|\bvisit\b|https?:\/\/|\bwww\.|\b[a-z0-9-]+\.[a-z]{2,}\/\S*|\b(manage|update) (your|email) (preferences|subscription)/i;
const ownListFooter = (l) => OWN_LIST.test(l) && BOILERPLATE.test(l);
// Text aimed at a model, not at us: a bracketed note or HTML that names the classifier, an HTML comment, or a
// hidden element. It is removed before the rules and the decider read the reply, unless it holds a first-person
// opt-out, which always counts (safe side).
// Only brackets that address a model ("[note to the triage model: …]", "[assistant note: …]", "[ignore previous …]"),
// not any bracket that happens to say "system" or "bot" ("[We already have a phone system, not interested]" stays).
const MODEL_NOTE = /\[[^\]\n]{0,300}\b((note|instruction|message)s? (to|for) (the |any )?(triage |automated |reading )?(ai|model|classifier|assistant|bot|llm|system)|(ai|llm|model|assistant|bot|classifier|triage) (note|instruction|reading this)|classif(y|ier)|label (this|it|the reply|as)|ignore (all|any|previous|prior|earlier|your)|you are an? (ai|model|assistant|classifier)|as an ai|system:)[^\]\n]{0,300}\]/gi;
const HIDDEN_HTML = /<!--[\s\S]*?-->|<(span|div|p)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi;
const unlessOptOut = (m) => (OPT_OUT_REQUEST.test(m) ? m : '');

export function cleanReplyBody(body = '') {
  let lines = String(body).replace(/\r\n?/g, '\n').replace(HIDDEN_HTML, unlessOptOut).replace(MODEL_NOTE, unlessOptOut).split('\n');
  const hasText = (ls) => ls.some((l) => l.trim() && !/^\s*>/.test(l));
  // Gmail can wrap the attribution onto two lines ("On Tue, … <a@b.c>" / "wrote:"): join it before matching.
  for (let i = 0; i < lines.length - 1; i++) if (/^\s*wrote:\s*$/i.test(lines[i + 1]) && /^\s*on\b/i.test(lines[i])) { lines[i] = `${lines[i].trim()} wrote:`; lines.splice(i + 1, 1); }
  // An unquoted original below the reply (Outlook, "Original Message"): cut from its header down, but only when the
  // person wrote something above it; otherwise the "header" may be their own words.
  for (let i = 0; i < lines.length; i++) {
    const outlook = OUTLOOK_FROM.test(lines[i].trim()) && lines.slice(i + 1, i + 4).some((l) => OUTLOOK_NEXT.test(l.trim()));
    if ((ORIGINAL_HEADER.test(lines[i].trim()) || outlook) && hasText(lines.slice(0, i)) && !optOutIn(lines.slice(i))) { lines = lines.slice(0, i); break; }
  }
  // Quoted lines and the attribution line go wherever they are, so text written below a quote is kept.
  lines = lines.filter((l) => !/^\s*>/.test(l) && !ATTRIBUTION.test(l.trim()) && !OUR_FOOTER.test(l.trim()) && !MOBILE_SIG.test(l.trim())
    && !(ownListFooter(l) && !OPT_OUT_REQUEST.test(l)));
  // A signature ("-- " on its own line) or a disclaimer runs to the end: cut it when something is left above.
  const sig = lines.findIndex((l, i) => (/^--\s*$/.test(l) || DISCLAIMER.test(l.trim())) && hasText(lines.slice(0, i)) && !optOutIn(lines.slice(i)));
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

// ─── Out-of-office return date (acceptance step 9: "an out-of-office reply snoozes to the return date") ───────────
// Deterministic: the date after "until / through / back on / returning / hasta / regreso", as a month and day, a
// numeric date, a weekday, "tomorrow", "the 20th" or a month alone. "Through X" means back the day after. The sequence
// wakes at 09:00 in the workspace's time zone on the first weekday on or after the return day. No date → null, and
// the caller snoozes a default week. A date more than 180 days out is not believed (a typo or a template).
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const CUE = /\b(until|till|til|through|thru|back(?: in the office| in office| at my desk)?(?: on| by)?|returning(?: on)?|return(?:ing)? to the office(?: on)?|i return(?: on)?|hasta(?: el)?|regreso(?: el)?|vuelvo(?: el)?)\s+/gi;

function localParts(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), wd: DAYS.indexOf(p.weekday.slice(0, 3).toLowerCase()) };
}
// 09:00 on a local calendar day in `timeZone`, as an instant.
function nineAm(y, m, d, timeZone) {
  let t = Date.UTC(y, m - 1, d, 9);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    t += Date.UTC(y, m - 1, d, 9) - seen;
  }
  return new Date(t);
}

function dateAfterCue(s, now, tz) {
  const today = localParts(now, tz);
  const ymd = (y, m, d) => ({ y, m, d });
  const roll = (m, d) => { // the next occurrence of month/day on or after today
    const y = (m < today.m || (m === today.m && d < today.d)) ? today.y + 1 : today.y;
    return ymd(y, m, d);
  };
  const addDays = (n) => { const x = new Date(Date.UTC(today.y, today.m - 1, today.d + n)); return ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); };
  let m;
  const mon = (w) => { const k = w.slice(0, 3).toLowerCase(); const i = MONTHS.indexOf(k); return i >= 0 ? i + 1 : (MESES.indexOf(k) >= 0 ? MESES.indexOf(k) + 1 : 0); };
  if ((m = /^(?:on |el )?(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,? )?([a-záéíóú]{3,10})\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b/i.exec(s)) && mon(m[1])) {
    const d = Number(m[2]); if (d < 1 || d > 31) return null;
    return m[3] ? ymd(Number(m[3]), mon(m[1]), d) : roll(mon(m[1]), d);
  }
  if ((m = /^(?:on |el )?(\d{1,2})(?:st|nd|rd|th)? (?:de |of )?([a-záéíóú]{3,10})\.?(?:,? (?:de )?(\d{4}))?\b/i.exec(s)) && mon(m[2])) {
    const d = Number(m[1]); if (d < 1 || d > 31) return null;
    return m[3] ? ymd(Number(m[3]), mon(m[2]), d) : roll(mon(m[2]), d);
  }
  if ((m = /^(?:on )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s))) {   // US m/d
    const mm = Number(m[1]); const d = Number(m[2]); if (mm < 1 || mm > 12 || d < 1 || d > 31) return null;
    return m[3] ? ymd(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mm, d) : roll(mm, d);
  }
  if (/^(?:tomorrow|mañana)\b/i.test(s)) return addDays(1);
  if ((m = /^(?:next |the |el (?:próximo )?|this )?((?:mon|tues|wednes|thurs|fri|satur|sun)day|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/i.exec(s))) {
    const w = m[1].toLowerCase(); const target = DAYS.indexOf(w.slice(0, 3)) >= 0 ? DAYS.indexOf(w.slice(0, 3)) : DIAS.indexOf(w.slice(0, 3));
    if (target < 0) return null;
    return addDays(((target - today.wd + 7) % 7) || 7);
  }
  if ((m = /^the (\d{1,2})(?:st|nd|rd|th)\b/i.exec(s))) {
    const d = Number(m[1]); if (d < 1 || d > 31) return null;
    return d >= today.d ? ymd(today.y, today.m, d) : (today.m === 12 ? ymd(today.y + 1, 1, d) : ymd(today.y, today.m + 1, d));
  }
  if ((m = /^(?:early |mid-?|late )?([a-záéíóú]{3,10})(?:,? (\d{4}))?\b/i.exec(s)) && mon(m[1]) && !/^(?:mar|may)$/i.test(m[1])) {
    return m[2] ? ymd(Number(m[2]), mon(m[1]), 1) : roll(mon(m[1]), 1);
  }
  return null;
}

/** The instant an out-of-office sequence should wake, or null when the text names no usable return date. */
export function returnDateFrom(text, receivedAt, timeZone = 'America/Chicago') {
  const s = String(text ?? '');
  for (const cue of s.matchAll(CUE)) {
    const hit = dateAfterCue(s.slice(cue.index + cue[0].length, cue.index + cue[0].length + 60), receivedAt, timeZone);
    if (!hit) continue;
    let { y, m, d } = hit;
    if (/^(through|thru)$/i.test(cue[1])) { const x = new Date(Date.UTC(y, m - 1, d + 1)); [y, m, d] = [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]; }
    for (let i = 0; i < 3; i++) {   // first weekday on or after the return day
      const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (wd !== 0 && wd !== 6) break;
      const x = new Date(Date.UTC(y, m - 1, d + 1)); [y, m, d] = [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()];
    }
    const at = nineAm(y, m, d, timeZone);
    if (Number.isNaN(at.getTime()) || at <= receivedAt || at - receivedAt > 180 * 86400000) continue;
    return at;
  }
  return null;
}

export const OOO_DEFAULT_SNOOZE_DAYS = 7;
