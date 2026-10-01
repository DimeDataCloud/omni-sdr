// Home's signature moment (UI-REVISION-PLAN Phase 3): the agent core (arcs are today's pipeline stages, ticks are
// the day's send budget), the "while you were away" briefing, ticket stubs for meetings booked today, and the
// phone bento. Every number here links to the list it counts.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { X, Search, PenLine, Inbox as InboxIcon, CalendarCheck, CheckCheck, CalendarClock, Send, Sparkles, ChevronRight, PauseCircle, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import type { Agent, Meeting, Pipeline } from '@/lib/api/types';
import { useNow, useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { usePending } from '@/lib/undo';
import { agentFor } from '@/lib/ask';
import { clock, dayKey, hourIn, plural, relTime, shortWhen, slaText, zonedInstant } from '@/lib/format';
import { Banner, Button, IconButton, Meter, Skeleton, cx } from '@/components/ui';
import type { GhostContext } from './Composer';
import { PauseSheet } from './PauseSheet';

// ── Data ──────────────────────────────────────────────────────────────────────────────────────
/** Midnight today in the workspace's timezone, as ISO. Moves on at the next midnight. */
export function useDayStart(tz: string) {
  const now = useNow(60000);
  const day = dayKey(new Date(now).toISOString(), tz);
  return useMemo(() => zonedInstant(day, 0, tz).toISOString(), [day, tz]);
}
export function usePipeline(since: string | null) {
  const { scope } = useWorkspace();
  return useQuery(() => api.pipeline(scope, since!), [scope.workspaceId, since], { enabled: Boolean(since), key: `pipeline:${scope.workspaceId}:${since}` });
}
/** What the ghost suggestion can mention: the first blocked draft and the reply closest to its SLA. */
export function useGhostContext(): GhostContext {
  const { scope, can } = useWorkspace();
  const ws = scope.workspaceId;
  const blocked = useQuery(() => api.approvals(scope, { status: 'blocked' }), [ws], { enabled: can('approve'), key: `approvals:${ws}:blocked` });
  const inbox = useQuery(() => api.inbox(scope, { status: 'open' }), [ws], { enabled: can('inbox_read'), key: `inbox:${ws}:open` });
  const sla = (inbox.data ?? []).filter((r) => r.slaMinutesRemaining !== null).sort((a, b) => a.slaMinutesRemaining! - b.slaMinutesRemaining!)[0];
  return { blocked: blocked.data?.items[0]?.recipient.name ?? null, sla: sla?.contactName ?? null };
}

// The briefing window: from the last visit before today (or 18:00 yesterday on a first visit) to now. It is fixed
// for the day, so coming back at noon shows the same overnight; dismissing hides it until tomorrow. Per viewer.
const read = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null; } catch { return null; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: shows every visit */ } };
interface BriefRec { day: string; since: string; dismissed: boolean }
export function useBriefingWindow(ws: string, tz: string) {
  const [rec, setRec] = useState<BriefRec>(() => {
    const today = dayKey(new Date().toISOString(), tz);
    const had = read<BriefRec>(`omni-brief:${ws}`);
    if (had?.day === today) return had;
    const seen = read<string>(`omni-seen:${ws}`);
    const yesterday = dayKey(new Date(Date.now() - 86400e3).toISOString(), tz);
    const since = seen && Date.parse(seen) < Date.now() ? seen : zonedInstant(yesterday, 18, tz).toISOString();
    const next = { day: today, since, dismissed: false };
    write(`omni-brief:${ws}`, next);
    return next;
  });
  useEffect(() => { write(`omni-seen:${ws}`, new Date().toISOString()); }, [ws]);
  return { since: rec.since, show: !rec.dismissed, dismiss: () => { const r = { ...rec, dismissed: true }; write(`omni-brief:${ws}`, r); setRec(r); } };
}

