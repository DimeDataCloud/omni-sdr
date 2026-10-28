// Omni-SDR API response shapes, for building the UI against the real backend (packages/api, docs/claude/API.md).
// Written from the route code on 2026-09-29. Timestamps are ISO strings. All ids are uuids.
// Base path for workspace routes: /v1/o/{orgId}/w/{workspaceId}

export type Role = 'admin' | 'operator' | 'reviewer' | 'client_viewer' | 'closer' | 'rep';
export type AccountType = 'owner' | 'agency';
export type ModelTier = 'flash_lite' | 'flash' | 'pro';
export type Iso = string;
export type Id = string;

export interface ApiError { error: 'bad_request' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'model_unavailable' | 'internal' | string;
  message: string; details?: Record<string, unknown>; requestId: string }

// GET /v1/me
export interface Me {
  user: { id: Id; email: string };
  orgs: { id: Id; name: string; accountType: AccountType; subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled';
    role: Role; workspaces: { id: Id; name: string }[] }[];
}

// GET …/settings
export interface Settings {
  workspace: { id: Id; name: string; timezone: string; trustLevel: 1 | 2 | 3; clientApprovalsEnabled: boolean; autoAdjustEnabled: boolean;
    autoAdjustSources: AutoAdjustSource[]; postalAddress: string | null; customDomain: string | null; createdAt: Iso };
  org: { id: Id; name: string; accountType: AccountType; subscriptionStatus: string; trialEndsAt: Iso | null; featureFlags: Record<string, boolean> };
  you: { userId: Id; role: Role };
}
export type AutoAdjustSource = 'booked_meetings' | 'positive_replies' | 'objections' | 'unsubscribes_bounces' | 'sops' | 'won_lost' | 'draft_edits' | 'rejections';

// GET …/members  (admin)
export interface Members {
  members: { userId: Id; email: string; role: Role; workspaceIds: Id[] | null }[];
  pendingInvites: { id: Id; role: Role; workspaceIds: Id[] | null; expiresAt: Iso; createdAt: Iso }[];
}

// GET …/approvals → { items: ApprovalCard[], counts }
export type DraftStatus = 'generating' | 'gating' | 'blocked' | 'review' | 'approved' | 'discarded' | 'superseded';
export type EmailStatus = 'unknown' | 'valid' | 'invalid' | 'risky';
export interface Evidence { id: Id; type: string; sourceUri: string; fetchedAt: Iso; facts: Record<string, unknown>; expiresAt: Iso }
export interface GateFinding { code: GateCode | string; detail: string }
export type GateCode = 'claim_malformed' | 'evidence_not_found' | 'evidence_wrong_contact' | 'evidence_expired' | 'fact_missing'
  | 'number_mismatch' | 'claim_not_in_body' | 'unsupported_sentence' | 'unsupported_number' | 'revenue_formula_required'
  | 'no_evidence' | 'implied_prior_contact' | 'banned_filler' | 'competitor_named';
export interface ApprovalCard {
  id: Id; status: DraftStatus; dispatched: boolean;
  channel: 'email' | 'sms' | 'linkedin_assist'; step: number; subject: string | null; body: string;
  recipient: { contactId: Id; name: string | null; title: string | null; company: string | null; email: string | null; emailStatus: EmailStatus };
  fitScore: number | null;                     // 0-100
  campaign: { id: Id; name: string };
  agent: { id: Id; name: string; modelTier: ModelTier } | null;
  gate: { passed: boolean; version: string | null; gatedAt: Iso | null; findings: GateFinding[] };
  claims: { text: string | null; factKey: string | null; evidence: Evidence | null }[];
  sequence: { id: Id; step: number; subject: string | null; body: string; status: DraftStatus }[];
  trustLevel: 1 | 2 | 3; rejectionReason: string | null; approvedBy: Id | null; approvedAt: Iso | null; createdAt: Iso;
}
export interface ApprovalsList { items: ApprovalCard[]; counts: Partial<Record<DraftStatus, number>> }
// PATCH …/approvals/{id} → { gate: 'passed' | 'blocked' | 'stale' | 'skipped', item: ApprovalCard }
// POST …/approvals/bulk-approve → { results: { id, ok, error? }[], approved: number }

// GET …/inbox → { items: InboxItem[] }
export type Intent = 'meeting_request' | 'positive_inquiry' | 'question' | 'objection' | 'referral' | 'out_of_office'
  | 'not_interested' | 'unsubscribe' | 'wrong_person' | 'bounce' | 'unclassified';
