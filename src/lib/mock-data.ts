import { Campaign, DynamicAuditReport, InboundReplyTriage, Lead, SocialAuthorityPost } from '../types';

export const INITIAL_CAMPAIGNS: Campaign[] = [
  {
    id: 'camp-1',
    name: 'Nashville High-Ticket Commercial & Agency Outreach',
    niche: 'Commercial Roofing & B2B Contracting',
    targetLocation: 'Nashville, TN & Surrounding',
    valueProposition: 'Instant 24/7 AI-driven quote triage that captures after-hours commercial deals before competitors wake up.',
    trustDialLevel: 1, // Manual Review
    channels: ['email', 'sms', 'linkedin'],
    status: 'active',
    stats: {
      leadsScraped: 84,
      qualifiedCount: 42,
      pendingApproval: 14,
      sentCount: 28,
      openedCount: 19,
      repliedCount: 6,
      meetingsBooked: 2,
      totalPipelineValue: 36000
    },
    createdAt: '2026-09-15T10:00:00Z'
  },
  {
    id: 'camp-2',
    name: 'Skool Community & Course Creator Monetization Pipeline',
    niche: 'High-Ticket Skool Communities ($99-$500/mo)',
    targetLocation: 'Global / Remote',
    valueProposition: 'Automated member retention & churn-prevention engine with instant onboarding diagnostics.',
    trustDialLevel: 2, // Guarded Autonomy
    channels: ['email', 'linkedin'],
    status: 'active',
    stats: {
      leadsScraped: 120,
      qualifiedCount: 65,
      pendingApproval: 8,
      sentCount: 52,
      openedCount: 38,
      repliedCount: 11,
      meetingsBooked: 4,
      totalPipelineValue: 48000
    },
    createdAt: '2026-09-20T14:30:00Z'
  }
];

