import React, { useState } from 'react';
import { 
  Layers, 
  Terminal, 
  Sparkles, 
  CheckCircle2, 
  Bot, 
  Cpu, 
  ShieldCheck, 
  BookOpen, 
  ArrowRight,
  Sliders,
  History,
  Info
} from 'lucide-react';
import { Agent, AutoAdjustRule } from '../ui-types';
import { INITIAL_AUTO_ADJUST_RULES } from '../data/mockData';

interface StudioViewProps {
  agents: Agent[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
}

export const StudioView: React.FC<StudioViewProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent
}) => {
  const currentAgent = agents.find(a => a.id === selectedAgentId) || agents[0];
  const [promptDraft, setPromptDraft] = useState(currentAgent.systemRole);
  const [isSaved, setIsSaved] = useState(false);

  // Auto-adjust learning loop controls (Station 08)
  const [autoAdjustActive, setAutoAdjustActive] = useState(true);
  const [sources, setSources] = useState<Record<string, boolean>>({
    booked_meetings: true,
    positive_replies: true,
    objections: true,
    unsubscribes: false,
    uploaded_sops: false,
    human_edits: true
  });
  const [learnedRules, setLearnedRules] = useState<AutoAdjustRule[]>(INITIAL_AUTO_ADJUST_RULES);

  const handleSave = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const toggleSource = (key: string) => {
    setSources(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex-1 bg-[#fbf9f5] overflow-y-auto p-6 md:p-8 space-y-6">
      <div className="border-b border-[#eae4d9] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111111] tracking-tight">
            Station Logic & Auto-Adjust Learning Loop
          </h1>
          <p className="text-xs text-[#6f7a6e] mt-1">
            Configure system directives, Gemini model tier routing, and transparent learning loops.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl shadow-2xs transition-colors cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-[#036d30]" />
            <span>{isSaved ? 'Directives Deployed!' : 'Deploy Station Logic'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Select Station */}
        <div className="space-y-4">
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-3">
            <h3 className="text-xs font-mono font-bold text-[#111111] uppercase tracking-wider">
              Fleet Stations ({agents.length})
            </h3>
            <div className="space-y-1">
              {agents.map((ag) => (
                <button
                  key={ag.id}
                  onClick={() => {
                    onSelectAgent(ag.id);
                    setPromptDraft(ag.systemRole);
                  }}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between text-xs ${
                    ag.id === currentAgent.id
                      ? 'bg-[#fbf9f5] border-[#111111] font-semibold text-[#111111] shadow-2xs'
                      : 'bg-white border-transparent hover:bg-[#f5f3ef] text-[#3f493f]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: ag.avatarBg }}
                    />
                    <span>{ag.name}</span>
                  </div>
                  <span
                    className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold"
                    style={{ backgroundColor: ag.badgeColor, color: '#111111' }}
                  >
                    {ag.badge}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Model Routing Architecture */}
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-2xs space-y-3 text-xs">
            <h3 className="text-xs font-mono font-bold text-[#111111] uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#036d30]" />
              Model Tier Routing Map
            </h3>
            
            <div className="space-y-2">
              <div className="p-2.5 bg-[#f5f3ef] border border-[#eae4d9] rounded-xl space-y-0.5">
                <div className="flex justify-between font-mono">
                  <span className="font-bold text-[#111111]">Gemini Flash-Lite</span>
                  <span className="text-[#036d30]">1 CR</span>
                </div>
                <p className="text-[11px] text-[#6f7a6e]">Reply classification, lead deduplication, intent routing, snoozing.</p>
              </div>

              <div className="p-2.5 bg-[#a3ffb1]/20 border border-[#86efac] rounded-xl space-y-0.5">
                <div className="flex justify-between font-mono">
                  <span className="font-bold text-[#111111]">Gemini Flash (Default)</span>
                  <span className="text-[#036d30]">2 CR</span>
                </div>
                <p className="text-[11px] text-[#3f493f]">Personalized email drafts, LinkedIn outreach, objection handling, lead summaries.</p>
              </div>

              <div className="p-2.5 bg-[#f5f3ef] border border-[#eae4d9] rounded-xl space-y-0.5">
                <div className="flex justify-between font-mono">
                  <span className="font-bold text-[#111111]">Gemini Pro</span>
                  <span className="text-[#036d30]">4 CR</span>
                </div>
                <p className="text-[11px] text-[#6f7a6e]">High-precision ICP proposals, competitive battlecards, multi-step campaign briefs.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Center & Right Column: Prompt & Auto-Adjust Loop */}
        <div className="lg:col-span-2 space-y-6">
          {/* Prompt Editor */}
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-[#036d30]" />
                <h3 className="text-xs font-mono font-bold text-[#111111] uppercase tracking-wider">
                  Station Directive: {currentAgent.stationName}
                </h3>
              </div>
              <span className="text-[11px] font-mono text-[#6f7a6e]">
                Backbone: {currentAgent.model}
              </span>
            </div>

            <textarea
              rows={4}
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              className="w-full bg-[#fbf9f5] border border-[#eae4d9] rounded-xl p-3 text-xs font-mono text-[#111111] focus:outline-hidden focus:border-[#036d30]"
            />
          </div>

          {/* Station 08: Auto-Adjust Learning Loop */}
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-start justify-between pb-3 border-b border-[#eae4d9]">
              <div>
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#036d30]" />
                  <h3 className="text-xs font-mono font-bold text-[#111111] uppercase tracking-wider">
                    Station 08: Auto-Adjust Learning Loop
                  </h3>
                </div>
                <p className="text-xs text-[#6f7a6e] mt-1">
                  Learns successful drafting angles and objection rebuttals from positive signals.
                </p>
              </div>

              {/* Master toggle */}
              <button
                type="button"
                onClick={() => setAutoAdjustActive(!autoAdjustActive)}
                className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer relative shrink-0 ${
                  autoAdjustActive ? 'bg-[#16a34a]' : 'bg-[#dbdad6]'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
                    autoAdjustActive ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Granular Source Checkboxes */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono text-[#6f7a6e] uppercase">
                Active Learning Sources:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'booked_meetings', label: 'Booked Meetings' },
                  { key: 'positive_replies', label: 'Positive Replies' },
                  { key: 'objections', label: 'Objections Handled' },
                  { key: 'unsubscribes', label: 'Unsubscribes' },
                  { key: 'uploaded_sops', label: 'Uploaded SOPs' },
                  { key: 'human_edits', label: 'Human Edits to Drafts' }
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleSource(key)}
                    className={`p-2 rounded-xl border text-xs font-medium text-left transition-colors flex items-center justify-between ${
                      sources[key] 
                        ? 'bg-[#a3ffb1]/30 border-[#86efac] text-[#111111] font-semibold' 
                        : 'bg-white border-[#eae4d9] text-[#6f7a6e]'
                    }`}
                  >
                    <span>{label}</span>
                    {sources[key] && <CheckCircle2 className="w-3.5 h-3.5 text-[#036d30]" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Guardrail Guarantee Banner */}
            <div className="bg-[#f5fbf7] border border-[#bbf7d0] rounded-xl p-3 text-xs text-[#036d30] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#16a34a] shrink-0" />
              <span>Strictly prohibited from modifying safety guardrails, claims gate, or suppression lists.</span>
            </div>

            {/* Transparent Audit Log: What Auto-Adjust Learned */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-[#111111] uppercase flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-[#6f7a6e]" />
                  What Auto-Adjust Learned (Audit Log)
                </span>
                <span className="text-[#6f7a6e]">{learnedRules.length} Learned Insights</span>
              </div>

              <div className="space-y-2">
                {learnedRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="p-3 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#111111]">{rule.sourceEvent}</span>
                      <span className="text-[10px] font-mono text-[#6f7a6e]">{rule.dateLearned}</span>
                    </div>
                    <p className="text-[#3f493f] leading-relaxed">{rule.description}</p>
                    <div className="text-[10px] font-mono text-[#036d30]">
                      Confidence: {Math.round(rule.confidence * 100)}% • Category: {rule.category.replace('_', ' ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
