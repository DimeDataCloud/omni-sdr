// One nav list; each entry says who sees it (DESIGN 5.3). The shell, bottom bar, palette and route guards all read this.
// Pages are grouped into six sections (DECISIONS 2026-10-01, WORKSPACE-PLAN.md): the top bar shows sections, and a
// section with more than one page shows its pages as tabs under the bar. URLs stay one page each (/w/:ws/:page).
import { Home, CheckCheck, Inbox, CalendarDays, Users, BarChart3, Sparkles, Bot, Plug, Database, Settings as Cog, Send, MessageSquareReply, Megaphone, SlidersHorizontal, Handshake, BookOpenText, Briefcase, Calculator, MessageCircleQuestion, MonitorPlay, HandCoins, ListTodo, ClipboardList, MessageSquare, Settings2, CreditCard, type LucideIcon } from 'lucide-react';
import type { Role } from '@/lib/api/types';
import type { Action } from '@/lib/session';
import { salesAccess } from '@/features/sales/access';

export type PageKey = 'home' | 'approvals' | 'inbox' | 'handoffs' | 'playbook' | 'meetings' | 'leads' | 'analytics' | 'studio' | 'agents' | 'data' | 'connections' | 'settings' | 'clients' | 'quote' | 'objections' | 'demo' | 'deals' | 'prospects' | 'saleslog' | 'myservice' | 'conversations' | 'billing';
export type SectionKey = 'home' | 'outbound' | 'inbound' | 'marketing' | 'results' | 'setup' | 'dev' | 'sales';
export interface NavItem { key: PageKey; section: SectionKey; label: string; hint: string; icon: LucideIcon; shortcut?: string; visible: (role: Role, can: (a: Action) => boolean) => boolean }
export interface Section { key: SectionKey; label: string; hint: string; icon: LucideIcon }

export const SECTIONS: Section[] = [
  { key: 'home', label: 'Home', hint: 'What needs you today', icon: Home },
  { key: 'outbound', label: 'Outbound', hint: 'Leads in, drafts out: review and approve', icon: Send },
  { key: 'inbound', label: 'Inbound', hint: 'Replies and the meetings they turn into', icon: MessageSquareReply },
  { key: 'marketing', label: 'Marketing', hint: 'Images, video and social content', icon: Megaphone },
  { key: 'results', label: 'Results', hint: 'What worked, by the numbers', icon: BarChart3 },
  { key: 'sales', label: 'Sales portal', hint: 'Quote sheet and prices for reps', icon: Calculator },
  { key: 'dev', label: 'Dev portal', hint: 'Client records: sales, onboarding and go live', icon: Briefcase },
  { key: 'setup', label: 'Setup', hint: 'Agents, data, connections and rules', icon: SlidersHorizontal },
];

// The dev portal is for the operator team. packages/db has no client-record action yet, so the role is checked here.
const OPERATORS: Role[] = ['admin', 'operator', 'reviewer'];   // reviewers open the page to review versions only

// Outside parties see only their own screens: a client viewer their results, a closer their handoffs (0015).
const OUTSIDE: Role[] = ['client_viewer', 'closer', 'rep'];

