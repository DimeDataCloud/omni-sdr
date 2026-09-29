'use client';

import { SwipeCardQueue } from '@/components/SwipeCardQueue';
import { TrustDialSwitch } from '@/components/TrustDialSwitch';
import { useOmniSdrStore } from '@/lib/store';
import { ShieldCheck, CheckCheck, Sparkles, Filter } from 'lucide-react';

export default function ApprovalQueuePage() {
  const { pendingLeads, approveLead } = useOmniSdrStore();

  const handleBatchApproveAll = () => {
    pendingLeads.forEach(l => approveLead(l.id));
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Claims-Gate Verified Review
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
            Outreach Approval Queue
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Review and dispatch individualized, evidence-grounded copy across Email, SMS, and LinkedIn.
          </p>
        </div>

        {pendingLeads.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBatchApproveAll}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 hover:from-emerald-500 hover:to-teal-500 active:scale-95 transition-all"
            >
              <CheckCheck className="h-4 w-4" />
              <span>1-Click Approve All ({pendingLeads.length})</span>
            </button>
          </div>
        )}
      </div>

      {/* Trust Dial Context */}
      <TrustDialSwitch />

      {/* Main Review Card Deck */}
      <div className="pt-4">
        <SwipeCardQueue />
      </div>
    </div>
  );
}
