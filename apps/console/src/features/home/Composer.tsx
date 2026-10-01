// The composer (UI-REVISION-PLAN Phase 3, after Clico): + attaches an object to ask about, an agent picker on Home's
// core view, mode chips that steer what the agent answers from, and one ghost suggestion that Tab takes.
// No mic: in-browser speech recognition streams the audio to a vendor, and no vendor call runs client-side (rails §8).
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { ArrowUp, Plus, X, UserRound, FileText, Inbox, CalendarDays, BarChart3, MessageCircle, Target, PenLine, CalendarPlus, LineChart, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { About, AboutKind, Agent, AskMode, ModelTier } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { TIER, plural } from '@/lib/format';
import { capital, type AskHandoff } from '@/lib/ask';
import { SUGGESTIONS } from '@/lib/api/demo/brain';
import { Button, Select, cx } from '@/components/ui';

export const MODES: { value: AskMode; label: string; icon: LucideIcon }[] = [
  { value: 'ask', label: 'Ask', icon: MessageCircle }, { value: 'find_leads', label: 'Find leads', icon: Target },
  { value: 'draft', label: 'Draft', icon: PenLine }, { value: 'book', label: 'Book', icon: CalendarPlus }, { value: 'report', label: 'Report', icon: LineChart },
];
export const KIND_ICON: Record<AboutKind, LucideIcon> = { contact: UserRound, draft: FileText, reply: Inbox, meeting: CalendarDays, analytics: BarChart3 };

export interface GhostContext { station?: string; blocked?: string | null; sla?: string | null }
/** One suggestion for an empty composer: about the attached object, else the mode, else what's on screen right now. */
export function ghostFor(about: About | null, mode: AskMode, ctx: GhostContext, turn: number): string {
  if (about) {
    switch (about.kind) {
      case 'contact': return `What do we know about ${about.label}?`;
      case 'draft': return "What's behind this draft?";
      case 'reply': return 'How should I handle this reply?';
      case 'meeting': return 'What should I know before this meeting?';
      default: return 'What stands out in these numbers?';
    }
  }
  const byMode: Partial<Record<AskMode, string>> = { find_leads: 'Which leads should I look at first?', draft: 'Which drafts are waiting on me?', book: 'What meetings are coming up?', report: 'How are replies trending?' };
  if (byMode[mode]) return byMode[mode]!;
  const byStation: Record<string, string> = { sales_outbound: 'Which leads should I look at first?', inbox_triage: 'Which replies need an answer?', ea_dispatch: 'What meetings are coming up?' };
  const pool = [ctx.sla && `When does ${ctx.sla} need an answer?`, ctx.blocked && `Why was ${ctx.blocked} blocked?`, ctx.station && byStation[ctx.station], ...SUGGESTIONS]
    .filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i);
  return pool[turn % pool.length];
}