// ── Greeting ──────────────────────────────────────────────────────────────────────────────────
export function Greeting({ className }: { className?: string }) {
  const { tz } = useWorkspace();
  const now = useNow(60000);
  const h = hourIn(tz, now);
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return (
    <header className={className}>
      <p className="label">{new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1 tabIndex={-1} className="display mt-1 outline-none">Good <em>{part}</em></h1>
    </header>
  );
}

// ── The agent core ────────────────────────────────────────────────────────────────────────────
const STAGES = [
  { key: 'found', label: 'Found' }, { key: 'drafted', label: 'Drafted' }, { key: 'approved', label: 'Approved' },
  { key: 'sent', label: 'Sent' }, { key: 'replies', label: 'Replied' }, { key: 'booked', label: 'Booked' },
] as const;
type StageKey = typeof STAGES[number]['key'];

let ringDrawn = false; // the ring draws in once per page load, then only its values move

function Ring({ p, cap, used, size }: { p: Pipeline; cap: number; used: number; size: number }) {
  const [draw] = useState(() => { const d = !ringDrawn; ringDrawn = true; return d; });
  const c = size / 2; const rT = c - 3; const sw = size > 200 ? 12 : 10; const rA = c - 14 - sw;
  const max = Math.max(1, ...STAGES.map((s) => p[s.key]));
  const seg = 360 / STAGES.length; const gap = 7;
  const pt = (r: number, deg: number) => [c + r * Math.cos((deg * Math.PI) / 180), c + r * Math.sin((deg * Math.PI) / 180)].map((v) => Math.round(v * 100) / 100);
  const arc = (i: number) => { const a0 = -90 + i * seg + gap / 2; return `M${pt(rA, a0).join(' ')}A${rA} ${rA} 0 0 1 ${pt(rA, a0 + seg - gap).join(' ')}`; };
  // One tick per send, grouped when the budget is large so ticks never touch.
  const step = Math.max(1, Math.ceil(cap / 120)); const n = Math.ceil(cap / step);
  const live: Partial<Record<StageKey, boolean>> = { drafted: p.live.drafting > 0, replies: p.live.classifying > 0 };
  const summary = `Today: ${STAGES.map((s) => `${p[s.key]} ${s.label.toLowerCase()}`).join(', ')}. ${used} of ${cap} sends used.`;
  const i = (k: number) => ({ ['--i' as string]: k });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className={cx('block shrink-0', draw && 'ring-draw')} role="img" aria-label={summary}>
      <defs>
        <linearGradient id="ring-ai" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--ai-1)' }} /><stop offset=".5" style={{ stopColor: 'var(--ai-3)' }} /><stop offset="1" style={{ stopColor: 'var(--ai-2)' }} />
        </linearGradient>
      </defs>
      {n > 0 && Array.from({ length: n }, (_, k) => {
        const deg = -90 + (k * 360) / n; const [x1, y1] = pt(rT - 7, deg); const [x2, y2] = pt(rT, deg);
        return <line key={k} className={cx('ring-tick', k * step < used ? 'stroke-ink' : 'stroke-control/40')} style={i(k)} strokeWidth={2} strokeLinecap="round" x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      {STAGES.map((s, k) => {
        const f = p[s.key] ? Math.max(0.06, p[s.key] / max) : 0;
        return (
          <g key={s.key}>
            <path d={arc(k)} fill="none" strokeWidth={sw} className="stroke-sunken" />
            <path d={arc(k)} fill="none" strokeWidth={sw} pathLength={1} strokeDasharray={`${f} 1`} data-stage={s.key} className="ring-fill stroke-ink" style={i(k)} />
            {live[s.key] && <path d={arc(k)} fill="none" strokeWidth={sw} pathLength={1} className="ring-live" style={{ stroke: 'url(#ring-ai)' }} />}
          </g>
        );
      })}
    </svg>
  );
}

function stageLink(k: StageKey, dayStart: string, can: ReturnType<typeof useWorkspace>['can']): string | null {
  const since = encodeURIComponent(dayStart);
  switch (k) {
    case 'found': return can('build') ? `../leads?since=${since}` : null;
    case 'drafted': return can('approve') ? '../approvals' : null;
    case 'approved': return can('approve') ? '../approvals?tab=approved' : null;
    case 'sent': return '../analytics';
    case 'replies': return can('inbox_read') ? `../inbox?s=all&since=${since}` : null;
    default: return '../meetings';
  }
}

/** The ring with its legend. The legend is the ring in text: same order (clockwise from the top), each a link. */
export function AgentCore({ compact }: { compact?: boolean }) {
  const { scope, tz, can } = useWorkspace();
  const dayStart = useDayStart(tz);
  const p = usePipeline(dayStart);
  const capacity = useQuery(() => api.capacity(scope), [scope.workspaceId]);
  const size = compact ? 168 : 232;
  const cap = capacity.data?.today.cap ?? 0; const used = capacity.data?.today.used ?? 0;
  return (
    <section aria-labelledby="core-h" className={cx('card core', compact ? 'p-4' : 'p-6')}>
      <h2 id="core-h" className="label mb-3">Today&rsquo;s pipeline</h2>
      <div className={cx('flex items-center', compact ? 'flex-col gap-4' : 'gap-8')}>
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          {p.data && capacity.data ? <Ring p={p.data} cap={cap} used={used} size={size} /> : <Skeleton className="size-full rounded-full" />}
          {capacity.data && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center" aria-hidden>
              <div>
                <p className={cx('display tabular', compact && '!text-[34px] !leading-[36px]')}>{used}</p>
                <p className={cx('text-xs text-muted', compact && 'max-w-[5.5rem]')}>of {cap} sends today</p>
              </div>
            </div>
          )}
        </div>
        <ul className={cx('grid w-full gap-1', compact ? 'grid-cols-3' : 'grid-cols-2')} aria-label="Today by stage, clockwise from the top">
          {STAGES.map((s) => {
            const to = stageLink(s.key, dayStart, can);
            const inner = (<>
              <span className="label block">{s.label}</span>
              <span className={cx('tabular block font-semibold', compact ? 'text-xl' : 'text-2xl')}>{p.data ? p.data[s.key] : '–'}</span>
            </>);
            return (
              <li key={s.key}>
                {to ? <Link to={to} data-stage={s.key} className="press block rounded-lg px-2.5 py-1.5 hover:bg-sunken">{inner}</Link>
                  : <span data-stage={s.key} className="block px-2.5 py-1.5">{inner}</span>}
              </li>
            );
          })}
        </ul>
      </div>
      {!compact && <p className="mt-4 flex items-center gap-1.5 text-xs text-muted"><Send className="size-3.5" aria-hidden />Ticks are today&rsquo;s send budget across your mailboxes. It resets at 00:00 UTC.</p>}
    </section>
  );
}

// ── While you were away ───────────────────────────────────────────────────────────────────────
/** A number in the briefing: a link to the list it counts, or plain bold where this role can't open that list. */
function N({ to, ok, children }: { to: string; ok: boolean; children: ReactNode }) {
  return ok ? <Link to={to} className="font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink">{children}</Link> : <strong className="font-semibold">{children}</strong>;
}
export function Briefing() {
  const { scope, tz, can } = useWorkspace();
  const b = useBriefingWindow(scope.workspaceId, tz);
  const p = usePipeline(b.show ? b.since : null);
  if (!b.show) return null;
  if (!p.data) return p.loading ? <Skeleton className="h-36 rounded-xl" /> : null;
  const d = p.data;
  if (!d.found && !d.drafted && !d.replies && !d.booked) return null;
  const since = encodeURIComponent(d.since);
  const writer = d.byAgent[0]?.name;
  const lines: [typeof Search, ReactNode][] = [];
  if (d.found) lines.push([Search, <><N to={`../leads?since=${since}`} ok={can('build')}>{plural(d.found, 'new lead')}</N> found and researched</>]);
  if (d.drafted) lines.push([PenLine, <>{writer ?? 'Agents'} wrote <N to="../approvals?tab=all" ok={can('approve')}>{plural(d.drafted, 'draft')}</N>{d.waiting > 0 && <>: <N to="../approvals" ok={can('approve')}>{d.waiting} waiting for you</N></>}{d.blocked > 0 && <>, <N to="../approvals?tab=blocked" ok={can('approve')}>{d.blocked} blocked</N> by the gate</>}</>]);
  if (d.replies) lines.push([InboxIcon, <><N to={`../inbox?s=all&since=${since}`} ok={can('inbox_read')}>{plural(d.replies, 'reply', 'replies')}</N> came in{d.meetingRequests > 0 && `, ${d.meetingRequests} asking for a meeting`}{d.optOuts > 0 && `, ${plural(d.optOuts, 'opt-out')} (suppressed)`}</>]);
  if (d.booked) lines.push([CalendarCheck, <><N to="../meetings" ok>{plural(d.booked, 'meeting')} booked</N></>]);
  return (
    <section aria-labelledby="brief-h" className="card p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="label">Since {shortWhen(d.since, tz)}</p>
          <h2 id="brief-h" className="mt-0.5 text-lg">While you were away</h2>
        </div>
        <IconButton label="Dismiss until tomorrow" onClick={b.dismiss} className="-mt-1 -mr-1"><X className="size-4" aria-hidden /></IconButton>
      </div>
      <ul className="mt-3 space-y-2">
        {lines.map(([I, text], k) => (
          <li key={k} className="flex items-start gap-2.5 text-base"><I className="mt-1 size-4 shrink-0 text-muted" aria-hidden /><span>{text}</span></li>
        ))}
      </ul>
    </section>
  );
}

// ── Wins: meetings booked today, as ticket stubs ──────────────────────────────────────────────
let ticketsShown = false;
export function Wins() {
  const { scope, tz } = useWorkspace();
  const dayStart = useDayStart(tz);
  const all = useQuery(() => api.meetings(scope, 'all'), [scope.workspaceId], { key: `meetings:${scope.workspaceId}:all` });
  const [stamp] = useState(() => { const s = !ticketsShown; ticketsShown = true; return s; });
  const booked = (all.data ?? []).filter((m) => m.status !== 'canceled' && m.createdAt >= dayStart).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!booked.length) return null;
  return (
    <section aria-labelledby="wins-h">
      <h2 id="wins-h" className="label mb-2">Booked today</h2>
      <ul className="grid gap-3 sm:grid-cols-2">{booked.slice(0, 4).map((m) => <li key={m.id}><Ticket m={m} tz={tz} stamp={stamp} /></li>)}</ul>
    </section>
  );
}
function Ticket({ m, tz, stamp }: { m: Meeting; tz: string; stamp: boolean }) {
  const how = m.provider === 'cal_com' ? 'Through Cal.com' : m.provider === 'calendly' ? 'Through Calendly' : m.inboundMessageId ? 'From their reply' : 'Booked here';
  const d = new Date(m.startsAt);
  return (
    // The mask that cuts the perforation would also clip a focus ring, so the link wraps the masked shape.
    <Link to="../meetings" aria-label={`Meeting booked with ${m.contactName ?? 'a contact'}, ${shortWhen(m.startsAt, tz)}`} className={cx('ticket-wrap block rounded-lg', stamp && 'ticket-in')}>
      <span className="ticket">
        <span className="min-w-0 flex-1 p-4">
          <span className="label block">Meeting booked</span>
          <span className="mt-1 block truncate text-lg font-semibold">{m.contactName ?? 'A contact'}</span>
          <span className="block truncate text-sm text-muted">{m.contactCompany}</span>
          <span className="mt-2 block text-xs text-muted">{how} · {relTime(m.createdAt, tz)}</span>
        </span>
        <span className="ticket-stub grid place-items-center p-3 text-center" aria-hidden>
          <span>
            <span className="label block text-on-accent">{d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })}</span>
            <span className="display block !text-[34px] !leading-[38px]">{d.toLocaleDateString('en-US', { timeZone: tz, day: 'numeric' })}</span>
            <span className="tabular block text-sm font-medium">{clock(m.startsAt, tz)}</span>
          </span>
        </span>
      </span>
    </Link>
  );
}

