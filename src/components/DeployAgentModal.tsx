import React, { useState } from 'react';
import { 
  X, 
  Plus, 
  Sparkles, 
  Check, 
  Cpu, 
  ShieldCheck, 
  Layers, 
  Bot 
} from 'lucide-react';
import { Agent, BadgeType } from '../ui-types';

interface DeployAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (agent: Agent) => void;
}

export const DeployAgentModal: React.FC<DeployAgentModalProps> = ({
  isOpen,
  onClose,
  onDeploy
}) => {
  const [name, setName] = useState('');
  const [stationName, setStationName] = useState('');
  const [badge, setBadge] = useState<BadgeType>('SDR');
  const [model, setModel] = useState('Gemini 2.5 Flash Autonomous');
  const [rolePrompt, setRolePrompt] = useState('Autonomous outbound research, signal synthesis, and high-conversion cadence drafting.');
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>(['CRM', 'Slack']);

  if (!isOpen) return null;

  const badgeOptions: { type: BadgeType; label: string; color: string; bg: string }[] = [
    { type: 'SDR', label: 'SDR (Sales Development)', color: '#99f6e4', bg: '#0d9488' },
    { type: 'OPS', label: 'OPS (Operations)', color: '#bae6fd', bg: '#0284c7' },
    { type: 'EXEC', label: 'EXEC (Executive)', color: '#e9d5ff', bg: '#9333ea' },
    { type: 'MKT', label: 'MKT (Marketing)', color: '#ffedd5', bg: '#ea580c' },
    { type: 'HR', label: 'HR (Talent)', color: '#fde68a', bg: '#d97706' },
    { type: 'INT', label: 'INT (Intelligence)', color: '#e0e7ff', bg: '#4f46e5' }
  ];

  const handleDeploy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const chosenBadge = badgeOptions.find(b => b.type === badge) || badgeOptions[0];
    const chosenTier = model.includes('Pro') ? 'Pro' : model.includes('Flash-Lite') ? 'Flash-Lite' : 'Flash';

    const newAgent: Agent = {
      id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name: name.trim(),
      badge: badge,
      badgeColor: chosenBadge.color,
      avatarBg: chosenBadge.bg,
      iconType: 'sparkles',
      time: 'Just now',
      unreadCount: 0,
      preview: 'Agent initialized and ready for instructions.',
      threadName: `#thread-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-01`,
      stationName: stationName.trim().toUpperCase() || name.trim().toUpperCase(),
      autonomousMode: true,
      model: model,
      modelTier: chosenTier,
      contextSources: selectedIntegrations,
      activeThreads: 1,
      systemRole: rolePrompt
    };

    onDeploy(newAgent);
    onClose();
  };

  const toggleIntegration = (source: string) => {
    setSelectedIntegrations(prev => 
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-14 border-b border-[#eae4d9] px-6 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-[#036d30]" />
            <h3 className="text-xs font-bold text-[#111111] uppercase tracking-wider font-mono">
              Deploy New Autonomous Agent
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#6f7a6e] hover:text-[#111111] hover:bg-[#f0eeea] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleDeploy} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block text-[11px] font-mono font-bold text-[#111111] uppercase mb-1">
              Agent Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Inbound Qualifier, Partner Scout"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!stationName) setStationName(e.target.value.toUpperCase());
              }}
              className="w-full bg-white border border-[#eae4d9] rounded-xl px-3 py-2 text-xs text-[#111111] placeholder-[#6f7a6e] focus:outline-hidden focus:border-[#036d30] focus:ring-1 focus:ring-[#a3ffb1]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono font-bold text-[#111111] uppercase mb-1">
              Station Role Code (Badge)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {badgeOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.type}
                  onClick={() => setBadge(opt.type)}
                  className={`p-2 rounded-xl border text-left flex items-center justify-between transition-all ${
                    badge === opt.type 
                      ? 'bg-white border-[#111111] shadow-2xs' 
                      : 'bg-white/60 border-[#eae4d9] hover:bg-white'
                  }`}
                >
                  <span 
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold"
                    style={{ backgroundColor: opt.color, color: '#111111' }}
                  >
                    {opt.type}
                  </span>
                  {badge === opt.type && <Check className="w-3.5 h-3.5 text-[#111111]" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-mono font-bold text-[#111111] uppercase mb-1">
              LLM Backbone
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-white border border-[#eae4d9] rounded-xl px-3 py-2 text-xs text-[#111111] focus:outline-hidden focus:border-[#036d30]"
            >
              <option value="Gemini 2.5 Flash Autonomous">Gemini 2.5 Flash Autonomous (Fastest &bull; 34ms)</option>
              <option value="Gemini 2.5 Pro High-Accuracy">Gemini 2.5 Pro (Deep Research & Complex Strategy)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-mono font-bold text-[#111111] uppercase mb-1">
              Context Sources
            </label>
            <div className="flex flex-wrap gap-2">
              {['CRM', 'Slack', 'Google Calendar', 'Apollo.io', 'LinkedIn'].map((source) => {
                const active = selectedIntegrations.includes(source);
                return (
                  <button
                    type="button"
                    key={source}
                    onClick={() => toggleIntegration(source)}
                    className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                      active 
                        ? 'bg-[#a3ffb1] border-[#86efac] text-[#00210a] font-bold' 
                        : 'bg-white border-[#eae4d9] text-[#6f7a6e]'
                    }`}
                  >
                    {source}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-mono font-bold text-[#111111] uppercase mb-1">
              Mission Directive / System Prompt
            </label>
            <textarea
              rows={3}
              value={rolePrompt}
              onChange={(e) => setRolePrompt(e.target.value)}
              className="w-full bg-white border border-[#eae4d9] rounded-xl p-3 text-xs text-[#111111] placeholder-[#6f7a6e] focus:outline-hidden focus:border-[#036d30]"
            />
          </div>

          <div className="pt-3 border-t border-[#eae4d9] flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[#eae4d9] text-[#111111] hover:bg-[#f5f3ef] rounded-xl text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] rounded-xl text-xs font-bold shadow-2xs transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Deploy to Fleet</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
