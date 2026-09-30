import { 
  Agent, 
  ChatMessage, 
  ApprovalItem, 
  RoutineItem, 
  Integration, 
  EvidenceAnchor, 
  InboundReply, 
  Meeting, 
  Org, 
  Workspace, 
  AutoAdjustRule 
} from '../ui-types';

export const CURRENT_ORG: Org = {
  id: 'org-acme-growth',
  name: 'Acme Growth Labs',
  accountType: 'agency', // 'owner' | 'agency'
  subscriptionStatus: 'trialing',
  trialEndsAt: 'Day 5 of 7-Day Trial (Stripe Checkout Active)',
  featureFlags: {
    mediaPipelineGeneration: false, // Default OFF
    autoAdjustLearningLoop: true,
    level2GuardedAutonomy: false // Locked behind operator flag
  },
  createdAt: '2026-09-22T08:00:00Z'
};

export const WORKSPACES: Workspace[] = [
  {
    id: 'ws-retool',
    orgId: 'org-acme-growth',
    name: 'Client: Retool Dev Tools',
    customDomain: 'reports.acmegrowth.com/retool',
    clientApprovalsEnabled: true,
    autoAdjustEnabled: true,
    autoAdjustSources: ['booked_meetings', 'positive_replies', 'human_edits'],
    createdAt: '2026-09-23T10:00:00Z'
  },
  {
    id: 'ws-brightside',
    orgId: 'org-acme-growth',
    name: 'Client: Brightside Health Pod',
    customDomain: 'reports.acmegrowth.com/brightside',
    clientApprovalsEnabled: true,
    autoAdjustEnabled: false,
    autoAdjustSources: ['booked_meetings'],
    createdAt: '2026-09-24T12:00:00Z'
  },
  {
    id: 'ws-supabase',
    orgId: 'org-acme-growth',
    name: 'Client: Supabase RevOps',
    customDomain: 'reports.acmegrowth.com/supabase',
    clientApprovalsEnabled: false,
    autoAdjustEnabled: true,
    autoAdjustSources: ['booked_meetings', 'objections'],
    createdAt: '2026-09-25T14:00:00Z'
  }
];

