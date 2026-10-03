// Handoffs (SDR-PIVOT P4): conversations passed to a human closer. A closer sees only theirs (can() + RLS, 0015); an
// operator or admin sees the workspace's. Unaccepted and overdue first. The thread is prospect text: plain, never linked.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, CalendarClock, Check, Copy, Handshake, Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Scope } from '@/lib/api/client';
import type { HandoffItem, HandoffOutcome, HandoffReason } from '@/lib/api/types';
import { useMedia, useNow, useQuery, prefetchQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { absTime, relTime } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, Page, PageHeader, Segmented, Select, Skeleton, SkeletonList, cx } from '@/components/ui';

export const REASON: Record<HandoffReason, string> = {
  qualified: 'Qualified', meeting_request: 'Wants a meeting', asked_for_human: 'Asked for a person', escalation: 'Escalated',
};
const ANSWER_LABEL: Record<string, string> = { need: 'What they need', timing: 'Timing', decisionMaker: 'Decision-maker', budget: 'Budget' };
const OUTCOME: Record<HandoffOutcome, string> = { won: 'Won', lost: 'Lost', no_show: 'No-show', not_a_fit: 'Not a fit', reassigned: 'Reassigned' };
// What recording each outcome does to the conversation (0015 handoffs_sync; it reopens when they write again).
const OUTCOME_DONE: Record<HandoffOutcome, string> = {
  won: 'Recorded: Won. It stays with you if they write again.',
  lost: 'Recorded: Lost. If they write again, it goes back to the inbox.',
  no_show: 'Recorded: No-show. If they write again, it goes back to the inbox.',
  not_a_fit: 'Recorded: Not a fit. If they write again, it goes back to the inbox.',
  reassigned: 'Reassigned. The conversation is back in the inbox to hand off again.',
};

/** Warmed on hover of the Handoffs nav link. */
export const prefetch = (s: Scope) => prefetchQuery(`handoffs:${s.workspaceId}:open`, () => api.handoffs(s));

export default function HandoffsPage() {
  const { scope, role } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const show = (params.get('s') === 'all' ? 'all' : 'open') as 'open' | 'all';
  const list = useQuery(() => api.handoffs(scope, { open: show === 'open' }), [scope.workspaceId, show], { pollMs: 60000, key: `handoffs:${scope.workspaceId}:${show}` });
  const wide = useMedia('(min-width: 1100px)');
  const items = list.data ?? [];
  const selId = params.get('h');
  const selected = items.find((h) => h.id === selId) ?? (wide ? items[0] : undefined);
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const header = (
    <PageHeader title="Handoffs" subtitle={role === 'closer'
      ? 'Conversations handed to you, with what they said and what qualified them. Accept one to stop its clock.'
      : 'Conversations passed to a closer. One not accepted in time alerts the workspace.'}>
      <div className="flex w-full flex-wrap items-end gap-4">
        <Segmented id="handoff-tabs" label="Which handoffs" value={show} onChange={(v) => setParam('s', v === 'open' ? null : v)}
          options={[{ value: 'open', label: 'Open', count: show === 'open' ? items.length : undefined }, { value: 'all', label: 'All' }]} />
        <BookingLink />
      </div>
    </PageHeader>
  );
  const empty = <EmptyState icon={<Handshake className="size-5" aria-hidden />} title={show === 'open' ? 'Nothing waiting' : 'No handoffs yet'}
    body={role === 'closer' ? 'When a conversation is handed to you, it lands here.' : 'Hand a conversation off from the Inbox when it is ready for a person.'} />;

  if (!wide) {
    return (
      <Page>
        {selected && selId ? (<>
          <div className="mb-3"><IconButton label="Back to handoffs" onClick={() => setParam('h', null)}><ArrowLeft className="size-5" aria-hidden /></IconButton></div>
          <HandoffDetail key={selected.id} id={selected.id} />
        </>) : (<>
          {header}
          <ErrorState error={list.error} onRetry={list.reload} />
          {list.loading ? <SkeletonList rows={4} /> : items.length ? <HandoffList items={items} selectedId={null} onSelect={(id) => setParam('h', id)} /> : empty}
        </>)}
      </Page>
    );
  }
  return (
    <Page wide>
      {header}
      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading ? <div className="grid grid-cols-[minmax(320px,400px)_1fr] gap-5"><SkeletonList rows={4} /><Skeleton className="h-96 rounded-xl" /></div>
        : !items.length ? empty : (
          <div className="grid grid-cols-[minmax(320px,400px)_1fr] items-start gap-5">
            <HandoffList items={items} selectedId={selected?.id ?? null} onSelect={(id) => setParam('h', id)} />
            {selected && <HandoffDetail key={selected.id} id={selected.id} />}
          </div>
        )}
    </Page>
  );
}

