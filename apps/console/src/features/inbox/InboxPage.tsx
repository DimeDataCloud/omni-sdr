// Inbox (DESIGN 6.5). Sorted by SLA; a meeting request close to its deadline can't be missed.
// Replies are prospect text: shown as plain text, links not activated.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { CalendarPlus, CheckCircle2, ArrowLeft, Inbox as InboxIcon, Info, Clock3, UserRound, ShieldOff, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import type { InboxItem } from '@/lib/api/types';
import { bumpEdge, useArrivalFocus, useHotkeys, useMedia, useNow, useQuery, useSelection, prefetchQuery, requestArrival } from '@/lib/hooks';
import { useCommands } from '@/lib/commands';
import { AskButton } from '@/lib/ask';
import type { Scope } from '@/lib/api/client';
import { useWorkspace } from '@/lib/session';
import { deferAction, usePending } from '@/lib/undo';
import { INTENT, enrollmentState, absTime, relTime, slaText, slaTone, clock, plural, shortWhen } from '@/lib/format';
import { BulkBar, FilterChip, Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, Page, PageHeader, Segmented, Select, Sheet, SkeletonList, Skeleton, cx } from '@/components/ui';

type Status = 'open' | 'handled' | 'all';

/** Warmed on hover of the Inbox nav link. */
export const prefetch = (s: Scope) => prefetchQuery(`inbox:${s.workspaceId}:open`, () => api.inbox(s, { status: 'open' }));

export default function InboxPage() {
  const { scope, tz } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const status = (params.get('s') as Status) ?? 'open';
  const since = params.get('since'); // from Home: only replies that arrived after this instant
  const inbox = useQuery(() => api.inbox(scope, { status }), [scope.workspaceId, status], { pollMs: 60000, key: `inbox:${scope.workspaceId}:${status}` });
  const wide = useMedia('(min-width: 1100px)');
  const pending = usePending();
  const items = (inbox.data ?? []).filter((r) => (status !== 'open' || !pending.isHidden(r.id)) && (!since || r.receivedAt >= since));
  const selId = params.get('r');
  // A handled reply is hidden one render before the URL moves on; resolve to the reply after it (else before it)
  // so that render already shows the right one. Same rule as Approvals.
  const all = inbox.data ?? [];
  const following = (id: string) => {
    const i = all.findIndex((r) => r.id === id);
    if (i < 0) return undefined;
    return all.slice(i + 1).find((r) => items.includes(r)) ?? all.slice(0, i).reverse().find((r) => items.includes(r));
  };
  const selected = items.find((r) => r.id === selId) ?? (selId ? following(selId) : undefined) ?? (wide ? items[0] : undefined);
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const idx = selected ? items.indexOf(selected) : -1;
  const order = useMemo(() => items.filter((r) => !r.handledAt).map((r) => r.id), [items]);
  const sel = useSelection(order, status === 'open');
  const markHandled = () => {
    const ids = sel.ids; sel.clear();
    deferAction({ ids, kind: 'handle', workspaceId: scope.workspaceId, message: `Marked ${plural(ids.length, 'reply', 'replies')} handled.`, commit: () => Promise.all(ids.map((id) => api.handle(scope, id))) });
  };
  const step = (d: 1 | -1) => { const n = items[idx + d]; if (n) { requestArrival(); setParam('r', n.id); } else if (selected) bumpEdge(d); };
  useHotkeys({ j: () => step(1), k: () => step(-1),
    x: () => { if (selected && !selected.handledAt) sel.toggle(selected.id); } }, [idx, items.length, selected?.id, sel.toggle], wide);
  useCommands([
    ...(wide && items.length > 1 ? [{ id: 'next', label: 'Next reply', keys: 'J', run: () => step(1) }, { id: 'prev', label: 'Previous reply', keys: 'K', run: () => step(-1) }] : []),
    ...(wide && selected && !selected.handledAt ? [{ id: 'sel', label: sel.has(selected.id) ? 'Unselect this reply' : 'Select this reply', keys: 'X', run: () => sel.toggle(selected.id) }] : []),
    ...(sel.size ? [{ id: 'bulk', label: `Mark ${plural(sel.size, 'selected reply', 'selected replies')} handled`, icon: CheckCircle2, run: markHandled },
      { id: 'clear', label: 'Clear selection', keys: 'Esc', run: sel.clear }] : []),
  ]);
  const bulkBar = (
    <BulkBar count={sel.size} onClear={sel.clear}>
      <Button variant="primary" size="sm" icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={markHandled}>Mark handled</Button>
    </BulkBar>
  );

  const header = (
    <PageHeader title="Inbox" subtitle="Replies to your outreach, meeting requests first. The SLA counts business hours only.">
      <div className="w-full">
        <Segmented id="inbox-tabs" label="Reply status" value={status} onChange={(v) => { const p = new URLSearchParams(); if (v !== 'open') p.set('s', v); setParams(p); }}
          options={[{ value: 'open', label: 'Open', count: status === 'open' ? items.length : undefined }, { value: 'handled', label: 'Handled' }, { value: 'all', label: 'All' }]} />
        {since && <FilterChip label={`Arrived since ${shortWhen(since, tz)}`} onClear={() => setParam('since', null)} className="mt-3" />}
      </div>
    </PageHeader>
  );
  const empty = <EmptyState icon={<InboxIcon className="size-5" aria-hidden />} title={status === 'open' ? 'All caught up' : 'No replies yet'}
    body={status === 'open' ? 'Every reply has been handled. New replies land here.' : 'Replies to your outreach land here.'} />;

  if (!wide) {
    return (
      <Page>
        {selected ? (<>
          <div className="mb-3"><IconButton label="Back to inbox" onClick={() => setParam('r', null)}><ArrowLeft className="size-5" aria-hidden /></IconButton></div>
          <ReplyDetail key={selected.id} r={selected} onDone={() => setParam('r', null)} />
        </>) : (<>
          {header}
          <ErrorState error={inbox.error} onRetry={inbox.reload} />
          {inbox.loading ? <SkeletonList rows={5} /> : items.length ? <ReplyList items={items} selectedId={null} onSelect={(id) => setParam('r', id)} sel={sel} /> : empty}
          {bulkBar}
        </>)}
      </Page>
    );
  }
  return (
    <Page wide>
      {header}
      <ErrorState error={inbox.error} onRetry={inbox.reload} />
      {inbox.loading ? <div className="grid grid-cols-[minmax(320px,400px)_1fr] gap-5"><SkeletonList rows={5} /><Skeleton className="h-96 rounded-xl" /></div>
        : !items.length ? empty : (
          <div className="grid grid-cols-[minmax(320px,400px)_1fr] items-start gap-5">
            <div className="sticky top-[72px] max-h-[calc(100dvh-160px)] overflow-y-auto pr-1"><ReplyList items={items} selectedId={selected?.id ?? null} onSelect={(id) => setParam('r', id)} sel={sel} /></div>
            <AnimatePresence mode="wait">{selected && <ReplyDetail key={selected.id} r={selected} onDone={() => { const n = items[idx + 1] ?? items[idx - 1]; if (n && n.id !== selected.id) { requestArrival(); setParam('r', n.id); } else setParam('r', null); }} keyboard />}</AnimatePresence>
          </div>
        )}
      {bulkBar}
    </Page>
  );
}