export interface InboxItem {
  id: Id; channel: 'email' | 'linkedin' | 'form'; fromAddress: string | null; subject: string | null; body: string;
  receivedAt: Iso; intent: Intent; intentConfidence: number | null; classifiedBy: string | null;
  slaDueAt: Iso | null; slaMinutesRemaining: number | null; needsHuman: boolean;
  handledAt: Iso | null; handledBy: Id | null; messageId: Id | null;
  contactId: Id | null; contactName: string | null; contactCompany: string | null; contactTitle: string | null;
  /** 0015: the thread this reply belongs to; a handoff passes the whole thread to a closer. */
  conversationId?: Id | null;
}

// Handoffs (0015/0016; SDR-PIVOT P1, P4). A qualified conversation passed to a human closer.
export type HandoffReason = 'qualified' | 'meeting_request' | 'asked_for_human' | 'escalation';
export type HandoffOutcome = 'won' | 'lost' | 'no_show' | 'not_a_fit' | 'reassigned';
export interface ThreadMessage { id: Id; direction: 'in' | 'out'; at: Iso; channel: string; subject: string | null; body: string; category?: string | null }
// GET …/handoffs → { items: HandoffItem[] }
export interface HandoffItem {
  id: Id; conversationId: Id; closerId: Id; reason: HandoffReason; summary: string; answers: Record<string, unknown>; createdBy: Id | null; createdAt: Iso;
  dueAt: Iso | null; acceptedAt: Iso | null; outcome: HandoffOutcome | null; outcomeAt: Iso | null; overdue: boolean;
  // channel and contact are null for a closer whose handoff ended (not won): they keep the record, not the conversation.
  channel: string | null; category: string | null; contactName: string | null; contactEmail: string | null; contactCompany: string | null;
}
// GET …/handoffs/:id
export interface HandoffCard extends Omit<HandoffItem, 'channel' | 'category' | 'contactName' | 'contactEmail' | 'contactCompany'> {
  closerEmail: string | null; bookingUrl: string | null;
  contact: { name: string | null; email: string | null; company: string | null } | null;
  conversation: { id: Id; channel: string; category: string | null; messages: ThreadMessage[] } | null;
}
// Playbook (0017; SDR-PIVOT P3). GET …/playbook
export type PlaybookCategory = 'meeting_request' | 'positive_inquiry' | 'question' | 'objection' | 'referral' | 'out_of_office'
  | 'not_interested' | 'wrong_person' | 'unclassified';
export interface PlaybookReply { id: Id; category: PlaybookCategory; name: string; subject: string | null; body: string; asksNextQuestion: boolean; createdAt: Iso; updatedAt: Iso }
export interface QualificationQuestion { position: number; key: string; question: string }
export interface AutonomyRow { category: string; decided: number; unedited: number; edited: number; discarded: number; rate: number; eligible: boolean }
export interface Playbook { replies: PlaybookReply[]; questions: QualificationQuestion[]; fields: string[];
  autonomy: { window: number; rate: number; autoSend: false; categories: AutonomyRow[] } }
export interface ReplyDraft { id: Id; conversationId: Id; playbookReplyId: Id | null; category: string; channel: string; questionKey: string | null;
  subject: string | null; bodyProposed: string; bodyFinal: string | null; status: 'pending' | 'approved' | 'discarded' | 'superseded'; edited: boolean | null;
  countsForAutonomy: boolean; createdAt: Iso; decidedAt: Iso | null }
// GET …/conversations/:id/handoff-draft
export interface HandoffDraft { reason: HandoffReason; summary: string; closers: { id: Id; email: string; role: Role; hasBookingLink: boolean }[] }

// GET …/meetings → { items: Meeting[] }
export interface Meeting {
  id: Id; contactId: Id | null; contactName: string | null; contactCompany: string | null; inboundMessageId: Id | null;
  provider: 'native' | 'calendly' | 'cal_com'; externalId: string | null; startsAt: Iso; endsAt: Iso; meetUrl: string | null;
  status: 'booked' | 'completed' | 'no_show' | 'canceled'; createdBy: Id | null; createdAt: Iso;
}

