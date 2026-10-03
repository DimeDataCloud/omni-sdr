// The demo database: the seed world, primed through the real claims gate and reply rules, persisted per browser.
// Nothing here leaves the device. Reset rebuilds it from the seed.
import { checkDraft } from '@gate/check.mjs';
import { classifyReply, addBusinessMinutes, SLA_MINUTES } from '@rules/reply-rules.mjs';
import { buildWorld, WORLD_VERSION, type World, type DraftRow } from './seed';
import { answer } from './brain';

const KEY = 'omni-demo-world';
const PERSONA_KEY = 'omni-demo-persona';
const MAX_AGE_MS = 36 * 3600e3; // a stale "today" is worse than a reset: rebuild after 36 hours

type Stored = { world: World; builtAt: number };
let current: Stored | null = null;

export const newId = () => crypto.randomUUID();

const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: the demo still works for this tab */ } };
const safeDel = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

/** Runs the gate exactly as the gate worker does and writes the verdict onto the draft. */
export function gate(w: World, d: DraftRow, now: Date) {
  const enr = w.enrollments.find((e) => e.id === d.enrollmentId)!;
  const evidence = new Map(w.evidence.filter((e) => e.ws === d.ws)
    .map((e) => [e.id, { contact_id: e.contactId, facts: e.facts, expires_at: e.expiresAt }]));
  const verdict = checkDraft({ subject: d.subject, body: d.body, step: d.step, claims: d.claims },
    { contactId: enr.contactId, evidence, now, competitors: [] });
  d.gatePassed = verdict.passed; d.gateVersion = verdict.version; d.gatedAt = now.toISOString(); d.gateFindings = verdict.findings;
  return verdict;
}

/** Records a reply the way services/inbox.mjs does: classify, SLA, suppress on opt-out, stop the sequence. */
export function recordReply(w: World, r: { ws: string; contactId: string; messageId: string | null; from: string; subject: string; body: string; receivedAt: Date }) {
  const ws = w.workspaces.find((x) => x.id === r.ws)!;
  const verdict = classifyReply({ subject: r.subject, body: r.body, from: r.from });
  const slaDueAt = verdict.intent === 'meeting_request' ? addBusinessMinutes(r.receivedAt, SLA_MINUTES, ws.timezone) : null;
  const row = { id: newId(), ws: r.ws, contactId: r.contactId, messageId: r.messageId, channel: 'email' as const, fromAddress: r.from, subject: r.subject,
    body: r.body, receivedAt: r.receivedAt.toISOString(), intent: verdict.intent, intentConfidence: verdict.confidence, classifiedBy: verdict.by,
    slaDueAt: slaDueAt?.toISOString() ?? null, handledAt: null as string | null, handledBy: null as string | null };
  w.inbound.push(row);
  if (verdict.intent === 'unsubscribe') {
    if (!w.suppression.includes(r.from)) w.suppression.push(r.from);
    row.handledAt = row.receivedAt; row.handledBy = 'system';
  }
  if (verdict.intent !== 'out_of_office' && verdict.intent !== 'bounce') {
    for (const e of w.enrollments.filter((x) => x.contactId === r.contactId && !['stopped', 'converted', 'completed'].includes(x.state))) {
      e.state = 'stopped'; e.stopReason = `reply:${verdict.intent}`;
      for (const d of w.drafts.filter((x) => x.enrollmentId === e.id && ['gating', 'blocked', 'review'].includes(x.status))) d.status = 'superseded';
    }
  }
  return row;
}

/** Ends a contact's open sequences when a meeting is booked (the meetings_convert_enrollments trigger). */
export function convertOnMeeting(w: World, contactId: string | null) {
  if (!contactId) return;
  for (const e of w.enrollments.filter((x) => x.contactId === contactId && (!['stopped', 'converted', 'completed'].includes(x.state) || x.stopReason?.startsWith('reply:')))) {
    e.state = 'converted'; e.stopReason = 'meeting_booked';
    for (const d of w.drafts.filter((x) => x.enrollmentId === e.id && ['gating', 'blocked', 'review', 'approved'].includes(x.status)
      && !w.sent.some((s) => s.draftId === x.id))) d.status = 'superseded';
  }
}

