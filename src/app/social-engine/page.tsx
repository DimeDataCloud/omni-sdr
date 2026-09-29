'use client';

import { useState } from 'react';
import { 
  Share2, 
  Copy, 
  Check, 
  Sparkles, 
  Flame, 
  TrendingUp,
  MessageSquare
} from 'lucide-react';
import { useOmniSdrStore } from '@/lib/store';

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 8.76a1.45 1.45 0 0 0 1.45-1.45 1.45 1.45 0 0 0-1.45-1.45 1.45 1.45 0 0 0-1.45 1.45c0 .8.65 1.45 1.45 1.45m1.37 9.74v-8.37H5.09v8.37h2.74Z"/>
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}

export default function SocialEnginePage() {
  const { socialPosts, audits, createSocialPostFromAudit, isGenerating } = useOmniSdrStore();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedAuditSlug, setSelectedAuditSlug] = useState<string>(Object.keys(audits)[0] || '');

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleGenerate = async () => {
    if (!selectedAuditSlug) return;
    await createSocialPostFromAudit(selectedAuditSlug);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
              Inbound Flywheel
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
            Social Authority & Teardown Generator
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Turn actual prospect audits and real revenue leak data into viral LinkedIn and X posts that drive inbound leads.
          </p>
        </div>

        {/* Generator Trigger */}
        <div className="flex items-center gap-3">
          <select
            value={selectedAuditSlug}
            onChange={(e) => setSelectedAuditSlug(e.target.value)}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
          >
            {Object.values(audits).map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.companyName} (${(a.totalMonthlyBleed / 1000).toFixed(0)}k/mo)
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || !selectedAuditSlug}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-50 transition-all"
          >
            <Sparkles className="h-4 w-4" />
            <span>{isGenerating ? 'Generating...' : 'Draft Post'}</span>
          </button>
        </div>
      </div>

      {/* Posts Feed */}
      <div className="space-y-6">
        {socialPosts.map((post) => (
          <div
            key={post.id}
            className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    post.platform === 'linkedin'
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                      : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {post.platform === 'linkedin' ? (
                    <LinkedinIcon className="h-5 w-5" />
                  ) : (
                    <XIcon className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">{post.title}</h3>
                  <span className="text-xs text-zinc-400">
                    Target Niche: <strong className="text-zinc-200">{post.industry}</strong> · Estimated Reach: {post.estimatedReach}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleCopy(post.id, `${post.hook}\n\n${post.content}\n\n${post.tags.join(' ')}`)}
                className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                {copiedId === post.id ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Copy Full Post</span>
                  </>
                )}
              </button>
            </div>

            {/* Hook Callout */}
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 text-xs font-semibold text-indigo-200 whitespace-pre-line leading-relaxed">
              {post.hook}
            </div>

            {/* Main Body */}
            <div className="rounded-2xl bg-zinc-950/80 border border-zinc-800 p-5 text-xs text-zinc-300 whitespace-pre-line leading-relaxed">
              {post.content}
            </div>

            {/* Tags */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-zinc-800/80 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400 border border-zinc-700/60"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