export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'chief-of-staff',
    name: 'Chief of Staff',
    badge: 'EXEC',
    badgeColor: '#e9d5ff',
    avatarBg: '#9333ea',
    iconType: 'sparkles',
    time: '7:34P',
    unreadCount: 1,
    preview: 'Claims Gate: 4 anchors validated...',
    threadName: '#thread-brightside-q3',
    stationName: 'CHIEF OF STAFF',
    autonomousMode: true,
    model: 'Gemini 2.5 Flash',
    modelTier: 'Flash',
    contextSources: ['CRM', 'Slack', 'Google Calendar', 'Evidence Harvester'],
    activeThreads: 3,
    systemRole: 'Executive orchestration, cross-functional status tracking, and claims-gate verified stakeholder communication.'
  },
  {
    id: 'ea-dispatch',
    name: 'EA Dispatch',
    badge: 'OPS',
    badgeColor: '#bae6fd',
    avatarBg: '#0284c7',
    iconType: 'calendar',
    time: '6:12P',
    unreadCount: 2,
    preview: 'Native Cal: 3-slot free/busy picker...',
    threadName: '#thread-exec-calendar-w40',
    stationName: 'EA DISPATCH',
    autonomousMode: true,
    model: 'Gemini 2.5 Flash-Lite',
    modelTier: 'Flash-Lite',
    contextSources: ['Google Calendar', 'Cal.com', 'Gmail (gmail.send)'],
    activeThreads: 2,
    systemRole: 'Executive scheduling automation, 3-slot availability generation, and 2-hour SLA response guard.'
  },
  {
    id: 'inbox-triage',
    name: 'Inbox Triage',
    badge: 'TRI',
    badgeColor: '#bbf7d0',
    avatarBg: '#16a34a',
    iconType: 'mail',
    time: '7:34P',
    unreadCount: 3,
    preview: '2 meeting requests with SLA < 45m',
    threadName: '#thread-vip-inbox-daily',
    stationName: 'INBOX TRIAGE',
    autonomousMode: true,
    model: 'Gemini 2.5 Flash-Lite',
    modelTier: 'Flash-Lite',
    contextSources: ['Cloudflare Email Routing (reply.omnisdr.com)', 'LinkedIn DM Ingest'],
    activeThreads: 1,
    systemRole: 'Inbound sentiment classification, meeting request detection, objection tagging, and SLA countdown escalation.'
  },
  {
    id: 'sales-outbound',
    name: 'Sales Outbound',
    badge: 'SDR',
    badgeColor: '#99f6e4',
    avatarBg: '#0d9488',
    iconType: 'target',
    time: '11:18A',
    unreadCount: 4,
    preview: '4 draft cadences passed Claims Gate',
    threadName: '#thread-q3-enterprise-outbound',
    stationName: 'SALES OUTBOUND',
    autonomousMode: true,
    model: 'Gemini 2.5 Flash',
    modelTier: 'Flash',
    contextSources: ['Google Business Places', 'Skool Signals', 'PageSpeed Diagnostics', 'Apollo.io'],
    activeThreads: 4,
    systemRole: 'Evidence-first outbound generation, Claims-Gate enforcement, and Trust Dial Level 1 sequence queuing.'
  },
  {
    id: 'talent-scout',
    name: 'Talent Scout',
    badge: 'HR',
    badgeColor: '#fde68a',
    avatarBg: '#d97706',
    iconType: 'users',
    time: '8:45A',
    unreadCount: 5,
    hasUnreadDot: true,
    preview: 'Hiring signals: 4 SDR reqs posted',
    threadName: '#thread-senior-ml-sourcing',
    stationName: 'TALENT SCOUT',
    autonomousMode: true,
    model: 'Gemini 2.5 Flash',
    modelTier: 'Flash',
    contextSources: ['Greenhouse Hooks', 'LinkedIn Jobs', 'GitHub Telemetry'],
    activeThreads: 2,
    systemRole: 'Company expansion signals, sales hiring alerts, and operational trigger identification.'
  },
  {
    id: 'growth-marketer',
    name: 'Growth Marketer',
    badge: 'MKT',
    badgeColor: '#ffedd5',
    avatarBg: '#ea580c',
    iconType: 'trending-up',
    time: '9:04A',
    preview: 'A/B hooks grounded in Skool pain',
    threadName: '#thread-product-hunt-v2-launch',
    stationName: 'GROWTH MARKETER',
    autonomousMode: true,
    model: 'Gemini 2.5 Flash',
    modelTier: 'Flash',
    contextSources: ['Skool Communities', 'PostHog', 'Whop Signals'],
    activeThreads: 1,
    systemRole: 'Hook formulation based on community discussions and verified customer frustrations.'
  },
  {
    id: 'support-lead',
    name: 'Support Lead',
    badge: 'CS',
    badgeColor: '#fecdd3',
    avatarBg: '#e11d48',
    iconType: 'headphones',
    time: '2:20P',
    preview: 'Diagnostic audit pages active (/a/)',
    threadName: '#thread-tier3-incident-slack-sync',
    stationName: 'SUPPORT LEAD',
    autonomousMode: true,
    model: 'Gemini 2.5 Flash-Lite',
    modelTier: 'Flash-Lite',
    contextSources: ['GoHighLevel', 'Shopify Admin API', 'Zendesk'],
    activeThreads: 3,
    systemRole: 'Diagnostic teardown verification, client audit URL generator, and customer ticket categorization.'
  },
  {
    id: 'expense-lead',
    name: 'Expense Lead',
    badge: 'FIN',
    badgeColor: '#fbcfe8',
    avatarBg: '#db2777',
    iconType: 'receipt',
    time: 'Tue',
    preview: 'Credit meter burn: ~140 CR/day',
    threadName: '#thread-month-end-reconciliation',
    stationName: 'EXPENSE LEAD',
    autonomousMode: false,
    model: 'Gemini 2.5 Pro',
    modelTier: 'Pro',
    contextSources: ['Stripe Billing', 'GCP Cost Meter', 'PGlite Ledger'],
    activeThreads: 1,
    systemRole: 'Cost control, single-production environment budget tracking, and trial conversion checks.'
  },
  {
    id: 'research-analyst',
    name: 'Research Analyst',
    badge: 'INT',
    badgeColor: '#e0e7ff',
    avatarBg: '#4f46e5',
    iconType: 'file-search',
    time: '10:15A',
    preview: 'Battlecard generated via Gemini Pro',
    threadName: '#thread-competitive-intel-q3',
    stationName: 'RESEARCH ANALYST',
    autonomousMode: true,
    model: 'Gemini 2.5 Pro',
    modelTier: 'Pro',
    contextSources: ['Google Search Grounding', 'PitchBook', 'SEC Filings'],
    activeThreads: 1,
    systemRole: 'High-precision competitive battlecards, ICP proposals, and structured website teardowns.'
  }
];

