'use client';

import Link from 'next/link';
import { 
  Sparkles, 
  ArrowUpRight, 
  Send, 
  Calendar, 
  MessageSquare, 
  Share2, 
  ShieldCheck, 
  Search, 
  Flame,
  Zap,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { KPICards } from '@/components/KPICards';
import { TrustDialSwitch } from '@/components/TrustDialSwitch';
import { SwipeCardQueue } from '@/components/SwipeCardQueue';
import { useOmniSdrStore } from '@/lib/store';

export default function CommandCenter() {
  const { campaigns, inboundReplies, socialPosts, pendingLeads, approvedLeads } = useOmniSdrStore();

  const hotReplies = inboundReplies.filter(r => r.sentiment === 'positive_hot');

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Hero Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-3xl border border-zinc-800 bg-gradient-to-r from-zinc-900 via-indigo-950/30 to-zinc-900 p-6 sm:p-8 backdrop-blur-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Autonomous Pipeline Active
            </span>
          </div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Agency SDR Command Center
          </h1>
          <p className="mt-1 text-sm text-zinc-400 max-w-2xl">
            Google-native outbound system. Mining dated customer pain from Google Places & Skool, verifying claims, hosting dynamic audits, and closing sales meetings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/prospects"
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all active:scale-95"
          >
            <Search className="h-4 w-4" />
            <span>Launch Prospect Miner</span>
          </Link>
          <Link
            href="/approval-queue"
            className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-all"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>Approval Queue ({pendingLeads.length})</span>
          </Link>
        </div>
      </div>

      {/* KPI Overview Metrics */}
      <KPICards />

      {/* The Trust Dial Autonomy Controller */}
      <TrustDialSwitch />

      {/* Main Two-Column Workflow Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Interactive 1-Click Approval Queue (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-indigo-400" />
              <h2 className="text-base font-bold text-white">Review & Dispatch Deck</h2>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 border border-zinc-700">
                {pendingLeads.length} leads
              </span>
            </div>
            <Link
              href="/approval-queue"
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <span>Full Screen Queue</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <SwipeCardQueue />
        </div>

        {/* Right Column: Inbound Triage, Campaigns & Inbound Content (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Hot Inbound Replies Card */}
          <div className="rounded-2xl border border-emerald-500/30 bg-zinc-900/60 p-5 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                <h3 className="text-sm font-bold text-white">Hot Inbound Responses</h3>
              </div>
              <Link href="/inbound" className="text-xs text-indigo-400 hover:text-indigo-300">
                View All ({inboundReplies.length})
              </Link>
            </div>

            <div className="mt-3 divide-y divide-zinc-800/60">
              {hotReplies.map((reply) => (
                <div key={reply.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-200">{reply.leadName}</span>
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      Meeting Intent
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">{reply.companyName}</p>
                  <p className="mt-1.5 text-xs italic text-zinc-300 bg-black/40 p-2 rounded-lg border border-zinc-800">
                    &quot;{reply.incomingText}&quot;
                  </p>
                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Received today
                    </span>
                    <Link
                      href="/inbound"
                      className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 transition-colors"
                    >
                      Handle Reply
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Campaigns Tracker */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Active Campaigns</h3>
              </div>
              <span className="text-xs text-zinc-500">{campaigns.length} running</span>
            </div>

            <div className="mt-3 space-y-3">
              {campaigns.map((camp) => (
                <div
                  key={camp.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3.5 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-white">{camp.name}</h4>
                    <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">{camp.niche} · {camp.targetLocation}</p>

                  <div className="mt-3 grid grid-cols-4 gap-2 text-center border-t border-zinc-850 pt-2 text-[11px]">
                    <div>
                      <span className="text-zinc-500 block">Leads</span>
                      <span className="font-bold text-zinc-200">{camp.stats.leadsScraped}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Sent</span>
                      <span className="font-bold text-zinc-200">{camp.stats.sentCount}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Replies</span>
                      <span className="font-bold text-indigo-400">{camp.stats.repliedCount}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Booked</span>
                      <span className="font-bold text-emerald-400">{camp.stats.meetingsBooked}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Authority Inbound Flywheel Teaser */}
          <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 to-zinc-900/60 p-5 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Social Authority Engine</h3>
              </div>
              <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
                Inbound Flywheel
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
              Auto-generate viral LinkedIn carousels and X threads from your live client teardowns.
            </p>
            <div className="mt-3">
              <Link
                href="/social-engine"
                className="flex items-center justify-center gap-1.5 w-full rounded-xl bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                <span>View Generated Authority Posts ({socialPosts.length})</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