export const INITIAL_LEADS: Lead[] = [
  {
    id: 'lead-101',
    campaignId: 'camp-1',
    businessName: 'Stone & Timber Commercial Roofing',
    decisionMakerName: 'Marcus Vance',
    decisionMakerRole: 'Managing Principal & Founder',
    email: 'marcus@stonetimberroofing.com',
    phone: '+1 (615) 840-2918',
    websiteUrl: 'https://stonetimberroofing.com',
    location: 'Nashville, TN',
    niche: 'Commercial Roofing',
    rating: 4.6,
    reviewCount: 48,
    status: 'pending_approval',
    auditSlug: 'stone-timber-commercial-roofing',
    createdAt: '2026-09-27T08:15:00Z',
    evidenceAnchors: [
      {
        id: 'ev-1',
        type: 'google_review_unanswered',
        title: 'Unanswered 3-star review citing delayed quote',
        snippet: 'Called their emergency line on Sunday after the hail storm; didn\'t get a call back until Tuesday afternoon. Went with another commercial roofer instead.',
        sourceUrl: 'https://maps.google.com/?cid=stone-timber',
        detectedAt: '2026-09-18',
        confidenceScore: 0.98,
        severity: 'critical',
        estimatedMonthlyBleed: 8500
      },
      {
        id: 'ev-2',
        type: 'booking_flow_missing',
        title: 'No instant commercial inspection scheduling',
        snippet: 'Website "Request Inspection" button opens a static mailto: link with no calendar selection or auto-responder.',
        sourceUrl: 'https://stonetimberroofing.com/contact',
        detectedAt: '2026-09-22',
        confidenceScore: 0.94,
        severity: 'high',
        estimatedMonthlyBleed: 4000
      }
    ],
    outreachDrafts: [
      {
        channel: 'email',
        subject: 'Stone & Timber: missed hail storm inquiry',
        body: 'Hey Marcus, saw a Google review from last month where a commercial client had to wait until Tuesday afternoon for a callback after the hail storm and booked elsewhere. In commercial roofing, that after-hours lag typically leaks $8,500+ on a single bid. We put together a 2-minute diagnostic showing how to capture those weekend inquiries instantly.',
        callToAction: 'Mind if I send the audit link over?',
        citedEvidenceId: 'ev-1',
        characterCount: 384,
        confidenceScore: 0.97,
        claimsVerified: true
      },
      {
        channel: 'sms',
        body: 'Marcus, saw the Google review regarding the Tuesday callback delay on a roofing quote. Built a 2-min breakdown showing how to automate instant 24/7 quote booking.',
        callToAction: 'Reply YES if you want me to text the audit link.',
        citedEvidenceId: 'ev-1',
        characterCount: 165,
        confidenceScore: 0.96,
        claimsVerified: true
      },
      {
        channel: 'linkedin',
        body: 'Hi Marcus, great work expanding Stone & Timber in Nashville. Noticed an unanswered review citing an estimate delay after recent storms that likely cost an $8k+ project. We built a teardown showing how other Nashville contractors capture those bids in <60 seconds.',
        callToAction: 'Open to taking a look?',
        citedEvidenceId: 'ev-1',
        characterCount: 278,
        confidenceScore: 0.96,
        claimsVerified: true
      }
    ]
  },
  {
    id: 'lead-102',
    campaignId: 'camp-1',
    businessName: 'Vanguard HVAC & Facility Engineering',
    decisionMakerName: 'Derek Holbrook',
    decisionMakerRole: 'VP of Commercial Operations',
    email: 'd.holbrook@vanguardhvac.net',
    phone: '+1 (615) 912-4411',
    websiteUrl: 'https://vanguardhvac.net',
    location: 'Franklin, TN',
    niche: 'Commercial HVAC & Mechanical',
    rating: 4.8,
    reviewCount: 92,
    status: 'pending_approval',
    auditSlug: 'vanguard-hvac-facility-engineering',
    createdAt: '2026-09-27T09:30:00Z',
    evidenceAnchors: [
      {
        id: 'ev-3',
        type: 'mobile_broken',
        title: 'Mobile dispatch form breaks on iOS Safari',
        snippet: 'Viewport scaling bug hides the "Submit Emergency Dispatch" button off-screen on mobile devices, forcing phone calls to an unmonitored line.',
        sourceUrl: 'https://vanguardhvac.net/emergency',
        detectedAt: '2026-09-24',
        confidenceScore: 0.96,
        severity: 'critical',
        estimatedMonthlyBleed: 11200
      }
    ],
    outreachDrafts: [
      {
        channel: 'email',
        subject: 'Vanguard HVAC: mobile emergency dispatch button bug',
        body: 'Derek, noticed your "Emergency Dispatch" form button gets clipped off-screen on iPhone screens, preventing facility managers from submitting after-hours calls. At your contract size, even 2 dropped emergency calls a month bleeds ~$11,000 in commercial service work. Recorded a 90-second screen teardown showing the exact glitch and the immediate fix.',
        callToAction: 'Can I drop the teardown link in your inbox?',
        citedEvidenceId: 'ev-3',
        characterCount: 395,
        confidenceScore: 0.98,
        claimsVerified: true
      },
      {
        channel: 'sms',
        body: 'Derek, caught a mobile viewport bug hiding the emergency dispatch button on Vanguard\'s website. Built a 90-sec teardown showing the fix.',
        callToAction: 'Text back if you\'d like the link.',
        citedEvidenceId: 'ev-3',
        characterCount: 147,
        confidenceScore: 0.97,
        claimsVerified: true
      }
    ]
  },
  {
    id: 'lead-103',
    campaignId: 'camp-2',
    businessName: 'Synthetix AI Operator Guild',
    decisionMakerName: 'Elena Rostova',
    decisionMakerRole: 'Community Founder & Head of Operations',
    email: 'elena@synthetixguild.io',
    phone: '+1 (415) 782-9901',
    websiteUrl: 'https://skool.com/synthetix-guild',
    location: 'Austin, TX / Remote',
    niche: 'Skool Community ($199/mo)',
    status: 'approved',
    auditSlug: 'synthetix-ai-operator-guild',
    createdAt: '2026-09-26T11:00:00Z',
    evidenceAnchors: [
      {
        id: 'ev-4',
        type: 'skool_engagement_leak',
        title: 'New member drop-off within 72 hours',
        snippet: 'Skool community leaderboard shows 45 new signups last week but zero introductions or day-3 course completions for 68% of new members.',
        sourceUrl: 'https://skool.com/synthetix-guild/about',
        detectedAt: '2026-09-25',
        confidenceScore: 0.93,
        severity: 'high',
        estimatedMonthlyBleed: 5970
      }
    ],
    outreachDrafts: [
      {
        channel: 'email',
        subject: 'Synthetix Guild: day-3 member churn gap',
        body: 'Elena, saw your recent Skool growth to 300+ members—huge milestone. Noticed in the public community activity that roughly 68% of new joins last week stalled before their intro post. In a $199/mo community, day-3 silence is the #1 predictor of month-1 cancellation, leaking ~$5,900/mo. Mapped out a 3-step automated DM onboarding loop that doubles 30-day retention.',
        callToAction: 'Mind if I share the diagnostic breakdown?',
        citedEvidenceId: 'ev-4',
        characterCount: 408,
        confidenceScore: 0.95,
        claimsVerified: true
      }
    ]
  }
];

