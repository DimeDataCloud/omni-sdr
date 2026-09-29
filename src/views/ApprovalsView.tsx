import React, { useState } from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  Edit3, 
  ExternalLink, 
  Filter, 
  CheckCheck,
  Send,
  Sparkles,
  Search,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Mail,
  Share2,
  Calendar
} from 'lucide-react';
import { ApprovalItem, InboundReply } from '../ui-types';

interface ApprovalsViewProps {
  approvals: ApprovalItem[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onOpenReview: (item: ApprovalItem) => void;
  onApproveAll: () => void;
  inboundReplies?: InboundReply[];
  onHandleInboundReply?: (replyId: string) => void;
}

export const ApprovalsView: React.FC<ApprovalsViewProps> = ({
  approvals,
  onApprove,
  onReject,
  onOpenReview,
  onApproveAll,
  inboundReplies = [],
  onHandleInboundReply
}) => {
  const [filterMinScore, setFilterMinScore] = useState<number>(0);
  const [filterChannel, setFilterChannel] = useState<'all' | 'email' | 'linkedin'>('all');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'approvals' | 'inbound'>('approvals');

  const filteredApprovals = approvals.filter(item => {
    const matchesScore = item.icpFit >= filterMinScore;
    const matchesChannel = filterChannel === 'all' || item.channel === filterChannel;
    const matchesSearch = 
      item.recipientName.toLowerCase().includes(search.toLowerCase()) ||
      item.recipientCompany.toLowerCase().includes(search.toLowerCase()) ||
      item.subject.toLowerCase().includes(search.toLowerCase());
    return matchesScore && matchesChannel && matchesSearch;
  });

  return (
    <div className="flex-1 bg-[#fbf9f5] overflow-y-auto p-6 md:p-8 space-y-6">
      {/* Top Banner & Batch Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#eae4d9] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#111111] tracking-tight">
              Today Queue: Trust Dial Level 1 Approvals
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-[#a3ffb1] text-[#00210a] border border-[#86efac]">
              {approvals.length} DRAFTS PENDING
            </span>
          </div>
          <p className="text-xs text-[#6f7a6e] mt-1">
            Claims-Gate Pre-Send Verification enforced. Every outbound message must cite a verified Evidence Anchor. Shortcuts: <kbd className="px-1 bg-[#f0eeea] border border-[#eae4d9] rounded font-mono">A</kbd> Approve, <kbd className="px-1 bg-[#f0eeea] border border-[#eae4d9] rounded font-mono">E</kbd> Edit, <kbd className="px-1 bg-[#f0eeea] border border-[#eae4d9] rounded font-mono">D</kbd> Discard.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onApproveAll}
            disabled={approvals.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-[#a3ffb1] hover:bg-[#79fd91] disabled:opacity-50 text-[#111111] text-xs font-bold rounded-xl shadow-2xs transition-colors cursor-pointer"
          >
            <CheckCheck className="w-4 h-4 text-[#036d30]" />
            <span>Approve All 90%+ ICP ({approvals.filter(a => a.icpFit >= 90).length})</span>
          </button>
        </div>
      </div>

      {/* Mode Switcher: Outbound Approvals vs Inbound 2-Hour SLA */}
      <div className="flex items-center gap-2 border-b border-[#eae4d9] pb-2">
        <button
          onClick={() => setActiveTab('approvals')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'approvals' 
              ? 'bg-white border border-[#eae4d9] text-[#111111] shadow-2xs' 
              : 'text-[#6f7a6e] hover:text-[#111111]'
          }`}
        >
          <Mail className="w-4 h-4 text-[#036d30]" />
          <span>Outbound Message Drafts ({approvals.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('inbound')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'inbound' 
              ? 'bg-white border border-[#eae4d9] text-[#111111] shadow-2xs' 
              : 'text-[#6f7a6e] hover:text-[#111111]'
          }`}
        >
          <Clock className="w-4 h-4 text-[#d97706]" />
          <span>Inbound Replies (2-Hour SLA Queue)</span>
          {inboundReplies.filter(r => !r.handled).length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
              {inboundReplies.filter(r => !r.handled).length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'inbound' ? (
        /* Inbound Replies View */
        <div className="space-y-3">
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-950 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#d97706]" />
              <span className="font-semibold">Station 13 & 20 SLA Policy:</span>
              <span>2 business hours default response SLA for meeting requests. Escalates from in-app to push and email.</span>
            </div>
            <span className="font-mono text-[11px] font-bold text-[#d97706]">
              Cloudflare Email Routing (reply.omnisdr.com)
            </span>
          </div>

          {inboundReplies.map((reply) => (
            <div
              key={reply.id}
              className="bg-white border border-[#eae4d9] rounded-2xl p-5 shadow-2xs space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#f0eeea] border border-[#eae4d9] flex items-center justify-center font-bold text-xs text-[#111111]">
                    {reply.leadName.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#111111]">
                      {reply.leadName} ({reply.leadCompany})
                    </h3>
                    <div className="flex items-center gap-2 text-[11px] text-[#6f7a6e] font-mono">
                      <span>Channel: {reply.channel}</span>
                      <span>•</span>
                      <span className="uppercase text-[#036d30] font-bold">Intent: {reply.intent.replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    {reply.slaMinutesRemaining} mins remaining on 2h SLA
                  </span>
                  <button
                    onClick={() => onHandleInboundReply && onHandleInboundReply(reply.id)}
                    className="px-3.5 py-1.5 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-2xs"
                  >
                    <Calendar className="w-3.5 h-3.5 text-[#036d30]" />
                    <span>Inject 3-Slot Free/Busy Hold</span>
                  </button>
                </div>
              </div>

              <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-xl p-3 text-xs text-[#111111] leading-relaxed">
                &quot;{reply.rawBody}&quot;
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Outbound Approvals List */
        <>
          {/* Filter and Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#6f7a6e]" />
                <input
                  type="text"
                  placeholder="Search leads, companies..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-white border border-[#eae4d9] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#111111] placeholder-[#6f7a6e] focus:outline-hidden focus:border-[#036d30]"
                />
              </div>

              {/* Channel filter */}
              <div className="flex items-center gap-1 bg-white border border-[#eae4d9] rounded-xl p-1 text-xs">
                {(['all', 'email', 'linkedin'] as const).map(ch => (
                  <button
                    key={ch}
                    onClick={() => setFilterChannel(ch)}
                    className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                      filterChannel === ch ? 'bg-[#a3ffb1] font-bold text-[#111111]' : 'text-[#6f7a6e] hover:text-[#111111]'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>

              {/* Min ICP filter */}
              <div className="flex items-center gap-1 bg-white border border-[#eae4d9] rounded-xl p-1 text-xs">
                <span className="px-2 text-[11px] text-[#6f7a6e] font-mono">Min ICP:</span>
                {[0, 85, 90, 95].map(score => (
                  <button
                    key={score}
                    onClick={() => setFilterMinScore(score)}
                    className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${
                      filterMinScore === score ? 'bg-[#a3ffb1] font-bold text-[#111111]' : 'text-[#6f7a6e] hover:text-[#111111]'
                    }`}
                  >
                    {score === 0 ? 'All' : `${score}%+`}
                  </button>
                ))}
              </div>
            </div>

            <span className="text-xs font-mono text-[#6f7a6e]">
              Showing {filteredApprovals.length} of {approvals.length} drafts
            </span>
          </div>

          {/* Approvals List */}
          <div className="space-y-3">
            {filteredApprovals.map((item) => (
              <div
                key={item.id}
                className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs hover:shadow-xs transition-all space-y-3"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2 border-b border-[#eae4d9]/70">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#0284c7] to-[#bae6fd] flex items-center justify-center text-white font-bold text-xs shadow-2xs">
                      {item.recipientName.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[#111111]">
                          {item.recipientName}
                        </h3>
                        <span className="text-xs text-[#6f7a6e]">
                          {item.recipientRole} at <strong className="text-[#111111]">{item.recipientCompany}</strong>
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold uppercase bg-[#f0eeea] text-[#111111]">
                          {item.channel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono text-[#6f7a6e]">
                        <span>Agent: {item.agentName}</span>
                        <span>•</span>
                        <span>Model: Gemini {item.modelTier}</span>
                        <span>•</span>
                        <span>{item.timestamp}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold font-mono bg-[#a3ffb1] text-[#00210a] border border-[#86efac]">
                      {item.icpFit}% ICP FIT
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onOpenReview(item)}
                        className="px-3 py-1.5 bg-white hover:bg-[#f5f3ef] border border-[#eae4d9] text-[#111111] rounded-xl text-xs font-semibold transition-colors flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#6f7a6e]" />
                        <span>Review [E]</span>
                      </button>
                      <button
                        onClick={() => onApprove(item.id)}
                        className="px-4 py-1.5 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] rounded-xl text-xs font-bold transition-colors flex items-center gap-1 shadow-2xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#036d30]" />
                        <span>Approve [A]</span>
                      </button>
                      <button
                        onClick={() => onReject(item.id)}
                        className="p-1.5 border border-rose-200 text-[#ba1a1a] hover:bg-rose-50 rounded-xl transition-colors"
                        title="Discard"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Claims-Gate Evidence Anchor Callout */}
                <div className="bg-[#f5fbf7] border border-[#bbf7d0] rounded-xl p-3 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="font-bold text-[#166534] flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#16a34a]" />
                      CLAIMS-GATE VERIFIED: {item.citedEvidence.title || item.citedEvidence.sourceType.replace('_', ' ').toUpperCase()}
                    </span>
                    <span className="text-[#6f7a6e]">{Math.round(item.citedEvidence.confidenceScore * 100)}% Confidence</span>
                  </div>
                  <p className="text-xs text-[#3f493f] leading-relaxed">
                    &quot;{item.citedEvidence.snippet}&quot;
                  </p>
                </div>

                {/* Email Subject & Snippet */}
                <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-xl p-3 font-mono text-xs text-[#111111] space-y-1">
                  <div className="font-semibold text-[#111111]">
                    Subject: &quot;{item.subject}&quot;
                  </div>
                  <p className="text-[#3f493f] line-clamp-2">
                    {item.bodyPreview}
                  </p>
                </div>
              </div>
            ))}

            {filteredApprovals.length === 0 && (
              <div className="bg-white border border-[#eae4d9] rounded-2xl p-12 text-center space-y-3">
                <CheckCircle2 className="w-10 h-10 text-[#16a34a] mx-auto" />
                <h3 className="text-sm font-bold text-[#111111]">Queue is clear!</h3>
                <p className="text-xs text-[#6f7a6e]">
                  No pending draft sequences match the selected filters.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
