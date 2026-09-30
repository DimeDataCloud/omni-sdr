'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Sparkles, 
  CheckCircle2, 
  Users, 
  FileSearch, 
  Share2, 
  MessageSquare, 
  Settings, 
  ShieldCheck, 
  Flame,
  ArrowUpRight
} from 'lucide-react';
import { useOmniSdrStore } from '@/lib/store';

export function Navbar() {
  const pathname = usePathname();
  const { pendingLeads, trustDial } = useOmniSdrStore();

  // Hide internal app navbar on public landing page, audit pages, and legal pages
  if (pathname === '/' || pathname.startsWith('/audit/') || ['/privacy', '/terms', '/anti-spam', '/security'].includes(pathname)) {
    return null;
  }

  const navItems = [
    { label: 'Command Center', href: '/app', icon: Sparkles },
    { 
      label: 'Approval Queue', 
      href: '/approval-queue', 
      icon: CheckCircle2, 
      badge: pendingLeads.length 
    },
    { label: 'Prospects & Mining', href: '/prospects', icon: Users },
    { label: 'Hosted Audits', href: '/audit/stone-timber-commercial-roofing', icon: FileSearch },
    { label: 'Social Authority', href: '/social-engine', icon: Share2 },
    { label: 'Inbound Triage', href: '/inbound', icon: MessageSquare },
    { label: 'Settings', href: '/settings', icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div className="flex items-center gap-3">
          <Link href="/" className="group flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20 transition-all duration-300 group-hover:scale-105 group-hover:shadow-indigo-500/40 overflow-hidden">
              <img src="/logo.png" alt="Omni SDR Logo" className="h-full w-full object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-white">Omni-SDR</span>
                <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-indigo-400 border border-indigo-500/20">
                  Google-Native
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 hidden sm:block">Autonomous AI Sales Representative</p>
            </div>
          </Link>
        </div>

        {/* Navigation Links */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-zinc-800/90 text-white shadow-sm ring-1 ring-zinc-700'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-400' : 'text-zinc-500'}`} />
                <span>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-bold text-white shadow-sm shadow-indigo-500/50">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right Status Badges */}
        <div className="flex items-center gap-3">
          {/* Trust Dial State Indicator */}
          <div className="flex items-center gap-2 rounded-full bg-zinc-900 border border-zinc-800 px-3 py-1 text-xs">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-zinc-400 hidden sm:inline">Trust Dial:</span>
            <span className="font-semibold text-emerald-300">
              {trustDial === 1 ? 'L1: Swipe Review' : trustDial === 2 ? 'L2: Guarded' : 'L3: Full Auto'}
            </span>
          </div>

          {/* Quick Action Button */}
          <Link
            href="/prospects"
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-600/30 transition-all hover:bg-indigo-500 hover:shadow-indigo-500/50 active:scale-95"
          >
            <Flame className="h-3.5 w-3.5 text-amber-300" />
            <span>Mine Leads</span>
            <ArrowUpRight className="h-3 w-3 opacity-70" />
          </Link>
        </div>
      </div>
    </header>
  );
}
