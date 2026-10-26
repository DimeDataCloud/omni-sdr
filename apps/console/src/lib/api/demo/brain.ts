// Demo-mode agent replies. Not a model: a deterministic reader over this workspace's rows, so every answer is
// true of the data on screen and names where it came from. The real API routes chat to the Gemini API (services/model.mjs).
// Phase 3 adds: an attached object ("Ask about this") answered from that object's rows, composer modes that pick
// the part of the workspace to answer from, and `sources`, the rows each answer read.
import type { World, AgentRow } from './seed';
import type { About, AskMode, Intent } from '../types';
import { INTENT, enrollmentState, findingText, domainOf } from '@/lib/format';

export interface Thought { body: string; sources: string[] }

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : 'no sends yet');
const count = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const summary = (facts: Record<string, unknown>) =>
  Object.values(facts).map((f) => (f as { summary?: string }).summary).filter(Boolean).join('; ');

function context(w: World, ws: string, now: Date) {
  const tz = w.workspaces.find((x) => x.id === ws)?.timezone ?? 'UTC';
  const time = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const contact = (id: string | null) => w.contacts.find((c) => c.id === id && c.ws === ws);
  const drafts = w.drafts.filter((d) => d.ws === ws);
  const contactOf = (enrollmentId: string) => contact(w.enrollments.find((e) => e.id === enrollmentId)?.contactId ?? null);
  return {
    w, ws, now, tz, time, day, contact, contactOf, drafts,
    review: drafts.filter((d) => d.status === 'review'),
    blocked: drafts.filter((d) => d.status === 'blocked'),
    openReplies: w.inbound.filter((r) => r.ws === ws && !r.handledAt),
    upcoming: w.meetings.filter((m) => m.ws === ws && m.status === 'booked' && new Date(m.startsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    who: (c?: { name: string | null; company: string | null }) => (c ? `${c.name ?? 'Unknown'}${c.company ? ` (${c.company})` : ''}` : 'an unknown contact'),
  };
}
type Ctx = ReturnType<typeof context>;

/** The agent's reply text (the seeded conversations use this). */
export function answer(w: World, ws: string, agent: AgentRow, question: string, now: Date, opts: { about?: About | null; mode?: AskMode } = {}): string {
  return think(w, ws, agent, question, now, opts).body;
}

type Route = 'blocked' | 'meetings' | 'replies' | 'stats' | 'leads' | 'drafts' | 'today';
const MODE_ROUTE: Record<Exclude<AskMode, 'ask'>, Route> = { find_leads: 'leads', draft: 'drafts', book: 'meetings', report: 'stats' };
function route(q: string): Route {
  if (/block|gate|why.*(stop|fail)|reject/.test(q)) return 'blocked';
  if (/meeting|calendar|book|schedule/.test(q)) return 'meetings';
  if (/reply|inbox|respond|answer/.test(q)) return 'replies';
  if (/rate|stat|number|metric|perform|analytic|how.*(doing|going)/.test(q)) return 'stats';
  if (/lead|prospect|hot|best|fit|who should/.test(q)) return 'leads';
  if (/draft|writ|first touch|follow.?up/.test(q)) return 'drafts';
  return 'today';
}

export function think(w: World, ws: string, agent: AgentRow, question: string, now: Date, opts: { about?: About | null; mode?: AskMode } = {}): Thought {
  const t = reply(w, ws, agent, question.toLowerCase(), now, opts);
  // What it read, without the zero rows ("0 gate findings" is noise); the first source always stays.
  return { ...t, sources: t.sources.filter((s, i) => i === 0 || !s.startsWith('0 ')) };
}
function reply(w: World, ws: string, agent: AgentRow, q: string, now: Date, opts: { about?: About | null; mode?: AskMode }): Thought {
  const c = context(w, ws, now);
  if (opts.about) return about(c, opts.about, q);
  const r = opts.mode && opts.mode !== 'ask' ? MODE_ROUTE[opts.mode] : route(q);
  switch (r) {
    case 'blocked': return blockedAnswer(c);
    case 'meetings': return meetingsAnswer(c);
    case 'replies': return repliesAnswer(c);
    case 'stats': return stats(c, 30);
    case 'leads': return leadsAnswer(c);
    case 'drafts': return draftsAnswer(c);
    default: return today(c, agent, q);
  }
}

function blockedAnswer(c: Ctx): Thought {
  const sources = [count(c.blocked.length, 'blocked draft')];
  if (!c.blocked.length) return { body: 'Nothing is blocked right now. Every draft in the queue passed the claims gate.', sources };
  return { sources, body: `${c.blocked.length} draft${c.blocked.length > 1 ? 's are' : ' is'} blocked by the claims gate:\n\n` + c.blocked.slice(0, 5).map((d) => {
    const f = (d.gateFindings ?? []).map((x) => `${x.code.replace(/_/g, ' ')}: ${x.detail}`).join('; ');
    return `• ${c.who(c.contactOf(d.enrollmentId))}: ${f}`;
  }).join('\n') + '\n\nFix the sentence or attach evidence in Approvals, and the gate runs again on save.' };
}

function meetingsAnswer(c: Ctx): Thought {
  const sla = c.openReplies.filter((r) => r.intent === 'meeting_request');
  const lines = c.upcoming.slice(0, 5).map((m) => `• ${c.time(m.startsAt)}: ${c.who(c.contact(m.contactId))}`);
  return { sources: [count(c.upcoming.length, 'upcoming meeting'), count(sla.length, 'meeting request')], body: [
    c.upcoming.length ? `${c.upcoming.length} meeting${c.upcoming.length > 1 ? 's' : ''} coming up:\n${lines.join('\n')}` : 'No meetings on the calendar yet.',
    sla.length ? `\n${sla.length} meeting request${sla.length > 1 ? 's are' : ' is'} waiting on a reply. The SLA is 2 business hours: ${sla.map((r) => c.who(c.contact(r.contactId))).join(', ')}.` : ''].join('') };
}

function repliesAnswer(c: Ctx): Thought {
  const sources = [count(c.openReplies.length, 'open reply', 'open replies')];
  if (!c.openReplies.length) return { body: 'The inbox is clear. Every reply has been handled.', sources };
  return { sources, body: `${c.openReplies.length} open repl${c.openReplies.length > 1 ? 'ies' : 'y'}, oldest SLA first:\n\n` + [...c.openReplies]
    .sort((a, b) => (a.slaDueAt ?? '9').localeCompare(b.slaDueAt ?? '9'))
    .map((r) => `• ${c.who(c.contact(r.contactId))}: ${r.intent.replace(/_/g, ' ')}. "${clip(r.body, 90)}"`).join('\n') };
}

function stats(c: Ctx, days: number): Thought {
  const since = c.now.getTime() - days * 86400e3;
  const sent = c.w.sent.filter((s) => s.ws === c.ws && new Date(s.sentAt).getTime() >= since).length;
  const replies = c.w.inbound.filter((r) => r.ws === c.ws && new Date(r.receivedAt).getTime() >= since && !['bounce', 'out_of_office'].includes(r.intent));
  const positive = replies.filter((r) => ['meeting_request', 'positive_inquiry', 'referral'].includes(r.intent)).length;
  const meetings = c.w.meetings.filter((m) => m.ws === c.ws && m.status !== 'canceled' && new Date(m.createdAt).getTime() >= since).length;
  return { sources: [count(sent, 'send'), count(replies.length, 'reply', 'replies'), count(meetings, 'meeting')],
    body: `Last ${days} days: ${sent} sent, ${replies.length} replies (${pct(replies.length, sent)}), ${positive} positive (${pct(positive, sent)}), ${meetings} meetings booked.\n\nReplies and meetings are the measures; no tracking is added to email.` };
}

function leadsAnswer(c: Ctx): Thought {
  const inReview = new Set(c.review.map((d) => c.w.enrollments.find((e) => e.id === d.enrollmentId)?.contactId));
  const top = c.w.contacts.filter((x) => x.ws === c.ws && inReview.has(x.id)).sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0)).slice(0, 5);
  const sources = [count(c.review.length, 'draft in review', 'drafts in review'), count(top.length, 'lead')];
  if (!top.length) return { body: 'No leads are waiting on a decision.', sources };
  return { sources, body: 'Highest-fit leads with a draft waiting:\n\n' + top.map((x) => {
    const ev = c.w.evidence.find((e) => e.contactId === x.id);
    const fact = ev ? summary(ev.facts).split('; ')[0] : '';
    return `• ${c.who(x)}, fit ${x.fitScore}${fact ? `: ${fact}` : ''}`;
  }).join('\n') };
}

