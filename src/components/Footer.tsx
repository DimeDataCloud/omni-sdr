'use client';

import { usePathname } from 'next/navigation';

export function Footer() {
  const pathname = usePathname();

  // Hide dark app footer on public landing page, audit pages, and legal pages
  if (pathname === '/' || pathname.startsWith('/audit/') || ['/privacy', '/terms', '/anti-spam', '/security'].includes(pathname)) {
    return null;
  }

  return (
    <footer className="border-t border-zinc-900 bg-zinc-950 py-6 text-center text-xs text-zinc-500">
      <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>© 2026 Omni-SDR. Google-Native Autonomous Pipeline Architecture.</p>
        <div className="flex items-center gap-4 text-zinc-400">
          <span>Google Gemini 2.5 Active</span>
          <span>•</span>
          <span>Claims-Gate Verified</span>
          <span>•</span>
          <span>Multi-Tenant Ready</span>
        </div>
      </div>
    </footer>
  );
}
