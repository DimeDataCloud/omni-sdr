'use client';

import { useState } from 'react';
import Link from 'next/link';
import { 
  Check, 
  X, 
  ExternalLink, 
  Mail, 
  MessageSquare, 
  ShieldCheck, 
  AlertCircle, 
  Sparkles, 
  ChevronRight, 
  Building2, 
  MapPin, 
  Send,
  Eye
} from 'lucide-react';
import { useOmniSdrStore } from '@/lib/store';
import { ChannelType } from '@/types';

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 8.76a1.45 1.45 0 0 0 1.45-1.45 1.45 1.45 0 0 0-1.45-1.45 1.45 1.45 0 0 0-1.45 1.45c0 .8.65 1.45 1.45 1.45m1.37 9.74v-8.37H5.09v8.37h2.74Z"/>
    </svg>
  );
}

export function SwipeCardQueue() {
  const { pendingLeads, approveLead, rejectLead } = useOmniSdrStore();
  const [selectedChannel, setSelectedChannel] = useState<ChannelType>('email');
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  if (pendingLeads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-800 bg-zinc-950/60 p-12 text-center backdrop-blur-md">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-xl shadow-emerald-500/10">
          <Check className="h-8 w-8" />
        </div>
        <h3 className="mt-4 text-xl font-bold text-white">All Caught Up!</h3>
        <p className="mt-1 text-sm text-zinc-400 max-w-md">
          Zero leads awaiting approval. The Trust Dial will continue monitoring Google Places and Skool communities for new dated pain triggers.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            href="/prospects"
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all"
          >
            Mine More Leads
          </Link>
          <Link
            href="/audit/stone-timber-commercial-roofing"
            className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition-all"
          >
            Preview Sample Audit
          </Link>
        </div>
      </div>
    );
  }

  const currentLead = pendingLeads[0];
  const primaryEvidence = currentLead.evidenceAnchors[0];
  const activeDraft = currentLead.outreachDrafts.find(d => d.channel === selectedChannel) || currentLead.outreachDrafts[0];

  const handleApprove = () => {
    approveLead(currentLead.id);
  };

  const handleReject = () => {
    rejectLead(currentLead.id);
  };

  return (
    <div className="relative mx-auto max-w-3xl">
      {/* Background Deck Card Simulation (Stacked Depth) */}
      {pendingLeads.length > 1 && (
        <div className="absolute inset-x-4 -bottom-3 h-full rounded-3xl border border-zinc-800/40 bg-zinc-900/30 backdrop-blur-sm -z-10 transform scale-[0.98]" />
      )}
      {pendingLeads.length > 2 && (
        <div className="absolute inset-x-8 -bottom-6 h-full rounded-3xl border border-zinc-800/20 bg-zinc-900/10 backdrop-blur-sm -z-20 transform scale-[0.96]" />
      )}

      {/* Main Active Card */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 sm:p-8 shadow-2xl backdrop-blur-xl ring-1 ring-white/5">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white font-bold text-lg shadow-md shadow-indigo-500/20 ring-1 ring-white/20">
              {currentLead.businessName.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">{currentLead.businessName}</h3>
                <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300 border border-zinc-700">
                  {currentLead.niche}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-zinc-500" />
                  {currentLead.location}
                </span>
                {currentLead.decisionMakerName && (
                  <span className="flex items-center gap-1 font-medium text-zinc-300">
                    <Building2 className="h-3.5 w-3.5 text-zinc-500" />
                    {currentLead.decisionMakerName} ({currentLead.decisionMakerRole})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-400">
              Queue: <span className="text-indigo-400">{pendingLeads.length}</span> remaining
            </span>
          </div>
        </div>

        {/* Verified Evidence Box (The Claims-Gate Anchor) */}
        {primaryEvidence && (
          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  Verified Pain Signal #{primaryEvidence.id}
                </span>
              </div>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                Bleeding ~${primaryEvidence.estimatedMonthlyBleed?.toLocaleString()}/mo
              </span>
            </div>

            <h4 className="mt-2 text-sm font-semibold text-white">
              {primaryEvidence.title}
            </h4>

            <p className="mt-1 text-xs italic text-zinc-300 border-l-2 border-amber-500/50 pl-2.5 py-0.5 my-2 bg-black/30 rounded-r">
              &quot;{primaryEvidence.snippet}&quot;
            </p>

            <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
              <span className="flex items-center gap-1">
                Detected: {primaryEvidence.detectedAt} · Confidence: {Math.round(primaryEvidence.confidenceScore * 100)}%
              </span>
              <a
                href={primaryEvidence.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                <span>View Raw Evidence</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}

        {/* Multi-Channel Outreach Draft Preview */}
        <div className="mt-6">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedChannel('email')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  selectedChannel === 'email'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <Mail className="h-3.5 w-3.5" />
                <span>Cold Email</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedChannel('sms')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  selectedChannel === 'sms'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>SMS Follow-up</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedChannel('linkedin')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  selectedChannel === 'linkedin'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <LinkedinIcon className="h-3.5 w-3.5" />
                <span>LinkedIn Touch</span>
              </button>
            </div>

            {/* Claims Verification Stamp */}
            <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Claims Verified</span>
            </div>
          </div>

          {/* Generated Message Content */}
          <div className="mt-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 p-4">
            {activeDraft?.subject && (
              <div className="mb-3 border-b border-zinc-800/80 pb-2.5">
                <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block">Subject</span>
                <p className="text-sm font-semibold text-white mt-0.5">{activeDraft.subject}</p>
              </div>
            )}

            <div>
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block">Message Body</span>
              <p className="mt-1 text-sm text-zinc-200 leading-relaxed whitespace-pre-line">
                {activeDraft?.body || 'Generating tailored copy for this channel...'}
              </p>
            </div>

            {activeDraft?.callToAction && (
              <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                <span className="text-zinc-400">Call to action:</span>
                <span className="font-semibold text-indigo-300">{activeDraft.callToAction}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-zinc-800/80">
          {/* Audit Link Button */}
          {currentLead.auditSlug ? (
            <Link
              href={`/audit/${currentLead.auditSlug}`}
              target="_blank"
              className="flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-white transition-all shadow-sm"
            >
              <Eye className="h-4 w-4 text-indigo-400" />
              <span>Inspect Hosted Audit</span>
              <ChevronRight className="h-3.5 w-3.5 opacity-60" />
            </Link>
          ) : (
            <div />
          )}

          {/* Reject & Approve Buttons */}
          <div className="flex w-full sm:w-auto items-center gap-3">
            <button
              type="button"
              onClick={handleReject}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-3 text-xs font-bold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition-all"
            >
              <X className="h-4 w-4" />
              <span>Discard</span>
            </button>

            <button
              type="button"
              onClick={handleApprove}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-400 hover:to-teal-500 active:scale-95 transition-all"
            >
              <Send className="h-4 w-4" />
              <span>Approve & Dispatch</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
