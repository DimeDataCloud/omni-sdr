// Demo-mode agent replies. Not a model: a deterministic reader over this workspace's rows, so every answer is
// true of the data on screen and names where it came from. The real API routes chat to Vertex (services/model.mjs).
import type { World, AgentRow } from './seed';

const fmtTime = (iso: string, tz: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : 'no sends yet');

export function answer(w: World, ws: string, agent: AgentRow, question: string, now: Date): string {
  const q = question.toLowerCase();
  const tz = w.workspaces.find((x) => x.id === ws)?.timezone ?? 'UTC';
  const contact = (id: string | null) => w.contacts.find((c) => c.id === id);
  const drafts = w.drafts.filter((d) => d.ws === ws);
  const review = drafts.filter((d) => d.status === 'review');
  const blocked = drafts.filter((d) => d.status === 'blocked');
  const openReplies = w.inbound.filter((r) => r.ws === ws && !r.handledAt);
  const upcoming = w.meetings.filter((m) => m.ws === ws && m.status === 'booked' && new Date(m.startsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const contactOf = (enrollmentId: string) => contact(w.enrollments.find((e) => e.id === enrollmentId)?.contactId ?? null);
  const who = (c?: { name: string | null; company: string | null }) => (c ? `${c.name ?? 'Unknown'}${c.company ? ` (${c.company})` : ''}` : 'an unknown contact');

  if (/block|gate|why.*(stop|fail)|reject/.test(q)) {
    if (!blocked.length) return 'Nothing is blocked right now. Every draft in the queue passed the claims gate.';
    return `${blocked.length} draft${blocked.length > 1 ? 's are' : ' is'} blocked by the claims gate:\n\n` + blocked.slice(0, 5).map((d) => {
      const f = (d.gateFindings ?? []).map((x) => `${x.code.replace(/_/g, ' ')}: ${x.detail}`).join('; ');
      return `• ${who(contactOf(d.enrollmentId))}: ${f}`;
    }).join('\n') + '\n\nFix the sentence or attach evidence in Approvals, and the gate runs again on save.';
  }
  if (/meeting|calendar|book|schedule/.test(q)) {
    const sla = openReplies.filter((r) => r.intent === 'meeting_request');
    const lines = upcoming.slice(0, 5).map((m) => `• ${fmtTime(m.startsAt, tz)}: ${who(contact(m.contactId))}`);
    return [upcoming.length ? `${upcoming.length} meeting${upcoming.length > 1 ? 's' : ''} coming up:\n${lines.join('\n')}` : 'No meetings on the calendar yet.',
      sla.length ? `\n${sla.length} meeting request${sla.length > 1 ? 's are' : ' is'} waiting on a reply. The SLA is 2 business hours: ${sla.map((r) => who(contact(r.contactId))).join(', ')}.` : ''].join('');
  }
  if (/reply|inbox|respond|answer/.test(q)) {
    if (!openReplies.length) return 'The inbox is clear. Every reply has been handled.';
    return `${openReplies.length} open repl${openReplies.length > 1 ? 'ies' : 'y'}, oldest SLA first:\n\n` + openReplies
      .sort((a, b) => (a.slaDueAt ?? '9').localeCompare(b.slaDueAt ?? '9'))
      .map((r) => `• ${who(contact(r.contactId))}: ${r.intent.replace(/_/g, ' ')}. "${r.body.slice(0, 90)}${r.body.length > 90 ? '…' : ''}"`).join('\n');
  }
  if (/rate|stat|number|metric|perform|analytic|how.*(doing|going)/.test(q)) {
    const since = now.getTime() - 30 * 86400e3;
    const sent = w.sent.filter((s) => s.ws === ws && new Date(s.sentAt).getTime() >= since).length;
    const replies = w.inbound.filter((r) => r.ws === ws && new Date(r.receivedAt).getTime() >= since && !['bounce', 'out_of_office'].includes(r.intent));
    const positive = replies.filter((r) => ['meeting_request', 'positive_inquiry', 'referral'].includes(r.intent)).length;
    const meetings = w.meetings.filter((m) => m.ws === ws && m.status !== 'canceled' && new Date(m.createdAt).getTime() >= since).length;
    return `Last 30 days: ${sent} sent, ${replies.length} replies (${pct(replies.length, sent)}), ${positive} positive (${pct(positive, sent)}), ${meetings} meetings booked.\n\nReplies and meetings are the measures; no tracking is added to email.`;
  }
  if (/lead|prospect|hot|best|fit|who should/.test(q)) {
    const inReview = new Set(review.map((d) => w.enrollments.find((e) => e.id === d.enrollmentId)?.contactId));
    const top = w.contacts.filter((c) => c.ws === ws && inReview.has(c.id)).sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0)).slice(0, 5);
    if (!top.length) return 'No leads are waiting on a decision.';
    return 'Highest-fit leads with a draft waiting:\n\n' + top.map((c) => {
      const ev = w.evidence.find((e) => e.contactId === c.id);
      const fact = ev ? Object.values(ev.facts).map((f) => (f as { summary?: string }).summary).filter(Boolean)[0] : null;
      return `• ${who(c)}, fit ${c.fitScore}${fact ? `: ${fact}` : ''}`;
    }).join('\n');
  }
  // Default and "what needs me": the ranked day.
  const items: string[] = [];
  const slaReply = openReplies.filter((r) => r.slaDueAt).sort((a, b) => a.slaDueAt!.localeCompare(b.slaDueAt!))[0];
  if (slaReply) items.push(`${who(contact(slaReply.contactId))} asked for a meeting. Reply before ${fmtTime(slaReply.slaDueAt!, tz)}.`);
  const others = openReplies.filter((r) => r !== slaReply);
  if (others.length) items.push(`${others.length} other repl${others.length > 1 ? 'ies' : 'y'} in the inbox.`);
  if (review.length) {
    const top = [...review].sort((a, b) => (contactOf(b.enrollmentId)?.fitScore ?? 0) - (contactOf(a.enrollmentId)?.fitScore ?? 0))[0];
    items.push(`${review.length} draft${review.length > 1 ? 's' : ''} waiting in Approvals. The top one is ${who(contactOf(top.enrollmentId))}.`);
  }
  if (blocked.length) items.push(`The gate blocked ${blocked.length} draft${blocked.length > 1 ? 's' : ''}. Ask me "why was it blocked?"`);
  if (upcoming[0]) items.push(`Next meeting: ${who(contact(upcoming[0].contactId))}, ${fmtTime(upcoming[0].startsAt, tz)}.`);
  const intro = agent.station === 'chief_of_staff' || /today|need|priorit|what/.test(q) ? 'Here is today, most urgent first:' : `From ${agent.name}'s view of this workspace:`;
  return items.length ? `${intro}\n\n${items.map((x, i) => `${i + 1}. ${x}`).join('\n')}` : 'Nothing needs you right now. The queue, inbox and gate are all clear.';
}

export const SUGGESTIONS = ['What needs me today?', 'Why was a draft blocked?', 'Which leads should I look at first?', 'How are replies trending?', 'What meetings are coming up?'];
