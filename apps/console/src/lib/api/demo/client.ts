// The demo adapter: the same Client contract as the API, answered from the in-browser world with the API's rules:
// the SPEC §7 role matrix (the real can()), the real claims gate, the real reply rules, status transitions that
// match routes/*.mjs, and a 403 wherever the API would give one.
import { can } from '@db/permissions.mjs';
import { CONNECTORS, freeEmailChecks } from '@rules/catalog.mjs';
import { ApiError, invalidate, type Client, type Scope, type Campaign, type Icp } from '../client';
import type { Dataset, ApprovalCard, Agent, ChatMessage, Contact, InboxItem, Meeting, Routine, Role, Analytics, Me, Pipeline, AboutKind, AskMode, HandoffItem, HandoffCard, ThreadMessage } from '../types';
import { addBusinessMinutes, SLA_MINUTES } from '@rules/reply-rules.mjs';
import { load, save, gate, newId, personaEmail, convertOnMeeting } from './store';
import { think } from './brain';
import { studioDemo, mediaCounts } from './studio';

const ABOUT_KINDS: AboutKind[] = ['contact', 'draft', 'reply', 'meeting', 'analytics'];
const MODES: AskMode[] = ['ask', 'find_leads', 'draft', 'book', 'report'];
import type { World, DraftRow, MemberRow } from './seed';

const latency = (min = 120, spread = 160) => new Promise((r) => setTimeout(r, min + Math.random() * spread));
const nowIso = () => new Date().toISOString();

function me(w: World): MemberRow {
  const m = w.members.find((x) => x.email === personaEmail()) ?? w.members[0];
  return m;
}

/** withTenant + can(): the membership must reach the workspace, and the role must allow the action. */
function tenant(w: World, s: Scope, action: string | null) {
  const m = me(w);
  const ws = w.workspaces.find((x) => x.id === s.workspaceId);
  if (s.orgId !== w.org.id || !ws || (m.workspaceIds && !m.workspaceIds.includes(ws.id))) throw new ApiError(404, 'not_found', 'workspace not found');
  if (action && !can({ role: m.role, clientApprovalsEnabled: ws.clientApprovalsEnabled }, action)) throw new ApiError(403, 'forbidden', 'your role cannot do that here');
  return { m, ws };
}

async function read<T>(fn: (w: World) => T): Promise<T> {
  await latency();
  return structuredClone(fn(load()));
}
async function write<T>(fn: (w: World) => T): Promise<T> {
  await latency(160, 200);
  const out = fn(load());
  save();
  invalidate();
  return structuredClone(out);
}
const audit = (w: World, ws: string | null, actor: string, action: string, entityType: string, entityId: string) =>
  w.audit.push({ id: newId(), ws, actor, action, entityType, entityId, at: nowIso() });
const nf = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
const conflict = (msg: string) => new ApiError(409, 'conflict', msg);

function card(w: World, d: DraftRow): ApprovalCard {
  const enr = w.enrollments.find((e) => e.id === d.enrollmentId)!;
  const c = w.contacts.find((x) => x.id === enr.contactId)!;
  const camp = w.campaigns.find((x) => x.id === enr.campaignId)!;
  const a = d.agentId ? w.agents.find((x) => x.id === d.agentId) : null;
  const ws = w.workspaces.find((x) => x.id === d.ws)!;
  return {
    id: d.id, status: d.status, dispatched: w.sent.some((s) => s.draftId === d.id), channel: d.channel, step: d.step, subject: d.subject, body: d.body,
    recipient: { contactId: c.id, name: c.name, title: c.title, company: c.company, email: c.email, emailStatus: c.emailStatus },
    fitScore: c.fitScore, campaign: { id: camp.id, name: camp.name }, agent: a ? { id: a.id, name: a.name, modelTier: a.modelTier } : null,
    gate: { passed: d.gatePassed, version: d.gateVersion, gatedAt: d.gatedAt, findings: d.gateFindings ?? [] },
    claims: d.claims.map((cl) => {
      const e = w.evidence.find((x) => x.id === cl.evidence_id);
      return { text: cl.text, factKey: cl.fact_key, evidence: e ? { id: e.id, type: e.type, sourceUri: e.sourceUri, fetchedAt: e.fetchedAt, facts: e.facts, expiresAt: e.expiresAt } : null };
    }),
    sequence: w.drafts.filter((x) => x.enrollmentId === d.enrollmentId && !['discarded', 'superseded'].includes(x.status))
      .sort((a1, b1) => a1.step - b1.step).map((x) => ({ id: x.id, step: x.step, subject: x.subject, body: x.body, status: x.status })),
    trustLevel: ws.trustLevel, rejectionReason: d.rejectionReason, approvedBy: d.approvedBy, approvedAt: d.approvedAt, createdAt: d.createdAt,
  };
}

function approveOne(w: World, s: Scope, id: string, userId: string) {
  const d = w.drafts.find((x) => x.id === id && x.ws === s.workspaceId);
  if (!d) throw nf('draft');
  if (d.status !== 'review' || w.sent.some((x) => x.draftId === id)) throw conflict(`draft is ${d.status}; only drafts in review can be approved`);
  if (!d.gatePassed) throw conflict('the gate has not passed this text'); // approved_requires_gate CHECK
  d.status = 'approved'; d.approvedBy = userId; d.approvedAt = nowIso();
  audit(w, s.workspaceId, userId, 'approve', 'draft', id);
}

function agentOut(w: World, a: World['agents'][number]): Agent {
  const last = w.chat.filter((m) => m.agentId === a.id).at(-1);
  return { id: a.id, name: a.name, station: a.station, badge: a.badge as Agent['badge'], modelTier: a.modelTier, systemPrompt: a.systemPrompt,
    contextSources: a.contextSources, autonomousMode: a.autonomousMode, appearance: a.appearance, archivedAt: a.archivedAt, createdBy: a.createdBy, createdAt: a.createdAt,
    lastMessage: last ? { preview: last.body.slice(0, 120), sender: last.sender, at: last.createdAt } : null,
    activeRoutines: w.routines.filter((r) => r.agentId === a.id && r.active && !r.pausedReason).length,
    autonomy: (a.appearance.autonomy as Agent['autonomy'] | undefined) ?? 'draft' };
}

