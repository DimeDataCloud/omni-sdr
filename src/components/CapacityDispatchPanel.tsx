import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Share2, 
  SlidersHorizontal, 
  Clock, 
  Mail, 
  PauseCircle, 
  ChevronRight, 
  Check, 
  CheckCircle2, 
  Sparkles, 
  ShieldCheck, 
  Plus, 
  RefreshCw, 
  Zap, 
  ArrowRight,
  ShieldAlert,
  CalendarCheck,
  MessageSquare
} from 'lucide-react';
import { ApprovalItem, RoutineItem, InboundReply, Meeting } from '../ui-types';

interface CapacityDispatchPanelProps {
  currentApproval: ApprovalItem | null;
  onApprove: (id: string) => void;
  onOpenReviewModal: (item: ApprovalItem) => void;
  routines: RoutineItem[];
  onToggleRoutine: (id: string) => void;
  onAddNewRoutine: () => void;
  onViewAllApprovals: () => void;
  inboundReplies?: InboundReply[];
  meetings?: Meeting[];
  onHandleInboundReply?: (replyId: string) => void;
}

export const CapacityDispatchPanel: React.FC<CapacityDispatchPanelProps> = ({
  currentApproval,
  onApprove,
  onOpenReviewModal,
  routines,
  onToggleRoutine,
  onAddNewRoutine,
  onViewAllApprovals,
  inboundReplies = [],
  meetings = [],
  onHandleInboundReply
}) => {
  const [justApproved, setJustApproved] = useState(false);

  // Keyboard shortcut listener for 'A' key to approve
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }
      if ((e.key === 'a' || e.key === 'A') && currentApproval) {
        e.preventDefault();
        handleApproveClick();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentApproval]);

  const handleApproveClick = () => {
    if (!currentApproval) return;
    setJustApproved(true);
    setTimeout(() => {
      onApprove(currentApproval.id);
      setJustApproved(false);
    }, 450);
  };

  const getRoutineIcon = (category: string, paused?: boolean) => {
    if (paused) return <PauseCircle className="w-4 h-4 text-[#6f7a6e]" />;
    if (category === 'briefing') return <Clock className="w-4 h-4 text-[#16a34a]" />;
    if (category === 'triage') return <Mail className="w-4 h-4 text-[#0284c7]" />;
    return <Clock className="w-4 h-4 text-[#6f7a6e]" />;
  };

  return (
    <aside className="w-80 lg:w-96 shrink-0 border-l border-[#eae4d9] bg-[#fbf9f5] flex flex-col h-[calc(100vh-3.5rem)] select-none overflow-y-auto">
      {/* Header Bar */}
      <div className="h-14 border-b border-[#eae4d9] px-4 flex items-center justify-between bg-white/70 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#111111]" />
          <h2 className="text-xs font-bold text-[#111111] tracking-wider uppercase font-mono">
            TODAY QUEUE & CAPACITY
          </h2>
        </div>

        <div className="flex items-center gap-1">
          <button 
            title="Export Dispatch Log"
            className="p-1.5 rounded-lg text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea] transition-colors"
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button 
            title="Dispatch Settings"
            className="p-1.5 rounded-lg text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea] transition-colors"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-6 flex-1">
        {/* Card 1: PENDING APPROVAL (Trust Dial Level 1 + Claims Gate) */}
        <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-3 relative overflow-hidden transition-all">
          {justApproved && (
            <div className="absolute inset-0 bg-[#a3ffb1]/95 backdrop-blur-xs flex flex-col items-center justify-center z-20 animate-in fade-in zoom-in-95 duration-200">
              <CheckCircle2 className="w-8 h-8 text-[#036d30] mb-1 animate-bounce" />
              <span className="text-xs font-bold text-[#111111] uppercase tracking-wider">
                Sequence Dispatched!
              </span>
              <span className="text-[11px] font-mono text-[#036d30]">
                gmail.send • CLAIMS-GATE VERIFIED
              </span>
            </div>
          )}

          {currentApproval ? (
            <>
              {/* Card Meta Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#ea580c] shadow-[0_0_6px_#ea580c]" />
                  <span className="text-[11px] font-bold tracking-wider text-[#111111] uppercase font-mono">
                    TRUST DIAL L1 APPROVAL
                  </span>
                </div>

                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-[#a3ffb1] text-[#00210a] border border-[#86efac]">
                  {currentApproval.icpFit}% ICP FIT
                </span>
              </div>

              {/* Recipient Details */}
              <p className="text-xs text-[#1b1c1a] leading-relaxed">
                Draft sequence generated for{' '}
                <strong className="font-semibold text-[#111111]">
                  {currentApproval.recipientName}
                </strong>{' '}
                ({currentApproval.recipientRole}, {currentApproval.recipientCompany}).
              </p>

              {/* Claims-Gate Verification Anchor Callout */}
              <div className="bg-[#f5fbf7] border border-[#bbf7d0] rounded-xl p-2.5 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#036d30] font-bold">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#16a34a]" />
                    CLAIMS-GATE: PASSED
                  </span>
                  <span className="uppercase text-[9px] px-1.5 py-0.2 bg-white rounded border border-[#86efac]">
                    {currentApproval.citedEvidence.sourceType.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-[11px] text-[#3f493f] leading-snug line-clamp-2">
                  Anchor: &quot;{currentApproval.citedEvidence.snippet}&quot;
                </p>
              </div>

              {/* Code Box Subject preview */}
              <div className="bg-[#f5f3ef] border border-[#eae4d9] rounded-xl p-2 font-mono text-xs text-[#111111] leading-snug truncate">
                Subject: &quot;{currentApproval.subject}&quot;
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleApproveClick}
                  className="w-full py-2 bg-[#a3ffb1] hover:bg-[#79fd91] active:scale-[0.98] text-[#111111] text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                >
                  <span>Approve</span>
                  <kbd className="px-1.5 py-0.2 bg-[#111111] text-white text-[10px] font-mono rounded">
                    A
                  </kbd>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenReviewModal(currentApproval)}
                  className="w-full py-2 bg-white hover:bg-[#f5f3ef] border border-[#eae4d9] text-[#111111] text-xs font-semibold rounded-xl flex items-center justify-center gap-1 shadow-2xs transition-colors"
                >
                  <span>Review [E]</span>
                </button>
              </div>

              <div className="pt-1 text-center">
                <button
                  onClick={onViewAllApprovals}
                  className="text-[11px] text-[#166534] hover:underline font-medium inline-flex items-center gap-1"
                >
                  View all in Approvals Queue <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </>
          ) : (
            <div className="py-6 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[#16a34a] mx-auto" />
              <p className="text-xs font-bold text-[#111111]">All current drafts approved!</p>
              <p className="text-[11px] text-[#6f7a6e]">
                Autonomous SDRs will notify you when new high-intent leads enter the queue.
              </p>
            </div>
          )}
        </div>

        {/* Section 2: INBOUND REPLIES & 2-HOUR SLA GUARDIAN */}
        {inboundReplies.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-bold text-[#111111] tracking-wider uppercase font-mono flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#d97706]" />
                INBOUND 2-HR SLA QUEUE
              </h3>
              <span className="text-[10px] font-mono text-[#166534] font-bold">
                {inboundReplies.filter(r => !r.handled).length} Active
              </span>
            </div>

            <div className="space-y-2">
              {inboundReplies.filter(r => !r.handled).slice(0, 2).map((reply) => (
                <div
                  key={reply.id}
                  className="bg-white border border-[#eae4d9] rounded-xl p-3 shadow-2xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#111111]">
                      {reply.leadName} ({reply.leadCompany})
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      {reply.slaMinutesRemaining}m left
                    </span>
                  </div>

                  <p className="text-xs text-[#3f493f] line-clamp-2 leading-relaxed">
                    &quot;{reply.rawBody}&quot;
                  </p>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] font-mono uppercase text-[#036d30] font-semibold">
                      Intent: {reply.intent.replace('_', ' ')}
                    </span>
                    <button
                      onClick={() => onHandleInboundReply && onHandleInboundReply(reply.id)}
                      className="px-2.5 py-1 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-[11px] font-bold rounded-lg transition-colors"
                    >
                      3-Slot Free/Busy Hold
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 3: MEETINGS BOOKED */}
        {meetings.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-bold text-[#111111] tracking-wider uppercase font-mono flex items-center gap-1.5">
              <CalendarCheck className="w-3.5 h-3.5 text-[#16a34a]" />
              CONFIRMED MEETINGS
            </h3>

            {meetings.map((m) => (
              <div
                key={m.id}
                className="bg-white border border-[#eae4d9] rounded-xl p-2.5 text-xs flex items-center justify-between shadow-2xs"
              >
                <div>
                  <div className="font-semibold text-[#111111]">{m.leadName} · {m.leadCompany}</div>
                  <div className="text-[10px] font-mono text-[#6f7a6e]">{m.scheduledTime}</div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-[#dcfce7] text-[#036d30] border border-[#86efac]">
                  BOOKED
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Section 4: AUTONOMOUS ROUTINES */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold text-[#111111] tracking-wider uppercase font-mono">
              AUTONOMOUS ROUTINES
            </h3>
            <button
              onClick={onAddNewRoutine}
              className="text-xs font-semibold text-[#166534] hover:underline flex items-center gap-1"
            >
              + New Routine
            </button>
          </div>

          <div className="space-y-2">
            {routines.slice(0, 3).map((routine) => (
              <div
                key={routine.id}
                className="bg-white border border-[#eae4d9] rounded-xl p-3 flex items-center justify-between shadow-2xs transition-all hover:border-[#dbdad6]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-[#f5f3ef] border border-[#eae4d9] flex items-center justify-center shrink-0">
                    {getRoutineIcon(routine.category, routine.pausedByAdmin)}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-[#111111] truncate">
                      {routine.name}
                    </h4>
                    <p className="text-[11px] text-[#6f7a6e] font-mono truncate">
                      {routine.schedule}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onToggleRoutine(routine.id)}
                  className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer relative shrink-0 ${
                    routine.active ? 'bg-[#16a34a]' : 'bg-[#dbdad6]'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
                      routine.active ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Section 5: DISPATCH QUEUE */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-bold text-[#111111] uppercase tracking-wider text-[11px]">
              DISPATCH QUEUE
            </span>
            <span className="font-bold text-[#111111]">94.2%</span>
          </div>

          <div className="w-full h-2 rounded-full bg-[#eae8e4] overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-[#79fd91] to-[#a3ffb1] rounded-full transition-all duration-500 shadow-2xs"
              style={{ width: '94.2%' }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-[#6f7a6e]">
            <span>Active: 8 threads</span>
            <span>Lat: 34ms</span>
          </div>
        </div>
      </div>

      {/* Footer Status Bar */}
      <div className="p-3 border-t border-[#eae4d9] bg-white/60 flex items-center justify-between text-[11px] font-mono shrink-0">
        <div className="flex items-center gap-1.5 text-[#166534] font-medium">
          <span className="w-2 h-2 rounded-full bg-[#16a34a] shadow-[0_0_6px_#16a34a]" />
          <span>99.98% Agent Uptime SLA</span>
        </div>
        <span className="text-[#6f7a6e] font-semibold">SOC2 Type II</span>
      </div>
    </aside>
  );
};