export const INITIAL_CONVERSATION_MESSAGES: Record<string, ChatMessage[]> = {
  'chief-of-staff': [
    {
      id: 'msg-1',
      sender: 'user',
      author: 'alexchen.auth',
      time: '09:41:02',
      content: "Hey, what's the latest update we have on Brightside Health?"
    },
    {
      id: 'msg-2',
      sender: 'agent',
      author: 'Chief of Staff',
      time: '09:41:18',
      content: "From last meeting's call notes, they need to see support for Slack integration and SSO before they proceed with a pilot.",
      claimsGateStatus: 'passed',
      evidenceAnchorSnippet: "Verified in Brightside Kickoff call notes (09/24): 'Need Slack Connect & Okta SAML SSO before Q4 pilot signoff.'"
    },
    {
      id: 'msg-3',
      sender: 'agent',
      author: 'Chief of Staff',
      time: '09:41:25',
      content: "PG plan and Brightside Health's account notes in CRM are up to date with the latest.",
      creditCost: 1,
      executionTime: '24ms'
    },
    {
      id: 'msg-4',
      sender: 'agent',
      author: 'Chief of Staff',
      time: '09:41:31',
      content: '',
      attachment: {
        type: 'pdf',
        title: 'Kickoff Agenda.pdf',
        details: '12 pages • 1.2 MB • v2.1',
        version: 'v2.1'
      }
    },
    {
      id: 'msg-5',
      sender: 'user',
      author: 'alexchen.auth',
      time: '09:42:15',
      content: "Perfect, those shipped last week, post an update to let them know"
    },
    {
      id: 'msg-6',
      sender: 'agent',
      author: 'Chief of Staff',
      time: '09:42:22',
      content: "Got it! Product updates shared and linked in #brightside-shared Slack channel.",
      channelTag: '#brightside-shared',
      claimsGateStatus: 'passed',
      evidenceAnchorSnippet: "Shipment record v2.4 confirmed on 09/25: Okta SAML 2.0 & Slack Connect integration live in production.",
      creditCost: 2,
      executionTime: '38ms'
    }
  ],
  'sales-outbound': [
    {
      id: 'so-1',
      sender: 'user',
      author: 'alexchen.auth',
      time: '11:02:10',
      content: "Review target accounts for this week's Retool and developer tools sequence."
    },
    {
      id: 'so-2',
      sender: 'agent',
      author: 'Sales Outbound',
      time: '11:03:00',
      content: "Identified 8 tier-1 VP/Director roles at Retool, Supabase, and Vercel. 4 draft sequences passed the Claims Gate with verified evidence anchors and are queued in Today Approvals.",
      claimsGateStatus: 'passed',
      creditCost: 4,
      executionTime: '82ms'
    }
  ],
  'ea-dispatch': [
    {
      id: 'ea-1',
      sender: 'user',
      author: 'alexchen.auth',
      time: '06:05:14',
      content: "Status of tomorrow's partner sync with Sequoia?"
    },
    {
      id: 'ea-2',
      sender: 'agent',
      author: 'EA Dispatch',
      time: '06:06:20',
      content: "Responded with native 3-slot free/busy availability for 2:00 PM, 3:30 PM, and 4:30 PM EST. Google Calendar hold placed.",
      creditCost: 1,
      executionTime: '18ms'
    }
  ]
};