export function Composer({ agent, agents, onAgent, busy, onAsk, ghost, onAttach }: {
  agent: Agent; agents?: Agent[]; onAgent?: (id: string) => void; busy: boolean; ghost: GhostContext;
  onAsk: (text: string, tier: ModelTier, opts: { about: About | null; mode: AskMode }) => void;
  onAttach?: (about: About) => void;
}) {
  const [text, setText] = useState('');
  const [tier, setTier] = useState<ModelTier>(agent.modelTier);
  const [about, setAbout] = useState<About | null>(null);
  const [mode, setMode] = useState<AskMode>('ask');
  const [turn, setTurn] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setTier(agent.modelTier), [agent.id, agent.modelTier]);
  // Handoffs in history state: Ctrl K "Ask <agent>" (text) and "Ask about this" (an object). They fill the box and
  // attach the chip; the person still presses Ask.
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    const h = loc.state as AskHandoff | null;
    if (!h || (typeof h.ask !== 'string' && !h.about && !h.mode)) return;
    if (typeof h.ask === 'string' && h.ask) setText(h.ask.slice(0, 4000));
    if (h.about) { setAbout(h.about); onAttach?.(h.about); }
    if (h.mode) setMode(h.mode);
    ref.current?.focus();
    nav({ pathname: loc.pathname, search: loc.search }, { replace: true, state: null });
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; } }, [text]);
  const suggestion = ghostFor(about, mode, { ...ghost, station: agent.station }, turn);
  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onAsk(t, tier, { about, mode }); setText(''); setAbout(null); setTurn((n) => n + 1);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
    // Tab (or → at the end) takes the suggestion while the box is empty. A second Tab moves on as usual.
    if (!text && suggestion && ((e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowRight')) { e.preventDefault(); setText(suggestion); }
  };
  const attach = (a: About) => { setAbout(a); onAttach?.(a); ref.current?.focus(); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="glass mx-auto max-w-[760px] rounded-xl p-2 shadow-md focus-within:ring-2 focus-within:ring-ring/40">
      {about && (
        <div className="mb-1 flex px-1 pt-0.5">
          <AboutChip about={about} onRemove={() => { setAbout(null); ref.current?.focus(); }} />
        </div>
      )}
      <label htmlFor="composer" className="sr-only">Message {agent.name}</label>
      <div className="relative">
        <textarea id="composer" ref={ref} rows={1} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} onKeyDown={onKey}
          placeholder={suggestion} aria-describedby="composer-hint"
          className={cx('block w-full resize-none bg-transparent px-2 py-1.5 text-md outline-none placeholder:text-muted', !text && 'pr-14')} />
        {!text && <span aria-hidden className="kbd pointer-events-none absolute top-2 right-2 max-md:hidden">Tab</span>}
      </div>
      <p id="composer-hint" className="sr-only">Suggestion: {suggestion} Press Tab to use it.</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Attach onPick={attach} />
        {agents && onAgent && (
          <>
            <label className="sr-only" htmlFor="composer-agent">Agent</label>
            <Select id="composer-agent" value={agent.id} onChange={(e) => onAgent(e.target.value)} className="!h-8 w-auto max-w-44 !border-line !bg-transparent text-sm max-md:!h-11">
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </>
        )}
        <ModeChips value={mode} onChange={setMode} />
        <span className="ml-auto flex items-center gap-1.5">
          <label className="sr-only" htmlFor="tier">Model tier</label>
          <Select id="tier" value={tier} onChange={(e) => setTier(e.target.value as ModelTier)} className="!h-8 w-auto !border-line !bg-transparent text-sm max-md:!h-11">
            {(Object.keys(TIER) as ModelTier[]).map((t) => <option key={t} value={t}>{TIER[t].label}</option>)}
          </Select>
          <span className="hidden truncate text-xs text-muted xl:inline">≈ {plural(TIER[tier].credits, 'action credit')}</span>
          <Button type="submit" variant="primary" size="sm" aria-label={`Ask ${agent.name}`} title="Ask (Enter)" className="!h-8 !w-8 !px-0 max-md:!h-11 max-md:!w-11" disabled={!text.trim() || busy} icon={<ArrowUp className="size-4" aria-hidden />} />
        </span>
      </div>
    </form>
  );
}

