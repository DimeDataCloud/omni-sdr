import React, { useState } from 'react';
import { 
  Cpu, 
  CheckCircle2, 
  Clock, 
  ExternalLink, 
  RefreshCw, 
  ShieldCheck, 
  Plus, 
  Check, 
  Share2,
  FileSpreadsheet,
  Terminal,
  Key,
  Shield
} from 'lucide-react';
import { Integration } from '../ui-types';
import { INITIAL_INTEGRATIONS } from '../data/mockData';

interface SkillsConnectionsViewProps {
  onOpenWorkspaceModal?: () => void;
}

export const SkillsConnectionsView: React.FC<SkillsConnectionsViewProps> = ({
  onOpenWorkspaceModal
}) => {
  const [integrations, setIntegrations] = useState<Integration[]>(INITIAL_INTEGRATIONS);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [copiedMcp, setCopiedMcp] = useState(false);

  const handleTestConnection = (id: string) => {
    setTestingId(id);
    setTimeout(() => {
      setIntegrations(prev => prev.map(item => {
        if (item.id === id) {
          return {
            ...item,
            status: 'Connected',
            lastSync: 'Just now'
          };
        }
        return item;
      }));
      setTestingId(null);
    }, 900);
  };

  const handleCopyMcp = () => {
    navigator.clipboard?.writeText('https://api.omnisdr.com/mcp/v1/sse');
    setCopiedMcp(true);
    setTimeout(() => setCopiedMcp(false), 2000);
  };

  return (
    <div className="flex-1 bg-[#fbf9f5] overflow-y-auto p-6 md:p-8 space-y-6">
      <div className="border-b border-[#eae4d9] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111111] tracking-tight">
            Connectors, Skills & Two-Way MCP Endpoints
          </h1>
          <p className="text-xs text-[#6f7a6e] mt-1">
            Compliant customer mailbox dispatch via <code className="font-mono bg-[#f0eeea] px-1 rounded">gmail.send</code> and Cloudflare Email Routing (<code className="font-mono bg-[#f0eeea] px-1 rounded">reply.omnisdr.com</code>).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenWorkspaceModal && (
            <button 
              onClick={onOpenWorkspaceModal}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl shadow-2xs transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              <span>Manage Google Workspace</span>
            </button>
          )}

          <button 
            onClick={() => alert("Exporting lead telemetry & verified anchors to Google Sheets...")}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#f5f3ef] border border-[#eae4d9] text-[#111111] text-xs font-semibold rounded-xl shadow-2xs transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#036d30]" />
            <span>Export to Google Sheets</span>
          </button>

          <button 
            onClick={() => alert("Connecting new enterprise webhook...")}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl shadow-2xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Connect New Tool</span>
          </button>
        </div>
      </div>

      {/* MCP Two-Way Integration Banner */}
      <div className="bg-white border border-[#eae4d9] rounded-2xl p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-4 h-4 text-[#036d30]" />
            <h3 className="text-xs font-bold text-[#111111] font-mono uppercase tracking-wider">
              Station 20: Model Context Protocol (MCP) Two-Way Server Endpoint
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#a3ffb1] text-[#00210a]">
            ACTIVE / SSE READY
          </span>
        </div>

        <p className="text-xs text-[#3f493f] leading-relaxed">
          Connect your custom Claude desktop or external MCP client directly to Omni-SDR to query live ICP proposals, run evidence-grounded competitor teardowns, or check queue capacity.
        </p>

        <div className="flex items-center gap-3 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl p-2.5">
          <span className="text-[11px] font-mono text-[#6f7a6e]">MCP SSE Endpoint:</span>
          <code className="text-xs font-mono font-bold text-[#111111] flex-1">
            https://api.omnisdr.com/mcp/v1/sse
          </code>
          <button
            onClick={handleCopyMcp}
            className="px-3 py-1 bg-white hover:bg-[#f0eeea] border border-[#eae4d9] rounded-lg text-xs font-semibold text-[#111111] transition-colors"
          >
            {copiedMcp ? 'Copied!' : 'Copy Endpoint'}
          </button>
        </div>
      </div>

      {/* Compliance Architecture Callout */}
      <div className="bg-[#f5fbf7] border border-[#bbf7d0] rounded-2xl p-4 flex items-start gap-3 text-xs text-[#036d30]">
        <Shield className="w-5 h-5 text-[#16a34a] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="font-bold uppercase tracking-wider text-[11px]">
            Station 04 Security Architecture: Zero Restricted Read Scopes
          </h4>
          <p className="text-[#3f493f] leading-relaxed">
            By sending via customer mailbox using <code className="bg-white px-1 rounded border border-[#bbf7d0]">gmail.send</code> and routing all replies to <code className="bg-white px-1 rounded border border-[#bbf7d0]">reply.omnisdr.com</code> (Cloudflare Email Routing), Omni-SDR avoids Google CASA Tier 2/3 compliance audits while preserving full multichannel delivery.
          </p>
        </div>
      </div>

      {/* Modular Integration Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map((item) => {
          const isConnected = item.status === 'Connected';
          const isPending = item.status === 'Pending Auth';

          return (
            <div
              key={item.id}
              className="bg-white border border-[#eae4d9] rounded-2xl p-5 shadow-2xs flex flex-col justify-between space-y-4 hover:border-[#dbdad6] transition-all"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#f5f3ef] border border-[#eae4d9] flex items-center justify-center font-bold text-[#111111]">
                      {item.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-[#111111]">
                        {item.name}
                      </h3>
                      <span className="text-[11px] text-[#6f7a6e]">
                        {item.category}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-tight ${
                      isConnected
                        ? 'bg-[#dcfce7] border border-[#86efac] text-[#036d30]'
                        : isPending
                        ? 'bg-amber-100 border border-amber-300 text-amber-800'
                        : 'bg-[#f0eeea] border border-[#eae4d9] text-[#6f7a6e]'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>

                <p className="text-xs text-[#3f493f] leading-relaxed">
                  {item.description}
                </p>

                {item.complianceNote && (
                  <div className="text-[10px] font-mono text-[#036d30] bg-[#f5fbf7] p-1.5 rounded-lg border border-[#bbf7d0]">
                    ✓ {item.complianceNote}
                  </div>
                )}

                <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-xl p-2.5 font-mono text-[11px] space-y-1">
                  <div className="flex justify-between text-[#6f7a6e]">
                    <span>Last Sync:</span>
                    <span className="text-[#111111]">{item.lastSync}</span>
                  </div>
                  <div className="flex justify-between text-[#6f7a6e]">
                    <span>Sync Scope:</span>
                    <span className="text-[#111111] truncate max-w-[150px]">{item.recordsSynced}</span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-[#eae4d9] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => handleTestConnection(item.id)}
                  disabled={testingId === item.id}
                  className="px-3 py-1.5 bg-[#f5f3ef] hover:bg-[#eae8e4] text-[#111111] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${testingId === item.id ? 'animate-spin' : ''}`} />
                  <span>{testingId === item.id ? 'Testing...' : 'Test Ping'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => alert(`Configuring ${item.name}`)}
                  className="text-xs text-[#036d30] font-semibold hover:underline flex items-center gap-1"
                >
                  <span>Configure</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