/** Datasets an agent can be given (Setup → Data). `source` is the contextSources tag; aliases cover older tags. */
const DATASETS: { key: Dataset['key']; name: string; source: string; aliases?: string[]; about: string; rules: string[]; manage: string; always?: boolean }[] = [
  { key: 'leads', name: 'Leads', source: 'Leads', about: 'People and companies to reach, with fit scores.', manage: 'leads',
    rules: ['Emails are checked before a first touch is written.', 'Anyone who opted out never gets another message.'] },
  { key: 'evidence', name: 'Evidence', source: 'Evidence', aliases: ['Web'], about: 'Facts fetched about each lead, with the page they came from.', manage: 'leads',
    rules: ['Every claim in a draft must point to a fact here (the claims gate).', 'Facts expire; an expired fact can\'t back a claim.'] },
  { key: 'icp', name: 'Ideal customer profiles', source: 'ICP', about: 'Who you sell to, versioned.', manage: 'leads', rules: ['Edits make a new version; older campaigns keep theirs.'] },
  { key: 'drafts', name: 'Drafts and sequences', source: 'Approvals', about: 'Every draft, its gate verdict and who decided it.', manage: 'approvals',
    rules: ['Nothing sends without a person approving it (Level 1).', 'Edited drafts are gated again before they can be approved.'] },
  { key: 'replies', name: 'Replies', source: 'Inbox', about: 'Inbound replies, classified, with their SLA.', manage: 'inbox',
    rules: ['Meeting requests get a 2-business-hour SLA.', 'Opt-out replies suppress the address at once.'] },
  { key: 'meetings', name: 'Meetings', source: 'Meetings', aliases: ['Calendar'], about: 'Booked calls and their outcomes.', manage: 'meetings', rules: ['Booking a meeting ends that lead\'s open sequences.'] },
  { key: 'results', name: 'Results history', source: 'Analytics', about: 'Sends, replies and meetings by day and by step. No open tracking, ever.', manage: 'analytics', rules: ['Counts only; no message bodies.'] },
  { key: 'suppression', name: 'Do-not-contact list', source: 'Suppression', about: 'Addresses that must never be contacted.', manage: 'settings?tab=safety', always: true,
    rules: ['Every agent and every send checks it. It can\'t be switched off.', 'Stored as a fingerprint, not the address.'] },
  { key: 'products', name: 'Products', source: 'Products', about: 'What you sell, for product shots and copy.', manage: 'studio?view=projects', rules: ['Product shots can\'t change the product itself.'] },
  { key: 'brand', name: 'Brand kits and styles', source: 'Brand', about: 'Colors, type and style notes, held as project ingredients.', manage: 'studio?view=projects', rules: ['Every generation in a project inherits its ingredients.'] },
  { key: 'media', name: 'Media library', source: 'Media', about: 'Uploaded and generated images and video.', manage: 'studio?view=library', rules: ['Everything is a draft until someone approves it.'] },
];
const reads = (a: World['agents'][number], d: (typeof DATASETS)[number]) => d.always || a.contextSources.some((t) => [d.source, ...(d.aliases ?? [])].some((x) => x.toLowerCase() === t.toLowerCase()));
const routineOut = (w: World, r: World['routines'][number]): Routine => ({ id: r.id, agentId: r.agentId, agentName: w.agents.find((a) => a.id === r.agentId)?.name ?? null,
  name: r.name, category: r.category, schedule: r.schedule, active: r.active, pausedReason: r.pausedReason, pausedByOps: Boolean(r.pausedReason?.startsWith('ops:')),
  lastRunAt: r.lastRunAt, nextRunAt: r.nextRunAt, createdAt: r.createdAt });
const chatOut = (m: World['chat'][number]): ChatMessage => ({ id: m.id, sender: m.sender, authorId: m.authorId, body: m.body, meta: m.meta as ChatMessage['meta'], createdAt: m.createdAt });
// Conversations in the demo: one per contact (email), as the API threads email replies (0015).
const convId = (contactId: string) => `conv-${contactId}`;
const contactOfConv = (id: string) => (id.startsWith('conv-') ? id.slice(5) : '');
function thread(w: World, ws: string, contactId: string): ThreadMessage[] {
  const inbound = w.inbound.filter((r) => r.ws === ws && r.contactId === contactId)
    .map((r): ThreadMessage => ({ id: r.id, direction: 'in', at: r.receivedAt, channel: r.channel, subject: r.subject, body: r.body, category: r.intent }));
  const enr = new Set(w.enrollments.filter((e) => e.contactId === contactId).map((e) => e.id));
  const out = w.sent.filter((x) => x.ws === ws).flatMap((x) => {
    const d = w.drafts.find((y) => y.id === x.draftId);
    return d && enr.has(d.enrollmentId) ? [{ id: x.id, direction: 'out' as const, at: x.sentAt, channel: 'email', subject: d.subject, body: d.body }] : [];
  });
  return [...inbound, ...out].sort((a, b) => a.at.localeCompare(b.at));
}
function handoffOut(w: World, h: World['handoffs'][number]): HandoffItem {
  const c = w.contacts.find((x) => x.id === h.contactId);
  const last = [...w.inbound].filter((r) => r.contactId === h.contactId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  return { id: h.id, conversationId: convId(h.contactId), closerId: h.closerId, reason: h.reason, summary: h.summary, answers: h.answers, createdBy: h.createdBy,
    createdAt: h.createdAt, dueAt: h.dueAt, acceptedAt: h.acceptedAt, outcome: h.outcome, outcomeAt: h.outcomeAt,
    overdue: !h.acceptedAt && !h.outcome && Boolean(h.dueAt && h.dueAt <= nowIso()), channel: 'email', category: last?.intent ?? null,
    contactName: c?.name ?? null, contactEmail: c?.email ?? null, contactCompany: c?.company ?? null };
}
/** What a person may see: a closer only their own handoffs (0015 closer_scope). */
const visibleHandoffs = (w: World, ws: string, m: MemberRow) => w.handoffs.filter((h) => h.ws === ws && (m.role !== 'closer' || h.closerId === m.userId));

function meetingOut(w: World, m: World['meetings'][number]): Meeting {
  const c = w.contacts.find((x) => x.id === m.contactId);
  return { id: m.id, contactId: m.contactId, contactName: c?.name ?? null, contactCompany: c?.company ?? null, inboundMessageId: m.inboundMessageId, provider: m.provider,
    externalId: m.externalId, startsAt: m.startsAt, endsAt: m.endsAt, meetUrl: m.meetUrl, status: m.status, createdBy: m.createdBy, createdAt: m.createdAt };
}
const contactOut = (c: World['contacts'][number]): Contact => ({ id: c.id, name: c.name, email: c.email, emailStatus: c.emailStatus, phone: c.phone, company: c.company,
  title: c.title, fitScore: c.fitScore, createdAt: c.createdAt });
const campaignOut = (w: World, c: World['campaigns'][number]): Campaign => {
  const enr = w.enrollments.filter((e) => e.campaignId === c.id);
  return { id: c.id, name: c.name, status: c.status, icpId: c.icpId, autoAuditEnabled: c.autoAuditEnabled, enrolled: enr.length,
    live: enr.filter((e) => !['stopped', 'converted', 'completed'].includes(e.state)).length };
};
const icpOut = (i: World['icps'][number]): Icp => ({ id: i.id, lineageId: i.lineageId, name: i.name, version: i.version, data: i.data, createdAt: i.createdAt });

// One formatter per timezone: constructing Intl.DateTimeFormat per call made Analytics a 535 ms long task on a 4x CPU.
const dayFmt = new Map<string, Intl.DateTimeFormat>();
function dayKey(d: Date, tz: string) {
  let f = dayFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); dayFmt.set(tz, f); }
  return f.format(d);
}

