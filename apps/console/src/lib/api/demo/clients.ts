// Dev portal demo store, shaped like Backend's 6a (omnisdr-pivot/DESIGN-backend-6a-api-shape.md): same resources, same 403/409 codes, so the swap is a base-URL change.
// Fake data only. Role checks live here because packages/db has no client-record actions yet; in 6a the server checks each action and the database refuses again.
import { looksLikeEmail } from './email';
import { projectConversation } from './clientConvo';
import { ApiError, type Scope } from '../client';
import type {
  ChecklistGroup, ChecklistItem, ChecklistState, ClientEvent, ClientHealth, ClientRecord, ClientStatus, ClientSummary, ConnChannel, DealLevel, DemoConnection, DemoReplyDraft,
  SetupConfig, SetupDraft, SetupVersion, VersionStatus, SalesDeal, CloseSaleInput, ClientStatusView, ClientSetupView, ClientConversation,
} from '../types';
import type { MemberRow, World } from './seed';
import { EMPTY_CONFIG, PATHS, demoChecks, diffConfig, topRisk } from './setup-versions';

export interface VersionRow extends SetupVersion { config: SetupConfig }
export interface ClientRow {
  id: string; name: string; status: ClientStatus; statusChangedAt: string; ownerUserId: string | null;
  deal: { repId: string; level: DealLevel; priceCents: number; priceIsDraft: boolean; closedAt: string };
  workspaceId: string | null; profile: ClientRecord['profile'];
  checklist: ChecklistItem[]; versions: VersionRow[]; events: ClientEvent[];
  connections: DemoConnection[]; replyDrafts: DemoReplyDraft[];
  /** Demo only: made-up health numbers for live and paused clients. The real rollup (6d) computes them from the system. */
  health: { replyMedianMinutes: number | null; replyWindowMinutes: number; openDrafts: number; openHandoffs: number; alertFailures: number; sendErrors: number };
}


// ── checklist ──
const TEMPLATE: [string, ChecklistGroup, string, boolean, 'manual' | 'auto'][] = [
  ['account_profile', 'Account', 'Business profile and hours', true, 'manual'], ['account_owner', 'Account', 'Owner contacts and alert emails', true, 'manual'],
  ['conn_mailbox', 'Connections', 'Mailbox connected and tested', true, 'auto'], ['conn_calendar', 'Connections', 'Calendar connected', false, 'manual'],
  ['conn_phone', 'Connections', 'Phone number and voice line', true, 'manual'],
  ['comp_consent', 'Compliance', 'Consent basis recorded', true, 'manual'], ['comp_a2p', 'Compliance', 'A2P texting filed', true, 'manual'],
  ['setup_playbook', 'Setup', 'Playbook replies and questions', true, 'manual'], ['setup_handoff', 'Setup', 'Handoff route and closers', true, 'manual'], ['setup_drafts', 'Setup', 'First drafts approved', true, 'manual'],
  ['launch_plan', 'Launch', 'Approval-week plan agreed', true, 'manual'], ['launch_review', 'Launch', 'Go live review', true, 'manual'],
];
const A2P = 'comp_a2p';
const checklistFor = (): ChecklistItem[] => TEMPLATE.map(([key, section, title, required, kind]) => (
  { key, section, title, required, kind, state: 'todo' as ChecklistState, ownerUserId: null, evidenceRef: null, waivedReason: null, blockedBy: null, doneBy: null, doneAt: null }));

// ── helpers ──
const nowIso = () => new Date().toISOString();
const forbidden = (action: string) => new ApiError(403, 'forbidden', `Your role cannot do that (${action})`, { action });
const bad = (msg: string) => new ApiError(400, 'bad_request', msg);
const conflict = (msg: string) => new ApiError(409, 'conflict', msg);
const isOps = (m: MemberRow) => m.role === 'admin' || m.role === 'operator';
const readAny = (m: MemberRow) => { if (!isOps(m) && m.role !== 'reviewer') throw forbidden('client_read'); };
const opsOnly = (m: MemberRow, action: string) => { if (!isOps(m)) throw forbidden(action); };
const appliedOf = (c: ClientRow) => c.versions.filter((v) => v.status === 'applied').sort((a, b) => (b.appliedAt ?? '').localeCompare(a.appliedAt ?? ''))[0] ?? null;
const isOpen = (v: VersionRow) => v.status === 'in_review' || v.status === 'approved';
const pendingOf = (c: ClientRow) => c.versions.filter(isOpen).length;
const nextNumber = (c: ClientRow) => Math.max(0, ...c.versions.map((v) => v.version)) + 1;
const publicVersion = (v: VersionRow): SetupVersion => { const out: Partial<VersionRow> = { ...v }; delete out.config; return out as SetupVersion; };
const isDone = (i: ChecklistItem) => i.state === 'done' || i.state === 'waived';