export function SlaChip({ minutes, dueAt }: { minutes: number; dueAt: string | null }) {
  const { tz } = useWorkspace();
  const tone = slaTone(minutes);
  return (
    <span title={dueAt ? `Due ${absTime(dueAt, tz)}` : undefined}
      className={cx('tabular inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs whitespace-nowrap', tone === 'danger' ? 'bg-danger font-semibold text-surface' : tone === 'warning' ? cx('bg-warning-soft text-warning', minutes < 30 && 'font-semibold') : 'bg-sunken text-muted')}>
      <Clock3 className="size-3" aria-hidden />{slaText(minutes)}
    </span>
  );
}

function outcomeNote(r: InboxItem): string | null {
  if (r.intent === 'unsubscribe') return 'Suppressed automatically, sequence stopped';
  if (r.intent === 'out_of_office') return 'Sequence continues';
  if (r.intent === 'bounce') return 'Address bounced, sequence stopped';
  return null;
}

function ReplyList({ items, selectedId, onSelect, sel }: { items: InboxItem[]; selectedId: string | null; onSelect: (id: string) => void; sel: ReturnType<typeof useSelection> }) {
  const { tz } = useWorkspace();
  const now = useNow();
  return (
    <ul className="space-y-1.5" aria-label="Replies" data-kbd-list>
      <AnimatePresence initial={false}>
        {items.map((r, i) => {
          const on = r.id === selectedId; const intent = INTENT[r.intent];
          return (
            <motion.li key={r.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03 } }} exit={{ opacity: 0, x: -24 }}
              className={cx('flex items-stretch rounded-xl border transition-colors', on ? 'border-ink/40 bg-surface shadow-md' : 'border-line bg-surface/70 hover:bg-surface',
                r.slaMinutesRemaining !== null && r.slaMinutesRemaining < 30 && !on && 'border-danger/40', sel.has(r.id) && 'ring-2 ring-ink/30')}>
              {!r.handledAt && (
                <label className="flex w-10 shrink-0 cursor-pointer items-start justify-center pt-[calc(var(--row-py)+4px)]">
                  <span className="sr-only">Select reply from {r.contactName ?? r.fromAddress}</span>
                  <input type="checkbox" checked={sel.has(r.id)} onChange={(e) => sel.toggle(r.id, e.nativeEvent as MouseEvent)} className="size-4 accent-[var(--accent-ink)]" />
                </label>
              )}
              <button onClick={() => onSelect(r.id)} aria-current={on || undefined}
                className={cx('row-d min-w-0 flex-1 pr-3 text-left', r.handledAt && 'pl-3')}>
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.contactName ?? r.fromAddress}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted">{relTime(r.receivedAt, tz, now)}</span>
                </span>
                <span className="block truncate text-sm text-muted">{r.contactCompany}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={intent.tone}>{intent.label}</Badge>
                  {r.slaMinutesRemaining !== null && <SlaChip minutes={r.slaMinutesRemaining} dueAt={r.slaDueAt} />}
                  {r.needsHuman && !r.handledAt && r.intent !== 'unclassified' && <Badge>Needs a look</Badge>}
                  {r.handledAt && <Badge tone="success">Handled</Badge>}
                </span>
                <span className="mt-1.5 line-clamp-2 text-sm">{r.body}</span>
                {outcomeNote(r) && <span className="mt-1 block text-xs text-muted">{outcomeNote(r)}</span>}
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

function ReplyDetail({ r, onDone, keyboard }: { r: InboxItem; onDone: () => void; keyboard?: boolean }) {
  const { scope, tz, can } = useWorkspace();
  const [booking, setBooking] = useState(false);
  const contact = useQuery(() => api.contact(scope, r.contactId!), [r.contactId], { enabled: Boolean(r.contactId) && can('build') });
  const intent = INTENT[r.intent];
  const act = can('inbox_draft') && !r.handledAt;
  const handle = () => {
    deferAction({ ids: [r.id], kind: 'handle', workspaceId: scope.workspaceId, message: 'Marked handled.', commit: () => api.handle(scope, r.id) });
    onDone();
  };
  useHotkeys({ h: () => { if (act) handle(); }, b: () => { if (act) setBooking(true); } }, [r.id, act], keyboard);
  const headRef = useRef<HTMLHeadingElement>(null);
  useArrivalFocus(headRef, keyboard);
  useCommands(keyboard && act ? [
    { id: 'handle', label: `Mark the reply from ${r.contactName ?? r.fromAddress} handled`, keys: 'H', icon: CheckCircle2, run: handle },
    { id: 'book', label: 'Book a meeting', keys: 'B', icon: CalendarPlus, run: () => setBooking(true) },
  ] : []);
  return (
    <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4" aria-label={`Reply from ${r.contactName}`}>
      <Card className="overflow-hidden">
        <div className="border-b border-line p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 ref={headRef} tabIndex={-1} className="text-lg outline-none">{r.contactName ?? r.fromAddress}</h2>
            <Badge tone={intent.tone}>{intent.label}</Badge>
            {r.slaMinutesRemaining !== null && <SlaChip minutes={r.slaMinutesRemaining} dueAt={r.slaDueAt} />}
            <AskButton about={{ kind: 'reply', id: r.id, label: `the reply from ${r.contactName ?? r.fromAddress ?? 'this contact'}` }} keys={Boolean(keyboard)} className="ml-auto" />
          </div>
          <p className="mt-0.5 text-sm text-muted">{[r.contactTitle, r.contactCompany].filter(Boolean).join(' · ')}</p>
          <p className="mt-1 text-xs text-muted">{r.fromAddress} · {absTime(r.receivedAt, tz)}</p>
        </div>
        <div className="p-5">
          <p className="mb-2 text-sm font-medium text-muted">{r.subject}</p>
          {/* Plain text: never HTML, never auto-linked (DESIGN 2.8). */}
          <p className="reading">{r.body}</p>
          {outcomeNote(r) && <p className="mt-4 flex items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-sm text-muted"><ShieldOff className="size-4" aria-hidden />{outcomeNote(r)}.</p>}
          {r.needsHuman && !r.handledAt && <p className="mt-3 flex items-center gap-2 text-xs text-muted"><Info className="size-3.5" aria-hidden />Sorted by rules ({Math.round((r.intentConfidence ?? 0) * 100)}% sure). Give it a look.</p>}
        </div>
        {act && (
          <div className="flex flex-wrap gap-2 border-t border-line bg-sunken px-5 py-3">
            {['meeting_request', 'positive_inquiry', 'question', 'referral'].includes(r.intent) && <Button variant="primary" kbd="B" icon={<CalendarPlus className="size-4" aria-hidden />} onClick={() => setBooking(true)} className="max-sm:flex-1">Book</Button>}
            <Button kbd="H" icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={handle} className="max-sm:flex-1">Mark handled</Button>
          </div>
        )}
        {r.handledAt && <p className="border-t border-line bg-sunken px-5 py-3 text-sm text-muted">Handled {relTime(r.handledAt, tz)}{r.handledBy === 'system' ? ' automatically' : ''}.</p>}
        {!can('inbox_draft') && <p className="border-t border-line bg-sunken px-5 py-3 text-sm text-muted">Your role can read the inbox. Operators and admins answer replies.</p>}
      </Card>
      {act && (
        <p className="flex items-start gap-2 px-1 text-xs text-muted"><FileText className="mt-px size-3.5 shrink-0" aria-hidden />
          Answers go through Approvals like any draft. Ask Sales Outbound on Home to draft a reply; it lands in Approvals after the claims gate.</p>
      )}
      {contact.data && (
        <Card className="p-5">
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold"><UserRound className="size-4" aria-hidden />{contact.data.name}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Fit</dt><dd className="tabular">{contact.data.fitScore ?? '—'}</dd>
            {contact.data.enrollments.map((e) => (<Fragment key={e.id}><dt className="text-muted">{e.campaignName}</dt><dd>{enrollmentState(e.state, e.stopReason)}</dd></Fragment>))}
          </dl>
        </Card>
      )}
      <BookSheet open={booking} onOpenChange={setBooking} reply={r} onBooked={onDone} />
    </motion.article>
  );
}

/** Three suggested slots (next business days, 10:00 / 14:00 / 11:00 workspace time) or a custom time. */
function useSlots(tz: string) {
  return useMemo(() => {
    const out: Date[] = [];
    const d = new Date();
    const hours = [10, 14, 11];
    for (let add = 1; out.length < 3 && add < 10; add++) {
      const day = new Date(d.getTime() + add * 86400e3);
      const wd = day.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
      if (wd === 'Sat' || wd === 'Sun') continue;
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
      out.push(zoned(ymd, hours[out.length], tz));
    }
    return out;
  }, [tz]);
}
/** The instant that reads `hh:00` on `ymd` in `tz`. */
function zoned(ymd: string, hour: number, tz: string) {
  const guess = new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
  const shown = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(guess));
  return new Date(guess.getTime() - (shown - hour) * 3600e3);
}

function BookSheet({ open, onOpenChange, reply, onBooked }: { open: boolean; onOpenChange: (v: boolean) => void; reply: InboxItem; onBooked: () => void }) {
  const { scope, tz } = useWorkspace();
  const slots = useSlots(tz);
  const [pick, setPick] = useState<number | 'custom'>(0);
  const [custom, setCustom] = useState('');
  const [dur, setDur] = useState(30);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setPick(0); setErr(null); } }, [open]);
  const submit = async () => {
    const start = pick === 'custom' ? (custom ? new Date(custom) : null) : slots[pick];
    if (!start || Number.isNaN(start.getTime())) { setErr('Pick a time.'); return; }
    if (link && !/^https:\/\/\S+$/.test(link)) { setErr('The meeting link must start with https://'); return; }
    setBusy(true); setErr(null);
    try {
      await api.bookFromReply(scope, reply.id, { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + dur * 60000).toISOString(), meetUrl: link || null });
      onOpenChange(false); toast.success(`Booked with ${reply.contactName}. Their sequence has ended.`); onBooked();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Book with ${reply.contactName ?? 'this contact'}`} description={`Times in ${tz.replace('_', ' ')}. Booking marks the reply handled and ends the sequence.`}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Book meeting</Button></>}>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Suggested times</legend>
        {slots.map((s, i) => (
          <label key={i} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 transition-colors', pick === i ? 'border-ink bg-accent-soft' : 'border-line hover:bg-sunken')}>
            <input type="radio" name="slot" checked={pick === i} onChange={() => setPick(i)} className="size-4 accent-[var(--accent-ink)]" />
            <span className="font-medium">{s.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' })}</span>
            <span className="tabular ml-auto text-muted">{clock(s.toISOString(), tz)}</span>
          </label>
        ))}
        <label className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3', pick === 'custom' ? 'border-ink bg-accent-soft' : 'border-line hover:bg-sunken')}>
          <input type="radio" name="slot" checked={pick === 'custom'} onChange={() => setPick('custom')} className="size-4 accent-[var(--accent-ink)]" />
          <span className="font-medium">Another time</span>
        </label>
        {pick === 'custom' && <Input type="datetime-local" aria-label="Meeting start" value={custom} onChange={(e) => setCustom(e.target.value)} />}
      </fieldset>
      <div className="mt-4 grid gap-3 sm:grid-cols-[140px_1fr]">
        <Field label="Length">{(p) => <Select id={p.id} value={dur} onChange={(e) => setDur(Number(e.target.value))}>{[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</Select>}</Field>
        <Field label="Meeting link (optional)" error={err}>{(p) => <Input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />}</Field>
      </div>
    </Sheet>
  );
}
