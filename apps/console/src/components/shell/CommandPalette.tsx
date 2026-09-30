// Ctrl/Cmd K: jump to any page, agent, contact or draft; run the few safe global actions (DESIGN 5.4).
import { Command } from 'cmdk';
import * as RDialog from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Search, Bot, UserRound, FileText, PauseCircle, UserPlus, Moon, Sun, Rows3 } from 'lucide-react';
import { api } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { useTheme, setTheme, useDensity, setDensity } from '@/lib/theme';
import { NAV, labelFor } from './nav';
import { cx } from '../ui';

const item = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm aria-selected:bg-sunken data-[selected=true]:bg-sunken';
const group = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { scope, role, can } = useWorkspace();
  const nav = useNavigate();
  const theme = useTheme();
  const density = useDensity();
  const base = `/w/${scope.workspaceId}`;
  const agents = useQuery(() => api.agents(scope), [scope.workspaceId], { enabled: open && role !== 'client_viewer' });
  const contacts = useQuery(() => api.contacts(scope), [scope.workspaceId], { enabled: open && can('build') });
  const drafts = useQuery(() => api.approvals(scope, { status: 'review' }), [scope.workspaceId], { enabled: open && can('approve') });
  const go = (to: string) => { onOpenChange(false); nav(to); };
  const pause = async () => {
    onOpenChange(false);
    try { await api.setHold(scope, { scopeType: 'workspace', reason: 'Paused from the command palette' }); toast.success('Paused. Nothing sends from this workspace until an admin resumes it.'); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
          <RDialog.Portal>
            <RDialog.Overlay className="ov-fade fixed inset-0 z-50 bg-inverse/30" />
            <RDialog.Content
                className="ov-pop fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
                <RDialog.Title className="sr-only">Search or jump to</RDialog.Title>
                <RDialog.Description className="sr-only">Type to find a page, agent, contact or draft.</RDialog.Description>
                <Command label="Search or jump to" loop>
                  <div className="flex items-center gap-2 border-b border-line px-3">
                    <Search className="size-4 text-muted" aria-hidden />
                    <Command.Input autoFocus placeholder="Search pages, agents, contacts, drafts…" className="h-12 flex-1 bg-transparent text-md outline-none placeholder:text-muted" />
                    <span className="kbd">Esc</span>
                  </div>
                  <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
                    <Command.Empty className="px-3 py-8 text-center text-sm text-muted">Nothing matches.</Command.Empty>
                    <Command.Group heading="Go to" className={group}>
                      {NAV.filter((n) => n.visible(role, can)).map((n) => (
                        <Command.Item key={n.key} value={`page ${labelFor(n, role)}`} onSelect={() => go(`${base}/${n.key}`)} className={item}>
                          <n.icon className="size-4 text-muted" aria-hidden />{labelFor(n, role)}
                          {n.shortcut && <span className="ml-auto flex gap-1">{n.shortcut.split(' ').map((k) => <span key={k} className="kbd">{k}</span>)}</span>}
                        </Command.Item>
                      ))}
                    </Command.Group>
                    {(drafts.data?.items.length ?? 0) > 0 && (
                      <Command.Group heading="Drafts in review" className={group}>
                        {drafts.data!.items.slice(0, 8).map((d) => (
                          <Command.Item key={d.id} value={`draft ${d.recipient.name} ${d.recipient.company} ${d.subject}`} onSelect={() => go(`${base}/approvals?d=${d.id}`)} className={item}>
                            <FileText className="size-4 text-muted" aria-hidden /><span className="truncate">{d.recipient.name} · {d.subject}</span>
                            <span className="ml-auto text-xs text-muted">step {d.step + 1}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {(agents.data?.length ?? 0) > 0 && (
                      <Command.Group heading="Agents" className={group}>
                        {agents.data!.map((a) => (
                          <Command.Item key={a.id} value={`agent ${a.name}`} onSelect={() => go(`${base}/home?agent=${a.id}`)} className={item}>
                            <Bot className="size-4 text-muted" aria-hidden />{a.name}<span className="ml-auto font-mono text-xs text-muted">{a.badge}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {(contacts.data?.length ?? 0) > 0 && (
                      <Command.Group heading="Contacts" className={group}>
                        {contacts.data!.slice(0, 60).map((c) => (
                          <Command.Item key={c.id} value={`contact ${c.name} ${c.company} ${c.email}`} onSelect={() => go(`${base}/leads?c=${c.id}`)} className={item}>
                            <UserRound className="size-4 text-muted" aria-hidden /><span className="truncate">{c.name}</span><span className="truncate text-muted">{c.company}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    <Command.Group heading="Actions" className={group}>
                      {can('approve') && <Command.Item value="pause all sending hold" onSelect={pause} className={item}><PauseCircle className="size-4 text-danger" aria-hidden />Pause all sending in this workspace</Command.Item>}
                      {can('members') && <Command.Item value="invite teammate member" onSelect={() => go(`${base}/settings?tab=members`)} className={item}><UserPlus className="size-4 text-muted" aria-hidden />Invite a teammate</Command.Item>}
                      <Command.Item value="theme dark light" onSelect={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); onOpenChange(false); }} className={item}>
                        {theme === 'dark' ? <Sun className="size-4 text-muted" aria-hidden /> : <Moon className="size-4 text-muted" aria-hidden />}{theme === 'dark' ? 'Light theme' : 'Dark theme (proposal)'}
                      </Command.Item>
                      <Command.Item value="density compact comfortable rows" onSelect={() => { setDensity(density === 'compact' ? 'comfortable' : 'compact'); onOpenChange(false); }} className={cx(item, 'max-md:hidden')}>
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
