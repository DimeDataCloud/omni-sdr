import React from 'react';
import { 
  BarChart2, 
  TrendingUp, 
  Zap, 
  Clock, 
  CheckCircle2, 
  MessageSquare, 
  Send,
  Users,
  ShieldCheck,
  ArrowUpRight
} from 'lucide-react';
import { FLEET_ANALYTICS } from '../data/mockData';

export const AnalyticsView: React.FC = () => {
  return (
    <div className="flex-1 bg-[#fbf9f5] overflow-y-auto p-6 md:p-8 space-y-6">
      {/* Top Header */}
      <div className="border-b border-[#eae4d9] pb-4">
        <h1 className="text-xl font-bold text-[#111111] tracking-tight">
          Autonomous Fleet Operations & SDR Telemetry
        </h1>
        <p className="text-xs text-[#6f7a6e] mt-1">
          Real-time metrics for Acme Growth Labs Fleet 01 • SLA status: 99.98% uptime.
        </p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-[#6f7a6e] text-xs font-mono">
            <span>Daily Dispatches</span>
            <Send className="w-4 h-4 text-[#036d30]" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-[#111111]">
              {FLEET_ANALYTICS.dailyDispatched}
            </span>
            <span className="text-xs font-bold text-[#16a34a] flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" /> {FLEET_ANALYTICS.weeklyGrowth}
            </span>
          </div>
          <span className="text-[11px] text-[#6f7a6e] block">
            Across 9 active autonomous stations
          </span>
        </div>

        <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-[#6f7a6e] text-xs font-mono">
            <span>Human Approval Rate</span>
            <CheckCircle2 className="w-4 h-4 text-[#16a34a]" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-[#111111]">
              {FLEET_ANALYTICS.approvalRate}
            </span>
            <span className="text-xs font-mono text-[#6f7a6e]">
              142 approved today
            </span>
          </div>
          <span className="text-[11px] text-[#6f7a6e] block">
            Average review turnaround: 12 seconds
          </span>
        </div>

        <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-[#6f7a6e] text-xs font-mono">
            <span>Median Latency</span>
            <Clock className="w-4 h-4 text-[#0284c7]" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-[#111111]">
              {FLEET_ANALYTICS.averageLatencyMs}ms
            </span>
            <span className="text-xs font-mono text-[#16a34a]">
              P99: 82ms
            </span>
          </div>
          <span className="text-[11px] text-[#6f7a6e] block">
            Edge inference running on Gemini Flash
          </span>
        </div>

        <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-[#6f7a6e] text-xs font-mono">
            <span>Remaining Credits</span>
            <Zap className="w-4 h-4 text-[#d97706] fill-[#d97706]" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-[#111111]">
              {FLEET_ANALYTICS.creditsRemaining.toLocaleString()}
            </span>
            <span className="text-xs font-mono text-[#6f7a6e]">
              ~34 days left
            </span>
          </div>
          <span className="text-[11px] text-[#6f7a6e] block">
            High quota tier active
          </span>
        </div>
      </div>

      {/* Hourly Dispatch Volume Chart */}
      <div className="bg-white border border-[#eae4d9] rounded-2xl p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#111111]">
              Today&apos;s Dispatch Volume & Approvals
            </h3>
            <p className="text-xs text-[#6f7a6e]">
              Autonomous messages dispatched vs human approvals across operational hours
            </p>
          </div>
          <span className="text-xs font-mono text-[#036d30] font-semibold bg-[#a3ffb1]/40 px-2 py-1 rounded-lg">
            Peak: 14:00 EDT (138 actions/hr)
          </span>
        </div>

        <div className="h-48 flex items-end gap-3 pt-6 pb-2 border-b border-[#eae4d9]">
          {FLEET_ANALYTICS.dailyVolumeTimeline.map((item, idx) => {
            const heightPct = (item.messages / 150) * 100;
            return (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                <div className="w-full flex flex-col justify-end items-center h-full">
                  <span className="text-[10px] font-mono text-[#6f7a6e] opacity-0 group-hover:opacity-100 transition-opacity mb-1">
                    {item.messages} msgs
                  </span>
                  <div 
                    className="w-full max-w-[42px] bg-gradient-to-t from-[#79fd91] to-[#a3ffb1] rounded-t-lg transition-all group-hover:brightness-95 shadow-2xs"
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-[#6f7a6e]">
                  {item.hour}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Channel Performance Breakdown */}
      <div className="bg-white border border-[#eae4d9] rounded-2xl p-6 shadow-2xs space-y-4">
        <h3 className="text-sm font-bold text-[#111111]">
          Channel Reply & Conversion Performance
        </h3>

        <div className="border border-[#eae4d9] rounded-xl overflow-hidden font-mono text-xs">
          <table className="w-full text-left">
            <thead className="bg-[#f5f3ef] border-b border-[#eae4d9] text-[#6f7a6e]">
              <tr>
                <th className="p-3">Communication Channel</th>
                <th className="p-3">Dispatched</th>
                <th className="p-3">Opened / Viewed</th>
                <th className="p-3">Qualified Replies</th>
                <th className="p-3 text-right">Conversion Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eae4d9]">
              {FLEET_ANALYTICS.conversionByChannel.map((ch, idx) => (
                <tr key={idx} className="hover:bg-[#fbf9f5] transition-colors">
                  <td className="p-3 font-semibold text-[#111111]">{ch.channel}</td>
                  <td className="p-3">{ch.sent}</td>
                  <td className="p-3">{ch.opened}</td>
                  <td className="p-3 text-[#036d30] font-bold">{ch.replied}</td>
                  <td className="p-3 text-right font-bold text-[#16a34a]">{ch.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