export const INITIAL_AUDITS: Record<string, DynamicAuditReport> = {
  'stone-timber-commercial-roofing': {
    id: 'audit-st-01',
    leadId: 'lead-101',
    slug: 'stone-timber-commercial-roofing',
    companyName: 'Stone & Timber Commercial Roofing',
    industry: 'Commercial Roofing & Exterior Systems',
    websiteUrl: 'https://stonetimberroofing.com',
    generatedAt: '2026-09-27T08:20:00Z',
    headline: 'High-Impact Inquiry Leak & After-Hours Capture Diagnostics',
    summary: 'A comprehensive evaluation of Stone & Timber\'s public digital intake and customer review records reveals an estimated $12,500/month ($150,000/year) in lost commercial contracts caused by response latency during peak storm events and unmonitored weekend emergency requests.',
    totalMonthlyBleed: 12500,
    totalAnnualBleed: 150000,
    healthScore: 54,
    metrics: [
      {
        label: 'Storm Inquiry Latency',
        value: '44+ Hours',
        benchmark: '< 3 Minutes',
        status: 'critical'
      },
      {
        label: 'After-Hours Capture Rate',
        value: '18%',
        benchmark: '> 85%',
        status: 'critical'
      },
      {
        label: 'Mobile Page Speed (LCP)',
        value: '3.8s',
        benchmark: '< 1.8s',
        status: 'warning'
      },
      {
        label: 'Google Review Resolution',
        value: '4 Unanswered Complaints',
        benchmark: '100% Closed Loop',
        status: 'warning'
      }
    ],
    painPoints: [
      {
        title: 'Unanswered Weekend Inquiries Following Severe Weather Events',
        evidence: 'Public Google Review: "Called their emergency line on Sunday after the hail storm; didn\'t get a call back until Tuesday afternoon. Went with another commercial roofer instead."',
        businessImpact: 'Average commercial re-roofing deal size is $15,000–$60,000. Losing even one qualified building manager to a faster respondent costs thousands in pure margin.',
        recommendedFix: 'Deploy an automated 24/7 AI Receptionist & Triage webhook to answer incoming commercial calls in <10 seconds, qualify square footage, and schedule an on-site adjuster instantly.'
      },
      {
        title: 'Friction-Heavy Online Estimate Form with No Calendar Confirmation',
        evidence: 'Website inspection button opens an unformatted mailto: link with no calendar selection or auto-responder.',
        businessImpact: '64% of commercial property owners browse on mobile. Without instant scheduling confirmation, they continue searching and contact the next competitor on Google Maps.',
        recommendedFix: 'Implement an interactive instant-booking embed with automatic SMS confirmation and pre-populated satellite roof imagery.'
      }
    ],
    beforeAfterComparison: {
      currentProcess: 'Prospect calls emergency line on weekend → Goes to generic voicemail → Operations reviews logs Tuesday morning → 70% have already contracted a competitor.',
      optimizedWithAI: 'Prospect calls → Instant AI conversational voice agent qualifies building type, square footage & urgency → Dispatches on-site inspector slot directly onto your calendar in 90 seconds.',
      timeOrMoneySaved: '$12,500/month recovered revenue + 22 staff hours saved per month'
    },
    meetingEmbedUrl: 'https://calendar.google.com'
  }
};