// GET …/agents → { items: Agent[] }
export type Badge = 'EXEC' | 'OPS' | 'TRI' | 'SDR' | 'HR' | 'MKT' | 'CS' | 'FIN' | 'INT';
export interface Agent {
  id: Id; name: string; station: string; badge: Badge; modelTier: ModelTier; systemPrompt: string; contextSources: string[];
  autonomousMode: boolean; appearance: Record<string, unknown>; archivedAt: Iso | null; createdBy: Id | null; createdAt: Iso;
  lastMessage: { preview: string; sender: 'user' | 'agent'; at: Iso } | null; activeRoutines: number;
  autonomy: Autonomy;                                    // PROPOSED (WORKSPACE-PLAN.md); 'draft' until set
}
// GET …/agents/{id}/messages → { items: ChatMessage[] } (oldest first)
// POST …/agents/{id}/messages { body, modelTier?, about?, mode? } → 201 { userMessage, reply }; 502 { details: { userMessage } } if the model fails
//   `about` and `mode` are PROPOSED (UI-REVISION-PLAN Phase 3): the demo adapter answers them; packages/api does not take them yet.
export interface ChatMessage { id: Id; sender: 'user' | 'agent'; authorId: Id | null; body: string;
  meta: { model?: string; tier?: ModelTier; ms?: number; usage?: { inputTokens: number | null; outputTokens: number | null } | null;
    about?: About; mode?: AskMode; sources?: string[] }; createdAt: Iso }
/** The object a question is about: attached from its own screen ("Ask about this", Q) or with the composer's +. */
export type AboutKind = 'contact' | 'draft' | 'reply' | 'meeting' | 'analytics';
export interface About { kind: AboutKind; id: Id; label: string }
/** Composer modes: each one steers which part of the workspace the agent answers from. */
export type AskMode = 'ask' | 'find_leads' | 'draft' | 'book' | 'report';

// GET …/pipeline?since=ISO   PROPOSED (UI-REVISION-PLAN Phase 3; not in packages/api yet). Counts over a window, because
// the list routes page at 50 rows and can't be summed on the client. `live` is work in flight right now, whatever the window.
export interface Pipeline {
  since: Iso; until: Iso;
  found: number;                                                  // contacts added
  drafted: number; waiting: number; blocked: number;              // drafts written; of those, in review / blocked now
  approved: number; sent: number;                                 // drafts approved; messages sent
  replies: number; meetingRequests: number; optOuts: number;      // replies received (bounces and out-of-office excluded)
  booked: number;                                                 // meetings booked (canceled excluded)
  byAgent: { agentId: Id; name: string; drafted: number }[];
  live: { drafting: number; classifying: number };
}

// GET …/routines → { items: Routine[] }
export interface Routine { id: Id; agentId: Id | null; agentName: string | null; name: string; category: 'briefing' | 'triage' | 'outbound' | 'sync';
  schedule: string; active: boolean; pausedReason: string | null; pausedByOps: boolean; lastRunAt: Iso | null; nextRunAt: Iso | null; createdAt: Iso }

// GET …/capacity
export interface Capacity {
  mailboxes: { id: Id; provider: 'gmail' | 'graph' | 'smtp_imap' | 'bridge'; address: string; dailyCap: number; pausedReason: string | null; sentToday: number }[];
  holds: { scopeType: 'org' | 'workspace' | 'campaign' | 'mailbox'; scopeId: Id; reason: string; setBy: string; setAt: Iso }[];
  queue: { approvedUnsent: number; awaitingReview: number };
  today: { cap: number; used: number; remaining: number };
  workspaceOnHold: boolean;
}

// GET …/analytics?days=7|30|90   (no open rate exists, by design)
export interface Analytics {
  days: 7 | 30 | 90; timezone: string;
  totals: { sent: number; replies: number; positive: number; meetings: number };
  rates: { replyRate: number | null; positiveRate: number | null; approvalRate: number | null };   // percent, 1 decimal; null = no denominator
  approvals: { approved: number; rejected: number };
  daily: { day: string; sent: number; replies: number; positive: number; meetings: number }[];   // day = YYYY-MM-DD in workspace tz
  byStep: { step: number; sent: number; replied: number; replyRate: number | null }[];
}

// GET …/credits
export interface Credits { balances: Partial<Record<'data' | 'action' | 'media', number>> }

// GET …/connectors → { items: Connector[] }
export interface Connector {
  id: string; name: string; category: 'mail' | 'calendar' | 'booking' | 'social' | 'commerce' | 'crm' | 'export' | 'mcp' | 'warmup' | 'sms';
  auth: 'oauth' | 'api_key' | 'app_password' | 'provider'; activation: 'live' | 'later'; costOwner: 'omni' | 'customer';
  scopes: { scope: string; why: string }[]; note?: string; consent?: { required: boolean; version: string };
  status: 'connected' | 'not_connected' | 'activates_later';
}