function DueChip({ h }: { h: Pick<HandoffItem, 'dueAt' | 'acceptedAt' | 'outcome' | 'overdue'> }) {
  const { tz } = useWorkspace();
  const now = useNow();
  if (h.outcome) return <Badge>{OUTCOME[h.outcome]}</Badge>;
  if (h.acceptedAt) return <Badge tone="success">Accepted</Badge>;
  if (!h.dueAt) return null;
  return (
    <span title={`Accept by ${absTime(h.dueAt, tz)}`} className={cx('tabular inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs whitespace-nowrap',
      h.overdue ? 'bg-danger font-semibold text-surface' : 'bg-warning-soft text-warning')}>
      <CalendarClock className="size-3" aria-hidden />{h.overdue ? `Overdue ${relTime(h.dueAt, tz, now)}` : `Accept ${relTime(h.dueAt, tz, now)}`}
    </span>
  );
}

function HandoffList({ items, selectedId, onSelect }: { items: HandoffItem[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { tz } = useWorkspace();
  const now = useNow();
  return (
    <ul className="space-y-1.5" aria-label="Handoffs">
      {items.map((h) => {
        const on = h.id === selectedId;
        return (
          <li key={h.id}>
            <button onClick={() => onSelect(h.id)} aria-current={on || undefined}
              className={cx('row-d w-full rounded-xl border px-3 text-left transition-colors', on ? 'border-ink/40 bg-surface shadow-md' : 'border-line bg-surface/70 hover:bg-surface',
                h.overdue && !on && 'border-danger/40')}>
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{h.contactName ?? h.contactEmail ?? 'Unknown contact'}</span>
                <span className="ml-auto shrink-0 text-xs text-muted">{relTime(h.createdAt, tz, now)}</span>
              </span>
              <span className="block truncate text-sm text-muted">{h.contactCompany}</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone="accent">{REASON[h.reason]}</Badge>
                <DueChip h={h} />
              </span>
              <span className="mt-1.5 line-clamp-2 text-sm">{h.summary}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function HandoffDetail({ id }: { id: string }) {
  const { scope, tz, settings } = useWorkspace();
  const card = useQuery(() => api.handoff(scope, id), [scope.workspaceId, id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<HandoffOutcome>('won');
  if (card.error) return <ErrorState error={card.error} onRetry={card.reload} />;
  if (!card.data) return <Skeleton className="h-96 rounded-xl" />;
  const h = card.data;
  const mine = settings?.you.userId === h.closerId;
  const act = async (what: string, fn: () => Promise<void>, done: string) => {
    setBusy(what);
    try { await fn(); toast.success(done); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const answers = Object.entries(h.answers ?? {}).filter(([, v]) => v !== null && v !== '');
  return (
    <article className="space-y-4" aria-label={`Handoff: ${h.contact?.name ?? h.contact?.email ?? 'contact'}`}>
      <Card className="overflow-hidden">
        <div className="border-b border-line p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg">{h.contact?.name ?? h.contact?.email ?? 'Unknown contact'}</h2>
            <Badge tone="accent">{REASON[h.reason]}</Badge>
            <DueChip h={h} />
          </div>
          <p className="mt-0.5 text-sm text-muted">{[h.contact?.company, h.contact?.email].filter(Boolean).join(' · ')}</p>
          <p className="mt-1 text-xs text-muted">Handed off {absTime(h.createdAt, tz)}{h.closerEmail && !mine ? ` to ${h.closerEmail}` : ''}</p>
        </div>
        <div className="space-y-4 p-5">
          <section>
            <h3 className="mb-1 text-sm font-medium text-muted">Summary</h3>
            <p className="reading">{h.summary}</p>
          </section>
          {answers.length > 0 && (
            <section>
              <h3 className="mb-1 text-sm font-medium text-muted">What they told us</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {answers.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{ANSWER_LABEL[k] ?? k}</dt><dd>{String(v)}</dd></div>))}
              </dl>
            </section>
          )}
          <section className="flex flex-wrap items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-sm">
            <Link2 className="size-4 text-muted" aria-hidden />
            {h.bookingUrl ? (<>
              <span className="min-w-0 truncate">{h.bookingUrl}</span>
              <Button size="sm" variant="ghost" className="ml-auto" icon={<Copy className="size-4" aria-hidden />}
                onClick={() => { navigator.clipboard?.writeText(h.bookingUrl!).then(() => toast.success('Booking link copied.'), () => toast.error('Couldn’t copy.')); }}>Copy</Button>
            </>) : <span className="text-muted">{mine ? 'Add your booking link above to offer a time.' : 'This closer has no booking link yet.'}</span>}
          </section>
        </div>
        {!h.outcome && (
          <div className="flex flex-wrap items-end gap-2 border-t border-line bg-sunken px-5 py-3">
            {mine && !h.acceptedAt && (
              <Button variant="primary" loading={busy === 'accept'} icon={<Check className="size-4" aria-hidden />}
                onClick={() => act('accept', () => api.acceptHandoff(scope, h.id), 'Accepted. The clock has stopped.')}>Accept</Button>
            )}
            <div className="ml-auto flex items-end gap-2">
              <Select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as HandoffOutcome)}>
                {(settings?.you.role === 'closer' ? ['won', 'lost', 'no_show', 'not_a_fit'] as const : ['won', 'lost', 'no_show', 'not_a_fit', 'reassigned'] as const)
                  .map((o) => <option key={o} value={o}>{OUTCOME[o]}</option>)}
              </Select>
              <Button loading={busy === 'outcome'} onClick={() => act('outcome', () => api.handoffOutcome(scope, h.id, outcome), OUTCOME_DONE[outcome])}>
                Record outcome
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 text-base font-semibold">Conversation</h3>
        {!h.conversation && <p className="text-sm text-muted">This conversation is no longer handed to you, so its messages aren’t shown.</p>}
        <ol className="space-y-3">
          {(h.conversation?.messages ?? []).map((m) => (
            <li key={m.id} className={cx('rounded-lg px-3 py-2', m.direction === 'in' ? 'bg-sunken' : 'border border-line')}>
              <p className="mb-1 text-xs text-muted">{m.direction === 'in' ? 'They wrote' : 'We sent'} · {absTime(m.at, tz)}{m.subject ? ` · ${m.subject}` : ''}</p>
              {/* Plain text: never HTML, never auto-linked (DESIGN 2.8). */}
              <p className="reading whitespace-pre-wrap text-sm">{m.body}</p>
            </li>
          ))}
        </ol>
      </Card>
    </article>
  );
}

/** The person's own booking link in this org, offered on every handoff card they get. https only. */
function BookingLink() {
  const { scope } = useWorkspace();
  const link = useQuery(() => api.bookingLink(scope), [scope.workspaceId]);
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(link.data?.url ?? ''); }, [link.data?.url]);
  const save = async () => {
    const url = value.trim() || null;
    if (url && !/^https:\/\/[^\s<>"]+$/.test(url)) { setErr('Use an https:// link.'); return; }
    setBusy(true); setErr(null);
    try { await api.setBookingLink(scope, url); toast.success(url ? 'Booking link saved.' : 'Booking link removed.'); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const dirty = (link.data?.url ?? '') !== value.trim();
  return (
    <div className="ml-auto flex min-w-[min(100%,360px)] items-end gap-2">
      <Field label="Your booking link" error={err} className="flex-1">{(p) => (
        <Input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} inputMode="url" placeholder="https://" value={value} onChange={(e) => setValue(e.target.value)} />
      )}</Field>
      <Button disabled={!dirty} loading={busy} onClick={save}>Save</Button>
    </div>
  );
}
