// Ctrl/Cmd K: act on what's open, jump to any page, draft, contact, meeting or agent, hand a question to an agent,
// and run the few safe global actions (DESIGN 5.4, UI-REVISION-PLAN Phase 2).
import { useState } from 'react';
import { Command } from 'cmdk';
import * as RDialog from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Search, Bot, UserRound, FileText, PauseCircle, UserPlus, Moon, Sun, Rows3, CalendarDays, History, Sparkles, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { useTheme, setTheme, useDensity, setDensity } from '@/lib/theme';
import { usePageCommands, readRecents, pushRecent, type Recent } from '@/lib/commands';
import { NAV, labelFor } from './nav';
import { cx } from '../ui';

const item = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm aria-selected:bg-sunken data-[selected=true]:bg-sunken';
const group = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted';
const Keys = ({ keys }: { keys?: string }) => keys ? <span className="ml-auto flex gap-1">{keys.split(' ').map((k) => <span key={k} className="kbd">{k}</span>)}</span> : null;
const RECENT_ICON = { page: Zap, draft: FileText, contact: UserRound, agent: Bot, meeting: CalendarDays } as const;
const when = (iso: string, tz: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { scope, role, can, tz } = useWorkspace();
  const nav = useNavigate();
  const theme = useTheme();
  const density = useDensity();
  const here = usePageCommands();
  const [search, setSearch] = useState('');
  const base = `/w/${scope.workspaceId}`;
  const agents = useQuery(() => api.agents(scope), [scope.workspaceId], { enabled: open && role !== 'client_viewer' });
  const contacts = useQuery(() => api.contacts(scope), [scope.workspaceId], { enabled: open && can('build') });
  const drafts = useQuery(() => api.approvals(scope, { status: 'review' }), [scope.workspaceId], { enabled: open && can('approve') });
  const meetings = useQuery(() => api.meetings(scope, 'upcoming'), [scope.workspaceId], { enabled: open, key: `meetings:${scope.workspaceId}:upcoming` });
  const recents = open ? readRecents().filter((r) => r.to.startsWith(`${base}/`)) : [];
  const setOpen = (v: boolean) => { onOpenChange(v); if (!v) setSearch(''); };
  const go = (to: string, recent?: Omit<Recent, 'to' | 'value'>) => {
    if (recent) pushRecent({ ...recent, to, value: `${recent.kind} ${recent.label}` });
    setOpen(false); nav(to, { viewTransition: true });
  };
  const pause = async () => {
    setOpen(false);
    try { await api.setHold(scope, { scopeType: 'workspace', reason: 'Paused from the command palette' }); toast.success('Paused. Nothing sends from this workspace until an admin resumes it.'); }
    catch (e) { toast.error((e as Error).message); }
  };
  // "Ask" puts the typed text in that agent's composer. It never sends on its own: the person presses Ask.
  const q = search.trim();
  const askable = q && can('build') ? (agents.data ?? []).filter((a) => !a.archivedAt).slice(0, 3) : [];
  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="ov-fade fixed inset-0 z-50 bg-inverse/30" />
        {/* If the command already put focus somewhere (the next draft, a new page's title), keep it there instead of
            handing it back to whatever opened the palette, which may be a card on its way out. */}
        <RDialog.Content onCloseAutoFocus={(e) => { const a = document.activeElement; if (a && a !== document.body) e.preventDefault(); }}
          className="ov-pop fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <RDialog.Title className="sr-only">Search or jump to</RDialog.Title>
          <RDialog.Description className="sr-only">Act on this page, find a page, draft, meeting, contact or agent, or ask an agent.</RDialog.Description>
          <Command label="Search or jump to" loop>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 text-muted" aria-hidden />
              <Command.Input autoFocus value={search} onValueChange={setSearch} placeholder="Search, jump, or ask an agent…" className="h-12 flex-1 bg-transparent text-md outline-none placeholder:text-muted" />
              <span className="kbd">Esc</span>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">Nothing matches.</Command.Empty>
              {here.length > 0 && (
                <Command.Group heading="This page" className={group}>
                  {here.map((c) => { const I = c.icon ?? Zap; return (
                    <Command.Item key={c.id} value={`this ${c.label}`} onSelect={() => { setOpen(false); c.run(); }} className={cx(item, c.tone === 'danger' && 'text-danger')}>
                      <I className="size-4 text-muted" aria-hidden />{c.label}<Keys keys={c.keys} />
                    </Command.Item>
                  ); })}
                </Command.Group>
              )}
              {!q && recents.length > 0 && (
                <Command.Group heading="Recent" className={group}>
                  {recents.map((r) => { const I = RECENT_ICON[r.kind] ?? History; return (
                    <Command.Item key={r.to} value={`recent ${r.value}`} onSelect={() => go(r.to, r)} className={item}><I className="size-4 text-muted" aria-hidden /><span className="truncate">{r.label}</span></Command.Item>
                  ); })}
                </Command.Group>
              )}
              <Command.Group heading="Go to" className={group}>
                {NAV.filter((n) => n.visible(role, can)).map((n) => (
                  <Command.Item key={n.key} value={`page ${labelFor(n, role)}`} onSelect={() => go(`${base}/${n.key}`, { kind: 'page', label: labelFor(n, role) })} className={item}>
                    <n.icon className="size-4 text-muted" aria-hidden />{labelFor(n, role)}<Keys keys={n.shortcut} />
                  </Command.Item>
                ))}
              </Command.Group>
              {(drafts.data?.items.length ?? 0) > 0 && (
                <Command.Group heading="Drafts in review" className={group}>
                  {drafts.data!.items.slice(0, 8).map((d) => (
                    <Command.Item key={d.id} value={`draft ${d.recipient.name} ${d.recipient.company} ${d.subject}`} onSelect={() => go(`${base}/approvals?d=${d.id}`, { kind: 'draft', label: `${d.recipient.name} · ${d.subject}` })} className={item}>
                      <FileText className="size-4 text-muted" aria-hidden /><span className="truncate">{d.recipient.name} · {d.subject}</span>
                      <span className="ml-auto text-xs text-muted">step {d.step + 1}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {(meetings.data?.length ?? 0) > 0 && (
                <Command.Group heading="Upcoming meetings" className={group}>
                  {meetings.data!.slice(0, 6).map((m) => (
                    <Command.Item key={m.id} value={`meeting ${m.contactName ?? ''} ${m.contactCompany ?? ''}`} onSelect={() => go(`${base}/meetings`, { kind: 'meeting', label: `${m.contactName ?? 'Meeting'} · ${when(m.startsAt, tz)}` })} className={item}>
                      <CalendarDays className="size-4 text-muted" aria-hidden /><span className="truncate">{m.contactName ?? 'Meeting'}</span><span className="truncate text-muted">{m.contactCompany}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted">{when(m.startsAt, tz)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {(agents.data?.length ?? 0) > 0 && (
                <Command.Group heading="Agents" className={group}>
                  {agents.data!.map((a) => (
                    <Command.Item key={a.id} value={`agent ${a.name}`} onSelect={() => go(`${base}/home?agent=${a.id}`, { kind: 'agent', label: a.name })} className={item}>
                      <Bot className="size-4 text-muted" aria-hidden />{a.name}<span className="ml-auto font-mono text-xs text-muted">{a.badge}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {(contacts.data?.length ?? 0) > 0 && (
                <Command.Group heading="Contacts" className={group}>
                  {contacts.data!.slice(0, 60).map((c) => (
                    <Command.Item key={c.id} value={`contact ${c.name} ${c.company} ${c.email}`} onSelect={() => go(`${base}/leads?c=${c.id}`, { kind: 'contact', label: `${c.name} · ${c.company}` })} className={item}>
                      <UserRound className="size-4 text-muted" aria-hidden /><span className="truncate">{c.name}</span><span className="truncate text-muted">{c.company}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {askable.length > 0 && (
                // forceMount + a value that always contains the query: these rows answer "no match" instead of vanishing.
                <Command.Group heading="Ask an agent" className={group} forceMount>
                  {askable.map((a) => (
                    <Command.Item key={a.id} forceMount value={`ask ${a.name}`} onSelect={() => { setOpen(false); nav(`${base}/home?agent=${a.id}`, { state: { ask: q }, viewTransition: true }); }} className={item}>
                      <Sparkles className="size-4 text-muted" aria-hidden /><span className="truncate">Ask {a.name}: &ldquo;{q}&rdquo;</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Actions" className={group}>
                {can('approve') && <Command.Item value="pause all sending hold" onSelect={pause} className={item}><PauseCircle className="size-4 text-danger" aria-hidden />Pause all sending in this workspace</Command.Item>}
                {can('members') && <Command.Item value="invite teammate member" onSelect={() => go(`${base}/settings?tab=members`)} className={item}><UserPlus className="size-4 text-muted" aria-hidden />Invite a teammate</Command.Item>}
                <Command.Item value="theme dark light" onSelect={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setOpen(false); }} className={item}>
                  {theme === 'dark' ? <Sun className="size-4 text-muted" aria-hidden /> : <Moon className="size-4 text-muted" aria-hidden />}{theme === 'dark' ? 'Light theme' : 'Dark theme (proposal)'}
                </Command.Item>
                <Command.Item value="density compact comfortable rows" onSelect={() => { setDensity(density === 'compact' ? 'comfortable' : 'compact'); setOpen(false); }} className={cx(item, 'max-md:hidden')}>
                  <Rows3 className="size-4 text-muted" aria-hidden />{density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
