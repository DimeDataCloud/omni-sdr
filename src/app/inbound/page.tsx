'use client';

import { useState } from 'react';
import { 
  MessageSquare, 
  Sparkles, 
  Send, 
  CheckCircle2, 
  Clock, 
  ShieldAlert, 
  Calendar,
  AlertCircle
} from 'lucide-react';
import { useOmniSdrStore } from '@/lib/store';

export default function InboundTriagePage() {
  const { inboundReplies, handleExecuteReply } = useOmniSdrStore();
  const [activeTab, setActiveTab] = useState<'all' | 'positive_hot' | 'objection'>('all');

  const filtered = inboundReplies.filter(r => activeTab === 'all' || r.sentiment === activeTab);

  const getSentimentBadge = (sentiment: string) => {
    switch (sentiment) {
      case 'positive_hot':
        return <span className="rounded bg-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-300 border border-emerald-500/30">Hot: Meeting Requested 🔥</span>;
      case 'objection':
        return <span className="rounded bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-300 border border-amber-500/30">Objection: Price / Scope</span>;
      case 'out_of_office':
        return <span className="rounded bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-400">Out of Office</span>;
      default:
        return <span className="rounded bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">{sentiment}</span>;
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Sub-Minute Response Engine
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
            Inbound Reply Triage & Objection Closer
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Automated reply categorization and objection handling powered by Google Gemini 2.5 Flash.
          </p>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            All Replies ({inboundReplies.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('positive_hot')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'positive_hot' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Hot Leads
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('objection')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'objection' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Objections
          </button>
        </div>
      </div>

      {/* Reply Cards */}
      <div className="space-y-6">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">{item.leadName}</h3>
                  <span className="text-xs text-zinc-400">· {item.companyName}</span>
                </div>
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider">
                  Channel: {item.channel.toUpperCase()} · Received {new Date(item.receivedAt).toLocaleTimeString()}
                </span>
              </div>
              {getSentimentBadge(item.sentiment)}
            </div>

            {/* Inbound Message */}
            <div>
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Prospect&apos;s Message
              </span>
              <div className="rounded-2xl border border-zinc-800 bg-black/50 p-4 text-xs italic text-zinc-200">
                &quot;{item.incomingText}&quot;
              </div>
            </div>

            {/* AI Diagnosis & Suggested Reply */}
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                  Gemini Recommended Objection Rebuttal / Action
                </span>
                <span className="text-[11px] text-zinc-400">
                  {item.suggestedAction}
                </span>
              </div>

              <div className="rounded-xl bg-zinc-900/80 border border-zinc-800/80 p-4 text-xs text-zinc-200 whitespace-pre-line leading-relaxed">
                {item.suggestedReplyCopy}
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-end gap-3 pt-2">
              {item.autoExecuted ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Reply Dispatched Automatically</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleExecuteReply(item.id)}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-400 hover:to-teal-500 active:scale-95 transition-all"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Dispatch Suggested Reply</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