// ── Phone: the bento ──────────────────────────────────────────────────────────────────────────
function Tile({ to, label, icon: I, children, className }: { to: string | null; label: string; icon: typeof Send; children: ReactNode; className?: string }) {
  const body = (<><span className="label flex items-center gap-1.5"><I className="size-3.5" aria-hidden />{label}</span><span className="mt-1.5 block">{children}</span></>);
  return to ? <Link to={to} className={cx('card press block min-h-24 p-3.5', className)}>{body}</Link> : <div className={cx('card min-h-24 p-3.5', className)}>{body}</div>;
}

export function Bento({ agents, onOpenAgent }: { agents: Agent[]; onOpenAgent: (id: string) => void }) {
  const { scope, tz, can } = useWorkspace();
  const now = useNow(30000);
  const pending = usePending();
  const inbox = useQuery(() => api.inbox(scope, { status: 'open' }), [scope.workspaceId], { enabled: can('inbox_read'), key: `inbox:${scope.workspaceId}:open`, pollMs: 60000 });
  const review = useQuery(() => api.approvals(scope, { status: 'review' }), [scope.workspaceId], { enabled: can('approve') });
  const capacity = useQuery(() => api.capacity(scope), [scope.workspaceId]);
  const meetings = useQuery(() => api.meetings(scope, 'upcoming'), [scope.workspaceId], { key: `meetings:${scope.workspaceId}:upcoming` });
  const [pauseOpen, setPauseOpen] = useState(false);
  const open = (inbox.data ?? []).filter((r) => !pending.isHidden(r.id));
  const sla = open.filter((r) => r.slaMinutesRemaining !== null).sort((a, b) => a.slaMinutesRemaining! - b.slaMinutesRemaining!)[0];
  const drafts = (review.data?.items ?? []).filter((d) => !pending.isHidden(d.id));
  const next = meetings.data?.[0];
  const cos = agentFor(agents);
  const cap = capacity.data?.today;
  return (
    <div className="space-y-4">
      <Greeting />
      <Briefing />
      <AgentCore compact />
      <div className="grid grid-cols-2 gap-3">
        {sla && (
          <Link to={`../inbox?r=${sla.id}`} className={cx('press col-span-2 flex items-start gap-3 rounded-xl border p-3.5', sla.slaMinutesRemaining! < 60 ? 'border-danger/30 bg-danger-soft text-danger' : 'card')}>
            <span className={cx('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', sla.slaMinutesRemaining! < 60 ? 'pulse-danger bg-danger text-surface' : 'bg-accent-soft text-ink')}><CalendarClock className="size-4" aria-hidden /></span>
            <span className="min-w-0">
              <span className="block font-semibold">{sla.contactName} asked for a meeting</span>
              <span className="block text-sm opacity-90">Reply within <span className="tabular font-semibold">{slaText(sla.slaMinutesRemaining!).replace(' left', '')}</span></span>
            </span>
          </Link>
        )}
        {can('approve') && (
          <Tile to="../approvals" label="Approvals" icon={CheckCheck}>
            <span className="tabular block text-2xl font-semibold">{review.data ? drafts.length : '–'}</span>
            <span className="block truncate text-sm text-muted">{drafts[0] ? `Top: ${drafts[0].recipient.name}` : 'Nothing waiting'}</span>
          </Tile>
        )}
        {can('inbox_read') && (
          <Tile to="../inbox" label="Inbox" icon={InboxIcon}>
            <span className="tabular block text-2xl font-semibold">{inbox.data ? open.length : '–'}</span>
            <span className="block truncate text-sm text-muted">{open.length ? `${plural(open.length, 'reply', 'replies')} open` : 'All caught up'}</span>
          </Tile>
        )}
        <div className="col-span-2"><Wins /></div>
        <Tile to="../meetings" label="Next meeting" icon={CalendarCheck}>
          {next ? <><span className="tabular block text-lg font-semibold">{clock(next.startsAt, tz)}</span><span className="block truncate text-sm text-muted">{next.contactName} · {relTime(next.startsAt, tz, now)}</span></>
            : <span className="block text-sm text-muted">None booked yet</span>}
        </Tile>
        <Tile to={null} label="Sends today" icon={Send}>
          <span className="tabular block text-lg font-semibold">{cap ? `${cap.used} / ${cap.cap}` : '–'}</span>
          {cap && <Meter value={cap.used} max={Math.max(1, cap.cap)} label={`${cap.used} of ${cap.cap} sends used today`} className="mt-2" />}
        </Tile>
        {can('build') && cos && (
          <button onClick={() => onOpenAgent(cos.id)} className="card press col-span-2 flex items-center gap-3 p-3.5 text-left">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-ink"><Sparkles className="size-4" aria-hidden /></span>
            <span className="min-w-0 flex-1"><span className="block font-medium">Ask {cos.name}</span><span className="block truncate text-sm text-muted">&ldquo;What needs me today?&rdquo;</span></span>
            <ChevronRight className="size-4 text-muted" aria-hidden />
          </button>
        )}
      </div>
      {can('approve') && !capacity.data?.workspaceOnHold && (
        <Button variant="danger" className="w-full" icon={<PauseCircle className="size-4" aria-hidden />} onClick={() => setPauseOpen(true)}>Pause all sending in this workspace</Button>
      )}
      {capacity.data?.workspaceOnHold && <Banner tone="warning" title="Sending is paused." role="status">Approvals still work; nothing goes out until an admin resumes.</Banner>}
      <PauseSheet open={pauseOpen} onOpenChange={setPauseOpen} />
      <p className="flex items-center gap-1.5 pb-2 text-xs text-muted"><ShieldCheck className="size-3.5" aria-hidden />Level 1: a person approves every message.</p>
    </div>
  );
}
