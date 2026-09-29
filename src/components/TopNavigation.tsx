import React, { useState } from 'react';
import { 
  ChevronDown, 
  MessageSquare, 
  BarChart2, 
  Layers, 
  CheckCircle2, 
  Cpu, 
  Settings, 
  Zap, 
  Share2, 
  SlidersHorizontal, 
  ShieldCheck, 
  Check,
  Building,
  UserCheck,
  Lock,
  Clock,
  ExternalLink,
  ShieldAlert,
  Sparkles
} from 'lucide-react';
import { Workspace, UserRole } from '../ui-types';


interface TopNavigationProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  approvalsCount: number;
  inboundSlaCount: number;
  credits: number;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onSelectWorkspace: (id: string) => void;
  currentRole: UserRole;
  onChangeRole: (role: UserRole) => void;
  trustDialLevel: 1 | 2;
  onToggleTrustDial: () => void;
  currentUser?: any | null;
  onOpenWorkspaceModal?: () => void;
}

export const TopNavigation: React.FC<TopNavigationProps> = ({
  currentTab,
  onTabChange,
  approvalsCount,
  inboundSlaCount,
  credits,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  currentRole,
  onChangeRole,
  trustDialLevel,
  onToggleTrustDial,
  currentUser,
  onOpenWorkspaceModal
}) => {
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [showTrustDialModal, setShowTrustDialModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const activeWs = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const roles: { role: UserRole; label: string; desc: string }[] = [
    { role: 'operator', label: 'Operator', desc: 'Campaigns, research, inbox triage' },
    { role: 'admin', label: 'Admin', desc: 'Billing, members, workspace deletion' },
    { role: 'reviewer', label: 'Reviewer', desc: 'Internal approvals & comments' },
    { role: 'client_viewer', label: 'Client Viewer', desc: 'Read-only reports & analytics' }
  ];

  return (
    <header className="h-14 border-b border-[#eae4d9] bg-[#fbf9f5]/90 backdrop-blur-md px-4 flex items-center justify-between z-30 sticky top-0">
      {/* Zone 1: Organization & Multi-Client Workspace Picker */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Workspace Dropdown */}
        <div className="relative">
          <button 
            onClick={() => setShowOrgDropdown(!showOrgDropdown)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#111111] hover:bg-[#f0eeea] transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-[#16a34a] shadow-[0_0_8px_#16a34a]" />
            <div className="text-left flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-[#6f7a6e] hidden md:inline">AGENCY /</span>
              <span className="tracking-tight font-bold">{activeWs.name}</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-[#6f7a6e]" />
          </button>

          {showOrgDropdown && (
            <div className="absolute top-full left-0 mt-1.5 w-72 bg-white border border-[#eae4d9] rounded-xl shadow-lg p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1 flex items-center justify-between text-[11px] font-semibold text-[#6f7a6e] uppercase tracking-wider border-b border-[#eae4d9]/50 mb-1">
                <span>Agency Workspaces</span>
                <span className="font-mono text-[10px] text-[#036d30] font-bold">White-Label</span>
              </div>
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    onSelectWorkspace(ws.id);
                    setShowOrgDropdown(false);
                  }}
                  className={`w-full text-left px-2.5 py-2 text-xs rounded-lg transition-colors flex items-center justify-between ${
                    ws.id === activeWorkspaceId 
                      ? 'bg-[#a3ffb1]/30 font-semibold text-[#111111]' 
                      : 'text-[#1b1c1a] hover:bg-[#f5f3ef]'
                  }`}
                >
                  <div>
                    <div className="font-medium text-[#111111]">{ws.name}</div>
                    <div className="text-[10px] font-mono text-[#6f7a6e]">{ws.customDomain}</div>
                  </div>
                  {ws.id === activeWorkspaceId && <Check className="w-3.5 h-3.5 text-[#036d30]" />}
                </button>
              ))}

              <div className="pt-1.5 mt-1 border-t border-[#eae4d9]/50">
                <button
                  onClick={() => {
                    alert("Provisioning new client workspace for Acme Growth Labs...");
                    setShowOrgDropdown(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-[#036d30] font-semibold hover:bg-[#f5f3ef] rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <span>+ Provision Client Workspace</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Trust Dial Spine Badge */}
        <button
          onClick={() => setShowTrustDialModal(true)}
          className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#eae4d9] bg-white/70 hover:bg-white text-[11px] font-mono transition-colors shadow-2xs"
          title="Click to view Trust Dial safety architecture"
        >
          <span className={`w-2 h-2 rounded-full ${trustDialLevel === 1 ? 'bg-[#16a34a]' : 'bg-[#d97706]'}`} />
          <span className="font-bold text-[#111111]">Trust Dial: L{trustDialLevel}</span>
          <span className="text-[#6f7a6e] font-sans">({trustDialLevel === 1 ? 'Human Approval' : 'Guarded'})</span>
        </button>

        {/* Role Selector Badge */}
        <div className="relative hidden xl:block">
          <button
            onClick={() => setShowRoleDropdown(!showRoleDropdown)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[#eae4d9] bg-[#f0eeea] text-[11px] font-mono text-[#111111] hover:bg-[#eae8e4] transition-colors"
          >
            <UserCheck className="w-3 h-3 text-[#036d30]" />
            <span className="capitalize font-semibold">{currentRole.replace('_', ' ')}</span>
            <ChevronDown className="w-3 h-3 text-[#6f7a6e]" />
          </button>

          {showRoleDropdown && (
            <div className="absolute top-full left-0 mt-1.5 w-60 bg-white border border-[#eae4d9] rounded-xl shadow-lg p-1.5 z-50">
              <div className="px-2 py-1 text-[10px] font-mono text-[#6f7a6e] uppercase">
                Station 01 Role Hierarchy
              </div>
              {roles.map((r) => (
                <button
                  key={r.role}
                  onClick={() => {
                    onChangeRole(r.role);
                    setShowRoleDropdown(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors flex items-center justify-between ${
                    currentRole === r.role 
                      ? 'bg-[#a3ffb1]/30 font-semibold text-[#111111]' 
                      : 'hover:bg-[#f5f3ef] text-[#111111]'
                  }`}
                >
                  <div>
                    <div className="capitalize font-bold">{r.label}</div>
                    <div className="text-[10px] text-[#6f7a6e]">{r.desc}</div>
                  </div>
                  {currentRole === r.role && <Check className="w-3.5 h-3.5 text-[#036d30]" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zone 2: Navigation Links / Tabs */}
      <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto py-1 scrollbar-none">
        <button
          onClick={() => onTabChange('chat')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            currentTab === 'chat'
              ? 'bg-white shadow-2xs border border-[#eae4d9] text-[#111111] font-semibold'
              : 'text-[#3f493f] hover:text-[#111111] hover:bg-[#f0eeea]'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Composer Home</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
        </button>

        <button
          onClick={() => onTabChange('approvals')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            currentTab === 'approvals'
              ? 'bg-white shadow-2xs border border-[#eae4d9] text-[#111111] font-semibold'
              : 'text-[#3f493f] hover:text-[#111111] hover:bg-[#f0eeea]'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Today Queue</span>
          {approvalsCount > 0 && (
            <span className="bg-[#a3ffb1] text-[#111111] text-[11px] font-bold px-1.5 py-0.2 rounded-full leading-none">
              {approvalsCount}
            </span>
          )}
          {inboundSlaCount > 0 && (
            <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold px-1.5 py-0.2 rounded-full flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" /> {inboundSlaCount} SLA
            </span>
          )}
        </button>

        <button
          onClick={() => onTabChange('analytics')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            currentTab === 'analytics'
              ? 'bg-white shadow-2xs border border-[#eae4d9] text-[#111111] font-semibold'
              : 'text-[#3f493f] hover:text-[#111111] hover:bg-[#f0eeea]'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          <span>Analytics</span>
        </button>

        <button
          onClick={() => onTabChange('studio')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            currentTab === 'studio'
              ? 'bg-white shadow-2xs border border-[#eae4d9] text-[#111111] font-semibold'
              : 'text-[#3f493f] hover:text-[#111111] hover:bg-[#f0eeea]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Studio & Learning Loop</span>
        </button>

        <button
          onClick={() => onTabChange('skills')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            currentTab === 'skills'
              ? 'bg-white shadow-2xs border border-[#eae4d9] text-[#111111] font-semibold'
              : 'text-[#3f493f] hover:text-[#111111] hover:bg-[#f0eeea]'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Connectors & MVP MCP</span>
          <span className="md:hidden">Connectors</span>
        </button>

        <button
          onClick={() => onTabChange('settings')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            currentTab === 'settings'
              ? 'bg-white shadow-2xs border border-[#eae4d9] text-[#111111] font-semibold'
              : 'text-[#3f493f] hover:text-[#111111] hover:bg-[#f0eeea]'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </button>
      </nav>

      {/* Zone 3: Credits & Actions */}
      <div className="flex items-center gap-2">
        {/* Google Workspace Button */}
        <button
          onClick={onOpenWorkspaceModal}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all ${
            currentUser
              ? 'border-[#a3ffb1] bg-[#a3ffb1]/20 hover:bg-[#a3ffb1]/30 text-[#00210a]'
              : 'border-[#eae4d9] bg-white hover:bg-[#f0eeea] text-[#111111]'
          }`}
          title="Google Workspace (Drive, Gmail, Calendar, Meet, Forms, Picker)"
        >
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          <span className="hidden sm:inline">Workspace</span>
          {currentUser && <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />}
        </button>

        <button
          onClick={() => setShowCreditModal(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#eae4d9] bg-white/70 hover:bg-white text-xs font-mono font-medium text-[#111111] shadow-2xs transition-colors"
        >
          <Zap className="w-3.5 h-3.5 text-[#d97706] fill-[#d97706]" />
          <span>{credits.toLocaleString()} CR</span>
        </button>

        <button
          onClick={handleShare}
          title="Share Omni-SDR Workspace"
          className="p-1.5 rounded-lg text-[#3f493f] hover:text-[#111111] hover:bg-[#f0eeea] transition-colors relative"
        >
          {copiedLink ? <Check className="w-4 h-4 text-[#16a34a]" /> : <Share2 className="w-4 h-4" />}
          {copiedLink && (
            <span className="absolute -bottom-7 right-0 text-[10px] bg-[#111111] text-white px-2 py-0.5 rounded shadow">
              Copied!
            </span>
          )}
        </button>

        <button
          onClick={() => onTabChange('settings')}
          title="Fleet Tuning"
          className="p-1.5 rounded-lg text-[#3f493f] hover:text-[#111111] hover:bg-[#f0eeea] transition-colors"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Trust Dial Safety Spine Modal */}
      {showTrustDialModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#eae4d9]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#036d30]" />
                <h3 className="text-sm font-bold text-[#111111]">Omni-SDR Trust Dial Architecture</h3>
              </div>
              <button 
                onClick={() => setShowTrustDialModal(false)}
                className="text-[#6f7a6e] hover:text-[#111111] text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-white border border-[#eae4d9] rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#111111]">Level 1: Human Approval (Active Default)</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#a3ffb1] text-[#00210a]">ACTIVE</span>
                </div>
                <p className="text-[#3f493f] leading-relaxed">
                  Every outbound draft (email & LinkedIn) is reviewed by a human operator or client reviewer. Claims-Gate automatically blocks any unanchored draft before it reaches the queue.
                </p>
              </div>

              <div className="p-3 bg-white border border-[#eae4d9] rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#111111]">Level 2: Guarded Autonomy</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#f0eeea] text-[#6f7a6e]">LOCKED</span>
                </div>
                <p className="text-[#3f493f] leading-relaxed">
                  Locked behind operator feature flag. Outbound sends execute automatically only when Claims Gate passes with &gt;95% confidence and ICP fit is &ge;95%.
                </p>
              </div>

              <div className="bg-[#f5f3ef] border border-[#eae4d9] rounded-xl p-3 text-[11px] font-mono text-[#6f7a6e] space-y-1">
                <div>Single Production Env: hip-well-509308-m9 (omni-sdr)</div>
                <div>Local verification: PGlite in packages/db</div>
              </div>
            </div>

            <button
              onClick={() => setShowTrustDialModal(false)}
              className="w-full py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Credits Breakdown Modal */}
      {showCreditModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#eae4d9]">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#d97706] fill-[#d97706]" />
                <h3 className="text-sm font-semibold text-[#111111]">Execution & Credit Meter</h3>
              </div>
              <button 
                onClick={() => setShowCreditModal(false)}
                className="text-[#6f7a6e] hover:text-[#111111] text-sm"
              >
                ✕
              </button>
            </div>
            
            <div className="py-4 space-y-3">
              <div className="flex justify-between items-baseline">
                <span className="text-2xl font-bold font-mono text-[#111111]">{credits.toLocaleString()} CR</span>
                <span className="text-xs text-[#16a34a] font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> High Quota
                </span>
              </div>
              <p className="text-xs text-[#3f493f] leading-relaxed">
                Cheap reversible tasks (drafting, summaries) execute instantly. Costlier bulk jobs (enrichment, diagnostic teardowns) display inline live estimates before running.
              </p>

              <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-[#6f7a6e]">
                  <span>Daily burn rate</span>
                  <span className="font-mono text-[#111111]">~140 CR / day</span>
                </div>
                <div className="flex justify-between text-[#6f7a6e]">
                  <span>7-Day Trial Status</span>
                  <span className="font-mono text-[#16a34a] font-bold">Stripe Card Captured</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowCreditModal(false)}
              className="w-full py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
