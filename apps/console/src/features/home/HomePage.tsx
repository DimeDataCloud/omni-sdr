// Home (DESIGN 6.3, UI-REVISION-PLAN Phase 3). Desktop: agents on the left, the agent core in the middle (or the
// open conversation, the ask beside the result it builds), Today on the right. Phones: Today is a bento of tiles,
// Agents is the list, and an agent opens full screen.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { ArrowLeft, Search, Plus, PanelRightOpen, CalendarClock, ShieldCheck, Sparkles, Bot, AlertTriangle, PauseCircle, Clock3, CheckCheck, Inbox as InboxIcon, Orbit } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { About, Agent, AskMode, ChatMessage, ModelTier } from '@/lib/api/types';
import { useMedia, useNow, useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { deferAction, usePending } from '@/lib/undo';
import { agentFor, aboutHref, type AskHandoff } from '@/lib/ask';
import { TIER, clock, dayLabel, relTime, slaText, plural, fmtDur } from '@/lib/format';
import { SUGGESTIONS } from '@/lib/api/demo/brain';
import { Avatar, Badge, Banner, Button, Card, EmptyState, ErrorState, IconButton, Meter, Segmented, Sheet, Skeleton, SkeletonList, Switch, cx, listItem, listStagger } from '@/components/ui';
import { AboutChip, Composer } from './Composer';
import { AgentCore, Bento, Briefing, Greeting, Wins, useGhostContext } from './Core';
import { PauseSheet } from './PauseSheet';

type Submit = NonNullable<AskHandoff['submit']>;

export default function HomePage() {
  const { scope } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const loc = useLocation();
  const agents = useQuery(() => api.agents(scope), [scope.workspaceId]);
  const wide = useMedia('(min-width: 1280px)');
  const desktop = useMedia('(min-width: 960px)');
  const [todayOpen, setTodayOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'today' | 'agents'>('today');
  const pending = usePending();
  const list = useMemo(() => [...(agents.data ?? [])].filter((a) => !pending.isHidden(a.id)).sort((a, b) => (b.lastMessage?.at ?? b.createdAt).localeCompare(a.lastMessage?.at ?? a.createdAt)), [agents.data, pending]);
  const selected = list.find((a) => a.id === params.get('agent')) ?? null;
  const select = (id: string | null, o: { replace?: boolean; state?: AskHandoff } = {}) => setParams(id ? { agent: id } : {}, { replace: o.replace ?? desktop, state: o.state });

  // "Ask about this" on a phone: there is no core composer, so the object goes straight to the agent that knows it.
  useEffect(() => {
    const about = (loc.state as AskHandoff | null)?.about;
    if (desktop || selected || !about || !list.length) return;
    const a = agentFor(list, about.kind);
    if (a) select(a.id, { replace: true, state: { about } });
  }, [loc.key, desktop, list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!desktop) {
    if (selected) return <ChatView key={selected.id} agent={selected} onBack={() => select(null)} />;
    return (
      <div className="px-4 pt-4">
        <div className="mb-4 flex justify-center"><Segmented id="home-m" label="Home view" value={mobileTab} onChange={setMobileTab} options={[{ value: 'today', label: 'Today' }, { value: 'agents', label: 'Agents' }]} /></div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={mobileTab} initial={{ opacity: 0, x: mobileTab === 'today' ? -12 : 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {mobileTab === 'today' ? <Bento key={scope.workspaceId} agents={list} onOpenAgent={(id) => select(id, { replace: false })} /> : <AgentRail agents={list} loading={agents.loading} selectedId={null} onSelect={(id) => select(id)} />}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-56px)] max-w-[1600px]">
      <aside aria-label="Agents" className="w-[280px] shrink-0 overflow-y-auto border-r border-line p-3">
        <AgentRail agents={list} loading={agents.loading} selectedId={selected?.id ?? null} onSelect={(id) => select(id)} onOverview={() => select(null)} />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {agents.error ? <div className="p-6"><ErrorState error={agents.error} onRetry={agents.reload} /></div>
          : selected ? <ChatView key={selected.id} agent={selected} headerExtra={!wide && <Button size="sm" variant="secondary" icon={<PanelRightOpen className="size-4" aria-hidden />} onClick={() => setTodayOpen(true)}>Today</Button>} />
          : agents.loading ? <div className="p-6"><SkeletonList rows={3} /></div>
          : list.length ? <CoreView key={scope.workspaceId} agents={list} onAsked={(id, submit) => select(id, { replace: false, state: { submit } })}
              extra={!wide && <Button size="sm" variant="secondary" icon={<PanelRightOpen className="size-4" aria-hidden />} onClick={() => setTodayOpen(true)}>Today</Button>} />
          : <NoAgents />}
      </section>
      {wide ? (
        <aside aria-label="Today" className="w-[360px] shrink-0 overflow-y-auto border-l border-line p-4"><TodayPanel /></aside>
      ) : (
        <Sheet open={todayOpen} onOpenChange={setTodayOpen} title="Today"><TodayPanel /></Sheet>
      )}
    </div>
  );
}

// ── The core view: the signature moment ───────────────────────────────────────────────────────
function CoreView({ agents, onAsked, extra }: { agents: Agent[]; onAsked: (agentId: string, submit: Submit) => void; extra?: React.ReactNode }) {
  const { can } = useWorkspace();
  const ghost = useGhostContext();
  const [agentId, setAgentId] = useState<string | undefined>(() => agentFor(agents)?.id);
  const agent = agents.find((a) => a.id === agentId) ?? agentFor(agents)!;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[820px] space-y-5 px-6 py-7">
        <div className="flex items-end gap-3"><Greeting className="min-w-0 flex-1" />{extra}</div>
        <Briefing />
        <AgentCore />
        {can('build') && (
          <Composer agent={agent} agents={agents} onAgent={setAgentId} busy={false} ghost={ghost}
            onAttach={(a) => { const to = agentFor(agents, a.kind); if (to) setAgentId(to.id); }}
            onAsk={(text, tier, o) => onAsked(agent.id, { text, tier, about: o.about, mode: o.mode })} />
        )}
        <Wins />
      </div>
    </div>
  );
}

// ── Agent rail ────────────────────────────────────────────────────────────────────────────────
function AgentRail({ agents, loading, selectedId, onSelect, onOverview }: { agents: Agent[]; loading: boolean; selectedId: string | null; onSelect: (id: string) => void; onOverview?: () => void }) {
  const { tz, can } = useWorkspace();
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const now = useNow();
  const shown = agents.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));
  const row = (on: boolean) => cx('relative flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors', on ? 'bg-surface shadow-md ring-1 ring-line' : 'hover:bg-surface/60');
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search agents</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents" className="h-9 w-full rounded-md border border-line bg-surface/70 pr-2 pl-8 text-sm placeholder:text-muted max-md:h-11" />
        </label>
        {can('build') && <IconButton label="New agent" onClick={() => nav('../agents?new=agent')} className="border border-line bg-surface/70"><Plus className="size-4" aria-hidden /></IconButton>}
      </div>
      {onOverview && (
        <button onClick={onOverview} aria-current={!selectedId || undefined} className={cx(row(!selectedId), 'mb-1 items-center')}>
          {!selectedId && <motion.span layoutId="agent-sel" className="absolute top-3 bottom-3 left-0 w-[3px] rounded-full bg-ink" />}
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-ink"><Orbit className="size-4" aria-hidden /></span>
          <span className="min-w-0 flex-1"><span className="block font-medium">Overview</span><span className="block text-sm text-muted">Today&rsquo;s pipeline and briefing</span></span>
        </button>
      )}
      {loading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div> : (
        <motion.ul variants={listStagger} initial="hidden" animate="show" className="space-y-1">
          {shown.map((a) => {
            const on = a.id === selectedId;
            return (
              <motion.li key={a.id} variants={listItem}>
                <button onClick={() => onSelect(a.id)} aria-current={on || undefined} className={row(on)}>
                  {on && <motion.span layoutId="agent-sel" className="absolute top-3 bottom-3 left-0 w-[3px] rounded-full bg-ink" />}
                  <Avatar kind="agent" text={a.badge} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2"><span className="truncate font-medium">{a.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted">{a.lastMessage ? relTime(a.lastMessage.at, tz, now) : ''}</span></span>
                    <span className="line-clamp-1 text-sm text-muted">{a.lastMessage?.preview ?? (a.autonomousMode ? `${plural(a.activeRoutines, 'routine')} running` : 'No messages yet')}</span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
      <p className="mt-4 flex items-start gap-2 px-1 text-xs text-muted"><ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />Agents draft and answer. Nothing they write goes out until a person approves it.</p>
    </div>
  );
}

function NoAgents() {
  const { scope, can } = useWorkspace();
  const presets = [['Sales Outbound', 'SDR', 'sales_outbound'], ['Inbox Triage', 'TRI', 'inbox_triage'], ['Chief of Staff', 'EXEC', 'chief_of_staff']] as const;
  return (
    <EmptyState icon={<Bot className="size-5" aria-hidden />} title="Create your first agent" body="Agents research, draft and summarize. Start from a preset; you can change everything later."
      action={can('build') ? <div className="flex flex-wrap justify-center gap-2">{presets.map(([name, badge, station]) => (
        <Button key={name} onClick={() => api.createAgent(scope, { name, badge, station }).then(() => toast.success(`${name} is ready.`))}>{name}</Button>))}</div> : undefined} />
  );
}

// ── Chat: the ask beside the result it builds ─────────────────────────────────────────────────
const consumed = new Set<string>(); // history entries whose submit already ran (StrictMode runs effects twice)

function ChatView({ agent, onBack, headerExtra }: { agent: Agent; onBack?: () => void; headerExtra?: React.ReactNode }) {
  const { scope, tz, can } = useWorkspace();
  const msgs = useQuery(() => api.messages(scope, agent.id), [scope.workspaceId, agent.id]);
  const ghost = useGhostContext();
  const [pending, setPending] = useState<ChatMessage | null>(null);
  const [failed, setFailed] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => [...(msgs.data ?? []), ...(pending && !msgs.data?.some((m) => m.body === pending.body && m.sender === 'user' && m.createdAt >= pending.createdAt) ? [pending] : [])], [msgs.data, pending]);
  const thinking = Boolean(pending) && !failed;
  // Answers already here when the conversation opened are history; only answers that arrive while you watch build in.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && msgs.data) seen.current = new Set(msgs.data.map((m) => m.id));
  const turns = useMemo(() => {
    const out: { ask: ChatMessage | null; replies: ChatMessage[] }[] = [];
    for (const m of items) { if (m.sender === 'user' || !out.length) out.push({ ask: m.sender === 'user' ? m : null, replies: m.sender === 'user' ? [] : [m] }); else out.at(-1)!.replies.push(m); }
    return out;
  }, [items]);

  useLayoutEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: items.length > 1 ? 'smooth' : 'auto' }); }, [items.length, thinking]);

  const ask = async (text: string, tier: ModelTier, o: { about: About | null; mode: AskMode }) => {
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, sender: 'user', authorId: null, body: text, meta: { ...(o.about ? { about: o.about } : {}), ...(o.mode !== 'ask' ? { mode: o.mode } : {}) }, createdAt: new Date().toISOString() };
    setPending(optimistic); setFailed(false);
    try { await api.sendMessage(scope, agent.id, text, tier, o); setPending(null); }
    catch (e) { setFailed(true); if (e instanceof ApiError && e.status !== 502) toast.error(e.message); }
  };
  // An ask made on the core view arrives here in history state, already decided: send it once.
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    const s = (loc.state as AskHandoff | null)?.submit;
    if (!s || consumed.has(loc.key)) return;
    consumed.add(loc.key);
    void ask(s.text, s.tier as ModelTier, { about: s.about, mode: s.mode });
    nav({ pathname: loc.pathname, search: loc.search }, { replace: true, state: null });
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', onBack && 'h-[calc(100dvh-56px-64px)]')}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        {onBack && <IconButton label="Back to agents" onClick={onBack}><ArrowLeft className="size-5" aria-hidden /></IconButton>}
        <Avatar kind="agent" text={agent.badge} size={36} />
        <div className="min-w-0 flex-1">
          <h1 tabIndex={-1} className="truncate text-lg leading-tight outline-none">{agent.name}</h1>
          <p className="truncate text-xs text-muted">{TIER[agent.modelTier].label} · {plural(agent.activeRoutines, 'routine')} · <span className="font-medium text-fg">can draft, can&rsquo;t send</span></p>
        </div>
        {headerExtra}
      </div>
      <div ref={logRef} role="log" aria-live="polite" aria-label={`Conversation with ${agent.name}`} className="@container min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
        {msgs.loading ? <SkeletonList rows={3} /> : items.length === 0 && !thinking ? (
          <div className="mx-auto max-w-lg pt-8 text-center">
            <Avatar kind="agent" text={agent.badge} size={48} className="mx-auto" />
            <p className="mt-3 text-lg font-semibold">{agent.name}</p>
            <p className="mt-1 text-sm text-muted">{agent.systemPrompt}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-[1040px] space-y-6">
            {turns.map((t, k) => {
              const last = k === turns.length - 1;
              return (
                <div key={t.ask?.id ?? t.replies[0]?.id} className="grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] @2xl:gap-6">
                  {t.ask ? <Asked m={t.ask} tz={tz} /> : <div className="hidden @2xl:block" />}
                  <div className="min-w-0 space-y-3">
                    {t.replies.map((m) => <Result key={m.id} m={m} agent={agent} tz={tz} fresh={!seen.current?.has(m.id)} />)}
                    {last && thinking && (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
                        <Avatar kind="agent" text={agent.badge} size={28} />
                        <div className="typing flex gap-1 rounded-xl bg-surface px-4 py-3 shadow-sm ring-1 ring-line" aria-label={`${agent.name} is writing`}><span /><span /><span /></div>
                      </motion.div>
                    )}
                    {last && failed && pending && (
                      <p className="rounded-lg bg-sunken px-3 py-2 text-sm">Didn&rsquo;t get an answer. <button className="font-medium text-ink underline" onClick={() => ask(pending.body, agent.modelTier, { about: pending.meta.about ?? null, mode: pending.meta.mode ?? 'ask' })}>Try again</button></p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {can('build') ? (
        <div className="px-3 pb-3 md:px-8 md:pb-5">
          {(msgs.data?.length ?? 0) < 3 && (
            <div className="mx-auto mb-2 flex max-w-[760px] gap-2 overflow-x-auto pb-1">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s, agent.modelTier, { about: null, mode: 'ask' })} disabled={thinking}
                className="press shrink-0 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-sm hover:border-control hover:bg-surface disabled:opacity-50 max-md:py-2.5">{s}</button>)}
            </div>
          )}
          <Composer agent={agent} busy={thinking} onAsk={ask} ghost={ghost} />
        </div>
      ) : <p className="border-t border-line px-4 py-3 text-center text-sm text-muted">Your role can read agent conversations. Operators and admins can ask agents for work.</p>}
    </div>
  );
}

function Asked({ m, tz }: { m: ChatMessage; tz: string }) {
  const { scope } = useWorkspace();
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
      className="flex flex-col items-end gap-1.5 @2xl:sticky @2xl:top-0 @2xl:items-start @2xl:self-start">
      <p className="label hidden @2xl:block">You asked</p>
      {m.meta.about && <AboutChip about={m.meta.about} href={aboutHref(`/w/${scope.workspaceId}`, m.meta.about)} />}
      {/* Untrusted text: rendered as text, never HTML (DESIGN 2.8). */}
      <div className="max-w-[85%] rounded-xl bg-inverse px-4 py-2.5 text-md whitespace-pre-wrap text-fg-inverse [overflow-wrap:anywhere] @2xl:max-w-full">{m.body}</div>
      <p className="text-xs text-muted">{relTime(m.createdAt, tz)}{m.meta.mode && m.meta.mode !== 'ask' && ` · ${m.meta.mode.replace('_', ' ')} mode`}</p>
    </motion.div>
  );
}

function Result({ m, agent, tz, fresh }: { m: ChatMessage; agent: Agent; tz: string; fresh: boolean }) {
  const nav = useNavigate();
  const links = [
    /approval/i.test(m.body) && { to: '../approvals', label: 'Open Approvals', icon: CheckCheck },
    /\binbox\b|repl(y|ies)|meeting request/i.test(m.body) && { to: '../inbox', label: 'Open Inbox', icon: InboxIcon },
    /blocked/i.test(m.body) && { to: '../approvals?tab=blocked', label: 'See blocked drafts', icon: AlertTriangle },
  ].filter(Boolean) as { to: string; label: string; icon: typeof CheckCheck }[];
  const paras = m.body.split(/\n{2,}/);
  const i = (k: number) => ({ ['--i' as string]: Math.min(k, 12) });
  return (
    <article aria-label={`${agent.name} answered`} className="card min-w-0 p-4">
      <header className="mb-2 flex items-center gap-2">
        <Avatar kind="agent" text={agent.badge} size={24} />
        <span className="text-sm font-medium">{agent.name}</span>
        <span className="text-xs text-muted">· {relTime(m.createdAt, tz)}</span>
      </header>
      <div className={cx('space-y-2.5', fresh && 'build')}>
        {m.meta.sources && m.meta.sources.length > 0 && <p className="label" style={i(0)}>Read {m.meta.sources.join(' · ')}</p>}
        {/* Untrusted text: rendered as text, never HTML (DESIGN 2.8). */}
        {paras.map((p, k) => <p key={k} style={i(k + 1)} className="text-md whitespace-pre-wrap [overflow-wrap:anywhere]">{p}</p>)}
        {links.length > 0 && <div className="flex flex-wrap gap-2 pt-1" style={i(paras.length + 1)}>{links.map((l) => <Button key={l.to} size="sm" variant="secondary" icon={<l.icon className="size-3.5" aria-hidden />} onClick={() => nav(l.to)}>{l.label}</Button>)}</div>}
      </div>
      <p className="mt-3 text-xs text-muted">{m.meta.tier && TIER[m.meta.tier].label}{m.meta.ms != null && ` · ${(m.meta.ms / 1000).toFixed(1)}s`}{m.meta.model === 'demo' && ' · demo answer from workspace data'}</p>
    </article>
  );
}

// ── Today ─────────────────────────────────────────────────────────────────────────────────────
function TodayPanel() {
  const { scope, tz, can } = useWorkspace();
  const nav = useNavigate();
  const now = useNow(30000);
  const pending = usePending();
  const inbox = useQuery(() => api.inbox(scope), [scope.workspaceId], { enabled: can('inbox_read'), pollMs: 60000 });
  const next = useQuery(() => api.approvals(scope, { status: 'review' }), [scope.workspaceId], { enabled: can('approve') });
  const capacity = useQuery(() => api.capacity(scope), [scope.workspaceId]);
  const routines = useQuery(() => api.routines(scope), [scope.workspaceId]);
  const meetings = useQuery(() => api.meetings(scope, 'upcoming'), [scope.workspaceId]);
  const [pauseOpen, setPauseOpen] = useState(false);

  const sla = (inbox.data ?? []).filter((r) => !pending.isHidden(r.id) && r.slaMinutesRemaining !== null).sort((a, b) => a.slaMinutesRemaining! - b.slaMinutesRemaining!)[0];
  const waiting = (next.data?.items ?? []).filter((d) => !pending.isHidden(d.id));
  const top = waiting[0];
  // The same undo window as Approvals: hidden now, sent to the API when the window closes.
  const approveTop = () => {
    if (!top) return;
    deferAction({ ids: [top.id], kind: 'approve', workspaceId: scope.workspaceId, message: `Approved the draft to ${top.recipient.name}. It sends in the next window.`, commit: () => api.approve(scope, top.id),
      onFail: (e) => toast.error(e instanceof ApiError && e.status === 409 ? 'That draft changed before it was approved, so it is back in the list.' : e.message) });
  };

  return (
    <motion.div variants={listStagger} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={listItem} className="flex items-baseline justify-between">
        <h2 className="text-lg">Today</h2>
        <span className="text-xs text-muted">{new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' })}</span>
      </motion.div>

      {sla && (
        <motion.button variants={listItem} onClick={() => nav(`../inbox?r=${sla.id}`)}
          className={cx('press flex w-full items-start gap-3 rounded-xl border p-3.5 text-left',
            sla.slaMinutesRemaining! < 60 ? 'border-danger/30 bg-danger-soft text-danger' : 'border-line bg-surface')}>
          <span className={cx('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', sla.slaMinutesRemaining! < 60 ? 'pulse-danger bg-danger text-surface' : 'bg-accent-soft text-ink')}><CalendarClock className="size-4" aria-hidden /></span>
          <span className="min-w-0">
            <span className="block font-semibold">{sla.contactName} asked for a meeting</span>
            <span className="block text-sm opacity-90">{sla.contactCompany} · reply within <span className="tabular font-semibold">{slaText(sla.slaMinutesRemaining!).replace(' left', '')}</span></span>
          </span>
        </motion.button>
      )}

      {can('approve') && (
        <motion.section variants={listItem} aria-labelledby="t-next">
          <div className="mb-2 flex items-center justify-between"><h3 id="t-next" className="section-title">Next approval</h3>
            {waiting.length > 0 && <button className="inline-flex items-center text-sm font-medium text-ink hover:underline max-md:min-h-11" onClick={() => nav('../approvals')}>All {waiting.length}</button>}</div>
          {next.loading ? <Skeleton className="h-28 rounded-xl" /> : top ? (
            <Card className="p-3.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{top.recipient.name}</p>
                  <p className="truncate text-sm text-muted">{top.recipient.company} · step {top.step + 1}</p>
                </div>
                <div className="text-right"><p className="tabular text-2xl leading-none font-semibold">{top.fitScore ?? '—'}</p><p className="text-xs text-muted">ICP fit</p></div>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-muted">{top.subject}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="primary" onClick={approveTop}>Approve</Button>
                <Button size="sm" onClick={() => nav(`../approvals?d=${top.id}`)}>Review</Button>
              </div>
            </Card>
          ) : <p className="rounded-xl bg-sunken px-3 py-3 text-sm text-muted">Nothing waiting. New drafts land in Approvals after the claims gate checks them.</p>}
        </motion.section>
      )}

      <motion.section variants={listItem} aria-labelledby="t-cap">
        <h3 id="t-cap" className="section-title mb-2">Sending capacity</h3>
        <Card className="space-y-3 p-3.5">
          {capacity.loading ? <Skeleton className="h-12" /> : capacity.data?.mailboxes.map((mb) => (
            <div key={mb.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><span className="truncate">{mb.address}</span>
                <span className="tabular shrink-0 text-muted">{mb.sentToday} / {mb.dailyCap}</span></div>
              <Meter value={mb.sentToday} max={mb.dailyCap} label={`${mb.address}: ${mb.sentToday} of ${mb.dailyCap} sent today`} />
            </div>
          ))}
          <p className="flex items-center gap-1.5 text-xs text-muted"><Clock3 className="size-3.5" aria-hidden />Daily caps are a safety floor. They reset at 00:00 UTC.</p>
        </Card>
      </motion.section>

      <motion.section variants={listItem} aria-labelledby="t-rt">
        <h3 id="t-rt" className="section-title mb-2">Routines</h3>
        <Card className="divide-y divide-line">
          {routines.loading ? <Skeleton className="m-3 h-24" /> : routines.data?.map((r) => (
            <div key={r.id} className="px-3.5 py-2.5">
              {r.pausedByOps ? (
                <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{r.name}</p><p className="text-xs text-muted">{r.schedule}</p></div><Badge tone="warning">Paused by Omni-SDR</Badge></div>
              ) : (
                <Switch checked={r.active} disabled={!can('build')} label={r.name}
                  description={`${r.schedule}${r.lastRunAt ? ` · last run ${relTime(r.lastRunAt, tz, now)}` : ' · last run —'}`}
                  onChange={(v) => api.patchRoutine(scope, r.id, { active: v }).then(() => toast(v ? `${r.name} is on.` : `${r.name} is off.`)).catch((e) => toast.error(e.message))} />
              )}
            </div>
          ))}
        </Card>
      </motion.section>

      <motion.section variants={listItem} aria-labelledby="t-mt">
        <div className="mb-2 flex items-center justify-between"><h3 id="t-mt" className="section-title">Upcoming meetings</h3>
          <button className="inline-flex items-center text-sm font-medium text-ink hover:underline max-md:min-h-11" onClick={() => nav('../meetings')}>Calendar</button></div>
        {meetings.loading ? <Skeleton className="h-16 rounded-xl" /> : meetings.data?.length ? (
          <ul className="space-y-2">{meetings.data.slice(0, 3).map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
              <div className="w-14 shrink-0 text-center"><p className="text-xs text-muted">{dayLabel(m.startsAt, tz).split(',')[0].slice(0, 3)}</p><p className="tabular text-sm font-semibold">{clock(m.startsAt, tz)}</p></div>
              <div className="min-w-0"><p className="truncate font-medium">{m.contactName}</p><p className="truncate text-sm text-muted">{m.contactCompany} · in {fmtDur(Math.max(0, (new Date(m.startsAt).getTime() - now) / 60000))}</p></div>
            </li>))}</ul>
        ) : <p className="rounded-xl bg-sunken px-3 py-3 text-sm text-muted">No meetings yet. Booked meetings show here.</p>}
      </motion.section>

      {can('approve') && !capacity.data?.workspaceOnHold && (
        <motion.div variants={listItem}>
          <Button variant="danger" className="w-full" icon={<PauseCircle className="size-4" aria-hidden />} onClick={() => setPauseOpen(true)}>Pause all sending in this workspace</Button>
        </motion.div>
      )}
      {capacity.data?.workspaceOnHold && <Banner tone="warning" title="Sending is paused." role="status">Approvals still work; nothing goes out until an admin resumes.</Banner>}
      <PauseSheet open={pauseOpen} onOpenChange={setPauseOpen} />
      <motion.p variants={listItem} className="flex items-center gap-1.5 pb-2 text-xs text-muted"><Sparkles className="size-3.5" aria-hidden />Level 1: a person approves every message.</motion.p>
    </motion.div>
  );
}