export const INITIAL_APPROVALS: ApprovalItem[] = [
  {
    id: 'appr-1',
    status: 'pending',
    icpFit: 96,
    recipientName: 'Sarah Jenkins',
    recipientRole: 'VP Sales',
    recipientCompany: 'Retool',
    channel: 'email',
    subject: "Automating Retool's inbound SDR handoffs",
    bodyPreview: "Hi Sarah — noticed your team's expansion of the self-serve to sales-assist pod last month. Most developer platform teams lose 28% of leads during SDR queue routing...",
    agentName: 'Sales Outbound',
    timestamp: '14m ago',
    signals: ['Hiring 4 SDRs in Q3', 'New Enterprise Tier launch', 'Tech stack: HubSpot + Segment'],
    claimsGatePassed: true,
    citedEvidence: {
      id: 'ev-1',
      leadId: 'lead-retool',
      sourceType: 'hiring',
      title: 'Active LinkedIn Job Posting #89211',
      snippet: "Retool is hiring '4 Inbound Enterprise SDRs' for newly formed Sales-Assist pod, citing rapid volume surge from free-tier signups.",
      sourceUrl: 'https://linkedin.com/jobs/view/retool-sdr-inbound',
      confidenceScore: 0.98,
      detectedAt: '2026-09-28T14:20:00Z'
    },
    trustDialLevel: 1,
    modelTier: 'Flash',
    fullSequence: [
      {
        step: 1,
        delay: 'Day 1 (Morning)',
        subject: "Automating Retool's inbound SDR handoffs",
        content: `Hi Sarah,

Noticed Retool's recent expansion into enterprise sales-assist pods (saw your team's active posting for 4 inbound SDRs). When high-intent technical evaluators request a demo, standard routing rules often create a 4-hour delay before SDR triage.

We built Omni-SDR to eliminate handoff latency: autonomous qualification directly against product telemetry, drafting contextual email responses within 90 seconds while guaranteeing zero unverified claims.

Are you open to a brief 7-minute look at how we handled similar volume for Vercel?

Best,
Alex Chen
Acme Growth Labs`
      },
      {
        step: 2,
        delay: 'Day 4 (Follow-up)',
        subject: "Quick example: Retool developer triage",
        content: `Hi Sarah,

Following up on my previous note. One specific bottleneck developer tooling teams encounter is distinguishing hobbyist signups from enterprise engineering leads with 50+ seats.

Our autonomous agents cross-reference GitHub contributions and LinkedIn headcount before drafting outreach, ensuring your SDRs only review 90%+ ICP fits.

Would Thursday at 11am EST make sense for a quick preview?`
      },
      {
        step: 3,
        delay: 'Day 8 (Breakup / Resource)',
        subject: "Resource: Modern SDR handoff architecture",
        content: `Hi Sarah,

Assuming your team is heads-down with the Q3 sprint. Leaving this teardown here: "The Autonomous SDR Blueprint for Developer Platforms".

If this becomes top of mind later this quarter, let's connect then.

Warm regards,
Alex`
      }
    ]
  },
  {
    id: 'appr-2',
    status: 'pending',
    icpFit: 94,
    recipientName: 'David Miller',
    recipientRole: 'Head of RevOps',
    recipientCompany: 'Supabase',
    channel: 'email',
    subject: 'Reducing RevOps lead routing latency by 80%',
    bodyPreview: "David — saw the PostgreSQL enterprise tier announcement. As lead volume spikes, autonomous agent routing preserves your SLA without scaling headcount linearly...",
    agentName: 'Sales Outbound',
    timestamp: '32m ago',
    signals: ['Launched Postgres 16 support', 'Raised Series B', 'Using Salesforce + Slack'],
    claimsGatePassed: true,
    citedEvidence: {
      id: 'ev-2',
      leadId: 'lead-supabase',
      sourceType: 'website_speed',
      title: 'Automated Teardown & Changelog Signal',
      snippet: "Supabase Blog Post: 'Enterprise Support SLA guarantee launched for Postgres clusters with >500 connections'.",
      sourceUrl: 'https://supabase.com/blog/enterprise-postgres-support',
      confidenceScore: 0.95,
      detectedAt: '2026-09-29T08:15:00Z'
    },
    trustDialLevel: 1,
    modelTier: 'Flash',
    fullSequence: [
      {
        step: 1,
        delay: 'Day 1',
        subject: 'Reducing RevOps lead routing latency by 80%',
        content: `Hi David,\n\nCongratulations on the enterprise tier announcement. Fast-growing infra companies often see high RevOps overhead when routing self-hosted to cloud migration prospects.\n\nOmni-SDR automates this qualification workflow with zero manual data entry and strict claims-gate verification.\n\nWorth exploring?`
      }
    ]
  },
  {
    id: 'appr-3',
    status: 'pending',
    icpFit: 91,
    recipientName: 'Marcus Vance',
    recipientRole: 'Director of Growth',
    recipientCompany: 'Linear',
    channel: 'linkedin',
    subject: 'Autonomous customer expansion triggers',
    bodyPreview: "Marcus — love Linear's product velocity. We drafted an autonomous signal listener that flags when free teams hit 15 active developers...",
    agentName: 'Sales Outbound',
    timestamp: '1h ago',
    signals: ['Expanding team in SF', 'Product Insights launch'],
    claimsGatePassed: true,
    citedEvidence: {
      id: 'ev-3',
      leadId: 'lead-linear',
      sourceType: 'broken_flow',
      title: 'Skool Community Discussion #402',
      snippet: "Linear community member noted: 'Need automated Slack alert when design team joins engineering board without admin manual invite.'",
      sourceUrl: 'https://skool.com/linear-power-users/post-402',
      confidenceScore: 0.91,
      detectedAt: '2026-09-28T21:40:00Z'
    },
    trustDialLevel: 1,
    modelTier: 'Flash',
    fullSequence: [
      {
        step: 1,
        delay: 'Day 1',
        subject: 'Autonomous customer expansion triggers',
        content: `Hey Marcus,\n\nBig fan of Linear. We built autonomous expansion triggers that ping your growth reps right when workspace usage surges past team thresholds.\n\nHappy to share a 2-min demo if relevant.`
      }
    ]
  },
  {
    id: 'appr-4',
    status: 'pending',
    icpFit: 89,
    recipientName: 'Elena Rostova',
    recipientRole: 'VP Marketing',
    recipientCompany: 'Resend',
    channel: 'email',
    subject: 'Outbound sequences tailored for transactional email',
    bodyPreview: "Elena — notice the incredible developer love for Resend. We prepared an outreach sequence targeting technical founders switching from SendGrid...",
    agentName: 'Growth Marketer',
    timestamp: '2h ago',
    signals: ['Competitor pricing change', 'Y Combinator alumni network'],
    claimsGatePassed: true,
    citedEvidence: {
      id: 'ev-4',
      leadId: 'lead-resend',
      sourceType: 'google_review',
      title: 'Google Developer Teardown & Review',
      snippet: "Verified developer feedback: 'Switching from legacy SMTP because API latency dropped to 40ms, but need better team invitation tracking.'",
      sourceUrl: 'https://google.com/search?q=resend+email+reviews',
      confidenceScore: 0.89,
      detectedAt: '2026-09-27T16:00:00Z'
    },
    trustDialLevel: 1,
    modelTier: 'Flash-Lite',
    fullSequence: [
      {
        step: 1,
        delay: 'Day 1',
        subject: 'Outbound sequences tailored for transactional email',
        content: `Hi Elena,\n\nResend has set the standard for developer DX. We mapped out 40 accounts currently navigating SendGrid migration issues and drafted customized messaging for each.\n\nReady for your review.`
      }
    ]
  }
];