// GET …/contacts → { items: Contact[] } ; GET …/contacts/{id} → ContactDetail
export interface Contact { id: Id; name: string | null; email: string | null; emailStatus: EmailStatus; phone: string | null;
  company: string | null; title: string | null; fitScore: number | null; createdAt: Iso }
export interface ContactDetail extends Contact {
  evidence: Evidence[];
  enrollments: { id: Id; state: string; step: number; heat: number; stopReason: string | null; campaignName: string; campaignId: Id }[];
}
// GET …/icps → { items: { id, lineageId, name, version, data, createdAt }[] } (latest version per lineage)
// GET …/campaigns → { items: { id, name, status: 'draft'|'active'|'paused'|'archived', icpId, autoAuditEnabled, enrolled, live }[] }
// GET …/activity (admin) → { items: { id, actor, actorEmail, action, entityType, entityId, at }[] }

// ── Studio: the image and video suite (PROPOSED, docs/claude/STUDIO-PLAN.md; SPEC §4 0009_content_assets) ──────────────
// Not in packages/api yet. Generation is server-side only and gated by the org flags `imageGeneration` / `videoGeneration`
// (DECISIONS 2026-09-28): with a flag off the UI hides that action and offers upload or pick-from-library instead.
export type AssetKind = 'image' | 'video';
export type AssetStatus = 'draft' | 'review' | 'approved' | 'changes_requested';
export type Aspect = '1:1' | '4:5' | '9:16' | '16:9';
/** Create modes. Each maps to one generator flag: video → videoGeneration, the rest → imageGeneration. */
export type GenMode = 'image' | 'product' | 'video' | 'social';
export type Scene = 'studio' | 'podium' | 'counter' | 'outdoor' | 'flatlay';
export type ProductShape = 'box' | 'bottle' | 'tube' | 'jar';
/** How a generated picture was composed. The demo draws it locally (lib/media.ts); the real API stores the file instead. */
export interface RenderSpec { shape: ProductShape | null; hue: number; scene: Scene; seed: number; label: string | null; backdrop: 'scene' | 'clean' | 'cutout' }
/** Non-destructive edits. Saving them makes a new version; the original version is never changed. */
export interface Edits {
  crop: Aspect | null; rotate: 0 | 90 | 180 | 270; flipH: boolean;
  brightness: number; contrast: number; saturation: number;              // percent, 100 = unchanged
  text: { value: string; position: 'top' | 'center' | 'bottom'; style: 'sans' | 'serif' } | null;
  trim: { inS: number; outS: number } | null;                             // video only
  captions: string | null;                                                 // video only, burned in at export
}
export interface AssetVersion { n: number; render: RenderSpec | null; src: string | null; edits: Edits; note: string; scale: 1 | 2; createdAt: Iso; createdBy: string }
export interface Ingredient { id: Id; kind: 'product' | 'brand' | 'style' | 'character'; label: string; assetId: Id | null; productId: Id | null }
export interface Generation { mode: GenMode; prompt: string; model: string; ingredients: Ingredient[]; motion: MotionKey | null;
  startFrame: Id | null; endFrame: Id | null; credits: number; sample: boolean }
export type MotionKey = 'static' | 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'crane_up' | 'orbit' | 'crash_zoom' | 'handheld';
export interface Asset {
  id: Id; kind: AssetKind; name: string; status: AssetStatus; source: 'upload' | 'generated';
  aspect: Aspect; durationS: number | null; projectId: Id | null; productId: Id | null;
  versions: AssetVersion[]; current: number;                               // index into versions
  generation: Generation | null; rendering: boolean; reviewNote: string | null;
  createdBy: string; createdAt: Iso; updatedAt: Iso;
}
export interface Product { id: Id; name: string; tagline: string; shape: ProductShape; hue: number; description: string }
export interface SequenceClip { id: Id; assetId: Id; inS: number; outS: number; caption: string }
export interface Project { id: Id; name: string; productId: Id | null; ingredients: Ingredient[]; sequence: SequenceClip[]; createdAt: Iso; assetCount: number }
export interface StudioCaps { imageGeneration: boolean; videoGeneration: boolean; mediaCredits: number; sample: boolean }