function event(c: ClientRow, actor: { id: string | null; kind: 'user' | 'system' }, kind: string, subjectId: string | null, detail: ClientEvent['detail'], at = nowIso()) {
  c.events.push({ id: `${c.id}-e${c.events.length + 1}`, at, actorUserId: actor.id, actorKind: actor.kind, kind, subjectId, detail });
}

const LEVEL_NAME: Record<number, DealLevel> = { 1: 'L1 pilot', 2: 'L2 recurring', 3: 'L3 outcome' };
const salesRead = (m: MemberRow) => { if (m.role !== 'admin' && m.role !== 'operator' && m.role !== 'rep') throw forbidden('sales_read'); };
const dealOf = (c: ClientRow): SalesDeal => ({ id: c.id, business: c.name, niche: c.profile.niche, level: c.deal.level, priceCents: c.deal.priceCents, priceIsDraft: c.deal.priceIsDraft, status: c.status, closedAt: c.deal.closedAt, repId: c.deal.repId });

function summary(c: ClientRow, m: MemberRow): ClientSummary {
  const req = c.checklist.filter((i) => i.required);
  const a = appliedOf(c);
  return {
    id: c.id, name: c.name, status: c.status, statusChangedAt: c.statusChangedAt, ownerUserId: c.ownerUserId,
    // A reviewer loads only what reviewing needs. In 6a this trimming is server-side; here the demo store does it so the UI proves it works without the fields.
    deal: { ...c.deal, priceCents: m.role === 'reviewer' ? 0 : c.deal.priceCents },
    appliedVersion: a?.version ?? null, pendingVersions: pendingOf(c),
    checklist: { done: req.filter(isDone).length, required: req.length, nextBlocked: c.checklist.find((i) => i.state === 'blocked')?.title ?? null },
  };
}
function record(c: ClientRow, m: MemberRow): ClientRecord {
  const reviewer = m.role === 'reviewer';
  return { ...summary(c, m), workspaceId: c.workspaceId, profile: reviewer ? { ...c.profile, contactName: '', contactEmail: '', notes: '' } : { ...c.profile } };
}

/** The unmet Go live guards, in plain words. */
function unmetForLive(c: ClientRow): string[] {
  const out = c.checklist.filter((i) => i.required && i.key !== A2P && !isDone(i)).map((i) => `Checklist: ${i.title}`);
  if (!appliedOf(c)) out.push('An applied setup version');
  const a2p = c.checklist.find((i) => i.key === A2P);
  if (a2p && !isDone(a2p)) out.push('A2P texting live, or explicitly simulated (waive it with a reason)');
  return out;
}
const EDGES: Record<ClientStatus, ClientStatus[]> = { lead: ['closed'], closed: ['onboarding'], onboarding: ['building'], building: ['ready'], ready: ['live'], live: ['paused', 'ended'], paused: ['live', 'ended'], ended: [] };

function draftOf(c: ClientRow): SetupDraft {
  const d = c.versions.find((v) => v.status === 'draft');
  if (d) return { version: d.version, parentVersion: d.parentVersion, config: structuredClone(d.config) };
  const a = appliedOf(c);
  // After a version is sent back, the edits survive as the next draft so nobody retypes them.
  const rejected = c.versions.filter((v) => v.status === 'rejected' && v.version > (a?.version ?? 0)).sort((x, y) => y.version - x.version)[0];
  return { version: nextNumber(c), parentVersion: a?.version ?? null, config: structuredClone(rejected?.config ?? a?.config ?? EMPTY_CONFIG) };
}

function validConfig(x: SetupConfig) {
  for (const p of PATHS) {
    const v = x[p];
    if (p === 'followUpDays') { if (!Array.isArray(v) || v.some((n) => !Number.isInteger(n) || n < 1 || n > 60)) throw bad('Follow-up days must be whole numbers from 1 to 60'); }
    else if (p === 'tone') { if (v !== 'warm' && v !== 'direct' && v !== 'formal') throw bad('Tone must be warm, direct or formal'); }
    else if (typeof v !== 'string' || v.length > 600) throw bad(`${p} must be text up to 600 characters`);
  }
}

export interface Helpers {
  read: <T>(fn: (w: World) => T) => Promise<T>;
  write: <T>(fn: (w: World) => T) => Promise<T>;
  me: (w: World) => MemberRow;
  nf: (what: string) => ApiError;
}