export const INITIAL_INBOUND_REPLIES: InboundReply[] = [
  {
    id: 'inb-1',
    leadId: 'lead-retool-01',
    leadName: 'Sarah Jenkins',
    leadCompany: 'Retool',
    channel: 'email',
    rawBody: "Hey Alex, saw your note about the sales-assist pod. We actually just onboarded our second SDR today. Do you have 15 mins this Thursday afternoon to demo how the telemetry routing works?",
    intent: 'meeting_request',
    slaExpiresAt: '2026-09-29T16:30:00Z',
    slaMinutesRemaining: 44, // 2-Hour SLA guard
    handled: false,
    createdAt: '2026-09-29T14:30:00Z'
  },
  {
    id: 'inb-2',
    leadId: 'lead-supabase-02',
    leadName: 'David Miller',
    leadCompany: 'Supabase',
    channel: 'email',
    rawBody: "Interested, but we require all outbound tools to be SOC2 Type II verified and support zero data retention. Can you send security docs first?",
    intent: 'objection',
    slaExpiresAt: '2026-09-29T17:15:00Z',
    slaMinutesRemaining: 89,
    handled: false,
    createdAt: '2026-09-29T15:15:00Z'
  },
  {
    id: 'inb-3',
    leadId: 'lead-linear-03',
    leadName: 'Marcus Vance',
    leadCompany: 'Linear',
    channel: 'linkedin',
    rawBody: "Sounds cool. Send over that 2-min loom link here on LinkedIn.",
    intent: 'positive_inquiry',
    slaExpiresAt: '2026-09-29T18:00:00Z',
    slaMinutesRemaining: 134,
    handled: false,
    createdAt: '2026-09-29T16:00:00Z'
  }
];

