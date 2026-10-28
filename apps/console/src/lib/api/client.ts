// One client contract, two adapters: `demo` (in-browser data, same shapes and rules as the API) and `http`
// (the real backend, docs/claude/API.md). Screens only ever see this interface.
import type {
  Me, Settings, Members, ApprovalsList, ApprovalCard, InboxItem, Meeting, Agent, ChatMessage, Routine, Capacity,
  Analytics, Credits, Connector, Contact, ContactDetail, Role, ModelTier, DraftStatus, Id, About, AskMode, Pipeline,
  Autonomy, AgentStats, Dataset, HandoffItem, HandoffCard, HandoffDraft, HandoffReason, HandoffOutcome,
  Playbook, PlaybookReply, PlaybookCategory, ReplyDraft, ClientRecord, ClientSummary, ClientHealth, ClientStatus, ChecklistItem, ChecklistState, ClientEvent, SetupConfig, SetupVersion, SetupDraft, DemoConnection, DemoReplyDraft, ConnChannel,
  Asset, AssetKind, AssetStatus, Aspect, Edits, GenMode, Ingredient, MotionKey, Product, Project, Scene, SequenceClip, StudioCaps,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

export interface Icp { id: Id; lineageId: Id; name: string; version: number; data: Record<string, unknown>; createdAt: string }
export interface Campaign { id: Id; name: string; status: 'draft' | 'active' | 'paused' | 'archived'; icpId: Id | null; autoAuditEnabled: boolean; enrolled: number; live: number }
export interface ActivityItem { id: string; actor: string; actorEmail: string | null; action: string; entityType: string; entityId: string; at: string }
export interface ImportResult { created: { index: number; id: Id; emailStatus: string; role: boolean; reason: string | null }[]; skipped: { index: number; reason: string }[] }

export interface Scope { orgId: Id; workspaceId: Id }

export interface Client {
  mode: 'demo' | 'http';
  me(): Promise<Me>;
  createWorkspace(orgId: Id, name: string): Promise<{ workspaceId: Id }>;

  settings(s: Scope): Promise<Settings>;
  patchSettings(s: Scope, patch: Partial<Pick<Settings['workspace'], 'name' | 'timezone' | 'clientApprovalsEnabled' | 'autoAdjustEnabled' | 'autoAdjustSources' | 'postalAddress'>>): Promise<void>;
  members(s: Scope): Promise<Members>;
  invite(s: Scope, body: { email: string; role: Role; workspaceIds?: Id[] | null }): Promise<{ id: Id; expiresAt: string; inviteUrl: string }>;
  revokeInvite(s: Scope, id: Id): Promise<void>;
  activity(s: Scope): Promise<ActivityItem[]>;

  approvals(s: Scope, q?: { status?: DraftStatus | 'all'; minFit?: number }): Promise<ApprovalsList>;
  approval(s: Scope, id: Id): Promise<ApprovalCard>;
  approve(s: Scope, id: Id): Promise<void>;
  bulkApprove(s: Scope, ids: Id[]): Promise<{ results: { id: Id; ok: boolean; error?: string }[]; approved: number }>;
  reject(s: Scope, id: Id, reason?: string): Promise<void>;
  editDraft(s: Scope, id: Id, patch: { subject?: string | null; body?: string }): Promise<{ gate: string; item: ApprovalCard }>;
  createDraft(s: Scope, body: { enrollmentId: Id; step?: number; subject?: string | null; body: string; claims?: { text: string; evidence_id: Id; fact_key: string }[]; agentId?: Id | null }): Promise<{ id: Id; gate: string; findings: { code: string; detail: string }[] }>;

  inbox(s: Scope, q?: { status?: 'open' | 'handled' | 'all' }): Promise<InboxItem[]>;
  handle(s: Scope, id: Id): Promise<void>;
  bookFromReply(s: Scope, id: Id, body: { startsAt: string; endsAt: string; meetUrl?: string | null }): Promise<Meeting>;
  meetings(s: Scope, range?: 'upcoming' | 'past' | 'all'): Promise<Meeting[]>;

  // Handoffs (SDR-PIVOT P4). Hand off: `handoff` (operator, admin). Work them: `handoff_work` (closer, operator, admin).
  handoffDraft(s: Scope, conversationId: Id): Promise<HandoffDraft>;
  createHandoff(s: Scope, conversationId: Id, body: { closerId: Id; reason: HandoffReason; summary: string; answers?: Record<string, string> }): Promise<{ id: Id }>;
  handoffs(s: Scope, q?: { open?: boolean }): Promise<HandoffItem[]>;
  handoff(s: Scope, id: Id): Promise<HandoffCard>;
  acceptHandoff(s: Scope, id: Id): Promise<void>;
  handoffOutcome(s: Scope, id: Id, outcome: HandoffOutcome): Promise<void>;
  bookingLink(s: Scope): Promise<{ url: string | null }>;
  setBookingLink(s: Scope, url: string | null): Promise<{ url: string | null }>;

  // Playbook (SDR-PIVOT P3). Read: inbox_read. Edit the playbook: build. Draft and decide replies: inbox_draft. Nothing sends.
  playbook(s: Scope): Promise<Playbook>;
  createPlaybookReply(s: Scope, body: { category: PlaybookCategory; name: string; subject?: string | null; body: string; asksNextQuestion?: boolean }): Promise<PlaybookReply>;
  patchPlaybookReply(s: Scope, id: Id, patch: { name?: string; subject?: string | null; body?: string; asksNextQuestion?: boolean }): Promise<PlaybookReply>;
  archivePlaybookReply(s: Scope, id: Id): Promise<void>;
  setQuestions(s: Scope, questions: { key: string; question: string }[]): Promise<void>;
  replyDraft(s: Scope, conversationId: Id): Promise<ReplyDraft | null>;
  createReplyDraft(s: Scope, conversationId: Id, playbookReplyId?: Id): Promise<ReplyDraft>;
  approveReplyDraft(s: Scope, id: Id, body?: string): Promise<ReplyDraft>;
  discardReplyDraft(s: Scope, id: Id): Promise<void>;
  /** P7: a LinkedIn message the person pasted in (inbox_draft). Omni never reads or sends on LinkedIn. */
  pasteLinkedIn(s: Scope, body: { name: string; profileUrl?: string | null; email?: string | null; body: string }): Promise<{ id: Id; conversationId: Id; intent: string }>;
  patchMeeting(s: Scope, id: Id, patch: { status?: Meeting['status'] }): Promise<Meeting>;

  agents(s: Scope): Promise<Agent[]>;
  createAgent(s: Scope, body: Partial<Pick<Agent, 'name' | 'station' | 'badge' | 'modelTier' | 'systemPrompt' | 'contextSources' | 'autonomousMode'>> & { name: string }): Promise<Agent>;
  patchAgent(s: Scope, id: Id, patch: Partial<Pick<Agent, 'name' | 'station' | 'badge' | 'modelTier' | 'systemPrompt' | 'contextSources' | 'autonomousMode'>> & { autonomy?: Autonomy }): Promise<Agent>;
  /** PROPOSED (WORKSPACE-PLAN.md): an agent's last N days of drafts and the corrections people made. */
  agentStats(s: Scope, id: Id, days?: number): Promise<AgentStats>;

  // Dev portal (6a). Org-level routes, checked per action on the server: client_read admin/operator/reviewer; sales_write, onboard_write, setup_edit, setup_apply,
  // client_transition admin/operator; setup_approve admin/operator/reviewer and never the author (403 own_version). Errors: 403 forbidden, 404, 409 stale_parent,
  // 409 transition_not_allowed (details.unmet lists unmet Go live guards), 409 auto_item, 409 conflict, 400 bad_request.
  clients(orgId: Id, q?: { status?: ClientStatus }): Promise<ClientSummary[]>;
  client(orgId: Id, id: Id): Promise<ClientRecord>;
  patchClientProfile(orgId: Id, id: Id, patch: Partial<ClientRecord['profile']>): Promise<ClientRecord>;
  transitionClient(orgId: Id, id: Id, to: ClientStatus, reason: string): Promise<ClientRecord>;
  clientChecklist(orgId: Id, id: Id): Promise<ChecklistItem[]>;
  patchChecklistItem(orgId: Id, id: Id, key: string, patch: { state: ChecklistState; evidenceRef?: string; waivedReason?: string }): Promise<ChecklistItem>;
  setupVersions(orgId: Id, id: Id): Promise<SetupVersion[]>;
  setupDraft(orgId: Id, id: Id): Promise<SetupDraft>;
  putSetupDraft(orgId: Id, id: Id, config: SetupConfig): Promise<SetupDraft>;
  setupAction(orgId: Id, id: Id, version: number, action: 'submit' | 'approve' | 'reject' | 'apply' | 'rollback', reason?: string): Promise<SetupVersion>;
  clientEvents(orgId: Id, id: Id, q?: { kind?: string; after?: string }): Promise<{ items: ClientEvent[]; next: string | null }>;
  clientHealth(orgId: Id): Promise<ClientHealth[]>;   // 6d rollup, not 6a: GET clients/health
  // Demo only, not in 6a.
  demoConnections(orgId: Id, id: Id): Promise<DemoConnection[]>;
  demoTestConnection(orgId: Id, id: Id, channel: ConnChannel): Promise<DemoConnection[]>;
  demoReplyDrafts(orgId: Id, id: Id): Promise<DemoReplyDraft[]>;
  demoDecideReplyDraft(orgId: Id, id: Id, draftId: Id, decision: 'approved' | 'rejected'): Promise<DemoReplyDraft[]>;
  demoPeople(orgId: Id): Promise<Record<Id, string>>;   // names for user and rep ids; real data resolves them through users
  /** PROPOSED (WORKSPACE-PLAN.md): every dataset agents can read, with size, freshness and readers. */
  datasets(s: Scope): Promise<Dataset[]>;
  archiveAgent(s: Scope, id: Id): Promise<void>;
  messages(s: Scope, agentId: Id): Promise<ChatMessage[]>;
  sendMessage(s: Scope, agentId: Id, body: string, modelTier?: ModelTier, opts?: { about?: About | null; mode?: AskMode }): Promise<{ userMessage: ChatMessage; reply: ChatMessage }>;

  routines(s: Scope): Promise<Routine[]>;
  createRoutine(s: Scope, body: { name: string; category: Routine['category']; schedule: string; agentId?: Id | null; active?: boolean }): Promise<Routine>;
  patchRoutine(s: Scope, id: Id, patch: Partial<Pick<Routine, 'name' | 'schedule' | 'active' | 'category'>>): Promise<Routine>;

  capacity(s: Scope): Promise<Capacity>;
  setHold(s: Scope, body: { scopeType: 'workspace' | 'campaign' | 'mailbox'; scopeId?: Id; reason: string }): Promise<void>;
  clearHold(s: Scope, scopeType: string, id: Id): Promise<void>;
  suppress(s: Scope, email: string, reason?: string): Promise<void>;
  credits(s: Scope): Promise<Credits>;
  analytics(s: Scope, days: 7 | 30 | 90): Promise<Analytics>;
  pipeline(s: Scope, since: string): Promise<Pipeline>;
  connectors(s: Scope): Promise<Connector[]>;

  contacts(s: Scope, q?: string): Promise<Contact[]>;
  contact(s: Scope, id: Id): Promise<ContactDetail>;
  importContacts(s: Scope, rows: { name?: string; email?: string; company?: string; title?: string; phone?: string }[]): Promise<ImportResult>;
  icps(s: Scope): Promise<Icp[]>;
  createIcp(s: Scope, body: { name: string; data: Record<string, unknown>; lineageId?: Id }): Promise<Icp>;
  campaigns(s: Scope): Promise<Campaign[]>;
  createCampaign(s: Scope, body: { name: string; icpId?: Id | null }): Promise<Campaign>;
  patchCampaign(s: Scope, id: Id, patch: Partial<Pick<Campaign, 'name' | 'status' | 'autoAuditEnabled'>>): Promise<Campaign>;
  enroll(s: Scope, campaignId: Id, contactIds: Id[]): Promise<{ enrolled: number; skipped: number }>;

  // Studio (PROPOSED, STUDIO-PLAN.md). Reads: reports_view. Create, upload, edit, submit: build. Approve or send back: approve.
  studioCaps(s: Scope): Promise<StudioCaps>;
  assets(s: Scope, q?: { kind?: AssetKind; status?: AssetStatus; projectId?: Id; q?: string }): Promise<Asset[]>;
  asset(s: Scope, id: Id): Promise<Asset>;
  uploadAsset(s: Scope, body: { name: string; kind: AssetKind; src: string; aspect: Aspect; durationS?: number | null; projectId?: Id | null }): Promise<Asset>;
  generate(s: Scope, body: { mode: GenMode; prompt: string; aspect: Aspect; count: number; scene?: Scene; motion?: MotionKey | null; durationS?: number;
    productId?: Id | null; projectId?: Id | null; ingredients?: Ingredient[]; startFrame?: Id | null; endFrame?: Id | null; caption?: string | null }): Promise<Asset[]>;
  editAsset(s: Scope, id: Id, body: { edits: Edits; note: string }): Promise<Asset>;
  /** Generative edits make a new version on the server: background, upscale, expand. Gated by imageGeneration. */
  aiEdit(s: Scope, id: Id, body: { op: 'remove_bg' | 'replace_bg' | 'upscale' | 'expand'; scene?: Scene; aspect?: Aspect }): Promise<Asset>;
  restoreVersion(s: Scope, id: Id, n: number): Promise<Asset>;
  patchAsset(s: Scope, id: Id, patch: { name?: string; projectId?: Id | null }): Promise<Asset>;
  setAssetStatus(s: Scope, id: Id, status: AssetStatus, note?: string | null): Promise<Asset>;
  archiveAsset(s: Scope, id: Id): Promise<void>;
  products(s: Scope): Promise<Product[]>;
  projects(s: Scope): Promise<Project[]>;
  createProject(s: Scope, body: { name: string; productId?: Id | null }): Promise<Project>;
  patchProject(s: Scope, id: Id, patch: { name?: string; ingredients?: Ingredient[]; sequence?: SequenceClip[] }): Promise<Project>;
}

// Mutations tell every mounted query to refetch. Simple and correct for a single-user console.
type Listener = () => void;
const listeners = new Set<Listener>();
export const onInvalidate = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const invalidate = () => { for (const fn of listeners) fn(); };
