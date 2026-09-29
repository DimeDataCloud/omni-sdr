export type TrustDialLevel = 1 | 2 | 3; // 1: Manual Swipe Review, 2: Guarded Autonomy, 3: Full Autonomy

export type ChannelType = 'email' | 'sms' | 'linkedin' | 'social_dm';

export type LeadStatus = 
  | 'scraped'
  | 'qualified'
  | 'pending_approval'
  | 'approved'
  | 'active_sequence'
  | 'replied'
  | 'meeting_booked'
  | 'rejected'
  | 'disqualified';

export type EvidenceType = 
  | 'google_review_unanswered'
  | 'google_review_negative'
  | 'website_speed_slow'
  | 'booking_flow_missing'
  | 'mobile_broken'
  | 'skool_engagement_leak'
  | 'hiring_open_requisition'
  | 'stale_copyright_tech';

export interface EvidenceAnchor {
  id: string;
  type: EvidenceType;
  title: string;
  snippet: string;
  sourceUrl: string;
  detectedAt: string;
  confidenceScore: number; // 0 - 1.0
  severity: 'high' | 'medium' | 'critical';
  estimatedMonthlyBleed: number; // Estimated dollar loss from this issue
}

export interface DynamicAuditReport {
  id: string;
  leadId: string;
  slug: string;
  companyName: string;
  industry: string;
  websiteUrl: string;
  generatedAt: string;
  headline: string;
  summary: string;
  totalMonthlyBleed: number;
  totalAnnualBleed: number;
  healthScore: number; // 0 - 100
  metrics: {
    label: string;
    value: string;
    benchmark: string;
    status: 'good' | 'warning' | 'critical';
  }[];
  painPoints: {
    title: string;
    evidence: string;
    businessImpact: string;
    recommendedFix: string;
  }[];
  beforeAfterComparison: {
    currentProcess: string;
    optimizedWithAI: string;
    timeOrMoneySaved: string;
  };
  meetingEmbedUrl?: string;
}

export interface OutreachCopy {
  channel: ChannelType;
  subject?: string; // For email
  body: string;
  callToAction: string;
  citedEvidenceId: string;
  characterCount: number;
  confidenceScore: number;
  claimsVerified: boolean;
}

export interface Lead {
  id: string;
  businessName: string;
  decisionMakerName?: string;
  decisionMakerRole?: string;
  email?: string;
  phone?: string;
  websiteUrl: string;
  location: string;
  niche: string;
  rating?: number;
  reviewCount?: number;
  evidenceAnchors: EvidenceAnchor[];
  status: LeadStatus;
  auditSlug?: string;
  outreachDrafts: OutreachCopy[];
  campaignId: string;
  createdAt: string;
  lastTouchAt?: string;
  notes?: string;
}

export interface Campaign {
  id: string;
  name: string;
  niche: string;
  targetLocation: string;
  valueProposition: string;
  trustDialLevel: TrustDialLevel;
  channels: ChannelType[];
  status: 'active' | 'paused' | 'draft';
  stats: {
    leadsScraped: number;
    qualifiedCount: number;
    pendingApproval: number;
    sentCount: number;
    openedCount: number;
    repliedCount: number;
    meetingsBooked: number;
    totalPipelineValue: number;
  };
  createdAt: string;
}

export interface SocialAuthorityPost {
  id: string;
  platform: 'linkedin' | 'x' | 'skool';
  title: string;
  content: string;
  hook: string;
  industry: string;
  estimatedReach: string;
  tags: string[];
  createdAt: string;
}

export interface InboundReplyTriage {
  id: string;
  leadId: string;
  leadName: string;
  companyName: string;
  channel: ChannelType;
  incomingText: string;
  sentiment: 'positive_hot' | 'objection' | 'out_of_office' | 'wrong_person' | 'unsubscribe';
  suggestedAction: string;
  suggestedReplyCopy: string;
  receivedAt: string;
  autoExecuted: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  ownerUserId: string;
  plan: 'starter' | 'pro' | 'agency_scale';
  stripeCustomerId?: string;
  trustDialLevel: TrustDialLevel;
  rateLimits: {
    maxDailyEmails: number;
    maxDailySms: number;
  };
  createdAt: string;
}
