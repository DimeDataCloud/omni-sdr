import React, { useState } from 'react';
import { 
  X, 
  FileText, 
  Download, 
  Printer, 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut,
  CheckCircle2
} from 'lucide-react';

interface DocumentViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  isOpen,
  onClose
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = 12;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-2xl max-w-4xl w-full h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Top Doc Toolbar */}
        <div className="h-14 border-b border-[#eae4d9] px-6 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-[#ba1a1a]">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-[#111111]">
                Kickoff Agenda.pdf
              </h3>
              <p className="text-[10px] font-mono text-[#6f7a6e]">
                Brightside Health Pilot Plan • v2.1 • 1.2 MB
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-[#f0eeea] px-2 py-1 rounded-lg text-xs font-mono text-[#111111]">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-0.5 hover:text-[#036d30] disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span>{currentPage} / {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-0.5 hover:text-[#036d30] disabled:opacity-40"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={() => alert("Document downloaded: Kickoff Agenda (v2.1).pdf")}
              className="p-1.5 rounded-lg text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea] transition-colors"
              title="Download PDF"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* PDF Simulated Viewer Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 flex justify-center bg-[#eae8e4]/50">
          <div className="bg-white max-w-2xl w-full p-8 md:p-12 shadow-md rounded-lg border border-[#dbdad6] space-y-6 text-[#1b1c1a]">
            {/* Header Document Page */}
            <div className="border-b-2 border-[#111111] pb-4 flex justify-between items-start">
              <div>
                <span className="text-[10px] font-mono text-[#6f7a6e] tracking-widest uppercase">
                  ENTERPRISE PILOT PROPOSAL & ROLLOUT SPECIFICATION
                </span>
                <h1 className="text-xl font-bold text-[#111111] mt-1">
                  Brightside Health — Autonomous Fleet Integration
                </h1>
                <p className="text-xs text-[#6f7a6e] mt-0.5">
                  Prepared by Acme Growth Labs & Chief of Staff Station
                </p>
              </div>
              <span className="px-2 py-1 bg-[#a3ffb1] text-[#00210a] text-[10px] font-mono font-bold rounded">
                VERSION 2.1 CONFIRMED
              </span>
            </div>

            {/* Document Content Sections */}
            <div className="space-y-4 text-xs leading-relaxed">
              <div>
                <h4 className="font-bold text-sm text-[#111111] mb-1">
                  1. Executive Summary & Success Criteria
                </h4>
                <p className="text-[#3f493f]">
                  Brightside Health requires real-time qualification and dispatching of inbound partnership leads. Goal: Reduce SDR reply latency from 4.2 hours to &lt;90 seconds while achieving 95%+ ICP accuracy across all enterprise tiers.
                </p>
              </div>

              <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-xl p-4 space-y-2">
                <h5 className="font-bold text-xs text-[#036d30] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#16a34a]" />
                  Shipped Prerequisites (Completed Last Week)
                </h5>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-[#1b1c1a] font-mono">
                  <li>Okta / SAML 2.0 Single Sign-On Verified</li>
                  <li>Slack Connect Integration active in #brightside-shared</li>
                  <li>SOC2 Type II security attestation packet verified</li>
                  <li>PG Plan & account records synced into CRM</li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-sm text-[#111111] mb-1">
                  2. Pilot Milestones & SLA Timeline
                </h4>
                <div className="border border-[#eae4d9] rounded-xl overflow-hidden font-mono text-[11px]">
                  <table className="w-full text-left">
                    <thead className="bg-[#f5f3ef] border-b border-[#eae4d9]">
                      <tr>
                        <th className="p-2 text-[#6f7a6e]">Phase</th>
                        <th className="p-2 text-[#6f7a6e]">Deliverable</th>
                        <th className="p-2 text-[#6f7a6e]">Target Date</th>
                        <th className="p-2 text-[#6f7a6e]">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eae4d9]">
                      <tr>
                        <td className="p-2 font-semibold">Phase 1</td>
                        <td className="p-2">Environment Setup & SSO</td>
                        <td className="p-2">Completed</td>
                        <td className="p-2 text-[#16a34a] font-bold">100% DONE</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-semibold">Phase 2</td>
                        <td className="p-2">Slack Dispatch Hook</td>
                        <td className="p-2">Completed</td>
                        <td className="p-2 text-[#16a34a] font-bold">LIVE</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-semibold">Phase 3</td>
                        <td className="p-2">Inbound Sequence Deployment</td>
                        <td className="p-2">This Week</td>
                        <td className="p-2 text-[#ea580c] font-bold">IN QUEUE</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-[#eae4d9] flex justify-between text-[10px] font-mono text-[#6f7a6e]">
              <span>CONFIDENTIAL — PROPRIETARY TO ACME GROWTH LABS & BRIGHTSIDE HEALTH</span>
              <span>PAGE {currentPage} OF {totalPages}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
