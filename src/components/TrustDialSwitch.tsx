'use client';

import { Shield, ShieldAlert, Zap, AlertTriangle, CheckCircle } from 'lucide-react';
import { useOmniSdrStore } from '@/lib/store';
import { TrustDialLevel } from '@/types';

export function TrustDialSwitch() {
  const { trustDial, setTrustDial } = useOmniSdrStore();

  const tiers: { level: TrustDialLevel; title: string; subtitle: string; icon: typeof Shield }[] = [
    {
      level: 1,
      title: 'L1: Manual Swipe Review',
      subtitle: 'Human-in-the-loop. Every initial message queues for 1-click review on web/mobile.',
      icon: Shield
    },
    {
      level: 2,
      title: 'L2: Guarded Autonomy',
      subtitle: 'Auto-sends high confidence leads (>90%) with verified evidence under rate caps (30/day).',
      icon: Zap
    },
    {
      level: 3,
      title: 'L3: Full Autonomy',
      subtitle: 'Unattended 24/7 autonomous mining, copy generation, and execution. Pauses on anomalies.',
      icon: ShieldAlert
    }
  ];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-white">The Trust Dial</h3>
            <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-300 border border-indigo-500/30">
              Agency Safety Matrix
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Calibrate autonomy levels across your outbound channels. Code-enforced claims verification applies across all tiers.
          </p>
        </div>

        {/* Safety Badges */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] text-emerald-400 font-medium">
            <CheckCircle className="h-3 w-3 text-emerald-400" />
            <span>Claims-Gate Active</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700/60 px-2.5 py-1 text-[11px] text-zinc-300 font-medium">
            <span>Rate Cap: 30 sends/day/inbox</span>
          </div>
        </div>
      </div>

      {/* Tier Selection Grid */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {tiers.map((tier) => {
          const isSelected = trustDial === tier.level;
          const Icon = tier.icon;
          return (
            <button
              key={tier.level}
              type="button"
              onClick={() => setTrustDial(tier.level)}
              className={`group relative flex flex-col items-start rounded-xl p-4 text-left transition-all duration-200 border ${
                isSelected
                  ? 'border-indigo-500/80 bg-indigo-950/20 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/50'
                  : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-900/60'
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    isSelected ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : 'bg-zinc-800 text-zinc-400 group-hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                {isSelected && (
                  <span className="flex h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/80 animate-pulse" />
                )}
              </div>

              <div className="mt-3">
                <h4 className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                  {tier.title}
                </h4>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                  {tier.subtitle}
                </p>
              </div>

              {isSelected && (
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-indigo-500 to-transparent" />
              )}
            </button>
          );
        })}
      </div>

      {trustDial === 3 && (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            <strong>Full Autonomy Notice:</strong> Gemini will dispatch verified outreach automatically during recipient business hours. Circuit breakers will pause execution if bounce rate exceeds 2% or reply sentiment turns negative.
          </span>
        </div>
      )}
    </div>
  );
}
