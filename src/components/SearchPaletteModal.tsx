import React, { useState, useEffect } from 'react';
import { Search, Sparkles, CheckCircle2, ArrowRight, Bot, Command, X } from 'lucide-react';
import { Agent, ApprovalItem } from '../ui-types';

interface SearchPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: Agent[];
  onSelectAgent: (id: string) => void;
  approvals: ApprovalItem[];
  onSelectApproval: (item: ApprovalItem) => void;
}

export const SearchPaletteModal: React.FC<SearchPaletteModalProps> = ({
  isOpen,
  onClose,
  agents,
  onSelectAgent,
  approvals,
  onSelectApproval
}) => {
  const [query, setQuery] = useState('');

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 's')) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!isOpen) return null;

  const filteredAgents = agents.filter(a => 
    a.name.toLowerCase().includes(query.toLowerCase()) ||
    a.stationName.toLowerCase().includes(query.toLowerCase()) ||
    a.badge.toLowerCase().includes(query.toLowerCase())
  );

  const filteredApprovals = approvals.filter(appr => 
    appr.recipientName.toLowerCase().includes(query.toLowerCase()) ||
    appr.recipientCompany.toLowerCase().includes(query.toLowerCase()) ||
    appr.subject.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-xs flex items-start justify-center p-4 pt-20">
      <div className="bg-white border border-[#eae4d9] rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-100">
        <div className="p-3 border-b border-[#eae4d9] flex items-center gap-3">
          <Search className="w-4 h-4 text-[#6f7a6e]" />
          <input
            type="text"
            autoFocus
            placeholder="Search agents, commands, or pending approvals..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full text-xs sm:text-sm text-[#111111] placeholder-[#6f7a6e] focus:outline-hidden"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-[#6f7a6e] bg-[#f0eeea] border border-[#eae4d9] rounded">
            ESC
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-3 text-xs">
          {/* Section: Agents */}
          {filteredAgents.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] font-mono font-bold text-[#6f7a6e] uppercase tracking-wider">
                Fleet Stations ({filteredAgents.length})
              </div>
              {filteredAgents.map(agent => (
                <div
                  key={agent.id}
                  onClick={() => {
                    onSelectAgent(agent.id);
                    onClose();
                  }}
                  className="flex items-center justify-between p-2.5 hover:bg-[#fbf9f5] rounded-xl cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div 
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs"
                      style={{ backgroundColor: agent.avatarBg }}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold text-[#111111] mr-2">{agent.name}</span>
                      <span 
                        className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold"
                        style={{ backgroundColor: agent.badgeColor, color: '#111111' }}
                      >
                        {agent.badge}
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-[#6f7a6e]">{agent.threadName}</span>
                </div>
              ))}
            </div>
          )}

          {/* Section: Approvals */}
          {filteredApprovals.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] font-mono font-bold text-[#6f7a6e] uppercase tracking-wider">
                Pending Approval Sequences ({filteredApprovals.length})
              </div>
              {filteredApprovals.map(appr => (
                <div
                  key={appr.id}
                  onClick={() => {
                    onSelectApproval(appr);
                    onClose();
                  }}
                  className="flex items-center justify-between p-2.5 hover:bg-[#fbf9f5] rounded-xl cursor-pointer transition-colors"
                >
                  <div>
                    <div className="font-semibold text-[#111111]">
                      {appr.recipientName} ({appr.recipientCompany})
                    </div>
                    <div className="text-[11px] text-[#6f7a6e] font-mono truncate max-w-sm">
                      {appr.subject}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#a3ffb1] text-[#00210a]">
                    {appr.icpFit}% FIT
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