export const INITIAL_MEETINGS: Meeting[] = [
  {
    id: 'meet-1',
    workspaceId: 'ws-retool',
    leadId: 'lead-retool',
    leadName: 'Sarah Jenkins',
    leadCompany: 'Retool',
    provider: 'native_google_cal',
    scheduledTime: 'Tomorrow, Oct 1 @ 2:00 PM EDT',
    status: 'booked',
    createdAt: '2026-09-29T14:35:00Z'
  },
  {
    id: 'meet-2',
    workspaceId: 'ws-brightside',
    leadId: 'lead-brightside',
    leadName: 'Priya Patel',
    leadCompany: 'Brightside Health',
    provider: 'cal_com',
    scheduledTime: 'Thursday, Oct 2 @ 11:00 AM EDT',
    status: 'booked',
    createdAt: '2026-09-28T18:20:00Z'
  }
];

export const INITIAL_AUTO_ADJUST_RULES: AutoAdjustRule[] = [
  {
    id: 'rule-1',
    learnedFrom: 'Sarah Jenkins Meeting Booking',
    category: 'drafting_angle',
    description: "Referencing 'SDR sales-assist expansion' increased positive reply rates by 42% over generic 'SDR productivity' hooks.",
    confidence: 0.94,
    dateLearned: 'Yesterday',
    sourceEvent: 'Booked Meeting'
  },
  {
    id: 'rule-2',
    learnedFrom: 'David Miller Security Objection',
    category: 'objection_rebuttal',
    description: "Proactively including 'SOC2 Type II verified + Zero Data Retention' in tech-infrastructure sequences reduces security objections by 60%.",
    confidence: 0.91,
    dateLearned: 'Today',
    sourceEvent: 'Objection Handled'
  },
  {
    id: 'rule-3',
    learnedFrom: 'Operator Edit on Touch 2 Subject',
    category: 'hook_pattern',
    description: "Operator changed subject line to include prospect company name and specific tech stack ('Retool + Segment triage') — adopted as template pattern.",
    confidence: 0.88,
    dateLearned: '2 days ago',
    sourceEvent: 'Human Edit'
  }
];

export const INITIAL_ROUTINES: RoutineItem[] = [
  {
    id: 'routine-1',
    name: 'Claims Gate Signal Harvester',
    schedule: 'Continuous Background • 14 Signals',
    signalsCount: 14,
    active: true,
    category: 'sync'
  },
  {
    id: 'routine-2',
    name: '2-Hour SLA Reply Guardian',
    schedule: 'Mon-Fri 08:00–18:00 EST',
    active: true,
    category: 'triage'
  },
  {
    id: 'routine-3',
    name: 'Morning Pipeline Briefing',
    schedule: 'Daily @ 08:00 EST',
    active: true,
    category: 'briefing'
  },
  {
    id: 'routine-4',
    name: 'Outbound Slow Ramp Warmup',
    schedule: 'Auto-capped at 80/day',
    active: true,
    category: 'outbound'
  }
];

