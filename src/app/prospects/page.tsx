'use client';

import { useState } from 'react';
import Link from 'next/link';
import { 
  Search, 
  Plus, 
  MapPin, 
  Globe, 
  ExternalLink, 
  ShieldAlert, 
  CheckCircle, 
  Clock, 
  Sparkles, 
  Filter, 
  Upload, 
  Building2, 
  Eye, 
  Send
} from 'lucide-react';
import { useOmniSdrStore } from '@/lib/store';
import { LeadStatus } from '@/types';

export default function ProspectsPage() {
  const { leads, addNewLead, isGenerating, approveLead } = useOmniSdrStore();
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMiningModalOpen, setIsMiningModalOpen] = useState(false);

  // Form states for manual or simulated scrape
  const [mineSource, setMineSource] = useState<'google_places' | 'skool' | 'website'>('google_places');
  const [businessName, setBusinessName] = useState('');
  const [niche, setNiche] = useState('Commercial Contracting');
  const [location, setLocation] = useState('Nashville, TN');
  const [websiteUrl, setWebsiteUrl] = useState('https://');
  const [decisionMaker, setDecisionMaker] = useState('');

  const filteredLeads = leads.filter((lead) => {
    const matchesFilter = filterStatus === 'all' || lead.status === filterStatus;
    const matchesSearch = 
      lead.businessName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.niche.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.location.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleSimulateMine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName) return;

    await addNewLead({
      businessName,
      niche,
      location,
      websiteUrl: websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
      decisionMakerName: decisionMaker || 'Managing Partner',
      decisionMakerRole: 'Founder & CEO',
      evidenceAnchors: [
        {
          id: `ev-mined-${Date.now()}`,
          type: 'google_review_unanswered',
          title: '3-star review citing delayed quote turnaround',
          snippet: `Client called ${businessName} for a project estimate and was told they would receive a proposal in 24 hours, but had to wait 5 days.`,
          sourceUrl: `https://maps.google.com/?q=${encodeURIComponent(businessName)}`,
          detectedAt: new Date().toISOString().split('T')[0],
          confidenceScore: 0.96,
          severity: 'high',
          estimatedMonthlyBleed: 6500
        }
      ]
    });

    setIsMiningModalOpen(false);
    setBusinessName('');
  };

  const getStatusBadge = (status: LeadStatus) => {
    switch (status) {
      case 'pending_approval':
        return <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/20">Pending Approval</span>;
      case 'approved':
        return <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">Approved / Ready</span>;
      case 'active_sequence':
        return <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-xs font-semibold text-indigo-400 border border-indigo-500/20">In Sequence</span>;
      case 'meeting_booked':
        return <span className="rounded bg-teal-500/10 px-2 py-0.5 text-xs font-semibold text-teal-300 border border-teal-500/20">Meeting Booked 🎉</span>;
      case 'rejected':
        return <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-zinc-400 border border-zinc-700">Discarded</span>;
      default:
        return <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-zinc-300">{status}</span>;
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
            Prospect & Pain Intelligence
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Hybrid automated scrapers for Google Places, Skool communities, and website teardowns.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsMiningModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 active:scale-95 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Mine New Prospects</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search company, niche, or city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/80 pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
          <Filter className="h-4 w-4 text-zinc-500 shrink-0" />
          {['all', 'pending_approval', 'approved', 'active_sequence'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilterStatus(st)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize whitespace-nowrap transition-all ${
                filterStatus === st
                  ? 'bg-zinc-800 text-white font-semibold shadow-sm ring-1 ring-zinc-700'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              {st.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Prospect List / Table */}
      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-md">
        <div className="divide-y divide-zinc-800/70">
          {filteredLeads.map((lead) => {
            const primaryEv = lead.evidenceAnchors[0];
            return (
              <div
                key={lead.id}
                className="p-5 sm:p-6 transition-colors hover:bg-zinc-850/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                {/* Company & Contact Info */}
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-white">{lead.businessName}</h3>
                    {getStatusBadge(lead.status)}
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                      {lead.niche}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-zinc-500" />
                      {lead.location}
                    </span>
                    {lead.decisionMakerName && (
                      <span className="flex items-center gap-1 text-zinc-300 font-medium">
                        <Building2 className="h-3.5 w-3.5 text-zinc-500" />
                        {lead.decisionMakerName} ({lead.decisionMakerRole})
                      </span>
                    )}
                    <a
                      href={lead.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-indigo-400 hover:underline"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      <span>Website</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  {/* Evidence Anchor Snippet */}
                  {primaryEv && (
                    <div className="mt-2 rounded-xl bg-black/40 border border-zinc-800 p-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                          <ShieldAlert className="h-3 w-3" />
                          {primaryEv.title}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          Bleed: ~${primaryEv.estimatedMonthlyBleed?.toLocaleString()}/mo
                        </span>
                      </div>
                      <p className="text-zinc-300 text-[11px] mt-1 line-clamp-1 italic">
                        &quot;{primaryEv.snippet}&quot;
                      </p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2.5 shrink-0">
                  {lead.auditSlug && (
                    <Link
                      href={`/audit/${lead.auditSlug}`}
                      target="_blank"
                      className="flex items-center gap-1 rounded-xl bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Inspect Audit</span>
                    </Link>
                  )}

                  {lead.status === 'pending_approval' && (
                    <button
                      type="button"
                      onClick={() => approveLead(lead.id)}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 shadow-sm shadow-emerald-600/30 transition-all active:scale-95"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Approve</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mining Modal */}
      {isMiningModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-400" />
                <h3 className="text-lg font-bold text-white">Mine New High-Ticket Prospect</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsMiningModalOpen(false)}
                className="text-zinc-500 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSimulateMine} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Intelligence Sourcing Channel</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setMineSource('google_places')}
                    className={`rounded-lg py-2 font-medium border text-center transition-all ${
                      mineSource === 'google_places'
                        ? 'border-indigo-500 bg-indigo-950/40 text-white font-bold'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Google Places
                  </button>
                  <button
                    type="button"
                    onClick={() => setMineSource('skool')}
                    className={`rounded-lg py-2 font-medium border text-center transition-all ${
                      mineSource === 'skool'
                        ? 'border-indigo-500 bg-indigo-950/40 text-white font-bold'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Skool Group
                  </button>
                  <button
                    type="button"
                    onClick={() => setMineSource('website')}
                    className={`rounded-lg py-2 font-medium border text-center transition-all ${
                      mineSource === 'website'
                        ? 'border-indigo-500 bg-indigo-950/40 text-white font-bold'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Website Teardown
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Business or Organization Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Mechanical Systems"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-zinc-300 mb-1">Niche / Category</label>
                  <input
                    type="text"
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-zinc-300 mb-1">Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Website URL</label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Key Decision Maker (Optional)</label>
                <input
                  type="text"
                  value={decisionMaker}
                  onChange={(e) => setDecisionMaker(e.target.value)}
                  placeholder="e.g. Jason Myers (Founder)"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsMiningModalOpen(false)}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 font-semibold text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 font-bold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/30 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>{isGenerating ? 'Gemini Mining...' : 'Run Diagnostics & Generate'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
