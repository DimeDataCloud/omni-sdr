'use client';

import { useState, useEffect } from 'react';
import { Campaign, DynamicAuditReport, InboundReplyTriage, Lead, SocialAuthorityPost, TrustDialLevel } from '../types';
import { INITIAL_CAMPAIGNS, INITIAL_LEADS, INITIAL_AUDITS, INITIAL_INBOUND_REPLIES, INITIAL_SOCIAL_POSTS } from './mock-data';
import { generateAuditReport, generateOutreachCopy, generateSocialAuthorityPost, triageInboundReply } from './gemini';

const STORAGE_KEYS = {
  LEADS: 'omni_sdr_leads',
  CAMPAIGNS: 'omni_sdr_campaigns',
  AUDITS: 'omni_sdr_audits',
  REPLIES: 'omni_sdr_replies',
  SOCIAL_POSTS: 'omni_sdr_social_posts',
  TRUST_DIAL: 'omni_sdr_trust_dial',
};

export function useOmniSdrStore() {
  const [leads, setLeads] = useState<Lead[]>(INITIAL_LEADS);
  const [campaigns, setCampaigns] = useState<Campaign[]>(INITIAL_CAMPAIGNS);
  const [audits, setAudits] = useState<Record<string, DynamicAuditReport>>(INITIAL_AUDITS);
  const [inboundReplies, setInboundReplies] = useState<InboundReplyTriage[]>(INITIAL_INBOUND_REPLIES);
  const [socialPosts, setSocialPosts] = useState<SocialAuthorityPost[]>(INITIAL_SOCIAL_POSTS);
  const [activeCampaignId, setActiveCampaignId] = useState<string>(INITIAL_CAMPAIGNS[0].id);
  const [trustDial, setTrustDialState] = useState<TrustDialLevel>(1);
  const [isGenerating, setIsGenerating] = useState(false);

  // Load from local storage on mount if available
  useEffect(() => {
    try {
      const savedLeads = localStorage.getItem(STORAGE_KEYS.LEADS);
      if (savedLeads) setLeads(JSON.parse(savedLeads));

      const savedCampaigns = localStorage.getItem(STORAGE_KEYS.CAMPAIGNS);
      if (savedCampaigns) setCampaigns(JSON.parse(savedCampaigns));

      const savedAudits = localStorage.getItem(STORAGE_KEYS.AUDITS);
      if (savedAudits) setAudits(JSON.parse(savedAudits));

      const savedDial = localStorage.getItem(STORAGE_KEYS.TRUST_DIAL);
      if (savedDial) setTrustDialState(Number(savedDial) as TrustDialLevel);
    } catch {
      // Fallback to initial if localStorage parsing fails
    }
  }, []);

  const saveLeads = (newLeads: Lead[]) => {
    setLeads(newLeads);
    try {
      localStorage.setItem(STORAGE_KEYS.LEADS, JSON.stringify(newLeads));
    } catch (e) {
      console.error(e);
    }
  };

  const setTrustDial = (level: TrustDialLevel) => {
    setTrustDialState(level);
    try {
      localStorage.setItem(STORAGE_KEYS.TRUST_DIAL, String(level));
    } catch (e) {
      console.error(e);
    }
  };

  const approveLead = async (leadId: string) => {
    const updated = leads.map(l => {
      if (l.id === leadId) {
        return { ...l, status: 'approved' as const, lastTouchAt: new Date().toISOString() };
      }
      return l;
    });
    saveLeads(updated);
  };

  const rejectLead = (leadId: string) => {
    const updated = leads.map(l => {
      if (l.id === leadId) {
        return { ...l, status: 'rejected' as const };
      }
      return l;
    });
    saveLeads(updated);
  };

  const addNewLead = async (leadInput: Partial<Lead>) => {
    setIsGenerating(true);
    const newId = `lead-${Date.now()}`;
    const slug = (leadInput.businessName || 'new-prospect')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const completeLead: Lead = {
      id: newId,
      campaignId: activeCampaignId,
      businessName: leadInput.businessName || 'Acme Agency',
      decisionMakerName: leadInput.decisionMakerName || 'Alex Mercer',
      decisionMakerRole: leadInput.decisionMakerRole || 'Founder & CEO',
      email: leadInput.email || 'alex@acme.agency',
      phone: leadInput.phone || '+1 (555) 019-2831',
      websiteUrl: leadInput.websiteUrl || 'https://acme.agency',
      location: leadInput.location || 'Austin, TX',
      niche: leadInput.niche || 'B2B Creative Agency',
      rating: leadInput.rating || 4.7,
      reviewCount: leadInput.reviewCount || 34,
      status: 'pending_approval',
      auditSlug: slug,
      createdAt: new Date().toISOString(),
      evidenceAnchors: leadInput.evidenceAnchors || [
        {
          id: `ev-${Date.now()}`,
          type: 'booking_flow_missing',
          title: 'Missing instant qualification booking portal',
          snippet: 'Contact form routes to generic info@ email with no instant calendar or SMS confirmation.',
          sourceUrl: leadInput.websiteUrl || 'https://acme.agency',
          detectedAt: new Date().toISOString().split('T')[0],
          confidenceScore: 0.95,
          severity: 'high',
          estimatedMonthlyBleed: 5200
        }
      ],
      outreachDrafts: []
    };

    // Generate copy and audit report via Gemini
    try {
      const activeCampaign = campaigns.find(c => c.id === activeCampaignId);
      const drafts = await generateOutreachCopy(
        completeLead,
        activeCampaign?.valueProposition || 'Automated high-ticket client triage'
      );
      completeLead.outreachDrafts = drafts;

      const audit = await generateAuditReport(completeLead);
      setAudits(prev => {
        const next = { ...prev, [slug]: audit };
        try {
          localStorage.setItem(STORAGE_KEYS.AUDITS, JSON.stringify(next));
        } catch (e) {
          console.error(e);
        }
        return next;
      });
    } catch (err) {
      console.error('Error auto-generating assets:', err);
    } finally {
      saveLeads([completeLead, ...leads]);
      setIsGenerating(false);
    }
  };

  const createSocialPostFromAudit = async (slug: string) => {
    const audit = audits[slug];
    if (!audit) return null;
    setIsGenerating(true);
    try {
      const newPost = await generateSocialAuthorityPost(audit);
      setSocialPosts(prev => [newPost, ...prev]);
      return newPost;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecuteReply = (replyId: string) => {
    setInboundReplies(prev =>
      prev.map(r => (r.id === replyId ? { ...r, autoExecuted: true } : r))
    );
  };

  const activeCampaign = campaigns.find(c => c.id === activeCampaignId) || campaigns[0];

  const pendingLeads = leads.filter(l => l.status === 'pending_approval');
  const approvedLeads = leads.filter(l => l.status === 'approved' || l.status === 'active_sequence');

  return {
    leads,
    campaigns,
    activeCampaign,
    setActiveCampaignId,
    audits,
    inboundReplies,
    socialPosts,
    trustDial,
    setTrustDial,
    pendingLeads,
    approvedLeads,
    approveLead,
    rejectLead,
    addNewLead,
    createSocialPostFromAudit,
    handleExecuteReply,
    isGenerating,
  };
}