export function makeClientApi({ read, write, me, nf }: Helpers) {
  const org = (w: World, orgId: string) => { if (orgId !== w.org.id) throw nf('organization'); };
  const find = (w: World, id: string) => { const c = w.clients.find((x) => x.id === id); if (!c) throw nf('client'); return c; };
  /** Reviewers reach a client only through a version waiting for them. */
  const visible = (c: ClientRow, m: MemberRow) => m.role !== 'reviewer' || pendingOf(c) > 0;
  const open = (w: World, orgId: string, id: string, gate: (m: MemberRow) => void) => { org(w, orgId); const m = me(w); gate(m); const c = find(w, id); if (!visible(c, m)) throw nf('client'); return { m, c }; };
  const version = (c: ClientRow, n: number) => { const v = c.versions.find((x) => x.version === n); if (!v) throw nf('version'); return v; };
  const staleCheck = (c: ClientRow, v: VersionRow) => { if (v.parentVersion !== (appliedOf(c)?.version ?? null)) throw new ApiError(409, 'stale_parent', 'The live version changed since this one was written. Start again from the live version.'); };

  /** Client portal reads: a client_viewer of that workspace, or an admin or operator previewing. Anyone else is refused. */
  // Notes for Backend 5 (PR #155 V-49 P3): (1) here an operator may read any workspace's portal view; the real route must also apply the operator's workspace list.
  // (2) The setup's closer and owner-contact fields are free text the client will read; the real route must show them as written by us, not as typed by a prospect.
  const viewerGate = (w: World, s: Scope) => {
    if (s.orgId !== w.org.id) throw nf('organization');
    const m = me(w);
    if (m.role === 'client_viewer') { if (!m.workspaceIds?.includes(s.workspaceId)) throw nf('workspace'); } else opsOnly(m, 'client_status');
    return m;
  };

  return {
    clients: (orgId: string, q?: { status?: ClientStatus }) => read((w) => {
      org(w, orgId); const m = me(w); readAny(m);
      return w.clients.filter((c) => visible(c, m) && (!q?.status || c.status === q.status)).map((c) => summary(c, m)).sort((a, b) => b.statusChangedAt.localeCompare(a.statusChangedAt));
    }),
    client: (orgId: string, id: string) => read((w) => { const { m, c } = open(w, orgId, id, readAny); return record(c, m); }),

    patchClientProfile: (orgId: string, id: string, patch: Partial<ClientRecord['profile']>) => write((w) => {
      const { m, c } = open(w, orgId, id, (x) => opsOnly(x, 'onboard_write'));
      const keys = (['niche', 'contactName', 'contactEmail', 'notes'] as const).filter((k) => typeof patch[k] === 'string');
      for (const k of keys) { const v = (patch[k] as string).trim(); if (v.length > 600) throw bad(`${k} is too long`); c.profile[k] = v; }
      if (keys.length) event(c, { id: m.userId, kind: 'user' }, 'client.profile_updated', null, { fields: keys.join(',') });
      return record(c, m);
    }),

    // The only door to status. A failed Go live guard comes back as 409 transition_not_allowed with details.unmet.
    transitionClient: (orgId: string, id: string, to: ClientStatus, reason: string) => write((w) => {
      const { m, c } = open(w, orgId, id, (x) => opsOnly(x, 'client_transition'));
      if (!reason.trim()) throw bad('Say why in a few words');
      if (!EDGES[c.status].includes(to)) throw new ApiError(409, 'transition_not_allowed', `A ${c.status} client cannot move to ${to}`, { from: c.status, to });
      let unmet: string[] = [];
      if (to === 'live' && (c.status === 'ready' || c.status === 'paused')) unmet = unmetForLive(c);   // Resume runs the same launch guard as Go live (PR #153 V-46 P3)
      if (to === 'ready' && !c.versions.some((v) => v.status === 'approved' || v.status === 'applied')) unmet = ['A setup version approved by a second person'];
      if (unmet.length) throw new ApiError(409, 'transition_not_allowed', 'Not ready yet', { from: c.status, to, unmet });
      if (c.status === 'closed' && to === 'onboarding') c.checklist = checklistFor();
      const from = c.status;
      c.status = to; c.statusChangedAt = nowIso();
      event(c, { id: m.userId, kind: 'user' }, 'client.transition', null, { from, to, reason: reason.trim().slice(0, 200) });
      return record(c, m);
    }),

    clientChecklist: (orgId: string, id: string) => read((w) => open(w, orgId, id, (x) => opsOnly(x, 'client_read')).c.checklist),
    patchChecklistItem: (orgId: string, id: string, key: string, patch: { state: ChecklistState; evidenceRef?: string; waivedReason?: string }) => write((w) => {
      const { m, c } = open(w, orgId, id, (x) => opsOnly(x, 'onboard_write'));
      const it = c.checklist.find((x) => x.key === key);
      if (!it) throw nf('checklist item');
      if (patch.state === 'done' && it.kind === 'auto') throw new ApiError(409, 'auto_item', 'The system marks this one done when its check passes');
      if (patch.state === 'done' && !patch.evidenceRef?.trim()) throw bad('Add the evidence or a note before marking it done');
      if (patch.state === 'waived' && !patch.waivedReason?.trim()) throw bad('Say why it is waived');
      const done = patch.state === 'done' || patch.state === 'waived';
      it.state = patch.state;
      it.evidenceRef = patch.state === 'done' ? patch.evidenceRef!.trim().slice(0, 300) : null;
      it.waivedReason = patch.state === 'waived' ? patch.waivedReason!.trim().slice(0, 300) : null;
      it.blockedBy = patch.state === 'blocked' ? (patch.evidenceRef?.trim().slice(0, 300) || 'Blocked') : null;
      it.doneBy = done ? m.userId : null; it.doneAt = done ? nowIso() : null;
      event(c, { id: m.userId, kind: 'user' }, 'checklist.update', key, { state: patch.state });
      return { ...it };
    }),

    setupVersions: (orgId: string, id: string) => read((w) => open(w, orgId, id, readAny).c.versions.map(publicVersion).sort((a, b) => b.version - a.version)),
    setupDraft: (orgId: string, id: string) => read((w) => draftOf(open(w, orgId, id, (x) => opsOnly(x, 'setup_edit')).c)),
    putSetupDraft: (orgId: string, id: string, config: SetupConfig) => write((w) => {
      const { m, c } = open(w, orgId, id, (x) => opsOnly(x, 'setup_edit'));
      if (c.status === 'lead' || c.status === 'closed' || c.status === 'ended') throw conflict('Start onboarding before editing the setup');
      validConfig(config);
      const a = appliedOf(c);
      const base = draftOf(c);
      const diff = diffConfig(a?.config ?? null, config);
      const d = c.versions.find((v) => v.status === 'draft');
      const next = { authorId: m.userId, parentVersion: base.parentVersion, diff, risk: topRisk(diff), config: structuredClone(config) };
      if (d) Object.assign(d, next);
      else c.versions.push({ version: base.version, status: 'draft', reviewerId: null, note: '', reviewNote: null, createdAt: nowIso(), reviewedAt: null, appliedAt: null, checks: [], ...next });
      event(c, { id: m.userId, kind: 'user' }, 'setup.draft_saved', String(base.version), { risk: next.risk });
      return { version: base.version, parentVersion: base.parentVersion, config: structuredClone(config) };
    }),

    setupAction: (orgId: string, id: string, n: number, action: 'submit' | 'approve' | 'reject' | 'apply' | 'rollback', reason?: string) => write((w) => {
      const gate = action === 'approve' || action === 'reject' ? (x: MemberRow) => readAny(x) : (x: MemberRow) => opsOnly(x, action === 'apply' || action === 'rollback' ? 'setup_apply' : 'setup_edit');
      const { m, c } = open(w, orgId, id, gate);
      const actor = { id: m.userId, kind: 'user' as const };
      const v = version(c, n);
      if (action === 'submit') {
        if (v.status !== 'draft') throw conflict('Only a draft can be submitted');
        if (!v.diff.length) throw bad('Nothing changed from the live version');
        if (c.versions.some(isOpen)) throw conflict('Finish the open version first');
        staleCheck(c, v);
        v.status = 'in_review'; v.note = (reason ?? '').trim().slice(0, 120) || v.note;
      } else if (action === 'approve' || action === 'reject') {
        // Approve and reject are for reviewers and operators, and never for the person who wrote the version. Checked by user id, not display name.
        if (m.role !== 'admin' && m.role !== 'operator' && m.role !== 'reviewer') throw forbidden('setup_approve');
        if (v.status !== 'in_review') throw conflict('Only a version in review can be decided');
        if (v.authorId === m.userId) throw new ApiError(403, 'own_version', 'You wrote this version, so someone else has to review it');
        if (action === 'reject') {
          if (!reason?.trim()) throw bad('Say what to fix when sending back');
          v.status = 'rejected'; v.reviewNote = reason.trim().slice(0, 200);
        } else {
          staleCheck(c, v);
          v.status = 'approved';
          if (c.status === 'building' && !appliedOf(c) && c.versions.filter((x) => x.status === 'approved' && x !== v).length === 0) {
            c.status = 'ready'; c.statusChangedAt = nowIso();
            event(c, actor, 'client.transition', null, { from: 'building', to: 'ready', reason: 'First setup version approved' });
          }
        }
        v.reviewerId = m.userId; v.reviewedAt = nowIso();
      } else if (action === 'apply') {
        if (v.status !== 'approved') throw conflict('Only an approved version can be applied');
        staleCheck(c, v);
        const cur = appliedOf(c);
        if (cur) cur.status = 'superseded';   // exactly one applied per client, in the same step
        v.status = 'applied'; v.appliedAt = nowIso();
        v.checks = demoChecks(v.config, c.connections);   // DEMO checks; 6a returns [] until post-checks exist
      } else {
        // Rollback is a new version restoring an earlier config. It goes through review and apply like any other, so two people always.
        if (v.status !== 'applied' && v.status !== 'superseded') throw conflict('Only a version that was applied can be restored');
        const cur = appliedOf(c);
        if (!cur || cur.version === v.version) throw conflict('That version is already live');
        if (c.versions.some((x) => isOpen(x) || x.status === 'draft')) throw conflict('Finish the open version first');
        const diff = diffConfig(cur.config, v.config);
        const nv: VersionRow = { version: nextNumber(c), status: 'in_review', authorId: m.userId, reviewerId: null, parentVersion: cur.version, note: `rollback to v${v.version}`, reviewNote: null,
          risk: topRisk(diff), diff, createdAt: nowIso(), reviewedAt: null, appliedAt: null, checks: [], config: structuredClone(v.config) };
        c.versions.push(nv);
        event(c, actor, 'setup.rollback', String(nv.version), { restores: v.version });
        return publicVersion(nv);
      }
      event(c, actor, `setup.${action}`, String(v.version), action === 'reject' ? { reason: reason!.trim().slice(0, 200) } : {});
      return publicVersion(v);
    }),

    clientHealth: (orgId: string) => read((w): ClientHealth[] => {
      org(w, orgId); const m = me(w); opsOnly(m, 'client_read');
      return w.clients.filter((c) => c.status === 'live' || c.status === 'paused').map((c) => ({
        clientId: c.id, ...c.health, appliedVersion: appliedOf(c)?.version ?? null, pendingVersions: pendingOf(c), billing: { state: 'not_connected' as const } }));
    }),
    /** The rep portal's list. Admin and operator see every deal; a rep sees only deals they closed. */
    salesDeals: (orgId: string) => read((w): SalesDeal[] => {
      org(w, orgId); const m = me(w); salesRead(m);
      return w.clients.filter((c) => m.role !== 'rep' || c.deal.repId === m.userId).map(dealOf).sort((a, b) => b.closedAt.localeCompare(a.closedAt));
    }),
    /** The one write a rep makes into the client record. The rep and the price come from the server, never from the form. */
    closeSale: (orgId: string, input: CloseSaleInput) => write((w): SalesDeal => {
      org(w, orgId); const m = me(w); salesRead(m);
      const business = input.business.trim(), niche = input.niche.trim(), contactName = input.contactName.trim(), contactEmail = input.contactEmail.trim(), notes = input.notes.trim();
      if (!business || business.length > 100) throw bad('Business name is required, up to 100 characters');
      if (!niche || niche.length > 60) throw bad('Niche is required, up to 60 characters');
      if (!contactName || contactName.length > 100) throw bad('Contact name is required, up to 100 characters');
      if (!looksLikeEmail(contactEmail)) throw bad('Contact email looks wrong');
      if (notes.length > 500) throw bad('Notes are limited to 500 characters');
      const step = w.priceConfig.levels.find((l) => LEVEL_NAME[l.level] === input.level);
      if (!step || step.level === 0) throw bad('Pick Level 1, 2 or 3');
      if (m.role === 'rep' && !step.quotable) throw forbidden('close_unquotable_level');
      if (w.clients.some((c) => c.name.toLowerCase() === business.toLowerCase() && c.status !== 'ended')) throw conflict('That business already has a client record');
      const at = nowIso();
      const c: ClientRow = {
        id: 'cl-' + business.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + (w.clients.length + 1), name: business, status: 'closed', statusChangedAt: at, ownerUserId: null,
        deal: { repId: m.userId, level: input.level, priceCents: step.amountCents, priceIsDraft: !w.priceConfig.isFinal, closedAt: at }, workspaceId: null,
        profile: { niche, contactName, contactEmail, notes }, checklist: [], versions: [], events: [], connections: [], replyDrafts: [],
        health: { replyMedianMinutes: null, replyWindowMinutes: 30, openDrafts: 0, openHandoffs: 0, alertFailures: 0, sendErrors: 0 },
      };
      event(c, { id: m.userId, kind: 'user' }, 'deal.closed', null, { level: input.level, price_is_draft: c.deal.priceIsDraft }, at);
      w.clients.push(c);
      return dealOf(c);
    }),
    /** The client portal's one read. A client_viewer gets only their own workspace's record, reduced to a word; admin and operator may preview it. */
    clientStatus: (s: Scope) => read((w): ClientStatusView | null => {
      viewerGate(w, s);
      const c = w.clients.find((x) => x.workspaceId === s.workspaceId);
      if (!c || c.status === 'ended' || c.status === 'lead') return null;
      const a = appliedOf(c);
      const first = c.versions.map((v) => v.appliedAt).filter((t): t is string => Boolean(t)).sort()[0];
      const word = c.status === 'paused' ? 'Paused' : c.status === 'live'
        ? (first && Date.now() - Date.parse(first) < 7 * 86400e3 ? 'Approval week' : 'Live') : 'Setting up';
      return { word, appliedVersion: a?.version ?? null, appliedAt: a?.appliedAt ?? null };
    }),
    clientSetup: (s: Scope) => read((w): ClientSetupView | null => {
      const m = viewerGate(w, s);
      void m;
      const c = w.clients.find((x) => x.workspaceId === s.workspaceId);
      const a = c ? appliedOf(c) : null;
      if (!c || !a || !a.appliedAt) return null;
      const cfg = a.config;
      return {
        appliedVersion: a.version, appliedAt: a.appliedAt, hours: cfg.hours, timezone: cfg.timezone, services: cfg.services, booking: cfg.booking, handoffRoute: cfg.closers, alertContacts: cfg.ownerContacts, tone: cfg.tone,
        history: c.versions.filter((v) => v.appliedAt).map((v) => ({ version: v.version, appliedAt: v.appliedAt! })).sort((x, y) => y.version - x.version),
      };
    }),
    clientConversations: (s: Scope) => read((w): ClientConversation[] => {
      viewerGate(w, s);
      const byContact = new Map<string, World['inbound']>();
      for (const i of w.inbound.filter((x) => x.ws === s.workspaceId && x.contactId)) byContact.set(i.contactId!, [...(byContact.get(i.contactId!) ?? []), i]);
      return [...byContact.entries()].map(([contactId, msgs]) => {
        const last = msgs.sort((x, y) => y.receivedAt.localeCompare(x.receivedAt))[0]!;
        const ct = w.contacts.find((x) => x.id === contactId);
        return projectConversation(contactId, ct?.name ?? 'Unknown', ct?.phone ?? null, last);
      }).sort((x, y) => y.lastAt.localeCompare(x.lastAt)).slice(0, 50);
    }),
    clientEvents: (orgId: string, id: string, q?: { kind?: string; after?: string }) => read((w) => {
      const { c } = open(w, orgId, id, (x) => opsOnly(x, 'client_read'));
      const all = [...c.events].reverse().filter((e) => !q?.kind || e.kind === q.kind);
      const from = q?.after ? Math.max(0, Number(q.after) || 0) : 0;
      const items = all.slice(from, from + 25);
      return { items, next: from + 25 < all.length ? String(from + 25) : null };
    }),

    // ── Demo only, not in 6a ──
    demoConnections: (orgId: string, id: string) => read((w) => open(w, orgId, id, (x) => opsOnly(x, 'client_read')).c.connections),
    demoTestConnection: (orgId: string, id: string, channel: ConnChannel) => write((w) => {
      const { m, c } = open(w, orgId, id, (x) => opsOnly(x, 'onboard_write'));
      const conn = c.connections.find((x) => x.channel === channel);
      if (!conn) throw nf('connection');
      if (conn.state === 'needs_approval') throw conflict('Waiting on the client to approve access, so there is nothing to test yet');
      conn.lastTest = nowIso();
      const auto = c.checklist.find((i) => i.key === 'conn_mailbox');
      if (channel === 'mailbox' && auto && auto.state !== 'done') {
        // The system, not a person, marks an auto item done when its check passes.
        auto.state = 'done'; auto.doneBy = null; auto.doneAt = nowIso(); auto.blockedBy = null;
        event(c, { id: null, kind: 'system' }, 'checklist.update', auto.key, { state: 'done' });
      }
      event(c, { id: m.userId, kind: 'user' }, 'connection.tested', channel, { state: conn.state });
      return c.connections.map((x) => ({ ...x }));
    }),
    demoReplyDrafts: (orgId: string, id: string) => read((w) => open(w, orgId, id, (x) => opsOnly(x, 'client_read')).c.replyDrafts),
    demoDecideReplyDraft: (orgId: string, id: string, draftId: string, decision: 'approved' | 'rejected') => write((w) => {
      const { m, c } = open(w, orgId, id, (x) => opsOnly(x, 'onboard_write'));
      const d = c.replyDrafts.find((x) => x.id === draftId);
      if (!d) throw nf('draft');
      if (c.status === 'closed' || c.status === 'ended') throw conflict('Start onboarding before deciding drafts');
      d.state = decision;
      event(c, { id: m.userId, kind: 'user' }, 'draft.decided', draftId, { decision });
      return c.replyDrafts.map((x) => ({ ...x }));
    }),
    /** Demo only: names for ids. Real data resolves users through a users endpoint. */
    demoPeople: (orgId: string) => read((w) => { org(w, orgId); readAny(me(w)); return { ...Object.fromEntries(w.members.map((x) => [x.userId, x.name])) } as Record<string, string>; }),
  };
}

