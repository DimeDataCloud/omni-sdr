import React from 'react';
import { 
  X, 
  Cpu, 
  Database, 
  Terminal, 
  CheckCircle2, 
  Clock, 
  ShieldCheck, 
  FileCode, 
  Activity,
  Layers
} from 'lucide-react';
import { Agent } from '../ui-types';

interface InspectStateDrawerProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
}

export const InspectStateDrawer: React.FC<InspectStateDrawerProps> = ({
  agent,
  isOpen,
  onClose
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/30 backdrop-blur-xs flex justify-end">
      <div 
        className="w-full max-w-lg bg-[#fbf9f5] border-l border-[#eae4d9] h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* Drawer Header */}
        <div className="h-14 border-b border-[#eae4d9] px-5 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-[#036d30]" />
            <h3 className="text-xs font-bold text-[#111111] uppercase tracking-wider font-mono">
              Agent State: {agent.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Runtime Overview */}
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#eae4d9]">
              <span className="font-mono text-[#6f7a6e] uppercase tracking-wider text-[10px]">Model & Engine</span>
              <span className="px-2 py-0.5 rounded-full bg-[#a3ffb1] text-[#00210a] text-[10px] font-bold font-mono">
                RUNNING
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 font-mono">
              <div>
                <span className="text-[#6f7a6e] text-[11px] block">LLM Backend</span>
                <span className="font-semibold text-[#111111]">{agent.model}</span>
              </div>
              <div>
                <span className="text-[#6f7a6e] text-[11px] block">Execution SLA</span>
                <span className="font-semibold text-[#16a34a]">34ms (P99: 82ms)</span>
              </div>
              <div>
                <span className="text-[#6f7a6e] text-[11px] block">Active Station</span>
                <span className="font-semibold text-[#111111]">{agent.stationName}</span>
              </div>
              <div>
                <span className="text-[#6f7a6e] text-[11px] block">Autonomous Threads</span>
                <span className="font-semibold text-[#111111]">{agent.activeThreads} parallel</span>
              </div>
            </div>
          </div>

          {/* Working Memory State */}
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-[#eae4d9]">
              <Database className="w-3.5 h-3.5 text-[#0284c7]" />
              <span className="font-mono font-bold text-[#111111] uppercase tracking-wider text-[11px]">
                Active Context & Memory Cache
              </span>
            </div>

            <div className="bg-[#f5f3ef] rounded-xl p-3 font-mono text-[11px] space-y-1.5 border border-[#eae4d9]">
              <div className="text-[#036d30] font-semibold">// Account: Brightside Health</div>
              <div className="text-[#111111]"><span className="text-[#6f7a6e]">target_deal_stage:</span> &quot;Enterprise Pilot Evaluation&quot;</div>
              <div className="text-[#111111]"><span className="text-[#6f7a6e]">blockers_resolved:</span> [&quot;Slack App Integration&quot;, &quot;Okta SAML SSO&quot;]</div>
              <div className="text-[#111111]"><span className="text-[#6f7a6e]">external_channel:</span> &quot;#brightside-shared&quot; (Slack Connect)</div>
              <div className="text-[#111111]"><span className="text-[#6f7a6e]">primary_contact:</span> &quot;Priya Patel (Head of BD)&quot;</div>
              <div className="text-[#111111]"><span className="text-[#6f7a6e]">last_doc_dispatched:</span> &quot;Kickoff Agenda.pdf (v2.1)&quot;</div>
            </div>
          </div>

          {/* Tool Invocations Log */}
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-[#eae4d9]">
              <Terminal className="w-3.5 h-3.5 text-[#d97706]" />
              <span className="font-mono font-bold text-[#111111] uppercase tracking-wider text-[11px]">
                Recent Tool & RPC Actions
              </span>
            </div>

            <div className="space-y-2">
              <div className="p-2.5 rounded-xl border border-[#eae4d9] bg-[#fbf9f5] space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[#036d30] font-bold">slack.postMessage</span>
                  <span className="text-[#6f7a6e]">09:42:22 EDT</span>
                </div>
                <p className="text-[11px] text-[#3f493f]">
                  Posted product update release notes to channel <code className="bg-[#e4e2de] px-1 rounded">#brightside-shared</code>.
                </p>
              </div>

              <div className="p-2.5 rounded-xl border border-[#eae4d9] bg-[#fbf9f5] space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[#036d30] font-bold">crm.syncNotes</span>
                  <span className="text-[#6f7a6e]">09:41:25 EDT</span>
                </div>
                <p className="text-[11px] text-[#3f493f]">
                  Synchronized PG plan and security clearance milestone in Salesforce account record.
                </p>
              </div>

              <div className="p-2.5 rounded-xl border border-[#eae4d9] bg-[#fbf9f5] space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[#036d30] font-bold">docs.generateAgenda</span>
                  <span className="text-[#6f7a6e]">09:41:31 EDT</span>
                </div>
                <p className="text-[11px] text-[#3f493f]">
                  Rendered PDF preview for 12-page kickoff blueprint (1.2 MB).
                </p>
              </div>
            </div>
          </div>

          {/* System Instructions Snippet */}
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-2">
            <div className="flex items-center gap-2 pb-1 text-[11px] font-bold font-mono text-[#111111] uppercase tracking-wider">
              <FileCode className="w-3.5 h-3.5 text-[#9333ea]" />
              <span>Station System Role</span>
            </div>
            <p className="text-xs text-[#3f493f] leading-relaxed">
              {agent.systemRole}
            </p>
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-[#eae4d9] bg-white flex items-center justify-between">
          <span className="text-[11px] font-mono text-[#6f7a6e] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#16a34a]" /> Guardrails Active
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#111111] text-white hover:bg-neutral-800 rounded-xl text-xs font-semibold transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
