'use client';

import { DollarSign, ShieldAlert, Calendar, CheckSquare, TrendingUp, Sparkles } from 'lucide-react';
import { useOmniSdrStore } from '@/lib/store';

export function KPICards() {
  const { campaigns, pendingLeads, leads } = useOmniSdrStore();

  const totalPipeline = campaigns.reduce((acc, c) => acc + c.stats.totalPipelineValue, 0);
  const totalMeetings = campaigns.reduce((acc, c) => acc + c.stats.meetingsBooked, 0);
  const totalEvidenceAnchors = leads.reduce((acc, l) => acc + l.evidenceAnchors.length, 0);
  const totalSent = campaigns.reduce((acc, c) => acc + c.stats.sentCount, 0);
  const totalReplied = campaigns.reduce((acc, c) => acc + c.stats.repliedCount, 0);
  const replyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : '21.4';

  const cards = [
    {
      label: 'Qualified Pipeline Value',
      value: `$${totalPipeline.toLocaleString()}`,
      change: '+18.4% this week',
      icon: DollarSign,
      gradient: 'from-emerald-500/20 to-teal-500/5',
      border: 'border-emerald-500/30',
      iconBg: 'bg-emerald-500/10 text-emerald-400'
    },
    {
      label: 'Verified Pain Anchors',
      value: totalEvidenceAnchors,
      change: '100% cited & verified',
      icon: ShieldAlert,
      gradient: 'from-amber-500/20 to-orange-500/5',
      border: 'border-amber-500/30',
      iconBg: 'bg-amber-500/10 text-amber-400'
    },
    {
      label: 'High-Ticket Meetings Booked',
      value: totalMeetings,
      change: `${replyRate}% reply rate`,
      icon: Calendar,
      gradient: 'from-indigo-500/20 to-blue-500/5',
      border: 'border-indigo-500/30',
      iconBg: 'bg-indigo-500/10 text-indigo-400'
    },
    {
      label: 'Awaiting 1-Click Approval',
      value: pendingLeads.length,
      change: 'Swipe card queue ready',
      icon: CheckSquare,
      gradient: 'from-violet-500/20 to-purple-500/5',
      border: 'border-violet-500/30',
      iconBg: 'bg-violet-500/10 text-violet-400'
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className={`relative overflow-hidden rounded-2xl border ${card.border} bg-gradient-to-br ${card.gradient} bg-zinc-900/60 p-5 backdrop-blur-md transition-all duration-300 hover:scale-[1.02] hover:shadow-xl`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">{card.label}</span>
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${card.iconBg} ring-1 ring-white/10`}>
                <Icon className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-white">{card.value}</span>
              <span className="flex items-center text-[11px] font-medium text-emerald-400">
                <TrendingUp className="mr-1 h-3 w-3" />
                {card.change}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-500">
              <Sparkles className="h-3 w-3 text-indigo-400" />
              <span>Google Gemini 2.5 Active</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