export const INITIAL_INTEGRATIONS: Integration[] = [
  {
    id: 'int-gmail',
    name: 'Gmail (Customer Mailbox Sending)',
    icon: 'mail',
    category: 'Communication',
    status: 'Connected',
    lastSync: '12s ago',
    recordsSynced: 'alex@omni-sdr.io (gmail.send scope)',
    description: 'Native customer mailbox sending via gmail.send. Zero read scopes required.',
    complianceNote: 'Avoids CASA tier 2/3 audit; non-sensitive profile'
  },
  {
    id: 'int-cloudflare-email',
    name: 'Cloudflare Email Routing (reply.omnisdr.com)',
    icon: 'mail',
    category: 'Communication',
    status: 'Connected',
    lastSync: 'Realtime',
    recordsSynced: 'Inbound Reply-To active',
    description: 'Inbound prospect replies route through reply.omnisdr.com directly to Unified Multichannel Inbox.',
    complianceNote: 'Zero Gmail mailbox read permission needed'
  },
  {
    id: 'int-google-cal',
    name: 'Google Calendar (3-Slot Availability)',
    icon: 'calendar',
    category: 'Productivity',
    status: 'Connected',
    lastSync: '2m ago',
    recordsSynced: '3 executive calendars linked',
    description: 'Native 3-slot free/busy availability picker injected into outbound objection handling.',
    complianceNote: 'Auto-holds provisional calendar slots'
  },
  {
    id: 'int-calendly-calcom',
    name: 'Calendly & Cal.com Webhooks',
    icon: 'calendar',
    category: 'Productivity',
    status: 'Connected',
    lastSync: '10m ago',
    recordsSynced: 'Ingesting meetings table',
    description: 'Webhook ingestion for instant SLA clearance and auto-canceling follow-up drip sequences.',
    complianceNote: 'Automatic suppression list enrollment'
  },
  {
    id: 'int-linkedin-unipile',
    name: 'LinkedIn Outbound (Unipile Provider)',
    icon: 'share-2',
    category: 'Communication',
    status: 'Connected',
    lastSync: '4m ago',
    recordsSynced: 'DMs, connections, & drips',
    description: 'Compliant third-party automation provider. Enforces Claims Gate and Trust Dial Level 1 on all messages.',
    complianceNote: 'Safe rate-limited drip envelopes'
  },
  {
    id: 'int-shopify',
    name: 'Shopify Admin API (GraphQL)',
    icon: 'shopping-bag',
    category: 'CRM & Data',
    status: 'Connected',
    lastSync: '1h ago',
    recordsSynced: 'Customers & orders as signals',
    description: 'Ingests high-ticket customer orders and abandoned carts as outbound triggers.',
    complianceNote: 'Read-only signals'
  },
  {
    id: 'int-ghl',
    name: 'GoHighLevel (GHL) Sub-Accounts',
    icon: 'layers',
    category: 'CRM & Data',
    status: 'Connected',
    lastSync: '15m ago',
    recordsSynced: '4 sub-account workspaces mapped',
    description: 'Multi-client workspace mapping for marketing agencies with two-way contact syncing.',
    complianceNote: 'Agency white-label enabled'
  },
  {
    id: 'int-whop',
    name: 'Whop Communities & Payments',
    icon: 'users',
    category: 'Sales Intelligence',
    status: 'Connected',
    lastSync: '30m ago',
    recordsSynced: 'Skool & Whop members ingested',
    description: 'Ingests community discussions and memberships to generate evidence-grounded outreach hooks.',
    complianceNote: 'Zero hallucinated pain points'
  }
];

export const FLEET_ANALYTICS = {
  activeAgentsCount: 9,
  totalCapacity: '94.2%',
  dailyDispatched: 342,
  weeklyGrowth: '+34.2%',
  approvalRate: '98.4%',
  averageLatencyMs: 34,
  uptimeSla: '99.98%',
  soc2Status: 'SOC2 Type II Certified',
  creditsRemaining: 4850,
  threadsHandledToday: 48,
  dailyVolumeTimeline: [
    { hour: '06:00', messages: 18, approvals: 2 },
    { hour: '08:00', messages: 64, approvals: 8 },
    { hour: '10:00', messages: 112, approvals: 14 },
    { hour: '12:00', messages: 95, approvals: 11 },
    { hour: '14:00', messages: 138, approvals: 19 },
    { hour: '16:00', messages: 88, approvals: 12 },
    { hour: '18:00', messages: 42, approvals: 5 }
  ],
  conversionByChannel: [
    { channel: 'Gmail (gmail.send)', sent: 840, opened: 680, replied: 284, rate: '33.8%' },
    { channel: 'LinkedIn (Unipile DMs)', sent: 192, opened: 186, replied: 142, rate: '74.0%' },
    { channel: 'Native Calendar Invites Dispatched', sent: 54, opened: 54, replied: 49, rate: '90.7%' }
  ]
};