export const INITIAL_INBOUND_REPLIES: InboundReplyTriage[] = [
  {
    id: 'reply-1',
    leadId: 'lead-101',
    leadName: 'Marcus Vance',
    companyName: 'Stone & Timber Commercial Roofing',
    channel: 'email',
    incomingText: 'Yeah, we actually had a few people mention that hail storm review. It was brutal. Send over the teardown link—interested to see what you found.',
    sentiment: 'positive_hot',
    suggestedAction: 'Send personalized audit link with direct calendar reservation invite.',
    suggestedReplyCopy: 'Here is the customized teardown we built for Stone & Timber: https://omnisdr.com/audit/stone-timber-commercial-roofing\n\nShows the exact intake leak and the automated qualification fix. You can also pick a quick 10-minute spot on our calendar here: https://calendar.google.com. Would Wednesday at 2 PM CT work for a quick walk-through?',
    receivedAt: '2026-09-28T16:42:00Z',
    autoExecuted: false
  },
  {
    id: 'reply-2',
    leadId: 'lead-102',
    leadName: 'Derek Holbrook',
    companyName: 'Vanguard HVAC',
    channel: 'sms',
    incomingText: 'How much does this kind of setup usually cost? We already have an IT guy who manages our site.',
    sentiment: 'objection',
    suggestedAction: 'Pivot from software cost to immediate ROI: recovering 1 commercial emergency call pays for the entire year.',
    suggestedReplyCopy: 'Completely get that Derek. It\'s not an IT replacement—it\'s an intake safety net that hooks right into your existing lines. If it captures even one after-hours commercial dispatch that would\'ve dropped to a competitor, it pays for itself 10x over. Happy to run through the numbers in 5 mins if you\'re open.',
    receivedAt: '2026-09-28T17:05:00Z',
    autoExecuted: false
  }
];

export const INITIAL_SOCIAL_POSTS: SocialAuthorityPost[] = [
  {
    id: 'post-1',
    platform: 'linkedin',
    title: 'How a Top Nashville Roofer Was Leaking $150k/Year Through Simple Callback Lag',
    hook: 'We audited a commercial contractor in Tennessee with 48 5-star reviews.\n\nUnder the hood, they were losing $12,500 every single month.\n\nHere is the exact breakdown (and how to fix it in 24 hours):',
    content: `We recently ran an intake audit on a premier commercial roofing outfit.\n\nTheir reputation was solid, their crews were world-class, but their after-hours intake was broken:\n\n1. The "Tuesday Callback" Trap: Hail hit Sunday. A commercial property manager called their emergency line. The team called back Tuesday afternoon. By then, a $35k contract had already gone to a competitor.\n2. The Mailto: Button: Their "Book Inspection" button opened an empty email client instead of an instant calendar scheduler.\n3. The Cost of Inaction: Losing just ONE commercial roof repair a month equals a $150,000 annual hit to EBITDA.\n\nWhen we plugged an autonomous AI receptionist and instant SMS confirmation into their workflow, emergency response time dropped from 44 hours to 45 seconds.\n\nIn high-ticket contracting, speed to lead isn't a perk—it's the entire margin.`,
    industry: 'Commercial Contracting',
    estimatedReach: '4,200 - 10,500 impressions',
    tags: ['#B2BMarketing', '#CommercialContracting', '#AIAutomation', '#AgencyGrowth', '#SalesOps'],
    createdAt: '2026-09-28T12:00:00Z'
  },
  {
    id: 'post-2',
    platform: 'x',
    title: 'The #1 Churn Driver in $100k+ Skool Communities',
    hook: 'If a new community member doesn\'t engage by Day 3, there is an 84% chance they cancel at Day 30.\n\nHere is how we stopped the leak using automated onboarding triage 🧵👇',
    content: `Most course creators think churn is a content problem.\nIt\'s almost never a content problem.\n\nIt is an ONBOARDING LATENCY problem.\n\nWhen someone joins a paid group ($99-$500/mo):\n- Dopamine is peak at hour 0\n- By hour 48, buyer remorse creeps in if they haven\'t had a personal interaction\n- By hour 72, they are ghosting\n\nWe built an automated triage bot that analyzes new member bios, matches them with relevant peers, and drops a bespoke action plan into their DM in <15 minutes.\n\nResult: 30-day retention jumped from 61% to 88%.\n\nFix your intake before you buy more ads.`,
    industry: 'Creator Economy & Skool',
    estimatedReach: '12,000+ views',
    tags: ['#Skool', '#CommunityBuilding', '#AI', '#SaaS'],
    createdAt: '2026-09-28T14:15:00Z'
  }
];
