import React, { useState } from 'react';
import { 
  Settings, 
  ShieldCheck, 
  Zap, 
  Sliders, 
  Check, 
  Lock, 
  Building,
  Globe,
  MailCheck,
  EyeOff,
  Flame,
  Cloud
} from 'lucide-react';
import { Org, Workspace } from '../ui-types';

interface SettingsViewProps {
  org?: Org;
  workspaces?: Workspace[];
  activeWorkspaceId?: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  org,
  workspaces = [],
  activeWorkspaceId
}) => {
  const [accountType, setAccountType] = useState<'owner' | 'agency'>('agency');
  const [requireApprovalUnder90, setRequireApprovalUnder90] = useState(true);
  const [autoSendOver95, setAutoSendOver95] = useState(false);
  const [dailyCap, setDailyCap] = useState(120);
  const [slowRampWarmup, setSlowRampWarmup] = useState(true);
  const [customDomain, setCustomDomain] = useState('reports.acmegrowth.com');
  const [clientApprovalsEnabled, setClientApprovalsEnabled] = useState(true);
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 bg-[#fbf9f5] overflow-y-auto p-6 md:p-8 space-y-6">
      <div className="border-b border-[#eae4d9] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111111] tracking-tight">
            Omni-SDR Workspace & Compliance Settings
          </h1>
          <p className="text-xs text-[#6f7a6e] mt-1">
            Project: <code className="font-mono bg-[#f0eeea] px-1 py-0.5 rounded">omni-sdr</code> · Cloudflare Pages Edge: <code className="font-mono bg-[#f0eeea] px-1 py-0.5 rounded">omnisdr.com</code>
          </p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl shadow-2xs transition-colors cursor-pointer"
        >
          <Check className="w-4 h-4 text-[#036d30]" />
          <span>{saved ? 'Saved Successfully!' : 'Save Workspace Rules'}</span>
        </button>
      </div>

      <div className="max-w-4xl space-y-6 text-xs">
        {/* Account Type & Agency White-Labeling */}
        <div className="bg-white border border-[#eae4d9] rounded-2xl p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#eae4d9]">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-[#036d30]" />
              <h3 className="font-bold text-[#111111] uppercase tracking-wider font-mono">
                Station 01 & 13: Account Architecture & White-Labeling
              </h3>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#a3ffb1] text-[#00210a]">
              AGENCY ACTIVE
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold text-[#111111] block mb-1">
                Account Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAccountType('owner')}
                  className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-colors ${
                    accountType === 'owner' ? 'bg-[#a3ffb1]/40 border-[#86efac] font-bold text-[#111111]' : 'border-[#eae4d9] text-[#6f7a6e]'
                  }`}
                >
                  <div className="font-bold">Owner Mode</div>
                  <div className="text-[10px]">Single business owner</div>
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType('agency')}
                  className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-colors ${
                    accountType === 'agency' ? 'bg-[#a3ffb1]/40 border-[#86efac] font-bold text-[#111111]' : 'border-[#eae4d9] text-[#6f7a6e]'
                  }`}
                >
                  <div className="font-bold">Agency Mode</div>
                  <div className="text-[10px]">Multi-client workspaces</div>
                </button>
              </div>
            </div>

            <div>
              <label className="font-semibold text-[#111111] block mb-1">
                Agency Custom Report Domain (Cloudflare for SaaS)
              </label>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#6f7a6e]" />
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  className="flex-1 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl px-3 py-1.5 text-xs font-mono text-[#111111] focus:outline-hidden focus:border-[#036d30]"
                />
              </div>
              <span className="text-[10px] text-[#6f7a6e] block mt-1">
                Completely removes Omni-SDR branding on client views and reports.
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-[#eae4d9] flex items-center justify-between">
            <div>
              <p className="font-semibold text-[#111111]">Client Approval Capability</p>
              <p className="text-[11px] text-[#6f7a6e]">
                Allow external client viewers to approve or comment on draft sequences before dispatch.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setClientApprovalsEnabled(!clientApprovalsEnabled)}
              className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                clientApprovalsEnabled ? 'bg-[#16a34a]' : 'bg-[#dbdad6]'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
                  clientApprovalsEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Guardrails Card */}
        <div className="bg-white border border-[#eae4d9] rounded-2xl p-6 shadow-2xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[#eae4d9]">
            <ShieldCheck className="w-4 h-4 text-[#16a34a]" />
            <h3 className="font-bold text-[#111111] uppercase tracking-wider font-mono">
              Trust Dial Spine & Claims-Gate Rules
            </h3>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-[#111111]">
                  Mandatory Review for ICP &lt; 90% (Trust Dial Level 1)
                </p>
                <p className="text-[#6f7a6e] text-[11px] leading-relaxed">
                  Require operator verification before sending any email cadence to prospects whose ICP score is under 90%.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRequireApprovalUnder90(!requireApprovalUnder90)}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                  requireApprovalUnder90 ? 'bg-[#16a34a]' : 'bg-[#dbdad6]'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
                    requireApprovalUnder90 ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-[#111111]">
                  Level 2 Guarded Autonomy (ICP &ge; 98% + Claims Gate Passed)
                </p>
                <p className="text-[#6f7a6e] text-[11px] leading-relaxed">
                  Locked behind operator feature flag. Outbound sends execute automatically only when Claims Gate has 100% confidence.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAutoSendOver95(!autoSendOver95)}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                  autoSendOver95 ? 'bg-[#16a34a]' : 'bg-[#dbdad6]'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
                    autoSendOver95 ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Email Warm-Up & Open Tracking Policies */}
        <div className="bg-white border border-[#eae4d9] rounded-2xl p-6 shadow-2xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[#eae4d9]">
            <Flame className="w-4 h-4 text-[#ea580c]" />
            <h3 className="font-bold text-[#111111] uppercase tracking-wider font-mono">
              Deliverability & Deliverability Policies
            </h3>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-[#111111]">
                  Built-In Slow Ramp Warmup (Enabled by Default)
                </p>
                <p className="text-[#6f7a6e] text-[11px] leading-relaxed">
                  Daily sending cap starts low and automatically increments by +10/day as healthy responses are recorded. Does not use fake warmup reply rings.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSlowRampWarmup(!slowRampWarmup)}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                  slowRampWarmup ? 'bg-[#16a34a]' : 'bg-[#dbdad6]'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
                    slowRampWarmup ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-start justify-between gap-4 pt-2 border-t border-[#eae4d9]">
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-[#111111]">
                  <EyeOff className="w-4 h-4 text-[#036d30]" />
                  <span>Tracking Pixel Policy: Zero Open Tracking Pixels</span>
                </div>
                <p className="text-[#6f7a6e] text-[11px] leading-relaxed">
                  Omni-SDR explicitly omits spy pixels to protect mailbox reputation and avoid spam filters. Engagement is measured exclusively by replies, sentiment, and booked meetings.
                </p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#dcfce7] text-[#036d30] border border-[#86efac]">
                STRICT COMPLIANCE
              </span>
            </div>
          </div>
        </div>

        {/* Postal Address & Legal Compliance Notice */}
        <div className="bg-white border border-[#eae4d9] rounded-2xl p-6 shadow-2xs space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-[#eae4d9]">
            <Lock className="w-4 h-4 text-[#0284c7]" />
            <h3 className="font-bold text-[#111111] uppercase tracking-wider font-mono">
              Station 23 Legal Compliance & Stripe Billing
            </h3>
          </div>

          <div className="space-y-2 text-[#3f493f]">
            <div className="flex items-center justify-between font-mono">
              <span>Stripe Account (Dime Data EIN):</span>
              <span className="text-[#16a34a] font-bold">7-Day Trial Captured</span>
            </div>
            <div className="flex items-center justify-between font-mono">
              <span>CAN-SPAM Registered Address:</span>
              <span className="text-[#111111] font-semibold">713 Harpeth Knoll Court, Nashville, TN 37221</span>
            </div>
            <div className="flex items-center justify-between font-mono">
              <span>In-App UI Address Visibility:</span>
              <span className="text-[#6f7a6e]">Omitted from app UI; strictly in commercial footers & receipts</span>
            </div>
            <div className="flex items-center justify-between font-mono">
              <span>SOC2 Type II Attestation:</span>
              <span className="text-[#16a34a] font-bold">VERIFIED</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
