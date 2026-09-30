import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  Terminal, 
  FileText, 
  ArrowUp, 
  Mic, 
  MicOff, 
  Plus, 
  ExternalLink, 
  Layers, 
  PanelRightClose, 
  PanelRightOpen,
  CheckCircle2,
  Calendar,
  Send,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Clock,
  Compass,
  ChevronDown
} from 'lucide-react';
import { Agent, ChatMessage, ModelTier } from '../ui-types';

interface ChatWorkspaceProps {
  agent: Agent;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onOpenInspectState: () => void;
  onOpenDocViewer: () => void;
  isRightPanelOpen: boolean;
  onToggleRightPanel: () => void;
  onTriggerQuickPrompt: (prompt: string) => void;
  onNavigateToApprovals: () => void;
  onOpenWorkspaceModal?: () => void;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  agent,
  messages,
  onSendMessage,
  onOpenInspectState,
  onOpenDocViewer,
  isRightPanelOpen,
  onToggleRightPanel,
  onTriggerQuickPrompt,
  onNavigateToApprovals,
  onOpenWorkspaceModal
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [activeModelTier, setActiveModelTier] = useState<ModelTier>(agent.modelTier || 'Flash');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const proactiveActions = [
    { label: 'Review 4 draft approvals', action: onNavigateToApprovals, badge: 'Trust Dial L1' },
    { label: 'Audit Skool community signals for Brightside', prompt: 'Audit Skool community signals for Brightside Health and extract verified pain points.' },
    { label: 'Run website diagnostic teardown on Retool', prompt: 'Run automated website speed & broken flow teardown on retool.com for Evidence Anchor extraction.' },
    { label: 'Inject 3-slot native calendar availability', prompt: 'Generate 3-slot free/busy Google Calendar availability for Thursday afternoon.' }
  ];