export const demoClient: Client = {
  mode: 'demo',

  me: () => read((w): Me => {
    const m = me(w);
    return { user: { id: m.userId, email: m.email }, orgs: [{ id: w.org.id, name: w.org.name, accountType: w.org.accountType, subscriptionStatus: w.org.subscriptionStatus,
      role: m.role, workspaces: w.workspaces.filter((x) => !m.workspaceIds || m.workspaceIds.includes(x.id)).map((x) => ({ id: x.id, name: x.name })) }] };
  }),
  createWorkspace: (orgId, name) => write((w) => {
    const m = me(w);
    if (orgId !== w.org.id || m.role !== 'admin' || m.workspaceIds) throw new ApiError(403, 'forbidden', 'only an org-wide admin can add a workspace');
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) throw new ApiError(400, 'bad_request', 'name: 1 to 80 characters');
    const id = newId();
    w.workspaces.push({ ...w.workspaces[0], id, name: trimmed, clientApprovalsEnabled: false, createdAt: nowIso() });
    audit(w, id, m.userId, 'create', 'workspace', id);
    return { workspaceId: id };
  }),

  settings: (s) => read((w) => {
    const { m, ws } = tenant(w, s, null);   // every member, as the API's GET …/settings
    return { workspace: { id: ws.id, name: ws.name, timezone: ws.timezone, trustLevel: ws.trustLevel, clientApprovalsEnabled: ws.clientApprovalsEnabled,
      autoAdjustEnabled: ws.autoAdjustEnabled, autoAdjustSources: ws.autoAdjustSources as never, postalAddress: ws.postalAddress, customDomain: ws.customDomain, createdAt: ws.createdAt },
      org: { id: w.org.id, name: w.org.name, accountType: w.org.accountType, subscriptionStatus: w.org.subscriptionStatus, trialEndsAt: w.org.trialEndsAt, featureFlags: w.org.featureFlags },
      you: { userId: m.userId, role: m.role } };
  }),
  patchSettings: (s, patch) => write((w) => {
    const { m, ws } = tenant(w, s, 'workspace_settings');
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.length > 80)) throw new ApiError(400, 'bad_request', 'name: 1 to 80 characters');
    Object.assign(ws, patch);
    audit(w, ws.id, m.userId, 'update', 'workspace', ws.id);
  }),
  members: (s) => read((w) => {
    tenant(w, s, 'members');
    return { members: w.members.map((x) => ({ userId: x.userId, email: x.email, role: x.role, workspaceIds: x.workspaceIds })),
      pendingInvites: w.invites.filter((i) => !i.revokedAt && !i.acceptedAt && new Date(i.expiresAt) > new Date())
        .map((i) => ({ id: i.id, role: i.role, workspaceIds: i.workspaceIds, expiresAt: i.expiresAt, createdAt: i.createdAt })) };
  }),
  invite: (s, body) => write((w) => {
    const { m } = tenant(w, s, 'members');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) throw new ApiError(400, 'bad_request', 'email: not an email address');
    if (body.role === 'client_viewer' && !body.workspaceIds?.length) throw new ApiError(400, 'bad_request', 'a client must be limited to at least one workspace');
    const id = newId();
    const expiresAt = new Date(Date.now() + 7 * 86400e3).toISOString();
    w.invites.push({ id, email: body.email, role: body.role, workspaceIds: body.workspaceIds ?? null, expiresAt, createdAt: nowIso(), revokedAt: null, acceptedAt: null });
    audit(w, s.workspaceId, m.userId, 'invite', 'invite', id);
    // Demo: nothing is emailed. The real API returns a single-use link the admin shares.
    return { id, expiresAt, inviteUrl: 'demo: invites are not sent in demo mode' };
  }),
  revokeInvite: (s, id) => write((w) => {
    const { m } = tenant(w, s, 'members');
    const i = w.invites.find((x) => x.id === id && !x.revokedAt);
    if (!i) throw nf('invite');
    i.revokedAt = nowIso();
    audit(w, s.workspaceId, m.userId, 'revoke', 'invite', id);
  }),
  activity: (s) => read((w) => {
    tenant(w, s, 'members');
    return w.audit.filter((a) => a.ws === s.workspaceId || a.ws === null).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50)
      .map((a) => ({ id: a.id, actor: a.actor, actorEmail: w.members.find((x) => x.userId === a.actor)?.email ?? null, action: a.action, entityType: a.entityType, entityId: a.entityId, at: a.at }));
  }),

  approvals: (s, q = {}) => read((w) => {
    tenant(w, s, 'approve');
    const status = q.status ?? 'review';
    const all = w.drafts.filter((d) => d.ws === s.workspaceId);
    const items = all.filter((d) => (status === 'all' || d.status === status))
      .map((d) => card(w, d)).filter((c) => q.minFit === undefined || (c.fitScore ?? 0) >= q.minFit)
      .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || a.createdAt.localeCompare(b.createdAt) || a.step - b.step).slice(0, 50);
    const counts: Record<string, number> = {};
    for (const d of all) counts[d.status] = (counts[d.status] ?? 0) + 1;
    return { items, counts };
  }),
  approval: (s, id) => read((w) => {
    tenant(w, s, 'approve');
    const d = w.drafts.find((x) => x.id === id && x.ws === s.workspaceId);
    if (!d) throw nf('draft');
    return card(w, d);
  }),
  approve: (s, id) => write((w) => { const { m } = tenant(w, s, 'approve'); approveOne(w, s, id, m.userId); }),
  bulkApprove: (s, ids) => write((w) => {
    const { m } = tenant(w, s, 'approve');
    const results = ids.map((id) => {
      try { approveOne(w, s, id, m.userId); return { id, ok: true }; } catch (e) { return { id, ok: false, error: (e as Error).message }; }
    });
    return { results, approved: results.filter((r) => r.ok).length };
  }),
  reject: (s, id, reason) => write((w) => {
    const { m } = tenant(w, s, 'approve');
    const d = w.drafts.find((x) => x.id === id && x.ws === s.workspaceId);
    if (!d) throw nf('draft');
    if (!['gating', 'blocked', 'review', 'approved'].includes(d.status) || w.sent.some((x) => x.draftId === id)) throw conflict(`draft is ${d.status}; it can't be rejected`);
    d.status = 'discarded'; d.rejectionReason = reason?.slice(0, 500) || null;
    audit(w, s.workspaceId, m.userId, 'reject', 'draft', id);
  }),
  editDraft: (s, id, patch) => write((w) => {
    const { m } = tenant(w, s, 'approve');
    const d = w.drafts.find((x) => x.id === id && x.ws === s.workspaceId);
    if (!d) throw nf('draft');
    if (!['gating', 'blocked', 'review', 'approved'].includes(d.status) || w.sent.some((x) => x.draftId === id)) throw conflict(`draft is ${d.status}; it can't be edited`);
    if (patch.body !== undefined && (!patch.body.trim() || patch.body.length > 20000)) throw new ApiError(400, 'bad_request', 'body: 1 to 20000 characters');
    if ('subject' in patch) d.subject = patch.subject ?? null;
    if (patch.body !== undefined) d.body = patch.body;
    // drafts_edit_voids_gate: new text voids the old verdict and any approval, then the gate runs again.
    d.approvedBy = null; d.approvedAt = null; d.gatePassed = false; d.gateFindings = null;
    audit(w, s.workspaceId, m.userId, 'edit', 'draft', id);
    const v = gate(w, d, new Date());
    d.status = v.passed ? 'review' : 'blocked';
    return { gate: v.passed ? 'passed' : 'blocked', item: card(w, d) };
  }),
  createDraft: (s, body) => write((w) => {
    const { m } = tenant(w, s, 'build');
    const enr = w.enrollments.find((e) => e.id === body.enrollmentId && e.ws === s.workspaceId);
    if (!enr) throw nf('enrollment');
    const d: DraftRow = { id: newId(), ws: s.workspaceId, enrollmentId: enr.id, step: body.step ?? 0, channel: 'email', subject: body.subject ?? null, body: body.body,
      claims: body.claims ?? [], status: 'gating', gatePassed: false, gateVersion: null, gatedAt: null, gateFindings: null, rejectionReason: null, approvedBy: null,
      approvedAt: null, createdAt: nowIso(), agentId: body.agentId ?? null };
    w.drafts.push(d);
    const v = gate(w, d, new Date());
    d.status = v.passed ? 'review' : 'blocked';
    audit(w, s.workspaceId, m.userId, 'create', 'draft', d.id);
    return { id: d.id, gate: v.passed ? 'passed' : 'blocked', findings: v.findings };
  }),

  inbox: (s, q = {}) => read((w) => {
    tenant(w, s, 'inbox_read');
    const now = Date.now();
    const status = q.status ?? 'open';
    return w.inbound.filter((r) => r.ws === s.workspaceId && (status === 'all' || (status === 'open' ? !r.handledAt : Boolean(r.handledAt))))
      .sort((a, b) => (a.slaDueAt ? 0 : 1) - (b.slaDueAt ? 0 : 1) || (a.slaDueAt ?? '').localeCompare(b.slaDueAt ?? '') || b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, 100)
      .map((r): InboxItem => {
        const c = w.contacts.find((x) => x.id === r.contactId);
        return { id: r.id, channel: r.channel, fromAddress: r.fromAddress, subject: r.subject, body: r.body, receivedAt: r.receivedAt, intent: r.intent as InboxItem['intent'],
          intentConfidence: r.intentConfidence, classifiedBy: r.classifiedBy, slaDueAt: r.slaDueAt,
          slaMinutesRemaining: r.slaDueAt && !r.handledAt ? Math.round((new Date(r.slaDueAt).getTime() - now) / 60000) : null,
          needsHuman: r.intentConfidence === null || r.intentConfidence < 0.8, handledAt: r.handledAt, handledBy: r.handledBy, messageId: r.messageId,
          contactId: r.contactId, contactName: c?.name ?? null, contactCompany: c?.company ?? null, contactTitle: c?.title ?? null,
          conversationId: r.contactId ? convId(r.contactId) : null };
      });
  }),
  handle: (s, id) => write((w) => {
    const { m } = tenant(w, s, 'inbox_draft');
    const r = w.inbound.find((x) => x.id === id && x.ws === s.workspaceId);
    if (!r) throw nf('reply');
    if (r.handledAt) throw conflict('reply already handled');
    r.handledAt = nowIso(); r.handledBy = m.userId;
    audit(w, s.workspaceId, m.userId, 'handle', 'inbound_message', id);
  }),
  bookFromReply: (s, id, body) => write((w) => {
    const { m } = tenant(w, s, 'inbox_draft');
    const r = w.inbound.find((x) => x.id === id && x.ws === s.workspaceId);
    if (!r) throw nf('reply');
    const start = new Date(body.startsAt); const end = new Date(body.endsAt);
    if (!(end > start)) throw new ApiError(400, 'bad_request', 'endsAt: must be after startsAt');
    if (body.meetUrl && !/^https:\/\/\S+$/.test(body.meetUrl)) throw new ApiError(400, 'bad_request', 'meetUrl: must be an https link');
    const row = { id: newId(), ws: s.workspaceId, contactId: r.contactId, inboundMessageId: r.id, provider: 'native' as const, externalId: null, startsAt: start.toISOString(),
      endsAt: end.toISOString(), meetUrl: body.meetUrl ?? null, status: 'booked' as const, createdBy: m.userId, createdAt: nowIso() };
    w.meetings.push(row);
    if (!r.handledAt) { r.handledAt = nowIso(); r.handledBy = m.userId; }
    convertOnMeeting(w, r.contactId);
    audit(w, s.workspaceId, m.userId, 'book', 'meeting', row.id);
    return meetingOut(w, row);
  }),
  handoffDraft: (s, id) => read((w) => {
    const { ws } = tenant(w, s, 'handoff');
    const contactId = contactOfConv(id);
    const c = w.contacts.find((x) => x.id === contactId && x.ws === ws.id);
    if (!c) throw nf('conversation');
    const msgs = thread(w, ws.id, contactId);
    const lastIn = [...msgs].reverse().find((x) => x.direction === 'in');
    const meeting = lastIn?.category === 'meeting_request';
    const n = msgs.filter((x) => x.direction === 'in').length;
    const summary = `${c.name ?? c.email ?? 'This person'}${c.company ? ` (${c.company})` : ''} ${meeting ? 'asked for a meeting' : 'replied'} via email; `
      + `${n} message${n === 1 ? '' : 's'} from them so far.${lastIn ? ` Last message: "${lastIn.body.replace(/\s+/g, ' ').trim().slice(0, 280)}"` : ''}`;
    const closers = w.members.filter((x) => ['closer', 'operator', 'admin'].includes(x.role) && (!x.workspaceIds || x.workspaceIds.includes(ws.id)))
      .sort((a, b) => Number(b.role === 'closer') - Number(a.role === 'closer') || a.email.localeCompare(b.email))
      .map((x) => ({ id: x.userId, email: x.email, role: x.role, hasBookingLink: Boolean(x.bookingUrl) }));
    return { reason: meeting ? 'meeting_request' as const : 'qualified' as const, summary, closers };
  }),
  createHandoff: (s, id, body) => write((w) => {
    const { m, ws } = tenant(w, s, 'handoff');
    const contactId = contactOfConv(id);
    if (!w.contacts.some((x) => x.id === contactId && x.ws === ws.id)) throw nf('conversation');
    const closer = w.members.find((x) => x.userId === body.closerId);
    if (!closer || !['closer', 'operator', 'admin'].includes(closer.role) || (closer.workspaceIds && !closer.workspaceIds.includes(ws.id))) {
      throw new ApiError(400, 'bad_request', 'that person can\'t take handoffs in this workspace', { field: 'closerId' });
    }
    if (!body.summary.trim() || body.summary.length > 4000) throw new ApiError(400, 'bad_request', 'summary: 1 to 4000 characters');
    if (w.handoffs.some((h) => h.ws === ws.id && h.contactId === contactId && !h.outcome)) throw conflict('this conversation already has an open handoff');
    const now = new Date();
    const h = { id: newId(), ws: ws.id, contactId, closerId: body.closerId, reason: body.reason, summary: body.summary, answers: body.answers ?? {},
      createdBy: m.userId, createdAt: now.toISOString(), dueAt: addBusinessMinutes(now, SLA_MINUTES, ws.timezone).toISOString(), acceptedAt: null, outcome: null, outcomeAt: null };
    w.handoffs.push(h);
    audit(w, ws.id, m.userId, 'handoff', 'conversation', id);
    return { id: h.id };
  }),
  handoffs: (s, q = {}) => read((w) => {
    const { m, ws } = tenant(w, s, 'handoff_work');
    return visibleHandoffs(w, ws.id, m).filter((h) => q.open === false || !h.outcome).map((h) => handoffOut(w, h))
      .sort((a, b) => Number(!a.outcome) === Number(!b.outcome) ? (Number(!b.acceptedAt) - Number(!a.acceptedAt) || (a.dueAt ?? '~').localeCompare(b.dueAt ?? '~'))
        : Number(!b.outcome) - Number(!a.outcome));
  }),
  handoff: (s, id) => read((w): HandoffCard => {
    const { m, ws } = tenant(w, s, 'handoff_work');
    const h = visibleHandoffs(w, ws.id, m).find((x) => x.id === id);
    if (!h) throw nf('handoff');
    const { channel, category, contactName, contactEmail, contactCompany, ...rest } = handoffOut(w, h);
    const closer = w.members.find((x) => x.userId === h.closerId);
    return { ...rest, closerEmail: closer?.email ?? null, bookingUrl: closer?.bookingUrl ?? null,
      contact: { name: contactName, email: contactEmail, company: contactCompany },
      conversation: { id: convId(h.contactId), channel, category, messages: thread(w, ws.id, h.contactId) } };
  }),
  acceptHandoff: (s, id) => write((w) => {
    const { m, ws } = tenant(w, s, 'handoff_work');
    const h = visibleHandoffs(w, ws.id, m).find((x) => x.id === id);
    if (!h) throw nf('handoff');
    if (h.closerId !== m.userId) throw new ApiError(403, 'forbidden', 'only the closer it was handed to can accept it');
    if (h.outcome) throw conflict('this handoff is already closed');
    if (!h.acceptedAt) { h.acceptedAt = nowIso(); audit(w, ws.id, m.userId, 'handoff_accept', 'handoff', h.id); }
  }),
  handoffOutcome: (s, id, outcome) => write((w) => {
    const { m, ws } = tenant(w, s, 'handoff_work');
    const h = visibleHandoffs(w, ws.id, m).find((x) => x.id === id);
    if (!h) throw nf('handoff');
    if (m.role === 'closer' && h.closerId !== m.userId) throw new ApiError(403, 'forbidden', 'not your handoff');
    if (h.outcome) throw conflict('this handoff already has an outcome');
    h.outcome = outcome; h.outcomeAt = nowIso();
    audit(w, ws.id, m.userId, `handoff_${outcome}`, 'handoff', h.id);
  }),
  bookingLink: (s) => read((w) => { const { m } = tenant(w, s, 'handoff_work'); return { url: m.bookingUrl ?? null }; }),
  setBookingLink: (s, url) => write((w) => {
    const { m, ws } = tenant(w, s, 'handoff_work');
    if (url !== null && !/^https:\/\/[^\s<>"]+$/.test(url)) throw new ApiError(400, 'bad_request', 'the booking link must be an https:// address', { field: 'url' });
    m.bookingUrl = url;
    audit(w, ws.id, m.userId, 'booking_link', 'membership', m.userId);
    return { url };
  }),
  meetings: (s, range = 'upcoming') => read((w) => {
    tenant(w, s, 'reports_view');
    const now = new Date().toISOString();
    return w.meetings.filter((x) => x.ws === s.workspaceId && (range === 'all' || (range === 'upcoming' ? x.endsAt >= now : x.endsAt < now)))
      .sort((a, b) => (range === 'past' ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt))).map((x) => meetingOut(w, x));
  }),
  patchMeeting: (s, id, patch) => write((w) => {
    const { m } = tenant(w, s, 'inbox_draft');
    const x = w.meetings.find((y) => y.id === id && y.ws === s.workspaceId);
    if (!x) throw nf('meeting');
    if (patch.status) x.status = patch.status;
    audit(w, s.workspaceId, m.userId, 'update', 'meeting', id);
    return meetingOut(w, x);
  }),

  agents: (s) => read((w) => { tenant(w, s, 'team_view'); return w.agents.filter((a) => a.ws === s.workspaceId && !a.archivedAt).map((a) => agentOut(w, a)); }),
  createAgent: (s, body) => write((w) => {
    const { m } = tenant(w, s, 'build');
    if (!body.name?.trim() || body.name.length > 60) throw new ApiError(400, 'bad_request', 'name: 1 to 60 characters');
    const a = { id: newId(), ws: s.workspaceId, name: body.name.trim(), station: body.station ?? 'custom', badge: body.badge ?? 'OPS', modelTier: body.modelTier ?? 'flash',
      systemPrompt: body.systemPrompt ?? '', contextSources: body.contextSources ?? [], autonomousMode: body.autonomousMode ?? false, appearance: {}, archivedAt: null,
      createdBy: m.userId, createdAt: nowIso() };
    w.agents.push(a);
    audit(w, s.workspaceId, m.userId, 'create', 'agent', a.id);
    return agentOut(w, a);
  }),
  patchAgent: (s, id, patch) => write((w) => {
    const { m } = tenant(w, s, 'build');
    const a = w.agents.find((x) => x.id === id && x.ws === s.workspaceId && !x.archivedAt);
    if (!a) throw nf('agent');
    const { autonomy, ...rest } = patch;
    // Above "draft" needs Trust Level 2 and a verified sending domain; no workspace has them in the MVP (SPEC §5).
    if (autonomy && !['suggest', 'draft'].includes(autonomy)) throw new ApiError(403, 'forbidden', 'Sending on its own needs Trust Level 2 and a verified sending domain. Every message is approved by a person for now.');
    const allowed = ['name', 'station', 'badge', 'modelTier', 'systemPrompt', 'contextSources', 'autonomousMode'] as const;
    for (const k of allowed) if (k in rest) (a as unknown as Record<string, unknown>)[k] = (rest as Record<string, unknown>)[k];
    if (autonomy) a.appearance = { ...a.appearance, autonomy };
    audit(w, s.workspaceId, m.userId, 'update', 'agent', id);
    return agentOut(w, a);
  }),
  archiveAgent: (s, id) => write((w) => {
    const { m } = tenant(w, s, 'build');
    const a = w.agents.find((x) => x.id === id && x.ws === s.workspaceId && !x.archivedAt);
    if (!a) throw nf('agent');
    a.archivedAt = nowIso();
    for (const r of w.routines.filter((x) => x.agentId === id)) r.active = false; // archiving stops its routines (the API does the same)
    audit(w, s.workspaceId, m.userId, 'archive', 'agent', id);
  }),
  messages: (s, agentId) => read((w) => {
    tenant(w, s, 'team_view');
    if (!w.agents.some((a) => a.id === agentId && a.ws === s.workspaceId)) throw nf('agent');
    return w.chat.filter((m) => m.agentId === agentId).map(chatOut);
  }),
  sendMessage: async (s, agentId, body, modelTier, opts = {}) => {
    const w = load();
    const { m } = tenant(w, s, 'build');
    const agent = w.agents.find((a) => a.id === agentId && a.ws === s.workspaceId && !a.archivedAt);
    if (!agent) throw nf('agent');
    const text = body.trim();
    if (!text || text.length > 4000) throw new ApiError(400, 'bad_request', 'body: 1 to 4000 characters');
    const about = opts.about ?? null;
    if (about && (!ABOUT_KINDS.includes(about.kind) || typeof about.id !== 'string' || !about.id || typeof about.label !== 'string')) throw new ApiError(400, 'bad_request', 'about: { kind, id, label }');
    if (opts.mode && !MODES.includes(opts.mode)) throw new ApiError(400, 'bad_request', `mode: one of ${MODES.join(', ')}`);
    const meta = { ...(about ? { about: { kind: about.kind, id: about.id, label: about.label.slice(0, 120) } } : {}), ...(opts.mode && opts.mode !== 'ask' ? { mode: opts.mode } : {}) };
    const user = { id: newId(), ws: s.workspaceId, agentId, sender: 'user' as const, authorId: m.userId, body: text, meta, createdAt: nowIso() };
    w.chat.push(user); save(); invalidate();
    const started = Date.now();
    await latency(650, 700);
    const t = think(w, s.workspaceId, agent, text, new Date(), { about: meta.about, mode: opts.mode });
    const reply = { id: newId(), ws: s.workspaceId, agentId, sender: 'agent' as const, authorId: null, body: t.body,
      meta: { model: 'demo', tier: modelTier ?? agent.modelTier, ms: Date.now() - started, sources: t.sources }, createdAt: nowIso() };
    w.chat.push(reply); save(); invalidate();
    return { userMessage: chatOut(user), reply: chatOut(reply) };
  },

  routines: (s) => read((w) => { tenant(w, s, 'team_view'); return w.routines.filter((r) => r.ws === s.workspaceId).map((r) => routineOut(w, r)); }),
  createRoutine: (s, body) => write((w) => {
    const { m } = tenant(w, s, 'build');
    if (!body.name.trim()) throw new ApiError(400, 'bad_request', 'name: required');
    const r = { id: newId(), ws: s.workspaceId, agentId: body.agentId ?? null, name: body.name.trim(), category: body.category, schedule: body.schedule, active: body.active ?? true,
      pausedReason: null, lastRunAt: null, nextRunAt: null, createdAt: nowIso() };
    w.routines.push(r);
    audit(w, s.workspaceId, m.userId, 'create', 'routine', r.id);
    return routineOut(w, r);
  }),
  patchRoutine: (s, id, patch) => write((w) => {
    const { m } = tenant(w, s, 'build');
    const r = w.routines.find((x) => x.id === id && x.ws === s.workspaceId);
    if (!r) throw nf('routine');
    if (patch.active && r.pausedReason?.startsWith('ops:')) throw conflict('paused by operations; it resumes when ops clears it');
    Object.assign(r, patch);
    audit(w, s.workspaceId, m.userId, 'update', 'routine', id);
    return routineOut(w, r);
  }),

  capacity: (s) => read((w) => {
    tenant(w, s, 'team_view');
    const today = new Date().toISOString().slice(0, 10);
    const mailboxes = w.mailboxes.filter((x) => x.ws === s.workspaceId).map((x) => ({ id: x.id, provider: x.provider, address: x.address, dailyCap: x.dailyCap,
      pausedReason: x.pausedReason, sentToday: w.sent.filter((y) => y.mailboxId === x.id && y.sentAt.slice(0, 10) === today).length }));
    const campIds = new Set(w.campaigns.filter((c) => c.ws === s.workspaceId).map((c) => c.id));
    const mbIds = new Set(mailboxes.map((x) => x.id));
    const holds = w.holds.filter((h) => (h.scopeType === 'org' && h.scopeId === w.org.id) || (h.scopeType === 'workspace' && h.scopeId === s.workspaceId)
      || (h.scopeType === 'campaign' && campIds.has(h.scopeId)) || (h.scopeType === 'mailbox' && mbIds.has(h.scopeId)))
      .map(({ scopeType, scopeId, reason, setBy, setAt }) => ({ scopeType, scopeId, reason, setBy, setAt }));
    const drafts = w.drafts.filter((d) => d.ws === s.workspaceId);
    const cap = mailboxes.filter((x) => !x.pausedReason).reduce((t, x) => t + x.dailyCap, 0);
    const used = mailboxes.reduce((t, x) => t + x.sentToday, 0);
    return { mailboxes, holds, queue: { approvedUnsent: drafts.filter((d) => d.status === 'approved' && !w.sent.some((x) => x.draftId === d.id)).length,
      awaitingReview: drafts.filter((d) => d.status === 'review').length }, today: { cap, used, remaining: Math.max(0, cap - used) },
      workspaceOnHold: holds.some((h) => h.scopeType === 'workspace' || h.scopeType === 'org') };
  }),
  setHold: (s, body) => write((w) => {
    const { m } = tenant(w, s, 'approve');
    const scopeId = body.scopeType === 'workspace' ? s.workspaceId : body.scopeId;
    if (!scopeId) throw new ApiError(400, 'bad_request', 'scopeId: is required');
    if (!body.reason.trim()) throw new ApiError(400, 'bad_request', 'reason: is required');
    if (!w.holds.some((h) => h.scopeType === body.scopeType && h.scopeId === scopeId))
      w.holds.push({ ws: s.workspaceId, scopeType: body.scopeType, scopeId, reason: body.reason.trim(), setBy: `user:${m.userId}`, setAt: nowIso() });
    audit(w, s.workspaceId, m.userId, 'hold', body.scopeType, scopeId);
  }),
  clearHold: (s, scopeType, id) => write((w) => {
    const { m } = tenant(w, s, 'clear_hold');
    const i = w.holds.findIndex((h) => h.scopeType === scopeType && h.scopeId === id && h.ws === s.workspaceId);
    if (i < 0) throw nf('hold');
    w.holds.splice(i, 1);
    audit(w, s.workspaceId, m.userId, 'clear_hold', scopeType, id);
  }),
  suppress: (s, email) => write((w) => {
    const { m } = tenant(w, s, 'approve');
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new ApiError(400, 'bad_request', 'email: not an email address');
    if (!w.suppression.includes(e)) w.suppression.push(e);
    audit(w, s.workspaceId, m.userId, 'suppress', 'email', 'hash');
  }),
  credits: (s) => read((w) => { tenant(w, s, 'team_view'); return { balances: { ...w.credits } }; }),
  analytics: (s, days) => read((w): Analytics => {
    const { ws } = tenant(w, s, 'reports_view');
    const tz = ws.timezone;
    const now = new Date();
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i--) keys.push(dayKey(new Date(now.getTime() - i * 86400e3), tz));
    const inWs = <T extends { ws: string | null }>(xs: T[]) => xs.filter((x) => x.ws === s.workspaceId);
    const sent = inWs(w.sent); const inbound = inWs(w.inbound); const meetings = inWs(w.meetings);
    const POS = ['meeting_request', 'positive_inquiry', 'referral'];
    // One pass per collection, bucketed by day key (was days × records formatter calls).
    const buckets = new Map(keys.map((day) => [day, { day, sent: 0, replies: 0, positive: 0, meetings: 0 }]));
    for (const x of sent) { const b = buckets.get(dayKey(new Date(x.sentAt), tz)); if (b) b.sent++; }
    for (const x of inbound) {
      const b = buckets.get(dayKey(new Date(x.receivedAt), tz)); if (!b) continue;
      if (!['bounce', 'out_of_office'].includes(x.intent)) b.replies++;
      if (POS.includes(x.intent)) b.positive++;
    }
    for (const x of meetings) { if (x.status === 'canceled') continue; const b = buckets.get(dayKey(new Date(x.createdAt), tz)); if (b) b.meetings++; }
    const daily = [...buckets.values()];
    const totals = daily.reduce((t, x) => ({ sent: t.sent + x.sent, replies: t.replies + x.replies, positive: t.positive + x.positive, meetings: t.meetings + x.meetings }),
      { sent: 0, replies: 0, positive: 0, meetings: 0 });
    const since = now.getTime() - days * 86400e3;
    const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
    const steps = new Map<number, { sent: number; replied: number }>();
    for (const x of sent.filter((y) => new Date(y.claimedAt).getTime() >= since)) {
      const step = w.drafts.find((d) => d.id === x.draftId)!.step;
      const b = steps.get(step) ?? { sent: 0, replied: 0 };
      b.sent++;
      if (inbound.some((r) => r.messageId === x.id && !['bounce', 'out_of_office'].includes(r.intent))) b.replied++;
      steps.set(step, b);
    }
    const decisions = w.audit.filter((a) => a.ws === s.workspaceId && a.entityType === 'draft' && new Date(a.at).getTime() >= since);
    const approved = decisions.filter((a) => a.action === 'approve').length; const rejected = decisions.filter((a) => a.action === 'reject').length;
    return { days, timezone: tz, totals, rates: { replyRate: rate(totals.replies, totals.sent), positiveRate: rate(totals.positive, totals.sent),
      approvalRate: rate(approved, approved + rejected) }, approvals: { approved, rejected }, daily,
      byStep: [...steps.entries()].sort((a, b) => a[0] - b[0]).map(([step, b]) => ({ step, sent: b.sent, replied: b.replied, replyRate: rate(b.replied, b.sent) })) };
  }),
  pipeline: (s, since) => read((w): Pipeline => {
    tenant(w, s, 'reports_view');
    const from = Date.parse(since);
    if (!Number.isFinite(from)) throw new ApiError(400, 'bad_request', 'since: an ISO timestamp');
    const until = Date.now();
    const inWindow = (iso: string | null) => { if (!iso) return false; const t = Date.parse(iso); return t >= from && t <= until; };
    const ws = s.workspaceId;
    const drafts = w.drafts.filter((d) => d.ws === ws && inWindow(d.createdAt));
    const replies = w.inbound.filter((r) => r.ws === ws && inWindow(r.receivedAt) && !['bounce', 'out_of_office'].includes(r.intent));
    const byAgent = new Map<string, number>();
    for (const d of drafts) if (d.agentId) byAgent.set(d.agentId, (byAgent.get(d.agentId) ?? 0) + 1);
    return {
      since: new Date(from).toISOString(), until: new Date(until).toISOString(),
      found: w.contacts.filter((c) => c.ws === ws && inWindow(c.createdAt)).length,
      drafted: drafts.length, waiting: drafts.filter((d) => d.status === 'review').length, blocked: drafts.filter((d) => d.status === 'blocked').length,
      approved: w.drafts.filter((d) => d.ws === ws && inWindow(d.approvedAt)).length,
      sent: w.sent.filter((x) => x.ws === ws && inWindow(x.sentAt)).length,
      replies: replies.length, meetingRequests: replies.filter((r) => r.intent === 'meeting_request').length, optOuts: replies.filter((r) => r.intent === 'unsubscribe').length,
      booked: w.meetings.filter((m) => m.ws === ws && m.status !== 'canceled' && inWindow(m.createdAt)).length,
      byAgent: [...byAgent].map(([agentId, n]) => ({ agentId, name: w.agents.find((a) => a.id === agentId)?.name ?? 'An agent', drafted: n })).sort((a, b) => b.drafted - a.drafted),
      live: { drafting: w.drafts.filter((d) => d.ws === ws && ['generating', 'gating'].includes(d.status)).length,
        classifying: w.inbound.filter((r) => r.ws === ws && !r.handledAt && r.intent === 'unclassified').length },
    };
  }),
  connectors: (s) => read((w) => {
    tenant(w, s, 'team_view');
    const providers = new Set(w.mailboxes.filter((x) => x.ws === s.workspaceId && !x.pausedReason).map((x) => x.provider));
    const connected: Record<string, boolean> = { gmail: providers.has('gmail'), smtp_imap: providers.has('smtp_imap'), email_routing: providers.size > 0 };
    return CONNECTORS.map((c) => ({ ...c, scopes: [...c.scopes], status: c.activation === 'later' ? 'activates_later' as const : connected[c.id] ? 'connected' as const : 'not_connected' as const }));
  }),

  contacts: (s, q) => read((w) => {
    tenant(w, s, 'build');
    const needle = q?.trim().toLowerCase();
    return w.contacts.filter((c) => c.ws === s.workspaceId && (!needle || [c.name, c.email, c.company, c.title].some((f) => f?.toLowerCase().includes(needle))))
      .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1)).map(contactOut);
  }),
  contact: (s, id) => read((w) => {
    tenant(w, s, 'build');
    const c = w.contacts.find((x) => x.id === id && x.ws === s.workspaceId);
    if (!c) throw nf('contact');
    return { ...contactOut(c), evidence: w.evidence.filter((e) => e.contactId === id).map((e) => ({ id: e.id, type: e.type, sourceUri: e.sourceUri, fetchedAt: e.fetchedAt, facts: e.facts, expiresAt: e.expiresAt })),
      enrollments: w.enrollments.filter((e) => e.contactId === id).map((e) => ({ id: e.id, state: e.state, step: e.step, heat: e.heat, stopReason: e.stopReason,
        campaignId: e.campaignId, campaignName: w.campaigns.find((x) => x.id === e.campaignId)?.name ?? '' })) };
  }),
  importContacts: (s, rows) => write((w) => {
    const { m } = tenant(w, s, 'build');
    if (rows.length > 500) throw new ApiError(400, 'bad_request', 'at most 500 rows per import');
    const created: { index: number; id: string; emailStatus: string; role: boolean; reason: string | null }[] = [];
    const skipped: { index: number; reason: string }[] = [];
    const seen = new Set(w.contacts.filter((c) => c.ws === s.workspaceId).map((c) => c.email?.toLowerCase()));
    rows.forEach((r, index) => {
      if (!r.email && !r.name) { skipped.push({ index, reason: 'needs a name or an email' }); return; }
      const chk = r.email ? freeEmailChecks(r.email) : null;
      if (chk && seen.has(chk.email)) { skipped.push({ index, reason: 'duplicate email' }); return; }
      if (chk && w.suppression.includes(chk.email)) { skipped.push({ index, reason: 'on the do-not-contact list' }); return; }
      const id = newId();
      w.contacts.push({ id, ws: s.workspaceId, name: r.name?.trim() || null, email: chk?.email ?? null, emailStatus: chk?.status ?? 'unknown', phone: r.phone?.trim() || null,
        company: r.company?.trim() || null, title: r.title?.trim() || null, fitScore: null, createdAt: nowIso() });
      if (chk) seen.add(chk.email);
      created.push({ index, id, emailStatus: chk?.status ?? 'unknown', role: chk?.role ?? false, reason: chk?.reason ?? null });
    });
    audit(w, s.workspaceId, m.userId, 'import', 'contacts', String(created.length));
    return { created, skipped };
  }),
  icps: (s) => read((w) => {
    tenant(w, s, 'build');
    const latest = new Map<string, World['icps'][number]>();
    for (const i of w.icps.filter((x) => x.ws === s.workspaceId && !x.archivedAt)) if (!latest.has(i.lineageId) || latest.get(i.lineageId)!.version < i.version) latest.set(i.lineageId, i);
    return [...latest.values()].map(icpOut);
  }),
  createIcp: (s, body) => write((w) => {
    const { m } = tenant(w, s, 'build');
    if (!body.name.trim()) throw new ApiError(400, 'bad_request', 'name: required');
    const prev = body.lineageId ? w.icps.filter((i) => i.lineageId === body.lineageId && i.ws === s.workspaceId) : [];
    if (body.lineageId && !prev.length) throw nf('icp');
    const i = { id: newId(), ws: s.workspaceId, lineageId: body.lineageId ?? newId(), name: body.name.trim(), version: prev.length ? Math.max(...prev.map((p) => p.version)) + 1 : 1,
      data: body.data, createdAt: nowIso(), archivedAt: null };
    w.icps.push(i);
    audit(w, s.workspaceId, m.userId, 'create', 'icp', i.id);
    return icpOut(i);
  }),
  campaigns: (s) => read((w) => { tenant(w, s, 'build'); return w.campaigns.filter((c) => c.ws === s.workspaceId).map((c) => campaignOut(w, c)); }),
  createCampaign: (s, body) => write((w) => {
    const { m } = tenant(w, s, 'build');
    if (!body.name.trim()) throw new ApiError(400, 'bad_request', 'name: required');
    const c = { id: newId(), ws: s.workspaceId, name: body.name.trim(), status: 'draft' as const, icpId: body.icpId ?? null, autoAuditEnabled: false };
    w.campaigns.push(c);
    audit(w, s.workspaceId, m.userId, 'create', 'campaign', c.id);
    return campaignOut(w, c);
  }),
  patchCampaign: (s, id, patch) => write((w) => {
    const { m } = tenant(w, s, 'build');
    const c = w.campaigns.find((x) => x.id === id && x.ws === s.workspaceId);
    if (!c) throw nf('campaign');
    Object.assign(c, patch);
    audit(w, s.workspaceId, m.userId, 'update', 'campaign', id);
    return campaignOut(w, c);
  }),
  enroll: (s, campaignId, contactIds) => write((w) => {
    const { m } = tenant(w, s, 'build');
    const c = w.campaigns.find((x) => x.id === campaignId && x.ws === s.workspaceId);
    if (!c) throw nf('campaign');
    let enrolled = 0; let skipped = 0;
    for (const id of contactIds) {
      const contact = w.contacts.find((x) => x.id === id && x.ws === s.workspaceId);
      if (!contact || w.enrollments.some((e) => e.campaignId === campaignId && e.contactId === id) || (contact.email && w.suppression.includes(contact.email))) { skipped++; continue; }
      w.enrollments.push({ id: newId(), ws: s.workspaceId, campaignId, contactId: id, state: 'waiting', step: 0, heat: 1, stopReason: null });
      enrolled++;
    }
    audit(w, s.workspaceId, m.userId, 'enroll', 'campaign', campaignId);
    return { enrolled, skipped };
  }),

  agentStats: (s, id, days = 30) => read((w) => {
    tenant(w, s, 'reports_view');
    const a = w.agents.find((x) => x.id === id && x.ws === s.workspaceId);
    if (!a) throw nf('agent');
    const since = new Date(Date.now() - days * 86400e3).toISOString();
    const ds = w.drafts.filter((d) => d.ws === s.workspaceId && d.agentId === id && d.createdAt >= since);
    const edits = new Set(w.audit.filter((e) => e.action === 'edit' && e.entityType === 'draft').map((e) => e.entityId));
    const name = (d: DraftRow) => { const e = w.enrollments.find((x) => x.id === d.enrollmentId); return w.contacts.find((c) => c.id === e?.contactId)?.name ?? 'a lead'; };
    const approved = ds.filter((d) => d.status === 'approved').length, rejected = ds.filter((d) => d.status === 'discarded').length;
    const corrections = ds.flatMap((d) => [
      ...(d.status === 'discarded' ? [{ draftId: d.id, recipient: name(d), kind: 'rejected' as const, note: d.rejectionReason, at: d.createdAt }] : []),
      ...(d.status === 'blocked' ? [{ draftId: d.id, recipient: name(d), kind: 'blocked' as const, note: (d.gateFindings ?? []).map((f) => f.detail.replace(/[.;\s]+$/, '')).join(' · ') || null, at: d.gatedAt ?? d.createdAt }] : []),
      ...(edits.has(d.id) ? [{ draftId: d.id, recipient: name(d), kind: 'edited' as const, note: null, at: d.createdAt }] : []),
    ]).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 12);
    return { days, drafted: ds.length, approved, rejected, blocked: ds.filter((d) => d.status === 'blocked').length, inReview: ds.filter((d) => d.status === 'review').length,
      edited: ds.filter((d) => edits.has(d.id)).length, approvalRate: approved + rejected ? Math.round((approved / (approved + rejected)) * 1000) / 10 : null, corrections };
  }),
  datasets: (s) => read((w): Dataset[] => {
    tenant(w, s, 'reports_view');
    const ws = s.workspaceId;
    const latest = (xs: (string | null | undefined)[]) => (xs.filter(Boolean) as string[]).sort().at(-1) ?? null;
    const media = mediaCounts(w, ws);
    const size: Record<Dataset['key'], { count: number; updatedAt: string | null }> = {
      leads: { count: w.contacts.filter((c) => c.ws === ws).length, updatedAt: latest(w.contacts.filter((c) => c.ws === ws).map((c) => c.createdAt)) },
      evidence: { count: w.evidence.filter((e) => e.ws === ws).length, updatedAt: latest(w.evidence.filter((e) => e.ws === ws).map((e) => e.fetchedAt)) },
      icp: { count: new Set(w.icps.filter((i) => i.ws === ws && !i.archivedAt).map((i) => i.lineageId)).size, updatedAt: latest(w.icps.filter((i) => i.ws === ws).map((i) => i.createdAt)) },
      drafts: { count: w.drafts.filter((d) => d.ws === ws).length, updatedAt: latest(w.drafts.filter((d) => d.ws === ws).map((d) => d.createdAt)) },
      replies: { count: w.inbound.filter((r) => r.ws === ws).length, updatedAt: latest(w.inbound.filter((r) => r.ws === ws).map((r) => r.receivedAt)) },
      meetings: { count: w.meetings.filter((m) => m.ws === ws).length, updatedAt: latest(w.meetings.filter((m) => m.ws === ws).map((m) => m.createdAt)) },
      results: { count: w.sent.filter((x) => x.ws === ws).length, updatedAt: latest(w.sent.filter((x) => x.ws === ws).map((x) => x.sentAt)) },
      suppression: { count: w.suppression.length, updatedAt: null },
      products: media.products, brand: media.brand, media: media.media,
    };
    const agents = w.agents.filter((a) => a.ws === ws && !a.archivedAt);
    return DATASETS.map((d) => ({ key: d.key, name: d.name, about: d.about, source: d.source, rules: d.rules, manage: d.manage, always: Boolean(d.always),
      ...size[d.key], readers: agents.filter((a) => reads(a, d)).map((a) => ({ agentId: a.id, name: a.name })) }));
  }),

  ...studioDemo({ tenant, read, write, audit }),
};

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', operator: 'Operator', reviewer: 'Reviewer', client_viewer: 'Client', closer: 'Closer' };