function draftsAnswer(c: Ctx): Thought {
  const top = [...c.review].sort((a, b) => (c.contactOf(b.enrollmentId)?.fitScore ?? 0) - (c.contactOf(a.enrollmentId)?.fitScore ?? 0))[0];
  const dayStart = c.now.getTime() - 86400e3;
  const recent = c.drafts.filter((d) => new Date(d.createdAt).getTime() >= dayStart);
  const lines = ['Sales Outbound writes every draft from fetched evidence. Nothing sends until a person approves it.'];
  lines.push(c.review.length ? `In review: ${c.review.length}. The top one is ${c.who(c.contactOf(top.enrollmentId))}, fit ${c.contactOf(top.enrollmentId)?.fitScore ?? '—'}.` : 'Nothing is waiting in Approvals.');
  if (c.blocked.length) lines.push(`Blocked by the claims gate: ${c.blocked.length} (${c.blocked.map((d) => c.contactOf(d.enrollmentId)?.name ?? 'unknown').join(', ')}). Ask me "why was it blocked?"`);
  lines.push(`Written in the last 24 hours: ${recent.length}.`);
  return { body: lines.join('\n\n'), sources: [count(c.review.length, 'draft in review', 'drafts in review'), count(c.blocked.length, 'blocked draft'), count(recent.length, 'recent draft')] };
}