// ── Setup: the harness per agent and per dataset (PROPOSED, docs/claude/WORKSPACE-PLAN.md) ──────────────────────────
/** How far an agent may go on its own. Levels from BrainAI methodology (UI-REVISION-PLAN Phase 4). Above "draft" is
 *  locked until the workspace reaches Trust Level 2 with a verified sending domain: every message is approved today. */
export type Autonomy = 'suggest' | 'draft' | 'guardrails' | 'autopilot';
// GET …/agents/{id}/stats?days=30
export interface AgentStats {
  days: number; drafted: number; approved: number; rejected: number; blocked: number; inReview: number; edited: number;
  approvalRate: number | null;                         // approved / (approved + rejected), percent; null = nothing decided yet
  corrections: { draftId: Id; recipient: string; kind: 'rejected' | 'edited' | 'blocked'; note: string | null; at: Iso }[];
}
// GET …/datasets → what the agents can read, how big and fresh it is, and who reads it
export type DatasetKey = 'leads' | 'evidence' | 'icp' | 'drafts' | 'replies' | 'meetings' | 'results' | 'suppression' | 'products' | 'brand' | 'media';
export interface Dataset {
  key: DatasetKey; name: string; about: string; source: string;     // `source` is the tag an agent's contextSources uses
  count: number; updatedAt: Iso | null; readers: { agentId: Id; name: string }[];
  rules: string[]; manage: string;                                  // manage: the page (and query) where its rows are corrected
  always: boolean;                                                  // true: every agent and every send honors it; not a toggle
}

// ── Dev portal: the client record, shaped like Backend's 6a (omnisdr-pivot/DESIGN-backend-6a-api-shape.md). camelCase here, snake_case on the wire. ──
export type ClientStatus = 'lead' | 'closed' | 'onboarding' | 'building' | 'ready' | 'live' | 'paused' | 'ended';
export type DealLevel = 'L1 pilot' | 'L2 recurring' | 'L3 outcome';
/** GET clients rows. One call, no N+1. */
export interface ClientSummary {
  id: Id; name: string; status: ClientStatus; statusChangedAt: Iso; ownerUserId: Id | null;
  deal: { repId: Id; level: DealLevel; priceCents: number; priceIsDraft: boolean; closedAt: Iso };
  appliedVersion: number | null; pendingVersions: number;
  checklist: { done: number; required: number; nextBlocked: string | null };
}
/** GET clients/:id. Profile is record keeping only: edited now, no review. Anything the system reads at run time is config (versioned). */
export interface ClientRecord extends ClientSummary { workspaceId: Id | null; profile: { niche: string; contactName: string; contactEmail: string; notes: string } }

export type ChecklistGroup = 'Account' | 'Connections' | 'Compliance' | 'Setup' | 'Launch';
export type ChecklistState = 'todo' | 'in_progress' | 'blocked' | 'done' | 'waived';
export interface ChecklistItem {
  key: string; section: ChecklistGroup; title: string; required: boolean; kind: 'manual' | 'auto'; state: ChecklistState;
  ownerUserId: Id | null; evidenceRef: string | null; waivedReason: string | null; blockedBy: string | null; doneBy: Id | null; doneAt: Iso | null;
}
/** GET clients/:id/events. Append-only. detail carries ids and enum values only, so the UI composes the sentence. */
export interface ClientEvent { id: Id; at: Iso; actorUserId: Id | null; actorKind: 'user' | 'system'; kind: string; subjectId: Id | null; detail: Record<string, string | number | boolean | null> }

// Setup versions (CI/CD). The config is everything the system reads at run time.
export type Risk = 'low' | 'medium' | 'high';
export interface SetupConfig {
  hours: string; timezone: string; quietHours: string; services: string; ownerContacts: string; consentBasis: string;
  closers: string; booking: string; payment: string; resolution: string; unknown: string;
  followUpDays: number[]; tone: 'warm' | 'direct' | 'formal'; replyNotes: string;
}
export interface SetupChange { area: string; path: keyof SetupConfig & string; before: string; after: string; risk: Risk }
export type VersionStatus = 'draft' | 'in_review' | 'approved' | 'applied' | 'superseded' | 'rejected' | 'rolled_back';   // exactly one applied per client; applying a newer one supersedes it
export interface SetupVersion {
  version: number; status: VersionStatus; authorId: Id; reviewerId: Id | null; parentVersion: number | null; note: string; reviewNote: string | null; risk: Risk; diff: SetupChange[];
  createdAt: Iso; reviewedAt: Iso | null; appliedAt: Iso | null;
  checks: { label: string; ok: boolean; why: string | null }[];   // 6a returns []; the demo fills labelled demo checks
}
export interface SetupDraft { version: number; parentVersion: number | null; config: SetupConfig }