function prime(w: World, now: Date) {
  const todays = (w as World & { _todays?: { firstDraftId: string; sendNow: boolean; reply: string | null; email: string; subject: string }[] })._todays ?? [];
  delete (w as World & { _todays?: unknown })._todays;
  const maya = w.members[0].userId;
  // Every draft goes through the real gate. History drafts were written to pass; one that doesn't stays blocked and shows.
  for (const d of w.drafts) {
    const v = gate(w, d, new Date(d.createdAt));
    if (d.status === 'gating') d.status = v.passed ? 'review' : 'blocked';
    else if (d.status === 'approved' && !v.passed) { d.status = 'blocked'; d.approvedBy = null; d.approvedAt = null; w.sent = w.sent.filter((s) => s.draftId !== d.id); }
  }
  // History replies go back through the classifier so the intent on screen is the classifier's, not the seed's.
  for (const r of w.inbound) {
    const v = classifyReply({ subject: r.subject ?? '', body: r.body, from: r.fromAddress ?? '' });
    r.intent = v.intent; r.intentConfidence = v.confidence; r.classifiedBy = v.by;
  }
  // Today: three first touches went out this morning and came back. Written, gated and approved before they were sent.
  todays.forEach((t, i) => {
    const d = w.drafts.find((x) => x.id === t.firstDraftId)!;
    if (!t.sendNow || d.status !== 'review') return;
    const sentAt = new Date(now.getTime() - (180 + i * 20) * 60000);
    const at = (min: number) => new Date(sentAt.getTime() - min * 60000).toISOString();
    Object.assign(d, { status: 'approved', createdAt: at(60), gatedAt: at(59), approvedBy: maya, approvedAt: at(20) });
    const msg = { id: newId(), ws: d.ws, draftId: d.id, mailboxId: w.mailboxes[0].id, state: 'sent' as const, sentAt: sentAt.toISOString(), claimedAt: sentAt.toISOString() };
    w.sent.push(msg);
    w.audit.push({ id: newId(), ws: d.ws, actor: maya, action: 'approve', entityType: 'draft', entityId: d.id, at: d.approvedAt! });
    const enr = w.enrollments.find((e) => e.id === d.enrollmentId)!;
    enr.state = 'waiting'; enr.step = 1;
    if (t.reply) recordReply(w, { ws: d.ws, contactId: enr.contactId, messageId: msg.id, from: t.email, subject: `Re: ${t.subject}`, body: t.reply,
      receivedAt: new Date(now.getTime() - (70 + i * 55) * 60000) });
  });
  for (const m of w.meetings.filter((x) => x.status === 'booked')) convertOnMeeting(w, m.contactId);
  // One open handoff for the closer persona: the newest unhandled meeting ask in the first workspace (SDR-PIVOT P4).
  const cole = w.members.find((x) => x.role === 'closer');
  const ask = [...w.inbound].filter((r) => r.ws === w.workspaces[0].id && r.contactId && !r.handledAt && ['meeting_request', 'positive_inquiry'].includes(r.intent))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  if (cole && ask) {
    const c = w.contacts.find((x) => x.id === ask.contactId);
    const at = new Date(new Date(ask.receivedAt).getTime() + 15 * 60000);
    cole.bookingUrl = 'https://cal.example/cole-park';
    w.handoffs.push({ id: newId(), ws: ask.ws, contactId: ask.contactId!, closerId: cole.userId, reason: ask.intent === 'meeting_request' ? 'meeting_request' : 'qualified',
      summary: `${c?.name ?? 'This person'}${c?.company ? ` (${c.company})` : ''} ${ask.intent === 'meeting_request' ? 'asked for a meeting' : 'is interested'} by email. Last message: "${ask.body.replace(/\s+/g, ' ').slice(0, 200)}"`,
      answers: { timing: 'this month', decisionMaker: 'yes' }, createdBy: maya, createdAt: at.toISOString(),
      dueAt: addBusinessMinutes(at, SLA_MINUTES, w.workspaces[0].timezone).toISOString(), acceptedAt: null, outcome: null, outcomeAt: null });
  }
  // Seeded agent answers are computed from the finished world, so what they say is true of what's on screen.
  w.chat.forEach((m, i) => {
    const q = w.chat[i - 1];
    const agent = w.agents.find((a) => a.id === m.agentId);
    if (m.sender === 'agent' && q?.sender === 'user' && agent) m.body = answer(w, m.ws, agent, q.body, now);
  });
}

export function load(): World {
  if (current && Date.now() - current.builtAt < MAX_AGE_MS) return current.world;
  const raw = safeGet(KEY);
  if (raw) {
    try {
      const s = JSON.parse(raw) as Stored;
      if (s.world?.version === WORLD_VERSION && Date.now() - s.builtAt < MAX_AGE_MS) { current = s; return s.world; }
    } catch { /* corrupt: rebuild */ }
  }
  return reset();
}

export function save() { if (current) safeSet(KEY, JSON.stringify(current)); }

export function reset(): World {
  const now = new Date();
  const world = buildWorld(now);
  prime(world, now);
  current = { world, builtAt: now.getTime() };
  save();
  return world;
}

export function builtAt() { load(); return current!.builtAt; }

export function personaEmail(): string { return safeGet(PERSONA_KEY) ?? 'maya@example.com'; }
export function setPersonaEmail(email: string) { safeSet(PERSONA_KEY, email); }
export function clearAll() { safeDel(KEY); safeDel(PERSONA_KEY); current = null; }