// Default and "what needs me": the ranked day.
function today(c: Ctx, agent: AgentRow, q: string): Thought {
  const items: string[] = [];
  const slaReply = c.openReplies.filter((r) => r.slaDueAt).sort((a, b) => a.slaDueAt!.localeCompare(b.slaDueAt!))[0];
  if (slaReply) items.push(`${c.who(c.contact(slaReply.contactId))} asked for a meeting. Reply before ${c.time(slaReply.slaDueAt!)}.`);
  const others = c.openReplies.filter((r) => r !== slaReply);
  if (others.length) items.push(`${others.length} other repl${others.length > 1 ? 'ies' : 'y'} in the inbox.`);
  if (c.review.length) {
    const top = [...c.review].sort((a, b) => (c.contactOf(b.enrollmentId)?.fitScore ?? 0) - (c.contactOf(a.enrollmentId)?.fitScore ?? 0))[0];
    items.push(`${c.review.length} draft${c.review.length > 1 ? 's' : ''} waiting in Approvals. The top one is ${c.who(c.contactOf(top.enrollmentId))}.`);
  }
  if (c.blocked.length) items.push(`The gate blocked ${c.blocked.length} draft${c.blocked.length > 1 ? 's' : ''}. Ask me "why was it blocked?"`);
  if (c.upcoming[0]) items.push(`Next meeting: ${c.who(c.contact(c.upcoming[0].contactId))}, ${c.time(c.upcoming[0].startsAt)}.`);
  const intro = agent.station === 'chief_of_staff' || /today|need|priorit|what/.test(q) ? 'Here is today, most urgent first:' : `From ${agent.name}'s view of this workspace:`;
  return { sources: [count(c.drafts.length, 'draft'), count(c.openReplies.length, 'open reply', 'open replies'), count(c.upcoming.length, 'meeting')],
    body: items.length ? `${intro}\n\n${items.map((x, i) => `${i + 1}. ${x}`).join('\n')}` : 'Nothing needs you right now. The queue, inbox and gate are all clear.' };
}