export function AboutChip({ about, onRemove, href }: { about: About; onRemove?: () => void; href?: string }) {
  const I = KIND_ICON[about.kind];
  const body = <><I className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{capital(about.label)}</span></>;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5 text-sm text-ink">
      {href ? <Link to={href} className="flex min-w-0 items-center gap-1.5 hover:underline">{body}</Link> : <span className="flex min-w-0 items-center gap-1.5 pr-1.5">{body}</span>}
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${about.label}`} className="press grid size-6 shrink-0 place-items-center rounded-full hover:bg-surface/70 max-md:size-8"><X className="size-3.5" aria-hidden /></button>}
    </span>
  );
}

function ModeChips({ value, onChange }: { value: AskMode; onChange: (m: AskMode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // A radio group: one tab stop, arrows move and choose (WAI-ARIA radio pattern).
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + MODES.length) % MODES.length;
    onChange(MODES[n].value); refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Mode" className="flex items-center gap-1">
      {MODES.map((m, i) => {
        const on = m.value === value;
        return (
          <button key={m.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} title={m.label}
            onClick={() => onChange(m.value)} onKeyDown={(e) => onKey(e, i)}
            className={cx('mode-chip press inline-flex h-8 items-center rounded-full border px-2.5 text-sm max-md:h-11 max-md:px-3',
              on ? 'border-ink/40 bg-accent-soft font-medium text-ink' : 'border-line text-muted hover:bg-sunken hover:text-fg')}>
            <m.icon className="size-4 shrink-0" aria-hidden /><span className="mode-label">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const item = 'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm aria-selected:bg-sunken data-[selected=true]:bg-sunken';
const group = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted';

/** + : attach a lead, draft, reply or meeting to ask about. Lists only what this role can open. */
function Attach({ onPick }: { onPick: (a: About) => void }) {
  const { scope, can } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ws = scope.workspaceId;
  const contacts = useQuery(() => api.contacts(scope, ''), [ws], { enabled: open && can('build'), key: `contacts:${ws}:` });
  const review = useQuery(() => api.approvals(scope, { status: 'review' }), [ws], { enabled: open && can('approve') });
  const blocked = useQuery(() => api.approvals(scope, { status: 'blocked' }), [ws], { enabled: open && can('approve'), key: `approvals:${ws}:blocked` });
  const replies = useQuery(() => api.inbox(scope, { status: 'open' }), [ws], { enabled: open && can('inbox_read'), key: `inbox:${ws}:open` });
  const meetings = useQuery(() => api.meetings(scope, 'upcoming'), [ws], { enabled: open, key: `meetings:${ws}:upcoming` });
  const pick = (a: About) => { setOpen(false); onPick(a); };
  const drafts = [...(review.data?.items ?? []), ...(blocked.data?.items ?? [])];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label="Attach a lead, draft, reply or meeting" title="Attach something to ask about"
        className="press grid size-8 shrink-0 place-items-center rounded-full border border-line text-muted hover:bg-sunken hover:text-fg max-md:size-11">
        <Plus className="size-4" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Attach something to ask about"
          className="ov-pop z-50 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <Command label="Attach something to ask about" loop>
            <Command.Input autoFocus placeholder="Find a lead, draft, reply or meeting…" className="h-11 w-full border-b border-line bg-transparent px-3 text-sm outline-none placeholder:text-muted" />
            <Command.List className="max-h-72 overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">Nothing matches.</Command.Empty>
              {drafts.length > 0 && (
                <Command.Group heading="Drafts" className={group}>
                  {drafts.slice(0, 8).map((d) => (
                    <Command.Item key={d.id} value={`draft ${d.recipient.name} ${d.recipient.company}`} onSelect={() => pick({ kind: 'draft', id: d.id, label: `the draft to ${d.recipient.name ?? 'this contact'}` })} className={item}>
                      <FileText className="size-4 text-muted" aria-hidden /><span className="truncate">{d.recipient.name}</span><span className="ml-auto shrink-0 text-xs text-muted">{d.status === 'blocked' ? 'blocked' : `step ${d.step + 1}`}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {(replies.data?.length ?? 0) > 0 && (
                <Command.Group heading="Open replies" className={group}>
                  {replies.data!.slice(0, 6).map((r) => (
                    <Command.Item key={r.id} value={`reply ${r.contactName ?? ''} ${r.contactCompany ?? ''}`} onSelect={() => pick({ kind: 'reply', id: r.id, label: `the reply from ${r.contactName ?? r.fromAddress ?? 'this contact'}` })} className={item}>
                      <Inbox className="size-4 text-muted" aria-hidden /><span className="truncate">{r.contactName ?? r.fromAddress}</span><span className="truncate text-muted">{r.contactCompany}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {(meetings.data?.length ?? 0) > 0 && (
                <Command.Group heading="Upcoming meetings" className={group}>
                  {meetings.data!.slice(0, 5).map((m) => (
                    <Command.Item key={m.id} value={`meeting ${m.contactName ?? ''} ${m.contactCompany ?? ''}`} onSelect={() => pick({ kind: 'meeting', id: m.id, label: `the meeting with ${m.contactName ?? 'this contact'}` })} className={item}>
                      <CalendarDays className="size-4 text-muted" aria-hidden /><span className="truncate">{m.contactName ?? 'Meeting'}</span><span className="truncate text-muted">{m.contactCompany}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {(contacts.data?.length ?? 0) > 0 && (
                <Command.Group heading="Leads" className={group}>
                  {contacts.data!.slice(0, 40).map((c) => (
                    <Command.Item key={c.id} value={`lead ${c.name ?? ''} ${c.company ?? ''} ${c.email ?? ''}`} onSelect={() => pick({ kind: 'contact', id: c.id, label: c.name ?? c.email ?? 'this lead' })} className={item}>
                      <UserRound className="size-4 text-muted" aria-hidden /><span className="truncate">{c.name}</span><span className="truncate text-muted">{c.company}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Numbers" className={group}>
                <Command.Item value="analytics numbers last 30 days" onSelect={() => pick({ kind: 'analytics', id: '30', label: 'the last 30 days of results' })} className={item}>
                  <BarChart3 className="size-4 text-muted" aria-hidden />Results, last 30 days
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
