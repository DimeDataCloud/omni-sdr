// Vendored verbatim from packages/sender/src/text-cadence.mjs on branch claude/s2l-text-cadence @9cb660b (legal-ruled send window, Addendum B6).
// One copy of the cadence rules: when that branch merges, replace this file with an import so the demo and the product cannot drift.
// Text follow-up cadence for form leads (speed to lead). Pure: no database, no clock, no network. Given what is known about one
// lead and its texts so far, say what happens next: send a text at a time, wait, or stop for good, with the reason.
//
// Nothing here sends. A text still goes out only as an approved lead draft through send_guard, and SMS stays locked there until a
// carrier-registered provider exists (0019). This module is the schedule and the stop rules, tested without a database.
//
// Rules, each one a refusal first and a schedule second:
//   - no express consent on this number, no text. Consent is read from the lead record, never assumed from a phone being present.
//   - a person who opted out, replied, booked, or has a human on the thread is never texted by the sequence again.
//   - texts go only inside the send window, in the lead's time zone (legal ruling, Compliance Addendum B6): follow-ups 9 AM to 8 PM,
//     Monday to Saturday, no federal holidays. The first reply to a request made in the last 10 minutes may go on any day, same hours.
//     If the zone is unknown, the window must hold in New York and Los Angeles at once, which with these hours is 12 PM to 8 PM
//     Eastern (the legal ruling's number), so a wrong guess can only be too careful.
//   - at most MAX_TEXTS in total and at most one text a day after the first; the sequence ends at SEQUENCE_DAYS.
// The numbers below are proposals (Christian sets them per client in the Playbook); they live in one frozen object so a test can
// pin them and a client rule can override them.

export const DEFAULT_RULES = Object.freeze({
  responseWindowMinutes: 2,            // the first text: inside the response window (migration 0028 default)
  // Wait before text n+1, counted from when text n was SENT: 4 hours, a day, three days. Then the sequence ends.
  waitMinutes: Object.freeze([4 * 60, 24 * 60, 72 * 60]),
  maxTexts: 4,
  sequenceDays: 7,
  // 9 AM to 8 PM recipient-local, Monday to Saturday (0 = Sunday), no federal holidays (legal ruling 2026-10-28, Addendum B6).
  quietHours: Object.freeze({ open: 9, close: 20, days: Object.freeze([1, 2, 3, 4, 5, 6]), skipHolidays: true }),
  firstReplyAnyDayMinutes: 10,         // a first text sent within this many minutes of the request may go on a Sunday or a holiday
  minGapMinutes: 12 * 60,              // never two texts closer than this after the first one
});

// Continental US. Hawaii and Alaska are not covered by the unknown-zone fallback; give those leads their zone.
export const UNKNOWN_ZONE_FALLBACK = Object.freeze(['America/New_York', 'America/Los_Angeles']);

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);   // CTIA standard opt-out keywords
const STOP_PHRASES = [/\bstop (texting|messaging|contacting|sending)\b/, /\b(do not|dont|don't) (text|message|contact)\b/, /\bremove me\b/, /\btake me off\b/, /\bopt out\b/];
const HELP_WORDS = new Set(['HELP', 'INFO']);

/**
 * What an inbound text means for opt-out, decided by rules and never by a model.
 * A bare keyword (the whole message) is a keyword; a few unmistakable phrases also count. Anything else is a normal reply.
 * @returns 'stop' | 'help' | 'start' | null
 */
export function classifyInbound(text) {
  const raw = String(text ?? '').trim();
  const word = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (STOP_WORDS.has(word)) return 'stop';
  if (HELP_WORDS.has(word)) return 'help';
  const lower = raw.toLowerCase().replace(/[‘’]/g, "'");
  if (STOP_PHRASES.some((re) => re.test(lower))) return 'stop';
  // 'start' re-subscribes only when someone is already opted out; the caller decides.
  if (word === 'START' || word === 'UNSTOP') return 'start';
  return null;
}

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map();
function localParts(at, zone) {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
    fmtCache.set(zone, f);
  }
  const p = {};
  for (const x of f.formatToParts(at)) p[x.type] = x.value;
  return { hour: Number(p.hour), weekday: WEEKDAY[p.weekday], date: `${p.year}-${p.month}-${p.day}` };
}

// US federal holidays. Each fixed-date holiday counts on its own date AND on the day it is observed (Saturday: the Friday before,
// Sunday: the Monday after), so a lead is never texted on either. That is the careful reading of "no federal holidays".
const holidayCache = new Map();
function holidaysFor(year) {
  let set = holidayCache.get(year);
  if (set) return set;
  set = new Set();
  const iso = (d) => d.toISOString().slice(0, 10);
  for (const y of [year, year + 1]) {                                   // next year's Jan 1 can be observed on Dec 31
    for (const [m, d] of [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]]) {
      if (y !== year && !(m === 1 && d === 1)) continue;
      const day = new Date(Date.UTC(y, m - 1, d));
      set.add(iso(day));
      if (day.getUTCDay() === 6) set.add(iso(new Date(day.getTime() - 86400000)));
      if (day.getUTCDay() === 0) set.add(iso(new Date(day.getTime() + 86400000)));
    }
  }
  const nth = (m, wd, n) => { const first = new Date(Date.UTC(year, m, 1)).getUTCDay(); return new Date(Date.UTC(year, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7)); };
  const last = (m, wd) => { const end = new Date(Date.UTC(year, m + 1, 0)); return new Date(Date.UTC(year, m, end.getUTCDate() - ((end.getUTCDay() - wd + 7) % 7))); };
  // MLK, Presidents, Memorial, Labor, Columbus, Thanksgiving
  for (const d of [nth(0, 1, 3), nth(1, 1, 3), last(4, 1), nth(8, 1, 1), nth(9, 1, 2), nth(10, 4, 4)]) set.add(iso(d));
  holidayCache.set(year, set);
  return set;
}

