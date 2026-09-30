import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import { ChevronsUpDown, Check, Plus, Search, Moon, Sun, LogOut, RotateCcw, UserRound, MoreHorizontal, ShieldCheck, LayoutGrid, Keyboard, PauseCircle, KeyRound, Rows3 } from 'lucide-react';
import { api } from '@/lib/api';
import { useQuery, useHotkeys } from '@/lib/hooks';
import { useSession, useWorkspace } from '@/lib/session';
import { useTheme, setTheme, useDensity, setDensity } from '@/lib/theme';
import { ROLE, initials } from '@/lib/format';
import { PERSONAS } from '@/lib/api/demo/seed';
import { NAV, MOBILE_PRIMARY, SECONDARY, labelFor, type PageKey } from './nav';
import { CommandPalette } from './CommandPalette';
import { prefetchProps } from './prefetch';
import { useOverlay, openOverlay, toggleOverlay } from '@/lib/overlays';
import { usePending, undoLatest } from '@/lib/undo';
import { usePageCommands } from '@/lib/commands';
import { Avatar, Badge, Banner, Button, Count, Field, IconButton, Input, Sheet, cx } from '../ui';

function useNavCounts() {
  const { scope, can } = useWorkspace();
  const approvals = useQuery(() => api.approvals(scope, { status: 'review' }), [scope.workspaceId], { enabled: can('approve'), pollMs: 60000 });
  const inbox = useQuery(() => api.inbox(scope), [scope.workspaceId], { enabled: can('inbox_read'), pollMs: 60000 });
  const capacity = useQuery(() => api.capacity(scope), [scope.workspaceId], { pollMs: 60000 });
  const pending = usePending();
  const urgent = (inbox.data ?? []).filter((r) => !pending.isHidden(r.id) && r.slaMinutesRemaining !== null && r.slaMinutesRemaining < 60).length;
  const decided = (approvals.data?.items ?? []).filter((d) => pending.isHidden(d.id)).length;
  return { review: Math.max(0, (approvals.data?.counts.review ?? 0) - decided), urgent, capacity: capacity.data };
}

function Logo({ small }: { small?: boolean }) {
  const theme = useTheme();
  return <img src={theme === 'dark' ? '/logo-on-dark.svg' : '/logo-mark-small.svg'} alt="" width={small ? 24 : 28} height={small ? 24 : 28} className="shrink-0" />;
}

