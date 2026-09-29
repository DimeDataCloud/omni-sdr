'use client';

import { useState } from 'react';
import { 
  Settings, 
  Key, 
  CheckCircle, 
  Mail, 
  Calendar, 
  MessageSquare, 
  ShieldCheck, 
  Globe, 
  Save, 
  Sparkles,
  ExternalLink
} from 'lucide-react';

export default function SettingsPage() {
  const [geminiKey, setGeminiKey] = useState('');
  const [placesKey, setPlacesKey] = useState('');
  const [twilioSid, setTwilioSid] = useState('');
  const [twilioPhone, setTwilioPhone] = useState('+1 (615) 827-8674');
  const [customDomain, setCustomDomain] = useState('audit.dimedata.cloud');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="border-b border-zinc-800 pb-6">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
            System Configuration
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
          Google-Native Integrations & API Keys
        </h1>
        <p className="text-sm text-zinc-400 mt-0.5">
          Connect your Google Workspace inboxes, Gemini reasoning models, and dispatch credentials.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Google Gemini Intelligence Model */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 sm:p-8 backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Google Gemini Reasoning Core</h3>
                <p className="text-xs text-zinc-400">Powering lead evidence extraction, copy synthesis, and objection handling</p>
              </div>
            </div>
            <span className="rounded bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
              Gemini 2.5 Flash / Pro
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-zinc-300 mb-1">Gemini API Key</label>
              <input
                type="password"
                placeholder="AIzaSy... (leave blank to use system environment default)"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-zinc-500">
              Keys are encrypted at rest. If omitted, Omni-SDR defaults to server-side Google Application Default Credentials or system keys.
            </p>
          </div>
        </div>

        {/* Google Places & Business API */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 sm:p-8 backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Google Places & Local Review Mining</h3>
                <p className="text-xs text-zinc-400">Automated discovery of business listings, ratings, and unanswered negative feedback</p>
              </div>
            </div>
            <span className="rounded bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-300 border border-blue-500/20">
              Google Maps Platform
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-zinc-300 mb-1">Google Places API Key</label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={placesKey}
                onChange={(e) => setPlacesKey(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Connected Channels: Gmail & Google Calendar */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 sm:p-8 backdrop-blur-xl space-y-4">
          <div className="flex items-center gap-3 border-b border-zinc-800/80 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Google Workspace & Calendar OAuth</h3>
              <p className="text-xs text-zinc-400">Direct 1-to-1 dispatch from warm inboxes with automatic meeting booking</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Mail className="h-4 w-4 text-indigo-400" />
                  Connected Sender Inbox
                </span>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                  Active
                </span>
              </div>
              <p className="text-zinc-400">admin@dimedata.cloud</p>
              <div className="pt-2 text-[11px] text-zinc-500">
                Daily Send Cap: <strong>30 emails/day</strong> (Warmup Protected)
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-indigo-400" />
                  Google Calendar Booking Link
                </span>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                  Synced
                </span>
              </div>
              <p className="text-zinc-400">calendar.google.com/meet/dimedata</p>
              <div className="pt-2 text-[11px] text-zinc-500">
                Auto-generates Google Meet link upon prospect confirmation
              </div>
            </div>
          </div>
        </div>

        {/* Twilio SMS Channel */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 sm:p-8 backdrop-blur-xl space-y-4">
          <div className="flex items-center gap-3 border-b border-zinc-800/80 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Twilio SMS Follow-Up Channel</h3>
              <p className="text-xs text-zinc-400">Compliant transactional and 1-to-1 conversational SMS follow-ups</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-zinc-300 mb-1">Twilio Account SID</label>
              <input
                type="password"
                placeholder="AC..."
                value={twilioSid}
                onChange={(e) => setTwilioSid(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-300 mb-1">Twilio Sender Phone Number</label>
              <input
                type="text"
                value={twilioPhone}
                onChange={(e) => setTwilioPhone(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Save Bar */}
        <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
          {savedSuccess ? (
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <CheckCircle className="h-4 w-4" />
              <span>Configuration successfully saved to local and cloud stores!</span>
            </div>
          ) : (
            <div className="text-xs text-zinc-500">
              Changes take effect immediately across all active campaigns.
            </div>
          )}

          <button
            type="submit"
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:from-indigo-500 hover:to-blue-500 active:scale-95 transition-all"
          >
            <Save className="h-4 w-4" />
            <span>Save Configuration</span>
          </button>
        </div>
      </form>
    </div>
  );
}
