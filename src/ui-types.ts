export type BadgeType = 'EXEC' | 'OPS' | 'TRI' | 'SDR' | 'HR' | 'MKT' | 'CS' | 'FIN' | 'INT';

export type UserRole = 'admin' | 'operator' | 'reviewer' | 'client_viewer';
export type AccountType = 'owner' | 'agency';
export type ModelTier = 'Flash-Lite' | 'Flash' | 'Pro';

// Master Database Schema (packages/db)
export interface Org {
  id: string;
  name: string;
  accountType: AccountType;
  stripeCustomerId?: string;
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled';
  trialEndsAt: string;
  featureFlags: Record<string, boolean>;
  createdAt: string;
}

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  customDomain?: string;
  clientApprovalsEnabled: boolean;
  autoAdjustEnabled: boolean;
  autoAdjustSources: string[];
  createdAt: string;
}

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: UserRole;
  createdAt: string;
}

export interface EvidenceAnchor {
  id: string;
  leadId: string;
  sourceType: 'google_review' | 'website_speed' | 'broken_flow' | 'skool_post' | 'hiring';
  title?: string;
  snippet: string;
  sourceUrl: string;
  confidenceScore: number;
  detectedAt: string;
}

export interface Lead {
  id: string;
  workspaceId: string;
  campaignId?: string;
  businessName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  emailStatus: 'unverified' | 'valid' | 'invalid' | 'risky';
  status: 'new' | 'enriched' | 'draft_pending' | 'in_sequence' | 'replied' | 'meeting_booked' | 'unsubscribed';
  evidenceAnchors: EvidenceAnchor[];
  createdAt: string;
}

export interface Campaign {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  icpId?: string;
  autoAuditEnabled: boolean;
  status: 'draft' | 'active' | 'paused' | 'archived';
}

export interface ICP {
  id: string;
  orgId: string;
  workspaceId: string;
  version: number;
  data: Record<string, any>;
  createdAt: string;
}

export interface OutreachDraft {
  id: string;
  leadId: string;
  workspaceId: string;
  channel: 'email' | 'linkedin';
  subject?: string;
  body: string;
  claimsGatePassed: boolean;
  citedEvidenceId: string;
  citedEvidence?: EvidenceAnchor;
  trustDialLevel: 1 | 2;
  status: 'pending_review' | 'approved' | 'rejected' | 'dispatched';
  rejectionReason?: string;
  createdAt: string;
}

export interface InboundReply {
  id: string;
  leadId: string;
  leadName: string;
  leadCompany: string;
  channel: 'email' | 'linkedin';
  rawBody: string;
  intent: 'meeting_request' | 'positive_inquiry' | 'objection' | 'wrong_person' | 'unsubscribe';
  slaExpiresAt?: string;
  slaMinutesRemaining?: number;
  handled: boolean;
  createdAt: string;
}

export interface Meeting {
  id: string;
  workspaceId: string;
  leadId: string;
  leadName: string;
  leadCompany: string;
  provider: 'native_google_cal' | 'calendly' | 'cal_com';
  scheduledTime: string;
  status: 'booked' | 'completed' | 'no_show' | 'canceled';
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  badge: BadgeType;
  badgeColor: string;
  avatarBg: string;
  iconType: string;
  time: string;
  unreadCount?: number;
  hasUnreadDot?: boolean;
  preview: string;
  threadName: string;
  stationName: string;
  autonomousMode: boolean;
  model: string;
  modelTier: ModelTier;
  contextSources: string[];
  activeThreads: number;
  systemRole: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  author: string;
  time: string;
  content: string;
  attachment?: {
    type: 'pdf' | 'doc' | 'sheet';
    title: string;
    details: string;
    version: string;
  };
  channelTag?: string;
  metaContext?: string;
  claimsGateStatus?: 'passed' | 'warning' | 'blocked';
  evidenceAnchorSnippet?: string;
  creditCost?: number;
  executionTime?: string;
}

export interface ApprovalItem {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  icpFit: number;
  recipientName: string;
  recipientRole: string;
  recipientCompany: string;
  channel: 'email' | 'linkedin';
  subject: string;
  bodyPreview: string;
  fullSequence: {
    step: number;
    delay: string;
    subject: string;
    content: string;
  }[];
  agentName: string;
  timestamp: string;
  signals: string[];
  claimsGatePassed: boolean;
  citedEvidence: EvidenceAnchor;
  trustDialLevel: 1 | 2;
  modelTier: ModelTier;
  rejectionReason?: string;
}

export interface RoutineItem {
  id: string;
  name: string;
  schedule: string;
  signalsCount?: number;
  active: boolean;
  pausedByAdmin?: boolean;
  category: 'briefing' | 'triage' | 'outbound' | 'sync';
}

export interface Integration {
  id: string;
  name: string;
  icon: string;
  category: 'CRM & Data' | 'Communication' | 'Productivity' | 'Sales Intelligence';
  status: 'Connected' | 'Pending Auth' | 'Setup Now';
  lastSync: string;
  recordsSynced: string;
  description: string;
  complianceNote?: string;
}

export interface AutoAdjustRule {
  id: string;
  learnedFrom: string;
  category: 'drafting_angle' | 'objection_rebuttal' | 'hook_pattern';
  description: string;
  confidence: number;
  dateLearned: string;
  sourceEvent: string;
}
