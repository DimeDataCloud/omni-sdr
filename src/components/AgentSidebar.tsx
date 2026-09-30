import React, { useState } from 'react';
import { 
  Search, 
  Plus, 
  MoreVertical, 
  Sparkles, 
  Calendar, 
  Mail, 
  Target, 
  Users, 
  TrendingUp, 
  Headphones, 
  Receipt, 
  FileSearch,
  CheckCircle,
  ExternalLink,
  Shield,
  LogOut
} from 'lucide-react';
import { Agent } from '../ui-types';

interface AgentSidebarProps {
  agents: Agent[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  onOpenDeployModal: () => void;
  onOpenSearchPalette: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const AgentSidebar: React.FC<AgentSidebarProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onOpenDeployModal,
  onOpenSearchPalette,
  searchQuery,
  onSearchChange
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const getAgentIcon = (iconType: string) => {
    switch (iconType) {
      case 'sparkles': return <Sparkles className="w-4 h-4 text-white" />;
      case 'calendar': return <Calendar className="w-4 h-4 text-white" />;
      case 'mail': return <Mail className="w-4 h-4 text-white" />;
      case 'target': return <Target className="w-4 h-4 text-white" />;
      case 'users': return <Users className="w-4 h-4 text-white" />;
      case 'trending-up': return <TrendingUp className="w-4 h-4 text-white" />;
      case 'headphones': return <Headphones className="w-4 h-4 text-white" />;
      case 'receipt': return <Receipt className="w-4 h-4 text-white" />;
      case 'file-search': return <FileSearch className="w-4 h-4 text-white" />;
      default: return <Sparkles className="w-4 h-4 text-white" />;
    }
  };

  const filteredAgents = agents.filter(agent => 
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.stationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.badge.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.preview.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside className="w-72 lg:w-80 shrink-0 border-r border-[#eae4d9] bg-[#fbf9f5] flex flex-col h-[calc(100vh-3.5rem)] select-none">
      {/* Search Input Bar */}
      <div className="p-3 border-b border-[#eae4d9]/60">
        <div 
          onClick={onOpenSearchPalette}
          className="relative flex items-center w-full px-2.5 py-1.5 bg-white/80 hover:bg-white border border-[#eae4d9] rounded-lg shadow-2xs cursor-pointer group transition-all"
        >
          <Search className="w-3.5 h-3.5 text-[#6f7a6e] mr-2 shrink-0 group-hover:text-[#111111]" />
          <input
            type="text"
            placeholder="Filter agents, stations, skills..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-xs text-[#111111] placeholder-[#6f7a6e] focus:outline-hidden"
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-[#6f7a6e] bg-[#f0eeea] border border-[#eae4d9] rounded">
            ⌘S
          </kbd>
        </div>
      </div>

      {/* Agents Counter & Status Header */}
      <div className="px-3.5 py-2.5 flex items-center justify-between text-[11px] font-semibold text-[#6f7a6e] uppercase tracking-wider border-b border-[#eae4d9]/40">
        <span>ACTIVE Agents ({filteredAgents.length}/9)</span>
        <span className="flex items-center gap-1.5 text-[#036d30] font-bold normal-case text-xs">
          <span className="w-2 h-2 rounded-full bg-[#16a34a] shadow-[0_0_6px_#16a34a]" />
          ALL ONLINE
        </span>
      </div>

      {/* Agents Scrollable List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredAgents.map((agent) => {
          const isSelected = agent.id === selectedAgentId;
          return (
            <div
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              className={`relative flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${
                isSelected 
                  ? 'bg-white border border-[#eae4d9] shadow-xs' 
                  : 'hover:bg-white/60 border border-transparent'
              }`}
            >
              {/* Selected indicator bar */}
              {isSelected && (
                <div 
                  className="absolute left-0 top-2 bottom-2 w-1 rounded-r-md"
                  style={{ backgroundColor: agent.avatarBg }}
                />
              )}

              {/* Agent Avatar Icon */}
              <div 
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-2xs relative"
                style={{ backgroundColor: agent.avatarBg }}
              >
                {getAgentIcon(agent.iconType)}
                {/* Active pulse dot on avatar */}
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#16a34a] border-2 border-white" />
              </div>

              {/* Agent Meta & Snippet */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[#111111] truncate">
                      {agent.name}
                    </span>
                    <span 
                      className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold tracking-tight"
                      style={{ 
                        backgroundColor: agent.badgeColor,
                        color: '#111111'
                      }}
                    >
                      {agent.badge}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-[#6f7a6e]">
                    {agent.time}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs text-[#6f7a6e] truncate">
                    {agent.preview}
                  </p>
                  
                  {/* Unread count pill or dot */}
                  {agent.unreadCount && agent.unreadCount > 0 ? (
                    <span className="shrink-0 px-1.5 py-0.2 text-[10px] font-bold text-[#111111] bg-[#f0eeea] border border-[#eae4d9] rounded-md">
                      {agent.unreadCount}
                    </span>
                  ) : agent.hasUnreadDot ? (
                    <span className="w-2 h-2 rounded-full bg-[#0284c7] shrink-0" />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Action: Deploy New Agent */}
      <div className="p-3 border-t border-[#eae4d9] space-y-2">
        <button
          onClick={onOpenDeployModal}
          className="w-full flex items-center justify-between px-3 py-2 bg-white/70 hover:bg-white border border-[#eae4d9] rounded-xl text-xs font-semibold text-[#111111] shadow-2xs transition-all group"
        >
          <span className="flex items-center gap-2">
            <Plus className="w-3.5 h-3.5 text-[#036d30] group-hover:scale-110 transition-transform" />
            + Deploy New Agent
          </span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-[#6f7a6e] bg-[#f0eeea] border border-[#eae4d9] rounded">
            ⌘N
          </kbd>
        </button>

        {/* User Profile Bar */}
        <div className="relative pt-1 border-t border-[#eae4d9]/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Alex Chen Avatar */}
            <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-tr from-[#16a34a] to-[#a3ffb1] p-0.5 shrink-0 shadow-2xs">
              <div className="w-full h-full rounded-full bg-[#111111] flex items-center justify-center text-white text-xs font-bold font-mono">
                AC
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#111111] leading-tight truncate">
                Alex Chen
              </div>
              <div className="text-[11px] font-mono text-[#6f7a6e] leading-tight truncate">
                alex@omni-sdr.io
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="p-1 text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea] rounded-md transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {/* Profile Dropdown Menu */}
          {showProfileMenu && (
            <div className="absolute bottom-full right-0 mb-2 w-52 bg-white border border-[#eae4d9] rounded-xl shadow-lg p-1.5 z-50">
              <div className="px-2 py-1.5 border-b border-[#eae4d9]/60">
                <p className="text-xs font-semibold text-[#111111]">Alex Chen</p>
                <p className="text-[10px] text-[#6f7a6e] font-mono">Fleet Operator (Admin)</p>
              </div>
              <div className="py-1">
                <button 
                  onClick={() => setShowProfileMenu(false)}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-[#111111] hover:bg-[#f5f3ef] rounded-lg flex items-center gap-2"
                >
                  <Shield className="w-3.5 h-3.5 text-[#6f7a6e]" />
                  <span>SOC2 Security Profile</span>
                </button>
                <button 
                  onClick={() => setShowProfileMenu(false)}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-[#111111] hover:bg-[#f5f3ef] rounded-lg flex items-center gap-2"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-[#6f7a6e]" />
                  <span>Switch Workspace</span>
                </button>
              </div>
              <div className="pt-1 border-t border-[#eae4d9]/60">
                <button 
                  onClick={() => setShowProfileMenu(false)}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-[#ba1a1a] hover:bg-rose-50 rounded-lg flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5 text-[#ba1a1a]" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
