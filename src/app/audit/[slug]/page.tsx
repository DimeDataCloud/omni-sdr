'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { 
  ShieldAlert, 
  TrendingDown, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  ExternalLink, 
  ArrowRight, 
  Sparkles, 
  Lock, 
  AlertTriangle,
  Building2,
  DollarSign
} from 'lucide-react';
import { useOmniSdrStore } from '@/lib/store';

export default function DynamicAuditPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = use(params);
  const { audits } = useOmniSdrStore();
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState('Wednesday 2:00 PM CT');

  const audit = audits[resolvedParams.slug] || audits['stone-timber-commercial-roofing'];

  if (!audit) {
    return (
      <div className="mx-auto max-w-4xl py-20 px-4 text-center">
        <h1 className="text-2xl font-bold text-white">Diagnostic Report Not Found</h1>
        <p className="mt-2 text-zinc-400">The requested audit URL is expired or unavailable.</p>
        <Link href="/" className="mt-6 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  const availableSlots = [
    'Wednesday 2:00 PM CT',
    'Thursday 10:30 AM CT',
    'Thursday 3:00 PM CT',
    'Friday 11:00 AM CT'
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top Security Banner */}
      <div className="border-b border-indigo-500/20 bg-indigo-950/30 px-4 py-2 text-center text-xs text-indigo-300 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2">
          <Lock className="h-3.5 w-3.5 text-indigo-400" />
          <span>Confidential Operational Audit — Prepared Exclusively for the Leadership Team of <strong>{audit.companyName}</strong></span>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8 space-y-10">
        {/* Executive Header */}
        <div className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900 via-zinc-900/80 to-zinc-950 p-6 sm:p-10 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white font-extrabold text-xl shadow-lg shadow-indigo-500/30 ring-1 ring-white/20">
                {audit.companyName.charAt(0)}
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                  {audit.industry}
                </span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {audit.companyName}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Clock className="h-4 w-4 text-zinc-500" />
              <span>Audited: {new Date(audit.generatedAt).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Headline & Annual Bleed Banner */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            <div className="md:col-span-8 space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-white leading-snug">
                {audit.headline}
              </h2>
              <p className="text-sm text-zinc-300 leading-relaxed">
                {audit.summary}
              </p>
            </div>

            {/* Financial Leak Card */}
            <div className="md:col-span-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-center shadow-lg">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-300 block">
                Estimated Monthly Bleed
              </span>
              <span className="text-3xl sm:text-4xl font-black text-rose-400 mt-1 block">
                ${audit.totalMonthlyBleed.toLocaleString()}
                <span className="text-sm font-semibold text-rose-300/80">/mo</span>
              </span>
              <span className="text-xs font-medium text-rose-200/80 mt-1 block">
                ≈ ${(audit.totalAnnualBleed / 1000).toFixed(0)}k/year in uncaptured contracts
              </span>
            </div>
          </div>
        </div>

        {/* Diagnostic Metrics Matrix */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-400" />
              <span>Core Conversion Health Metrics</span>
            </h3>
            <span className="text-xs font-semibold text-zinc-400">
              Health Score: <strong className="text-amber-400">{audit.healthScore} / 100</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {audit.metrics.map((metric, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-md"
              >
                <span className="text-xs font-medium text-zinc-400 block">{metric.label}</span>
                <span className="text-xl font-bold text-white mt-2 block">{metric.value}</span>
                <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Benchmark:</span>
                  <span className="font-semibold text-emerald-400">{metric.benchmark}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detailed Pain Points & Grounded Evidence */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-400" />
            <span>Verified Intake Bottlenecks (Evidence-Backed)</span>
          </h3>

          <div className="grid grid-cols-1 gap-4">
            {audit.painPoints.map((pain, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <h4 className="text-base font-bold text-white">{pain.title}</h4>
                  <span className="rounded bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-300 shrink-0">
                    High Bleed
                  </span>
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs italic text-zinc-300">
                  <strong>Documented Evidence:</strong> &quot;{pain.evidence}&quot;
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-1">
                  <div>
                    <span className="font-bold text-zinc-400 uppercase tracking-wider block">Business Impact</span>
                    <p className="mt-0.5 text-zinc-300">{pain.businessImpact}</p>
                  </div>
                  <div>
                    <span className="font-bold text-indigo-400 uppercase tracking-wider block">Autonomous Solution</span>
                    <p className="mt-0.5 text-zinc-300">{pain.recommendedFix}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Before vs After Interactive Comparison */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 sm:p-8 backdrop-blur-xl">
          <h3 className="text-lg font-bold text-white">Before vs. After AI Operational Transformation</h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            How deploying an autonomous intake layer resolves the callback lag without increasing headcount.
          </p>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Process */}
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-400 block">
                Current Intake Workflow (Friction Points)
              </span>
              <p className="mt-2 text-xs sm:text-sm text-zinc-300 leading-relaxed">
                {audit.beforeAfterComparison.currentProcess}
              </p>
            </div>

            {/* Optimized With AI */}
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 block">
                Optimized Autonomous Flow
              </span>
              <p className="mt-2 text-xs sm:text-sm text-zinc-300 leading-relaxed">
                {audit.beforeAfterComparison.optimizedWithAI}
              </p>
              <div className="mt-4 pt-3 border-t border-emerald-500/20 text-xs font-bold text-emerald-300">
                Net Impact: {audit.beforeAfterComparison.timeOrMoneySaved}
              </div>
            </div>
          </div>
        </div>

        {/* Call to Action & Meeting Booking Embed Section */}
        <div className="rounded-3xl border border-indigo-500/40 bg-gradient-to-r from-indigo-950 via-zinc-900 to-indigo-950 p-8 text-center space-y-4 shadow-2xl">
          <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-bold text-indigo-300 border border-indigo-500/30 inline-block">
            Take Action
          </span>
          <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
            Plug the ${audit.totalMonthlyBleed.toLocaleString()}/mo Intake Leak in 7 Days
          </h3>
          <p className="text-sm text-zinc-300 max-w-xl mx-auto">
            Review the complete engineering blueprint on a 10-minute diagnostic walk-through with our systems architect. No pitch, just the technical implementation plan.
          </p>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setIsBookingModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-8 py-4 text-sm font-bold text-white shadow-xl shadow-emerald-500/30 hover:from-emerald-400 hover:to-teal-500 active:scale-95 transition-all"
            >
              <Calendar className="h-5 w-5" />
              <span>Select a 10-Min Walkthrough Slot</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Embedded Booking Modal */}
      {isBookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Confirm 10-Min Walkthrough</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsBookingModalOpen(false)}
                className="text-zinc-500 hover:text-white"
              >
                ✕
              </button>
            </div>

            {bookingConfirmed ? (
              <div className="py-8 text-center space-y-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 mx-auto">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h4 className="text-lg font-bold text-white">Calendar Invitation Confirmed!</h4>
                <p className="text-xs text-zinc-400">
                  Google Meet link has been dispatched for <strong>{selectedSlot}</strong>. Looking forward to reviewing the intake architecture.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsBookingModalOpen(false);
                    setBookingConfirmed(false);
                  }}
                  className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-300 mt-2 hover:bg-zinc-700"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-4 text-xs">
                <p className="text-zinc-400">
                  Select your preferred time slot for a private screen walk-through with our systems engineer:
                </p>

                <div className="space-y-2">
                  {availableSlots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`w-full rounded-xl p-3 text-left border transition-all ${
                        selectedSlot === slot
                          ? 'border-indigo-500 bg-indigo-950/40 text-white font-bold ring-1 ring-indigo-500/50'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsBookingModalOpen(false)}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 font-semibold text-zinc-400 hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setBookingConfirmed(true)}
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 font-bold text-white shadow-md shadow-emerald-500/30 hover:from-emerald-400 hover:to-teal-500"
                  >
                    Confirm Meeting
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