export const NAV: NavItem[] = [
  { key: 'home', section: 'home', label: 'Home', hint: 'Briefing, agents and what to decide', icon: Home, shortcut: 'g h', visible: (r) => !OUTSIDE.includes(r) },
  { key: 'approvals', section: 'outbound', label: 'Approvals', hint: 'Drafts waiting for your yes', icon: CheckCheck, shortcut: 'g a', visible: (_, can) => can('approve') },
  { key: 'leads', section: 'outbound', label: 'Leads', hint: 'Who to reach, campaigns and imports', icon: Users, shortcut: 'g l', visible: (_, can) => can('build') },
  { key: 'inbox', section: 'inbound', label: 'Inbox', hint: 'Replies, sorted by what they need', icon: Inbox, shortcut: 'g i', visible: (_, can) => can('inbox_read') },
  { key: 'handoffs', section: 'inbound', label: 'Handoffs', hint: 'Conversations passed to a closer', icon: Handshake, shortcut: 'g o', visible: (_, can) => can('handoff_work') },
  { key: 'playbook', section: 'inbound', label: 'Playbook', hint: 'Your replies and qualification questions', icon: BookOpenText, shortcut: 'g p', visible: (_, can) => can('inbox_read') },
  { key: 'meetings', section: 'inbound', label: 'Meetings', hint: 'Booked calls and their outcomes', icon: CalendarDays, shortcut: 'g m', visible: (_, can) => can('reports_view') },
  { key: 'studio', section: 'marketing', label: 'Studio', hint: 'Make and review images and video', icon: Sparkles, shortcut: 'g s', visible: (r) => !OUTSIDE.includes(r) },
  { key: 'analytics', section: 'results', label: 'Analytics', hint: 'Replies, meetings and approval rates', icon: BarChart3, shortcut: 'g r', visible: (_, can) => can('reports_view') },
  { key: 'conversations', section: 'results', label: 'Conversations', hint: 'Who wrote in and what it was about', icon: MessageSquare, visible: (r) => r === 'client_viewer' },
  { key: 'myservice', section: 'results', label: 'My setup', hint: 'What your system does for you today', icon: Settings2, visible: (r) => r === 'client_viewer' },
  { key: 'billing', section: 'results', label: 'Billing', hint: 'Your plan and invoices, read-only', icon: CreditCard, visible: (r) => r === 'client_viewer' && import.meta.env.VITE_CLIENT_BILLING === 'on' },
  { key: 'agents', section: 'setup', label: 'Agents', hint: 'Role, autonomy, data access, guardrails', icon: Bot, shortcut: 'g t', visible: (r) => !OUTSIDE.includes(r) },
  { key: 'data', section: 'setup', label: 'Data', hint: 'What agents read, and who reads what', icon: Database, shortcut: 'g d', visible: (r) => !OUTSIDE.includes(r) },
  { key: 'quote', section: 'sales', label: 'Quote sheet', hint: 'The ladder and the exact sentence to say', icon: Calculator, shortcut: 'g q', visible: (r) => salesAccess(r).portal },
  { key: 'deals', section: 'sales', label: 'Deals', hint: 'Close a sale and follow your deals', icon: HandCoins, visible: (r) => salesAccess(r).portal },
  { key: 'prospects', section: 'sales', label: 'Prospects', hint: 'Who to call, what we saw, where each one stands', icon: ListTodo, visible: (r) => salesAccess(r).portal },
  { key: 'saleslog', section: 'sales', label: 'Daily log', hint: 'Calls, audits and the objections you heard', icon: ClipboardList, visible: (r) => salesAccess(r).portal },
  { key: 'objections', section: 'sales', label: 'Objections', hint: 'What owners say and what to answer, plus never say', icon: MessageCircleQuestion, visible: (r) => salesAccess(r).portal },
  { key: 'demo', section: 'sales', label: 'Run the demo', hint: 'How to show Try me and what to do at its limit', icon: MonitorPlay, visible: (r) => salesAccess(r).portal },
  { key: 'clients', section: 'dev', label: 'Clients', hint: 'Closed deals and onboarding checklists', icon: Briefcase, shortcut: 'g c', visible: (r) => OPERATORS.includes(r) },
  { key: 'connections', section: 'setup', label: 'Connections', hint: 'Mailboxes, calendar and tools', icon: Plug, visible: (r) => !OUTSIDE.includes(r) },
  { key: 'settings', section: 'setup', label: 'Settings', hint: 'Workspace, members, sending and safety', icon: Cog, visible: (r) => !OUTSIDE.includes(r) },
];

/** The client viewer calls Analytics "Results" (DESIGN 6.13). */
export const labelFor = (item: NavItem, role: Role) => (role === 'client_viewer' && item.key === 'analytics' ? 'Results' : item.label);
export const homeFor = (role: Role): PageKey => (role === 'client_viewer' ? 'analytics' : role === 'closer' ? 'handoffs' : role === 'rep' ? 'quote' : 'home');
export const sectionOf = (page: string | undefined) => NAV.find((n) => n.key === page)?.section;
/** Phone bottom bar: these four sections, then More. */
export const MOBILE_SECTIONS: SectionKey[] = ['home', 'outbound', 'inbound', 'marketing'];

// The last page opened in each section, so a section link returns where you were. Per viewer, browser storage only.
const LAST = 'omni-section-last';
export function lastInSection(s: SectionKey): PageKey | null {
  try { return (JSON.parse(localStorage.getItem(LAST) ?? '{}') as Record<string, PageKey>)[s] ?? null; } catch { return null; }
}
export function rememberPage(p: PageKey) {
  const s = sectionOf(p);
  if (!s) return;
  try { const m = JSON.parse(localStorage.getItem(LAST) ?? '{}'); m[s] = p; localStorage.setItem(LAST, JSON.stringify(m)); } catch { /* private mode */ }
}
/** Where a section link goes for this person: the page they last used in it, else its first page they can see. */
export function sectionTarget(s: SectionKey, items: NavItem[]): PageKey | null {
  const pages = items.filter((i) => i.section === s);
  const last = lastInSection(s);
  return (pages.find((p) => p.key === last) ?? pages[0])?.key ?? null;
}