/** Is the calendar date 'YYYY-MM-DD' a federal holiday, or the day one is observed? */
export function isFederalHoliday(date) { return holidaysFor(Number(date.slice(0, 4))).has(date); }

/** Is `at` inside the send window (hours, days, holidays) in every zone of `zones`? */
export function textingAllowed(at, zones, q = DEFAULT_RULES.quietHours) {
  return zones.every((z) => {
    const l = localParts(at, z);
    if (l.hour < q.open || l.hour >= q.close) return false;
    if (q.days && !q.days.includes(l.weekday)) return false;
    return !(q.skipHolidays && isFederalHoliday(l.date));
  });
}

/** The earliest minute at or after `from` when texting is allowed in every zone; null if none within 5 days (a bad rule). */
export function nextAllowed(from, zones, q = DEFAULT_RULES.quietHours) {
  const t0 = Math.ceil(from.getTime() / 60000) * 60000;   // whole minutes, so a result lands on :00 of an open hour
  const start = t0 === from.getTime() ? t0 : from.getTime();
  if (textingAllowed(new Date(start), zones, q)) return new Date(start);
  for (let t = t0; t <= t0 + 120 * 3600000; t += 60000) if (textingAllowed(new Date(t), zones, q)) return new Date(t);
  return null;
}

const MIN = 60000;

/**
 * What happens next for one lead.
 *
 * @param lead   { receivedAt: Date, consent: 'express_form' | 'existing_customer' | 'inquiry_reply' | 'imported_attested' | 'none',
 *                 hasPhone: boolean, timeZone?: string, optedOut?: boolean, suppressed?: boolean, replied?: boolean, booked?: boolean,
 *                 humanHasThread?: boolean, repliedToText?: boolean }
 * @param sent   Dates of the texts already SENT for this lead, oldest first (a draft or an approval is not a send)
 * @param now    Date
 * @param rules  DEFAULT_RULES, or a client's override
 * @returns      { action: 'send', at: Date, step: n, purpose, deferredBy?: 'quiet_hours' }  the next text and when it may go
 *             | { action: 'wait', until: Date, reason }                                       nothing is due yet
 *             | { action: 'stop', reason }                                                    the sequence is over for this lead
 */
export function planNextText(lead, sent, now, rules = DEFAULT_RULES) {
  const stop = (reason) => ({ action: 'stop', reason });
  // Refusals first, in the order a person would check them. Each reason is a stable string the UI and Results can show.
  if (lead.optedOut) return stop('opted_out');
  if (lead.suppressed) return stop('suppressed');
  if (lead.consent === 'none' || !lead.consent) return stop('no_consent');
  if (!lead.hasPhone) return stop('no_phone');
  if (lead.booked) return stop('booked');
  if (lead.replied) return stop('replied');
  if (lead.humanHasThread) return stop('human_has_thread');
  if (sent.length >= rules.maxTexts) return stop('max_texts');
  const start = lead.receivedAt.getTime();
  if (now.getTime() - start > rules.sequenceDays * 86400000) return stop('sequence_expired');

  const zones = lead.timeZone ? [lead.timeZone] : UNKNOWN_ZONE_FALLBACK;
  const step = sent.length;
  let due;
  if (step === 0) {
    due = new Date(start + rules.responseWindowMinutes * MIN);
  } else {
    const wait = rules.waitMinutes[step - 1] ?? rules.waitMinutes[rules.waitMinutes.length - 1];
    due = new Date(sent[step - 1].getTime() + Math.max(wait, rules.minGapMinutes) * MIN);
  }
  // The first reply to a request made in the last few minutes may go on any day (same hours); everything else keeps the full window.
  const anyDay = { ...rules.quietHours, days: undefined, skipHolidays: false };
  const quick = (t) => step === 0 && t.getTime() - start <= rules.firstReplyAnyDayMinutes * MIN;
  const windowAt = (t) => (quick(t) ? anyDay : rules.quietHours);
  // Deferred means the text's own due time fell outside the window (a cron that ran late inside the window is not a deferral).
  const deferred = !textingAllowed(due, zones, windowAt(due));
  // A late first text is still due now: speed to lead means the clock is already running, not that we wait for the window to come round.
  if (step === 0 && due < now) due = now;
  let allowed = nextAllowed(due, zones, windowAt(due));
  // Past the first few minutes the any-day allowance is gone: a Sunday request that missed it waits for the next real send day.
  if (allowed && quick(due) && !quick(allowed)) allowed = nextAllowed(due, zones, rules.quietHours);
  if (!allowed) return stop('no_send_window');
  // The sequence ends when the next text would fall after it (the last text is not pushed past the end by quiet hours).
  if (allowed.getTime() - start > rules.sequenceDays * 86400000) return stop('sequence_expired');
  const purpose = step === 0 ? 'first_response' : 'followup';
  if (allowed > now) return { action: 'wait', until: allowed, reason: deferred ? 'quiet_hours' : 'not_due', step, purpose };
  return { action: 'send', at: allowed, step, purpose, ...(deferred ? { deferredBy: 'quiet_hours' } : {}) };
}

/** Seconds from the lead arriving to the first text going out, for Results; null until a text is sent. */
export function timeToFirstTextSeconds(receivedAt, sent) {
  return sent.length ? Math.max(0, Math.round((sent[0].getTime() - receivedAt.getTime()) / 1000)) : null;
}