// ── Ask about this: an answer from the attached object's own rows ────────────────────────────
function about(c: Ctx, a: About, q: string): Thought {
  const gone = { body: `I can't find ${a.label} in this workspace any more. It may have been removed.`, sources: [] };
  switch (a.kind) {
    case 'contact': { const x = c.contact(a.id); return x ? aboutContact(c, x, q) : gone; }
    case 'draft': { const d = c.drafts.find((y) => y.id === a.id); return d ? aboutDraft(c, d) : gone; }
    case 'reply': { const r = c.w.inbound.find((y) => y.id === a.id && y.ws === c.ws); return r ? aboutReply(c, r) : gone; }
    case 'meeting': { const m = c.w.meetings.find((y) => y.id === a.id && y.ws === c.ws); return m ? aboutMeeting(c, m) : gone; }
    case 'analytics': { const d = Number(a.id); return stats(c, [7, 30, 90].includes(d) ? d : 30); }
    default: return gone;
  }
}

function evidenceLines(c: Ctx, contactId: string) {
  const ev = c.w.evidence.filter((e) => e.contactId === contactId);
  return { ev, text: ev.map((e) => `• ${summary(e.facts)} (${e.type.replace(/_/g, ' ')} · ${domainOf(e.sourceUri)}, fetched ${c.day(e.fetchedAt)})`).join('\n') };
}

