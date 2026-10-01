// One nav list; each entry says who sees it (DESIGN 5.3). The shell, bottom bar, palette and route guards all read this.
import { Home, CheckCheck, Inbox, CalendarDays, Users, BarChart3, Sparkles, Bot, Plug, Settings as Cog, type LucideIcon } from 'lucide-react';
import type { Role } from '@/lib/api/types';
import type { Action } from '@/lib/session';

export type PageKey = 'home' | 'approvals' | 'inbox' | 'meetings' | 'leads' | 'analytics' | 'studio' | 'agents' | 'connections' | 'settings';
export interface NavItem { key: PageKey; label: string; icon: LucideIcon; shortcut?: string; visible: (role: Role, can: (a: Action) => boolean) => boolean }

export const NAV: NavItem[] = [
  { key: 'home', label: 'Home', icon: Home, shortcut: 'g h', visible: (r) => r !== 'client_viewer' },
  { key: 'approvals', label: 'Approvals', icon: CheckCheck, shortcut: 'g a', visible: (_, can) => can('approve') },
  { key: 'inbox', label: 'Inbox', icon: Inbox, shortcut: 'g i', visible: (_, can) => can('inbox_read') },
  { key: 'meetings', label: 'Meetings', icon: CalendarDays, shortcut: 'g m', visible: () => true },
  { key: 'leads', label: 'Leads', icon: Users, shortcut: 'g l', visible: (_, can) => can('build') },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, shortcut: 'g r', visible: (_, can) => can('reports_view') },
  { key: 'studio', label: 'Studio', icon: Sparkles, shortcut: 'g s', visible: (r) => r !== 'client_viewer' },
  { key: 'agents', label: 'Agents', icon: Bot, shortcut: 'g t', visible: (r) => r !== 'client_viewer' },
  { key: 'connections', label: 'Connections', icon: Plug, visible: (r) => r !== 'client_viewer' },
  { key: 'settings', label: 'Settings', icon: Cog, visible: (r) => r !== 'client_viewer' },
];

/** The client viewer calls Analytics "Results" (DESIGN 6.13). */
export const labelFor = (item: NavItem, role: Role) => (role === 'client_viewer' && item.key === 'analytics' ? 'Results' : item.label);
export const homeFor = (role: Role): PageKey => (role === 'client_viewer' ? 'analytics' : 'home');
export const MOBILE_PRIMARY: PageKey[] = ['home', 'approvals', 'inbox', 'meetings'];
/** Desktop top bar: these sit under More so the bar never crowds. */
export const SECONDARY: PageKey[] = ['studio', 'agents', 'connections', 'settings'];
