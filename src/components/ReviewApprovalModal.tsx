import React, { useState, useEffect } from 'react';
import { 
  X, 
  CheckCircle2, 
  Send, 
  Edit3, 
  Sparkles, 
  User, 
  Building, 
  Clock, 
  ShieldCheck, 
  ChevronRight,
  ExternalLink,
  ShieldAlert
} from 'lucide-react';
import { ApprovalItem } from '../ui-types';

interface ReviewApprovalModalProps {
  item: ApprovalItem | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onSendViaGmail?: (item: ApprovalItem) => void;
}

export const ReviewApprovalModal: React.FC<ReviewApprovalModalProps> = ({
  item,
  isOpen,
  onClose,
  onApprove,
  onReject,
  onSendViaGmail
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editedSubject, setEditedSubject] = useState('');
  const [editedBody, setEditedBody] = useState('');

  useEffect(() => {
    if (item && item.fullSequence[activeStep]) {
      setEditedSubject(item.fullSequence[activeStep].subject);
      setEditedBody(item.fullSequence[activeStep].content);
      setIsEditing(false);
    }
  }, [item, activeStep]);

  if (!isOpen || !item) return null;

  const currentStep = item.fullSequence[activeStep] || item.fullSequence[0];

  const handleApprove = () => {
    onApprove(item.id);
    onClose();
  };

  const handleReject = () => {
    onReject(item.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-14 border-b border-[#eae4d9] px-6 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ea580c] shadow-[0_0_6px_#ea580c]" />
            <h3 className="text-xs font-bold text-[#111111] uppercase tracking-wider font-mono">
              Trust Dial L1 Review: {item.recipientName}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-[#a3ffb1] text-[#00210a] border border-[#86efac]">
              {item.icpFit}% ICP FIT
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase bg-[#f0eeea] text-[#111111]">
              Channel: {item.channel}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Recipient Snapshot */}
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#0284c7] to-[#bae6fd] flex items-center justify-center text-white font-bold text-sm shadow-xs">
                {item.recipientName.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#111111]">
                  {item.recipientName}
                </h4>
                <p className="text-xs text-[#6f7a6e]">
                  {item.recipientRole} · <span className="font-semibold text-[#111111]">{item.recipientCompany}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {item.signals.map((sig, idx) => (
                <span 
                  key={idx}
                  className="px-2 py-1 rounded-lg bg-[#f5f3ef] border border-[#eae4d9] text-[11px] font-medium text-[#3f493f]"
                >
                  {sig}
                </span>
              ))}
            </div>
          </div>

          {/* Claims-Gate Evidence Anchor Box */}
          <div className="bg-[#f5fbf7] border border-[#bbf7d0] rounded-2xl p-4 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#16a34a]" />
                <span className="text-xs font-bold font-mono text-[#036d30] uppercase tracking-wider">
                  Mandatory Claims-Gate Anchor ({item.citedEvidence.sourceType.replace('_', ' ')})
                </span>
              </div>
              <span className="text-[11px] font-mono text-[#6f7a6e]">
                Confidence: {Math.round(item.citedEvidence.confidenceScore * 100)}%
              </span>
            </div>

            <div className="text-xs text-[#111111] bg-white border border-[#bbf7d0] rounded-xl p-3 leading-relaxed">
              &quot;{item.citedEvidence.snippet}&quot;
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-[#6f7a6e]">
              <span className="truncate max-w-md">Source: {item.citedEvidence.sourceUrl}</span>
              <a 
                href={item.citedEvidence.sourceUrl} 
                target="_blank" 
                rel="noreferrer" 
                className="text-[#036d30] font-semibold hover:underline flex items-center gap-1"
              >
                Inspect Signal <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Sequence Touch Steps Tabs */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#eae4d9] pb-2">
              <div className="flex items-center gap-2">
                {item.fullSequence.map((seq, idx) => (
                  <button
                    key={seq.step}
                    onClick={() => setActiveStep(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeStep === idx 
                        ? 'bg-white shadow-2xs border border-[#eae4d9] text-[#111111] font-bold' 
                        : 'text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea]'
                    }`}
                  >
                    <span>Touch {seq.step}</span>
                    <span className="text-[10px] font-mono text-[#6f7a6e] ml-1.5">
                      ({seq.delay})
                    </span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="text-xs text-[#036d30] font-semibold hover:underline flex items-center gap-1"
              >
                <Edit3 className="w-3 h-3" />
                <span>{isEditing ? 'Preview Mode' : 'Edit Copy'}</span>
              </button>
            </div>

            {/* Email Draft Box */}
            <div className="bg-white border border-[#eae4d9] rounded-2xl p-5 shadow-2xs space-y-4">
              <div className="border-b border-[#eae4d9] pb-3 space-y-1">
                <span className="text-[11px] font-mono text-[#6f7a6e] uppercase">Subject Line</span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedSubject}
                    onChange={(e) => setEditedSubject(e.target.value)}
                    className="w-full bg-[#fbf9f5] border border-[#eae4d9] rounded-lg p-2 text-xs font-mono text-[#111111] focus:outline-hidden focus:border-[#036d30]"
                  />
                ) : (
                  <div className="text-sm font-semibold font-mono text-[#111111]">
                    {editedSubject || currentStep.subject}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <span className="text-[11px] font-mono text-[#6f7a6e] uppercase">Message Content</span>
                {isEditing ? (
                  <textarea
                    rows={8}
                    value={editedBody}
                    onChange={(e) => setEditedBody(e.target.value)}
                    className="w-full bg-[#fbf9f5] border border-[#eae4d9] rounded-xl p-3 text-xs font-mono text-[#111111] focus:outline-hidden focus:border-[#036d30]"
                  />
                ) : (
                  <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-xl p-4 font-mono text-xs text-[#111111] whitespace-pre-wrap leading-relaxed">
                    {editedBody || currentStep.content}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="p-4 border-t border-[#eae4d9] bg-white flex items-center justify-between shrink-0">
          <button
            onClick={handleReject}
            className="px-4 py-2 border border-rose-200 text-[#ba1a1a] hover:bg-rose-50 rounded-xl text-xs font-semibold transition-colors"
          >
            Discard Sequence [D]
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-[#eae4d9] text-[#111111] hover:bg-[#f5f3ef] rounded-xl text-xs font-semibold transition-colors"
            >
              Skip For Now [S]
            </button>
            {item.channel === 'email' && onSendViaGmail && (
              <button
                onClick={() => {
                  onSendViaGmail(item);
                  onClose();
                }}
                className="px-4 py-2 bg-white hover:bg-[#f0eeea] border border-[#036d30] text-[#036d30] rounded-xl text-xs font-bold shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send via Gmail</span>
              </button>
            )}
            <button
              onClick={handleApprove}
              className="px-5 py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] rounded-xl text-xs font-bold shadow-2xs flex items-center gap-1.5 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4 text-[#036d30]" />
              <span>Approve & Dispatch [A]</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