function aboutContact(c: Ctx, x: World['contacts'][number], q: string): Thought {
  const { ev, text } = evidenceLines(c, x.id);
  const enrs = c.w.enrollments.filter((e) => e.contactId === x.id);
  const drafts = c.drafts.filter((d) => enrs.some((e) => e.id === d.enrollmentId) && !['discarded', 'superseded'].includes(d.status));
  const replies = c.w.inbound.filter((r) => r.contactId === x.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const meeting = c.upcoming.find((m) => m.contactId === x.id);
  const out = [`${c.who(x)}${x.title ? `, ${x.title}` : ''}. ICP fit ${x.fitScore ?? 'not scored'}.`];
  out.push(ev.length ? `What research found:\n${text}` : 'No evidence yet, so no draft can make a claim about them.');
  for (const e of enrs) out.push(`${c.w.campaigns.find((k) => k.id === e.campaignId)?.name ?? 'Campaign'}: ${enrollmentState(e.state, e.stopReason)}.`);
  const last = replies[0];
  if (last) out.push(`Latest reply, ${c.time(last.receivedAt)} (${INTENT[last.intent as Intent]?.label.toLowerCase() ?? last.intent}): "${clip(last.body, 140)}"`);
  if (meeting) out.push(`Meeting booked for ${c.time(meeting.startsAt)}.`);
  // The next step, from the state of their rows.
  const sla = replies.find((r) => r.intent === 'meeting_request' && !r.handledAt && r.slaDueAt);
  const review = drafts.find((d) => d.status === 'review');
  const blocked = drafts.find((d) => d.status === 'blocked');
  if (sla) out.push(`Next: book the meeting from Inbox before ${c.time(sla.slaDueAt!)}.`);
  else if (blocked) out.push('Next: the gate blocked their draft. Fix it in Approvals.');
  else if (review) out.push(`Next: their step ${review.step + 1} draft is waiting in Approvals.`);
  else if (/why|how/.test(q) && !ev.length) out.push('Next: research has to find a fact about them before anyone can write to them.');
  return { body: out.join('\n\n'), sources: ['1 contact', count(ev.length, 'evidence record'), count(drafts.length, 'draft'), count(replies.length, 'reply', 'replies')] };
}

function aboutDraft(c: Ctx, d: World['drafts'][number]): Thought {
  const x = c.contactOf(d.enrollmentId);
  const sent = c.w.sent.find((s) => s.draftId === d.id);
  const out = [`The step ${d.step + 1} draft to ${c.who(x)}: "${d.subject ?? '(no subject)'}".`];
  if (d.status === 'blocked') {
    out.push('The claims gate blocked it:\n' + (d.gateFindings ?? []).map((f) => `• ${findingText(f.code, f.detail)}`).join('\n'));
    out.push('Fix the sentence or attach evidence in Approvals. The gate runs again on save.');
  } else if (d.status === 'superseded') {
    out.push('It was replaced: the sequence stopped when they replied or booked, so it will never send.');
  } else if (d.status === 'discarded') {
    out.push(`Rejected${d.rejectionReason ? `: "${d.rejectionReason}"` : ''}. It will never send.`);
  } else {
    out.push(`It passed the claims gate${d.gateVersion ? ` (${d.gateVersion})` : ''}.`);
    const claims = d.claims.map((cl) => {
      const e = c.w.evidence.find((y) => y.id === cl.evidence_id);
      return `• "${cl.text}" comes from ${e ? `${e.type.replace(/_/g, ' ')} on ${domainOf(e.sourceUri)}, fetched ${c.day(e.fetchedAt)}` : 'evidence that is no longer on file'}`;
    });
    out.push(claims.length ? `Every claim points at fetched evidence:\n${claims.join('\n')}` : d.step > 0 ? 'A follow-up makes no claims about them, so it needs no evidence.' : 'It makes no claims.');
    if (d.status === 'approved') out.push(sent ? `Approved and sent ${c.time(sent.sentAt)}.` : `Approved ${c.time(d.approvedAt!)}. It sends in the next window.`);
    else out.push('It is waiting in Approvals. Nothing sends until a person approves it.');
  }
  return { body: out.join('\n\n'), sources: ['1 draft', count(d.claims.length, 'claim'), count((d.gateFindings ?? []).length, 'gate finding')] };
}

function aboutReply(c: Ctx, r: World['inbound'][number]): Thought {
  const x = c.contact(r.contactId);
  const label = INTENT[r.intent as Intent]?.label.toLowerCase() ?? r.intent;
  const out = [`${c.who(x)} replied ${c.time(r.receivedAt)}: "${clip(r.body, 180)}"`, `The reply rules sorted it as ${label}.`];
  if (r.handledAt) out.push(`Handled ${c.time(r.handledAt)}${r.handledBy === 'system' ? ' automatically' : ''}.`);
  else if (r.intent === 'meeting_request') out.push(`Book it from Inbox${r.slaDueAt ? ` before ${c.time(r.slaDueAt)}` : ''}. The SLA is 2 business hours.`);
  else if (['question', 'positive_inquiry', 'referral', 'objection'].includes(r.intent)) out.push('To answer it, ask Sales Outbound for a drafted reply. It goes through the claims gate and Approvals like any draft.');
  if (r.intent === 'unsubscribe') out.push('They opted out: the address is suppressed and the sequence stopped. Nothing more goes to them.');
  const { ev, text } = x ? evidenceLines(c, x.id) : { ev: [], text: '' };
  if (ev.length) out.push(`What research found about them:\n${text}`);
  return { body: out.join('\n\n'), sources: ['1 reply', count(ev.length, 'evidence record')] };
}

function aboutMeeting(c: Ctx, m: World['meetings'][number]): Thought {
  const x = c.contact(m.contactId);
  const how = m.provider === 'cal_com' ? 'booked through Cal.com' : m.provider === 'calendly' ? 'booked through Calendly' : m.inboundMessageId ? 'booked from their reply' : 'booked here';
  const mins = Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60000);
  const out = [`${c.who(x)}, ${c.time(m.startsAt)}: ${mins} minutes, ${how}.`];
  const { ev, text } = x ? evidenceLines(c, x.id) : { ev: [], text: '' };
  out.push(ev.length ? `To prepare, what research found:\n${text}` : 'Research has nothing on file about them yet.');
  const last = x ? c.w.inbound.filter((r) => r.contactId === x.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0] : undefined;
  if (last) out.push(`Their last reply: "${clip(last.body, 140)}"`);
  return { body: out.join('\n\n'), sources: ['1 meeting', count(ev.length, 'evidence record'), count(last ? 1 : 0, 'reply', 'replies')] };
}

export const SUGGESTIONS = ['What needs me today?', 'Why was a draft blocked?', 'Which leads should I look at first?', 'How are replies trending?', 'What meetings are coming up?'];