/** Management rollup, 6d (not 6a): one call, a row per client. The demo returns made-up numbers so the table can be built now. */
export interface ClientHealth {
  clientId: Id; replyMedianMinutes: number | null; replyWindowMinutes: number; openDrafts: number; openHandoffs: number; alertFailures: number; sendErrors: number;
  appliedVersion: number | null; pendingVersions: number; billing: { state: 'not_connected' };
}

/** A deal as the rep portal shows it: the closed sale plus where the client record is now. A rep sees only their own. */
export interface SalesDeal { id: Id; business: string; niche: string; level: DealLevel; priceCents: number; priceIsDraft: boolean; status: ClientStatus; closedAt: Iso; repId: Id }
/** Close a sale. No price and no rep: the server takes the amount from the price config and the rep from the session. */
export interface CloseSaleInput { business: string; niche: string; level: DealLevel; contactName: string; contactEmail: string; notes: string }

/** What a client sees of their own record: one word, the live setup version and when it went out. No price, checklist, drafts or contacts. */
export type ClientStatusWord = 'Setting up' | 'Approval week' | 'Live' | 'Paused';
export interface ClientStatusView { word: ClientStatusWord; appliedVersion: number | null; appliedAt: Iso | null }

/** The live setup as a client reads it. Read-only; a change request goes by email. No drafts, no review notes, no reply notes. */
export interface ClientSetupView {
  appliedVersion: number; appliedAt: Iso; hours: string; timezone: string; services: string; booking: string; handoffRoute: string; alertContacts: string; tone: string;
  history: { version: number; appliedAt: Iso }[];
}
/** One conversation as a client sees it: a name, a masked phone, a short summary. The transcript is by request only. */
export interface ClientConversation {
  id: Id; name: string; maskedPhone: string | null; channel: string; lastAt: Iso; summary: string; status: 'open' | 'handled';
}

/** Rep prospect lists (fictional rows until Christian approves real prospect data and the privacy page says so). */
export type ProspectStatus = 'new' | 'contacted' | 'audit_run' | 'results_call' | 'proposed' | 'signed';
export interface Prospect { id: Id; repId: Id; business: string; niche: string; signal: string; lastTouch: string | null; nextStep: string; status: ProspectStatus; notes: string }
export interface ProspectPatch { status?: ProspectStatus; nextStep?: string; notes?: string }
/** One rep's day. Counts are whole numbers; objectionWords is what owners actually said, in their words. */
export interface SalesLog { date: string; repId: Id; attempts: number; conversations: number; audits: number; resultsCalls: number; pilotsProposed: number; pilotsSigned: number; objectionWords: string }
export type SalesLogInput = Omit<SalesLog, 'repId'>;

/** Rep portal price ladder (SALES-DECK-COPY slide 13). Data, not copy: every amount is DRAFT until `isFinal`, which only Christian sets. */
export type PriceUnit = 'free' | 'one_time' | 'per_month' | 'per_kept_appointment';
export interface PriceLevel {
  level: 0 | 1 | 2 | 3; label: string; what: string; amountCents: number; unit: PriceUnit;
  /** Top of a range (Level 2 is $299 to $499 a month), else null. */
  rangeToCents: number | null;
  /** Monthly floor that goes with a per-appointment fee (Level 3), else null. */
  floorCents: number | null;
  /** Reps may say this number out loud. Until Christian confirms, only Level 0 and Level 1 are. */
  quotable: boolean;
}
export interface PriceConfig { levels: PriceLevel[]; isFinal: boolean; effectiveDate: string | null }

// Demo only, NOT in 6a (connection cards and the draft approval queue come later). Labelled as demo on screen.
export type ConnState = 'live' | 'simulated' | 'needs_approval';
export type ConnChannel = 'mailbox' | 'calendar' | 'phone' | 'voice' | 'crm';
export interface DemoConnection { channel: ConnChannel; state: ConnState; lastTest: Iso | null; note: string }
export interface DemoReplyDraft { id: Id; subject: string; body: string; state: 'pending' | 'approved' | 'rejected' }