// ── seed: three fictional clients (closed, onboarding, live). Fictional names and .example addresses only. ──
export function seedClients(at: (daysAgo: number) => string, members: MemberRow[], viewerWorkspaceId: string): ClientRow[] {
  const maya = members[0].userId, sam = members[1].userId, riley = members[2].userId;
  void maya;
  const jordan = members.find((x) => x.role === 'rep')!.userId;
  const conns = (state: 'live' | 'simulated' | 'needs_approval', tested: string | null): DemoConnection[] => [
    { channel: 'mailbox', state, lastTest: tested, note: state === 'live' ? 'Gmail connected' : state === 'simulated' ? 'Simulated until the client connects' : 'Waiting on the client to approve access' },
    { channel: 'calendar', state: state === 'live' ? 'live' : 'simulated', lastTest: null, note: state === 'live' ? 'Calendar connected' : 'Simulated until the client connects' },
    { channel: 'phone', state: state === 'live' ? 'live' : 'needs_approval', lastTest: null, note: state === 'live' ? 'Number active' : 'Texting shows as pending (carrier review)' },
    { channel: 'voice', state: 'simulated', lastTest: null, note: 'Demo voice line' },
    { channel: 'crm', state: 'simulated', lastTest: null, note: 'No CRM yet' },
  ];
  const drafts = (id: string, name: string, niche: string, state: DemoReplyDraft['state']): DemoReplyDraft[] => [
    { id: id + '-d1', subject: 'Thanks for reaching out to ' + name, body: 'Hi {first_name}, thanks for contacting ' + name + '. We can help with ' + niche.toLowerCase() + ' questions. What day works for a quick call?', state },
    { id: id + '-d2', subject: 'Following up', body: 'Hi {first_name}, checking in on your question. Happy to help whenever you are ready.', state },
  ];
  const mk = (id: string, name: string, niche: string, status: ClientStatus, contactName: string, contactEmail: string, level: DealLevel, priceCents: number, days: number, notes: string): ClientRow => {
    const c: ClientRow = {
      id, name, status, statusChangedAt: at(days), ownerUserId: status === 'closed' ? null : sam,
      deal: { repId: jordan, level, priceCents, priceIsDraft: true, closedAt: at(days) }, workspaceId: 'ws-' + id.slice(3),
      profile: { niche, contactName, contactEmail, notes }, checklist: [], versions: [], events: [],
      connections: conns('needs_approval', null), replyDrafts: drafts(id, name, niche, 'pending'),
      health: { replyMedianMinutes: null, replyWindowMinutes: 30, openDrafts: 0, openHandoffs: 0, alertFailures: 0, sendErrors: 0 },
    };
    event(c, { id: null, kind: 'system' }, 'deal.closed', null, { level, price_is_draft: true }, at(days));
    return c;
  };

  // Live: versions v1 to v3 applied (v3 current), v4 waiting for review.
  const live = mk('cl-ridgeline', 'Ridgeline Generators', 'Generator dealer', 'live', 'Tom Alvarez', 'tom@ridgeline.example', 'L2 recurring', 49900, 40, 'Storm season rush, wants after-hours coverage.');
  const v3cfg: SetupConfig = { hours: 'Mon to Sat, 7am to 7pm', timezone: 'America/Chicago', quietHours: '9pm to 7am', services: 'Generator sales, installs and service plans', ownerContacts: 'owner@ridgeline.example',
    consentBasis: 'Existing customers and web inquiries', closers: 'Tom Alvarez', booking: 'Book on the owner calendar', payment: 'Send the payment link', resolution: 'Owner calls back same day', unknown: 'Ask a human',
    followUpDays: [2, 5, 9], tone: 'warm', replyNotes: 'Always mention the storm-season install slots.' };
  const v1cfg: SetupConfig = { ...v3cfg, hours: 'Mon to Fri, 8am to 6pm' };
  const v2cfg: SetupConfig = { ...v1cfg, tone: 'direct' };
  live.connections = conns('live', at(33));
  live.replyDrafts = drafts(live.id, live.name, 'Generator dealer', 'approved');
  live.checklist = checklistFor().map((i) => ({ ...i, state: 'done' as ChecklistState, doneBy: i.kind === 'auto' ? null : sam, doneAt: at(32), evidenceRef: i.kind === 'auto' ? null : 'Checked on the onboarding call' }));
  const checks = demoChecks(v3cfg, live.connections);
  const ver = (n: number, status: VersionStatus, note: string, d: number, prev: SetupConfig | null, config: SetupConfig, reviewed: boolean): VersionRow => {
    const diff = diffConfig(prev, config);
    return { version: n, status, authorId: sam, reviewerId: reviewed ? riley : null, parentVersion: n === 1 ? null : n - 1, note, reviewNote: reviewed ? 'Looks right.' : null, risk: topRisk(diff), diff, createdAt: at(d), reviewedAt: reviewed ? at(d) : null,
      appliedAt: status === 'applied' || status === 'superseded' ? at(d) : null, checks: status === 'applied' || status === 'superseded' ? checks : [], config };
  };
  live.versions = [ver(1, 'superseded', 'First setup', 36, null, v1cfg, true), ver(2, 'superseded', 'Switch to a direct tone', 34, v1cfg, v2cfg, true), ver(3, 'applied', 'Saturday hours and a warmer tone', 31, v2cfg, v3cfg, true),
    ver(4, 'in_review', 'Stay open until 8pm', 1, v3cfg, { ...v3cfg, hours: 'Mon to Sat, 7am to 8pm' }, false)];
  live.versions[3].parentVersion = 3;
  const tr = (from: ClientStatus, to: ClientStatus, reason: string, d: number) => event(live, { id: sam, kind: 'user' }, 'client.transition', null, { from, to, reason }, at(d));
  tr('closed', 'onboarding', 'Start onboarding', 39); tr('onboarding', 'building', 'Checklist underway', 37); tr('building', 'ready', 'First setup version approved', 36);
  tr('ready', 'live', 'Go live', 30);
  live.events.sort((a, b) => a.at.localeCompare(b.at));
  live.events.forEach((e, i) => { e.id = `${live.id}-e${i + 1}`; });

  live.health = { replyMedianMinutes: 14, replyWindowMinutes: 30, openDrafts: 2, openHandoffs: 1, alertFailures: 0, sendErrors: 0 };
  // A second live client with problems, so the Management table has something at the top. Built from the first by renaming.
  const dental = JSON.parse(JSON.stringify(live).split('cl-ridgeline').join('cl-maple').split('Ridgeline Generators').join('Maple Street Dental')) as ClientRow;
  dental.profile = { niche: 'Dental practice', contactName: 'Dr. Ana Pruitt', contactEmail: 'ana@maple.example', notes: 'Wants recall reminders and new-patient booking.' };
  dental.deal = { ...dental.deal, level: 'L1 pilot', priceCents: 49900, closedAt: at(25) };
  dental.versions = dental.versions.slice(0, 3);
  // Nothing of Ridgeline's may survive the rename (PR #153 V-46 P3): swap the setup content and the drafts for dental ones.
  const dentalCfg = (c: SetupConfig): SetupConfig => ({ ...c, services: 'New-patient exams, cleanings, recall reminders and whitening', ownerContacts: 'ana@maple.example', consentBasis: 'Existing patients and web inquiries',
    closers: 'Dr. Ana Pruitt', booking: 'Book on the front desk calendar', resolution: 'Front desk calls back same day', replyNotes: 'Always offer the next open new-patient exam slot.' });
  dental.versions.forEach((v) => { v.config = dentalCfg(v.config); });
  dental.connections = conns('live', at(33));
  dental.replyDrafts = drafts(dental.id, dental.name, 'Dental practice', 'approved');
  dental.events = dental.events.filter((e) => e.kind !== 'setup.draft_saved');
  dental.health = { replyMedianMinutes: 52, replyWindowMinutes: 30, openDrafts: 6, openHandoffs: 3, alertFailures: 2, sendErrors: 1 };
  dental.workspaceId = viewerWorkspaceId;   // the client_viewer persona's workspace, so their status is this record's

  // Onboarding: five items done, one in progress, A2P blocked on carrier review.
  const onb = mk('cl-ironwood', 'Ironwood Martial Arts', 'Martial arts school', 'onboarding', 'Priya Nair', 'priya@ironwood.example', 'L1 pilot', 49900, 6, 'Three locations, trial-class booking is the goal.');
  onb.connections = conns('simulated', at(5));
  onb.checklist = checklistFor().map((i, k) => {
    if (k < 5) return { ...i, state: 'done' as ChecklistState, doneBy: i.kind === 'auto' ? null : sam, doneAt: at(4), evidenceRef: i.kind === 'auto' ? null : 'Confirmed by email' };
    if (k === 5) return { ...i, state: 'in_progress' as ChecklistState, ownerUserId: sam };
    if (i.key === A2P) return { ...i, state: 'blocked' as ChecklistState, blockedBy: 'Carrier review (texting shows as pending)' };
    return i;
  });
  event(onb, { id: sam, kind: 'user' }, 'client.transition', null, { from: 'closed', to: 'onboarding', reason: 'Start onboarding' }, at(5));

  // Closed: sold, onboarding not started, so no checklist and no setup yet.
  const closed = mk('cl-northgate', 'Northgate Remodeling', 'Remodeler', 'closed', 'Dale Whitcomb', 'dale@northgate.example', 'L3 outcome', 14900, 1, 'Wants to pay per kept appointment. Quote requests come in by form and phone.');
  return [closed, onb, live, dental];
}