export function AppShell() {
  const { role, can, name, scope } = useWorkspace();
  const { org } = useSession();
  const reduce = useReducedMotion();
  const nav = useNavigate();
  const loc = useLocation();
  const { page } = useParams();
  const { review, urgent, capacity } = useNavCounts();
  const [more, setMore] = useState(false);
  const items = NAV.filter((n) => n.visible(role, can));
  const client = role === 'client_viewer';
  const base = `/w/${scope.workspaceId}`;
  const count = (k: PageKey) => (k === 'approvals' ? <Count n={review} label={`${review} drafts in review`} /> : k === 'inbox' ? <Count n={urgent} tone="danger" label={`${urgent} replies due within an hour`} /> : null);

  // g-then-key navigation, "?" for the shortcut sheet, Ctrl/Cmd K for the palette.
  const pending = useRef<number | null>(null);
  useHotkeys({
    g: () => { pending.current = window.setTimeout(() => { pending.current = null; }, 900); },
    '?': () => openOverlay('help'),
    z: () => { if (!undoLatest()) toast('Nothing to undo.', { duration: 1500 }); },
    ...Object.fromEntries(items.filter((i) => i.shortcut).map((i) => [i.shortcut!.split(' ')[1], () => {
      if (pending.current) { clearTimeout(pending.current); pending.current = null; nav(`${base}/${i.key}`, { viewTransition: true }); }
    }])),
  }, [items.length, base]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleOverlay('palette'); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  // Route change: land on the page title (announced by screen readers), else on <main>.
  useEffect(() => {
    setMore(false);
    // Unless the new screen already placed focus inside itself (the composer after "Ask an agent").
    const main = document.getElementById('main'); const a = document.activeElement;
    if (!(main && a && a !== main && main.contains(a))) (document.querySelector<HTMLElement>('#main h1[tabindex="-1"]') ?? main)?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('password') === 'changed') { toast.success('Password changed. Other devices are signed out.'); q.delete('password'); history.replaceState(null, '', `${window.location.pathname}${q.size ? `?${q}` : ''}`); }
  }, []);
  useEffect(() => { document.title = client ? `${org?.name ?? ''}` : 'Omni-SDR'; }, [client, org?.name]);

  const hold = capacity?.workspaceOnHold ? capacity.holds.find((h) => h.scopeType === 'workspace' || h.scopeType === 'org') : null;

  return (
    <div className="ambient flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-[70] rounded-md bg-surface px-3 py-2 shadow-lg focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>
      <header className="glass sticky top-0 z-40 border-x-0 border-t-0 [view-transition-name:app-header]">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 md:px-4">
          <NavLink to={`${base}/${client ? 'analytics' : 'home'}`} className="flex items-center gap-2 rounded-md pr-1" aria-label={client ? `${org?.name} home` : 'Omni-SDR home'}>
            {client ? <Avatar text={initials(org?.name)} size={28} className="rounded-lg" /> : <Logo />}
            <span className="hidden font-semibold xl:inline">{client ? org?.name : 'Omni-SDR'}</span>
          </NavLink>
          <WorkspaceSwitcher current={name} />
          <nav aria-label="Main" className="ml-2 hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
            {items.filter((i) => !SECONDARY.includes(i.key)).map((i) => (
              <NavLink key={i.key} to={`${base}/${i.key}`} viewTransition {...prefetchProps(i.key, scope)} className={({ isActive }) => cx('relative isolate flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors',
                isActive ? 'text-fg' : 'text-muted hover:text-fg')}>
                {({ isActive }) => (<>
                  {isActive && <motion.span layoutId="nav-pill" className="absolute inset-0 -z-10 rounded-md bg-surface shadow-sm ring-1 ring-line" transition={{ type: 'spring', bounce: 0.1, duration: 0.35 }} />}
                  <i.icon className="size-4" aria-hidden /><span>{labelFor(i, role)}</span>{count(i.key)}
                </>)}
              </NavLink>
            ))}
            {items.some((i) => SECONDARY.includes(i.key)) && (
              <Menu.Root modal={false}>
                <Menu.Trigger className={cx('relative isolate flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors',
                  SECONDARY.includes(page as PageKey) ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg')}>
                  <MoreHorizontal className="size-4" aria-hidden />{SECONDARY.includes(page as PageKey) ? labelFor(items.find((i) => i.key === page)!, role) : 'More'}
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content align="start" sideOffset={6} className={cx(menuPanel, 'min-w-52')}>
                    {items.filter((i) => SECONDARY.includes(i.key)).map((i) => (
                      <Menu.Item key={i.key} className={menuItem} onSelect={() => nav(`${base}/${i.key}`, { viewTransition: true })}><i.icon className="size-4" aria-hidden />{labelFor(i, role)}
                        {i.shortcut && <span className="ml-auto flex gap-1">{i.shortcut.split(' ').map((k) => <span key={k} className="kbd">{k}</span>)}</span>}</Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            )}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button onClick={() => openOverlay('palette')} className="hidden h-9 items-center gap-2 rounded-md border border-line bg-surface/70 px-2.5 text-sm text-muted transition-colors hover:text-fg md:flex">
              <Search className="size-4" aria-hidden /><span className="hidden 2xl:inline">Search or jump to…</span><span className="kbd">Ctrl K</span>
            </button>
            <IconButton label="Search" className="md:hidden" onClick={() => openOverlay('palette')}><Search className="size-5" aria-hidden /></IconButton>
            {!client && <span className="hidden 2xl:block"><Badge tone="neutral" icon={<ShieldCheck className="size-3.5" aria-hidden />}>Level 1 · you approve every message</Badge></span>}
            <span className="hidden sm:block"><ThemeButton /></span>
            <UserMenu onHelp={() => openOverlay('help')} />
          </div>
        </div>
      </header>

      <AnimatePresence>
        {hold && (
          <motion.div initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mx-auto max-w-[1600px] px-3 pt-3 md:px-4">
              <Banner tone="warning" role="status" title="Sending is paused for this workspace."
                action={can('clear_hold') ? <Button size="sm" onClick={() => api.clearHold(scope, hold.scopeType, hold.scopeId).then(() => toast.success('Resumed. Approved drafts send in the next window.'))}>Resume sending</Button> : undefined}>
                Set {hold.setBy.startsWith('user:') ? 'by a teammate' : 'by Omni-SDR'} · &ldquo;{hold.reason}&rdquo;. Nothing sends until an admin resumes it.
              </Banner>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main id="main" tabIndex={-1} className="flex-1 pb-24 outline-none lg:pb-0">
        <Outlet />
      </main>

      {/* Phone and tablet: bottom bar (DESIGN 5.2) */}
      <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 pb-safe [view-transition-name:app-tabbar] lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {items.filter((i) => MOBILE_PRIMARY.includes(i.key) || (client && i.key === 'analytics')).slice(0, 4).map((i) => (
            <NavLink key={i.key} to={`${base}/${i.key}`} viewTransition {...prefetchProps(i.key, scope)} className={({ isActive }) => cx('relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium', isActive ? 'text-fg' : 'text-muted')}>
              {({ isActive }) => (<>
                {isActive && <motion.span layoutId="tab-dot" className="absolute top-1.5 h-1 w-8 rounded-full bg-fill" transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }} />}
                <span className="relative"><i.icon className="size-5" aria-hidden />
                  <span className="absolute -top-2 -right-3">{count(i.key)}</span></span>
                {labelFor(i, role)}
              </>)}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted" aria-haspopup="dialog">
            <MoreHorizontal className="size-5" aria-hidden />More
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="More">
        <div className="grid grid-cols-3 gap-2 pb-2">
          {items.filter((i) => !MOBILE_PRIMARY.includes(i.key)).map((i) => (
            <NavLink key={i.key} to={`${base}/${i.key}`} viewTransition {...prefetchProps(i.key, scope)} className={({ isActive }) => cx('flex flex-col items-center gap-2 rounded-lg border p-3 text-sm font-medium', isActive ? 'border-ink bg-accent-soft' : 'border-line bg-surface')}>
              <i.icon className="size-5" aria-hidden />{labelFor(i, role)}
            </NavLink>
          ))}
          <NavLink to="/workspaces" className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface p-3 text-sm font-medium"><LayoutGrid className="size-5" aria-hidden />Workspaces</NavLink>
        </div>
      </Sheet>

      <PaletteHost />
      <HelpHost />
    </div>
  );
}

function ThemeButton() {
  const theme = useTheme();
  return (
    <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme (proposal)'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ rotate: -60, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 60, opacity: 0 }} transition={{ duration: 0.18 }}>
          {theme === 'dark' ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}

const menuItem = 'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm outline-none data-[highlighted]:bg-sunken';
const menuPanel = 'menu-pop z-50 min-w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg';

function WorkspaceSwitcher({ current }: { current: string }) {
  const { org } = useSession();
  const { scope, role } = useWorkspace();
  const nav = useNavigate();
  const { page } = useParams();
  const [adding, setAdding] = useState(false);
  const canAdd = org?.role === 'admin' && org.accountType === 'agency';
  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-sunken lg:h-10 lg:flex-none">
          <span className="min-w-0 leading-tight">
            {role !== 'client_viewer' && <span className="hidden text-xs text-muted sm:block">{org?.name}</span>}
            <span className="block truncate text-sm font-semibold sm:max-w-[220px]">{current || '…'}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={6} className={menuPanel}>
            <Menu.Label className="px-2.5 py-1.5 text-xs text-muted">{org?.name} · {org?.accountType === 'agency' ? 'Agency' : 'Owner'}</Menu.Label>
            {org?.workspaces.map((w) => (
              <Menu.Item key={w.id} className={menuItem} onSelect={() => nav(`/w/${w.id}/${page ?? 'home'}`)}>
                <Avatar text={initials(w.name)} size={24} className="rounded-md" />
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === scope.workspaceId && <Check className="size-4 text-ink" aria-label="Current" />}
              </Menu.Item>
            ))}
            <Menu.Separator className="my-1 h-px bg-line" />
            <Menu.Item className={menuItem} onSelect={() => nav('/workspaces')}><LayoutGrid className="size-4" aria-hidden />All workspaces</Menu.Item>
            {canAdd && <Menu.Item className={menuItem} onSelect={() => setAdding(true)}><Plus className="size-4" aria-hidden />New client workspace</Menu.Item>}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <NewWorkspaceSheet open={adding} onOpenChange={setAdding} />
    </>
  );
}

export function NewWorkspaceSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { org } = useSession();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const { workspaceId } = await api.createWorkspace(org!.id, name);
      onOpenChange(false); setName('');
      toast.success(`${name.trim()} is ready. Teach it the offer and ICP next.`);
      nav(`/w/${workspaceId}/home`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="New client workspace" description="Each client gets its own leads, agents, inbox and sending limits."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>Create workspace</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) submit(); }}>
        <Field label="Client name" error={err}>{(p) => <Input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="Harbor Legal" />}</Field>
      </form>
    </Sheet>
  );
}

function UserMenu({ onHelp }: { onHelp: () => void }) {
  const { me, org, persona, switchPersona, resetDemo } = useSession();
  const nav = useNavigate();
  const theme = useTheme();
  const density = useDensity();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="rounded-full p-0.5 transition-shadow hover:ring-2 hover:ring-line" aria-label="Account menu">
        <Avatar text={initials(me?.user.email)} size={32} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className={cx(menuPanel, 'w-72')}>
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{me?.user.email}</p>
            <p className="text-xs text-muted">{org && ROLE[org.role].label} · {org && ROLE[org.role].hint}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Label className="flex items-center gap-2 px-2.5 pt-1.5 pb-1 text-xs text-muted"><UserRound className="size-3.5" aria-hidden />Try another role <Badge tone="info" className="ml-auto">Demo</Badge></Menu.Label>
          <Menu.RadioGroup value={persona} onValueChange={(v) => { switchPersona(v); nav('/'); toast(`Viewing as ${PERSONAS.find((p) => p.email === v)?.name}`); }}>
            {PERSONAS.map((p) => (
              <Menu.RadioItem key={p.email} value={p.email} className={menuItem}>
                <span className="grid size-4 place-items-center"><Menu.ItemIndicator><Check className="size-4 text-ink" aria-hidden /></Menu.ItemIndicator></span>
                <span className="min-w-0 flex-1"><span className="block truncate">{p.name}</span><span className="block truncate text-xs text-muted">{ROLE[p.role].label}: {p.blurb}</span></span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item className={menuItem} onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}{theme === 'dark' ? 'Light theme' : 'Dark theme (proposal)'}</Menu.Item>
          <Menu.Item className={cx(menuItem, 'max-md:hidden')} onSelect={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}><Rows3 className="size-4" aria-hidden />{density === 'compact' ? 'Comfortable rows' : 'Compact rows'}</Menu.Item>
          <Menu.Item className={cx(menuItem, 'max-lg:hidden')} onSelect={onHelp}><Keyboard className="size-4" aria-hidden />Keyboard shortcuts<span className="kbd ml-auto">?</span></Menu.Item>
          <Menu.Item className={menuItem} onSelect={() => { resetDemo(); nav('/'); toast.success('Demo data reset.'); }}><RotateCcw className="size-4" aria-hidden />Reset demo data</Menu.Item>
          <Menu.Separator className="my-1 h-px bg-line" />
          {/* Served by the sign-in Worker, not the app router: a full page load. */}
          <Menu.Item asChild className={menuItem}><a href="/auth/password"><KeyRound className="size-4" aria-hidden />Change password</a></Menu.Item>
          <form method="post" action="/auth/logout">
            <Menu.Item asChild className={cx(menuItem, 'w-full text-danger')} onSelect={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).closest('form')?.requestSubmit(); }}>
              <button type="submit"><LogOut className="size-4" aria-hidden />Sign out</button>
            </Menu.Item>
          </form>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function PaletteHost() { const [open, set] = useOverlay('palette'); return <CommandPalette open={open} onOpenChange={set} />; }
function HelpHost() { const [open, set] = useOverlay('help'); return <ShortcutSheet open={open} onOpenChange={set} />; }

// Both lists are derived: page keys from the registry the palette reads, global keys from NAV. Nothing hand-listed.
function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { role, can } = useWorkspace();
  const here = usePageCommands().filter((c) => c.keys);
  const everywhere: [string, ReactNode][] = [
    ['Ctrl K', 'Search, jump, or ask an agent'],
    ...NAV.filter((n) => n.visible(role, can) && n.shortcut).map((n): [string, ReactNode] => [n.shortcut!, labelFor(n, role)]),
    ['Z', 'Undo the last approval or change'], ['?', 'This sheet'],
  ];
  const list = (rows: [string, ReactNode][]) => (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 pb-2">
      {rows.map(([k, v]) => (<Fragment key={k}><dt className="justify-self-end">{k.split(' ').map((p) => <span key={p} className="kbd mx-0.5">{p}</span>)}</dt><dd className="text-sm">{v}</dd></Fragment>))}
    </dl>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      {here.length > 0 && <><h3 className="label mb-2">On this page</h3>{list(here.map((c): [string, ReactNode] => [c.keys!, c.label]))}</>}
      <h3 className={cx('label mb-2', here.length > 0 && 'mt-4')}>Everywhere</h3>
      {list(everywhere)}
      <p className="mt-2 flex items-center gap-2 text-xs text-muted"><PauseCircle className="size-3.5" aria-hidden />Shortcuts pause while you type.</p>
    </Sheet>
  );
}