  const quickPrompts = [
    '/hunt-contacts',
    '/schedule-sync',
    '/audit-pipeline',
    '/slack-blast',
    '/generate-sequence'
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAgentTyping]);

  // Compute live estimate based on input length and model tier
  const getLiveEstimate = () => {
    if (!inputValue.trim()) return null;
    const lower = inputValue.toLowerCase();
    if (lower.includes('research') || lower.includes('audit') || lower.includes('teardown') || activeModelTier === 'Pro') {
      return { credits: 4, time: '~80ms', label: 'Pro Precision Task' };
    }
    if (activeModelTier === 'Flash-Lite' || lower.includes('label') || lower.includes('triage')) {
      return { credits: 1, time: '~18ms', label: 'Flash-Lite Triage' };
    }
    return { credits: 2, time: '~35ms', label: 'Flash Workhorse' };
  };

  const liveEstimate = getLiveEstimate();

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim()) return;

    const userText = inputValue;
    setInputValue('');
    onSendMessage(userText);

    setIsAgentTyping(true);
    setTimeout(() => {
      setIsAgentTyping(false);
    }, 1200);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleMic = () => {
    if (!isRecording) {
      setIsRecording(true);
      setTimeout(() => {
        setInputValue((prev) => (prev ? prev + ' ' : '') + 'Sync all CRM updates to the Brightside Health Slack account notes.');
        setIsRecording(false);
      }, 2200);
    } else {
      setIsRecording(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col h-[calc(100vh-3.5rem)] bg-[#fbf9f5] relative overflow-hidden">
      {/* Top Station Header */}
      <div className="h-14 border-b border-[#eae4d9] px-5 flex items-center justify-between bg-white/70 backdrop-blur-md shrink-0 z-10">
        <div className="flex items-center gap-3">
          {/* Station Icon */}
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-2xs"
            style={{ backgroundColor: agent.avatarBg }}
          >
            <Sparkles className="w-4 h-4" />
          </div>

          <div className="flex items-center gap-2.5">
            <h1 className="text-xs font-bold text-[#111111] tracking-wider uppercase font-mono">
              STATION: {agent.stationName}
            </h1>

            {agent.autonomousMode && (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-[#a3ffb1] text-[#111111] border border-[#86efac] shadow-2xs">
                AUTONOMOUS DISPATCH
              </span>
            )}

            {/* Model Tier Selector */}
            <div className="relative">
              <button
                onClick={() => setShowModelMenu(!showModelMenu)}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#eae4d9] bg-[#f0eeea] hover:bg-[#eae8e4] text-[10px] font-mono font-bold text-[#111111] transition-colors"
              >
                <span>Gemini {activeModelTier}</span>
                <ChevronDown className="w-3 h-3 text-[#6f7a6e]" />
              </button>

              {showModelMenu && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-[#eae4d9] rounded-xl shadow-lg p-1.5 z-50 animate-in fade-in duration-100">
                  <div className="px-2 py-1 text-[10px] font-mono text-[#6f7a6e] uppercase">
                    Gemini Model Routing Tier
                  </div>
                  <button
                    onClick={() => { setActiveModelTier('Flash-Lite'); setShowModelMenu(false); }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${activeModelTier === 'Flash-Lite' ? 'bg-[#a3ffb1]/40 font-bold' : 'hover:bg-[#f5f3ef]'}`}
                  >
                    <div className="font-semibold text-[#111111]">Flash-Lite (1 CR)</div>
                    <div className="text-[10px] text-[#6f7a6e]">Triage, routing, & labels</div>
                  </button>
                  <button
                    onClick={() => { setActiveModelTier('Flash'); setShowModelMenu(false); }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${activeModelTier === 'Flash' ? 'bg-[#a3ffb1]/40 font-bold' : 'hover:bg-[#f5f3ef]'}`}
                  >
                    <div className="font-semibold text-[#111111]">Flash Workhorse (2 CR)</div>
                    <div className="text-[10px] text-[#6f7a6e]">Personalized drafts & DMs</div>
                  </button>
                  <button
                    onClick={() => { setActiveModelTier('Pro'); setShowModelMenu(false); }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${activeModelTier === 'Pro' ? 'bg-[#a3ffb1]/40 font-bold' : 'hover:bg-[#f5f3ef]'}`}
                  >
                    <div className="font-semibold text-[#111111]">Pro Precision (4 CR)</div>
                    <div className="text-[10px] text-[#6f7a6e]">ICP proposals & battlecards</div>
                  </button>
                </div>
              )}
            </div>

            <span className="hidden md:inline-block text-xs font-mono text-[#6f7a6e]">
              {agent.threadName}
            </span>
          </div>
        </div>

        {/* Header Action Tools */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenInspectState}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#f5f3ef] border border-[#eae4d9] rounded-lg text-xs font-semibold text-[#111111] shadow-2xs transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-[#6f7a6e]" />
            <span>Inspect State</span>
          </button>

          <button
            onClick={onToggleRightPanel}
            title={isRightPanelOpen ? "Collapse Right Panel" : "Expand Right Panel"}
            className="p-1.5 rounded-lg border border-[#eae4d9] bg-white hover:bg-[#f5f3ef] text-[#6f7a6e] hover:text-[#111111] transition-colors"
          >
            {isRightPanelOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Proactive Recommended Next Actions Banner */}
      <div className="bg-[#f5f3ef]/80 border-b border-[#eae4d9] px-4 md:px-8 py-2 flex items-center gap-2 overflow-x-auto scrollbar-none shrink-0">
        <span className="text-[10px] font-mono text-[#166534] font-bold uppercase tracking-wider flex items-center gap-1 shrink-0">
          <Compass className="w-3.5 h-3.5" /> Next Actions:
        </span>
        {proactiveActions.map((item, idx) => (
          <button
            key={idx}
            onClick={() => {
              if (item.action) item.action();
              else if (item.prompt) setInputValue(item.prompt);
            }}
            className="px-2.5 py-1 bg-white hover:bg-[#fbf9f5] border border-[#eae4d9] rounded-lg text-xs font-medium text-[#111111] whitespace-nowrap shadow-2xs transition-colors flex items-center gap-1.5"
          >
            <span>{item.label}</span>
            {item.badge && (
              <span className="text-[9px] font-mono font-bold bg-[#a3ffb1] text-[#00210a] px-1 py-0.2 rounded">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Conversation Stream */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4">
        {/* Date divider pill */}
        <div className="flex justify-center my-3">
          <div className="px-4 py-1 rounded-full bg-[#f0eeea] border border-[#eae4d9] text-[11px] font-mono font-medium text-[#6f7a6e] tracking-tight shadow-2xs">
            TODAY • 9:41 AM EDT
          </div>
        </div>

        {/* Message Items */}
        {messages.map((msg) => {
          if (msg.sender === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-xl md:max-w-2xl bg-[#111111] text-white rounded-2xl rounded-tr-sm p-4 shadow-sm space-y-1">
                  <div className="flex items-center justify-between gap-4 text-[10px] font-mono text-neutral-400">
                    <span>{msg.author}</span>
                    <span>{msg.time}</span>
                  </div>
                  <p className="text-sm font-normal leading-relaxed text-neutral-100">
                    {msg.content}
                  </p>
                </div>
              </div>
            );
          }

          // Agent message card
          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-xl md:max-w-2xl space-y-3">
                {msg.content && (
                  <div className="bg-white/90 border border-[#eae4d9] rounded-2xl rounded-tl-sm p-4 shadow-2xs text-[#111111] space-y-2">
                    <p className="text-sm leading-relaxed text-[#1b1c1a]">
                      {msg.channelTag ? (
                        <>
                          Got it! Product updates shared and linked in{' '}
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#dcfce7] border border-[#86efac] text-[#036d30] font-mono text-xs font-semibold">
                            {msg.channelTag}
                          </span>{' '}
                          Slack channel.
                        </>
                      ) : (
                        msg.content
                      )}
                    </p>

                    {/* Claims-Gate Verification Badge */}
                    {msg.claimsGateStatus === 'passed' && (
                      <div className="pt-2 border-t border-[#eae4d9]/60 flex items-start gap-2 text-[11px] font-mono text-[#036d30] bg-[#f5fbf7] p-2.5 rounded-xl border border-[#bbf7d0]">
                        <ShieldCheck className="w-4 h-4 text-[#16a34a] shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold uppercase tracking-wider text-[10px]">
                            Claims Gate: Passed (Verified Evidence Anchor)
                          </div>
                          {msg.evidenceAnchorSnippet && (
                            <p className="text-[#3f493f] font-sans text-xs mt-0.5">
                              &quot;{msg.evidenceAnchorSnippet}&quot;
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Cost & Execution SLA Footnote */}
                    {(msg.creditCost || msg.executionTime) && (
                      <div className="flex items-center gap-3 text-[10px] font-mono text-[#6f7a6e] pt-1">
                        {msg.creditCost && <span>Cost: {msg.creditCost} CR</span>}
                        {msg.executionTime && <span>SLA: {msg.executionTime}</span>}
                      </div>
                    )}
                  </div>
                )}

                {/* PDF Attachment preview */}
                {msg.attachment && (
                  <div 
                    onClick={onOpenDocViewer}
                    className="bg-white hover:bg-[#faf8f5] border border-[#eae4d9] rounded-xl p-3 flex items-center justify-between cursor-pointer shadow-2xs group transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-rose-50 border border-rose-200 flex flex-col items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-[#ba1a1a]" />
                        <span className="text-[9px] font-bold font-mono text-[#ba1a1a]">PDF</span>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-[#111111] group-hover:text-[#036d30] transition-colors flex items-center gap-1.5">
                          {msg.attachment.title}
                        </h4>
                        <p className="text-[11px] font-mono text-[#6f7a6e]">
                          {msg.attachment.details}
                        </p>
                      </div>
                    </div>
                    <div className="p-1.5 rounded-lg text-[#6f7a6e] group-hover:text-[#111111] group-hover:bg-[#f0eeea] transition-colors">
                      <ExternalLink className="w-4 h-4" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Live typing indicator */}
        {isAgentTyping && (
          <div className="flex justify-start">
            <div className="bg-white/80 border border-[#eae4d9] rounded-2xl rounded-tl-sm px-4 py-3 shadow-2xs flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 text-[#036d30] animate-spin" />
              <span className="text-xs text-[#6f7a6e] font-mono">
                {agent.name} is verifying Claims Gate & executing against {activeModelTier}...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer Area */}
      <div className="p-4 md:px-8 border-t border-[#eae4d9] bg-[#fbf9f5]/90 backdrop-blur-md shrink-0 space-y-2.5">
        {/* Quick Prompts Row */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-[11px] font-medium text-[#6f7a6e] shrink-0">
            Quick Prompts:
          </span>
          {quickPrompts.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => setInputValue(prompt + ' ')}
              className="px-2.5 py-1 bg-white hover:bg-[#f0eeea] border border-[#eae4d9] rounded-lg text-xs font-mono text-[#111111] whitespace-nowrap shadow-2xs transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Command Input Box */}
        <div className="bg-white border border-[#eae4d9] rounded-2xl shadow-xs p-2 focus-within:border-[#036d30] focus-within:ring-2 focus-within:ring-[#a3ffb1]/40 transition-all">
          <div className="flex items-center gap-2 px-2">
            <button
              type="button"
              onClick={onOpenWorkspaceModal}
              title="Attach from Google Drive or Picker"
              className="p-1 text-[#036d30] bg-[#a3ffb1]/20 hover:bg-[#a3ffb1]/40 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-semibold font-mono"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Drive / Meet</span>
            </button>

            <span className="text-xs font-mono font-bold text-[#6f7a6e]">
              ❯
            </span>

            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agent.name} or enter /command... (Cheap tasks run instant; sends go to Approvals)`}
              className="flex-1 bg-transparent text-xs sm:text-sm text-[#111111] placeholder-[#6f7a6e] focus:outline-hidden py-1"
            />

            {/* Inline Live Estimate Pill */}
            {liveEstimate && (
              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#f0eeea] border border-[#eae4d9] text-[11px] font-mono text-[#111111] shrink-0">
                <Zap className="w-3 h-3 text-[#d97706] fill-[#d97706]" />
                <span className="font-semibold">{liveEstimate.credits} CR</span>
                <span className="text-[#6f7a6e]">({liveEstimate.time})</span>
              </div>
            )}

            {/* Mic Toggle Button */}
            <button
              type="button"
              onClick={toggleMic}
              title={isRecording ? "Stop voice input" : "Voice input command"}
              className={`p-1.5 rounded-lg transition-colors ${
                isRecording 
                  ? 'bg-rose-100 text-rose-600 animate-pulse' 
                  : 'text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea]'
              }`}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Primary Run Button */}
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={!inputValue.trim()}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-2xs ${
                inputValue.trim()
                  ? 'bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] cursor-pointer'
                  : 'bg-[#eae8e4] text-[#6f7a6e] cursor-not-allowed opacity-60'
              }`}
            >
              <span>Run</span>
              <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Sub-bar Info */}
        <div className="flex items-center justify-between text-[11px] text-[#6f7a6e] px-1 font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
            <span>Context: {agent.contextSources.join(', ')}</span>
            <span className="hidden lg:inline text-[#3f493f]">· Claims-Gate Barrier Active</span>
          </div>

          <div className="hidden sm:flex items-center gap-1">
            <span>Press</span>
            <kbd className="px-1.5 py-0.2 bg-[#f0eeea] border border-[#eae4d9] rounded text-[10px]">
              Return ↵
            </kbd>
            <span>to execute</span>
          </div>
        </div>
      </div>
    </main>
  );
};
