// Omni-SDR API response shapes, for building the UI against the real backend (packages/api, docs/claude/API.md).
// Written from the route code on 2026-09-29. Timestamps are ISO strings. All ids are uuids.
// Base path for workspace routes: /v1/o/{orgId}/w/{workspaceId}

export type Role = 'admin' | 'operator' | 'reviewer' | 'client_viewer';
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
}

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
