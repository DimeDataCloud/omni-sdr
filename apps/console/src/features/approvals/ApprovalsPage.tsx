// Approvals (DESIGN 6.4). One decision at a time; blocked drafts have no Approve button at all;
// editing re-runs the claims gate; bulk approve covers only drafts the person has opened.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion, useMotionValue, useTransform, animate, type PanInfo } from 'motion/react';
import { toast } from 'sonner';
import { Check, X, Pencil, SkipForward, ShieldCheck, ShieldAlert, ExternalLink, Mail, BriefcaseBusiness, MessageSquare, CheckCheck, Bot, AlertTriangle, ArrowLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { ApprovalCard, DraftStatus } from '@/lib/api/types';
import { bumpEdge, useArrivalFocus, useHotkeys, useMedia, useQuery, useSelection, prefetchQuery, requestArrival } from '@/lib/hooks';
import { useCommands } from '@/lib/commands';
import { AskButton } from '@/lib/ask';
import type { Scope } from '@/lib/api/client';
import { useWorkspace } from '@/lib/session';
import { deferAction, usePending } from '@/lib/undo';
import { EMAIL_STATUS, TIER, draftStatus, domainOf, factSummary, findingSentence, findingText, relTime, plural } from '@/lib/format';
import { Badge, BulkBar, Button, EmptyState, ErrorState, IconButton, Input, Page, PageHeader, Segmented, Sheet, SkeletonList, Skeleton, Textarea, cx } from '@/components/ui';

type Tab = 'review' | 'blocked' | 'approved' | 'all';
const opened = new Set<string>(); // drafts this person has actually looked at, this session (bulk approve rule)

/** Warmed on hover of the Approvals nav link. */
export const prefetch = (s: Scope) => prefetchQuery(`approvals:${s.workspaceId}:review`, () => api.approvals(s, { status: 'review' }));

export default function ApprovalsPage() {
  const { scope } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'review';
  const list = useQuery(() => api.approvals(scope, { status: tab as DraftStatus | 'all' }), [scope.workspaceId, tab], { key: `approvals:${scope.workspaceId}:${tab}` });
  const wide = useMedia('(min-width: 1100px)');
  const pending = usePending();
  // A decided draft leaves the decision lists in the same frame; it commits when its undo window closes.
  const decisionTab = tab === 'review' || tab === 'blocked';
  const all = list.data?.items ?? [];
  const items = decisionTab ? all.filter((d) => !pending.isHidden(d.id)) : all;
  const hiddenHere = all.length - items.length;
  const selId = params.get('d');
  // One row per person and campaign; the card's stepper moves between that person's drafts.
  const groups = useMemo(() => {
    const m = new Map<string, ApprovalCard[]>();
    for (const d of items) m.set(groupKey(d), [...(m.get(groupKey(d)) ?? []), d]);
    for (const g of m.values()) g.sort((a, b) => a.step - b.step);
    return m;
  }, [items]);
  const heads = useMemo(() => [...groups.values()].map((g) => g[0]), [groups]);
  // A decided draft is hidden in the same frame, one render before the URL moves to the next one. Resolve the open
  // draft to where it WAS (its own group if other steps remain, else the next group, else the previous) so that
  // render already shows the right card, instead of flashing the first card and mounting the right one after.
  const orderAll = useMemo(() => [...new Set(all.map(groupKey))], [all]);
  const findGroup = (id: string) => {
    const hit = [...groups.values()].find((g) => g.some((d) => d.id === id));
    if (hit) return hit;
    const gone = all.find((d) => d.id === id);
    if (!gone) return undefined;
    const i = orderAll.indexOf(groupKey(gone));
    for (let j = i; j < orderAll.length; j++) if (groups.has(orderAll[j])) return groups.get(orderAll[j]);
    for (let j = i - 1; j >= 0; j--) if (groups.has(orderAll[j])) return groups.get(orderAll[j]);
    return undefined;
  };
  const selGroup = (selId ? findGroup(selId) : undefined) ?? (wide && heads[0] ? groups.get(groupKey(heads[0])) : undefined);
  const selected = selGroup?.[0];
  const order = useMemo(() => heads.map(groupKey), [heads]);
  const checked = useSelection(order, tab === 'review');
  // X toggles the open draft (it is open, so it counts as seen for bulk approve).
  useHotkeys({ x: () => { if (selected && tab === 'review') checked.toggle(groupKey(selected)); } }, [selected?.id, tab, checked.toggle], wide);
  const [exiting, setExiting] = useState<'left' | 'right' | null>(null);

  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const select = (id: string | null) => setParam('d', id);
  const idx = selected ? heads.findIndex((d) => d.id === selected.id) : -1;
  const move = (d: 1 | -1) => { const n = heads[Math.min(heads.length - 1, Math.max(0, idx + d))]; if (n && n.id !== selected?.id) { requestArrival(); select(n.id); } else bumpEdge(d); };
  const moved = (t: Tab, id: string) => { const p = new URLSearchParams(); if (t !== 'review') p.set('tab', t); p.set('d', id); setParams(p, { replace: true }); };
  const afterDecision = (dir: 'left' | 'right') => {
    setExiting(dir);
    const nextItem = heads[idx + 1] ?? heads[idx - 1];
    if (nextItem && nextItem.id !== selected?.id) { requestArrival(); select(nextItem.id); } else select(null);
  };

  const counts = { ...(list.data?.counts ?? {}), ...(decisionTab && list.data ? { [tab]: Math.max(0, (list.data.counts[tab] ?? 0) - hiddenHere) } : {}) };
  const inChecked = checked.ids.flatMap((k) => groups.get(k) ?? []).filter((d) => d.status === 'review');
  const reviewable = inChecked.filter((d) => opened.has(d.id)).map((d) => d.id);
  const unopened = inChecked.length - reviewable.length;
  const bulk = () => {
    const ids = [...reviewable];
    checked.clear();
    deferAction({ ids, kind: 'approve', workspaceId: scope.workspaceId, message: `Approved ${plural(ids.length, 'draft')}. They send in the next window.`,
      commit: async () => { const r = await api.bulkApprove(scope, ids); if (r.approved < ids.length) toast.error(`${ids.length - r.approved} changed before approval and stayed in the list.`); } });
  };

  const header = (
    <PageHeader title="Approvals" subtitle="Every draft here passed the claims gate. Nothing goes out until you approve it."
>
      <div className="w-full">
        <Segmented id="appr-tabs" label="Draft status" value={tab} onChange={(v) => { const p = new URLSearchParams(); if (v !== 'review') p.set('tab', v); setParams(p); checked.clear(); }}
          options={[{ value: 'review', label: 'In review', count: counts.review ?? 0 }, { value: 'blocked', label: 'Blocked', count: counts.blocked ?? 0 },
            { value: 'approved', label: 'Approved', count: counts.approved ?? 0 }, { value: 'all', label: 'All' }]} />
      </div>
    </PageHeader>
  );

  useCommands([
    ...(selected && tab === 'review' && wide ? [{ id: 'sel', label: checked.has(groupKey(selected)) ? 'Unselect this draft' : 'Select this draft for bulk approve', keys: 'X', run: () => checked.toggle(groupKey(selected)) }] : []),
    ...(reviewable.length ? [{ id: 'bulk', label: `Approve ${plural(reviewable.length, 'selected draft')}`, icon: CheckCheck, run: bulk }] : []),
    ...(checked.size ? [{ id: 'clear', label: 'Clear selection', keys: 'Esc', run: checked.clear }] : []),
  ]);

  const bulkBar = (
    <BulkBar count={checked.size} onClear={checked.clear} note={unopened > 0 ? `${unopened} not opened yet, so not included` : undefined}>
      <Button variant="primary" size="sm" disabled={!reviewable.length} icon={<CheckCheck className="size-4" aria-hidden />} onClick={bulk}>Approve {reviewable.length}</Button>
    </BulkBar>
  );

  const empty = tab === 'review'
    ? <EmptyState icon={<CheckCheck className="size-5" aria-hidden />} title="Nothing to approve" body="New drafts land here after the claims gate checks them. Ask Sales Outbound on Home for more." />
    : <EmptyState title={tab === 'blocked' ? 'Nothing is blocked' : 'Nothing here yet'} body={tab === 'blocked' ? 'Every draft passed the claims gate.' : undefined} />;

  // Phones and narrow tablets: list, then one full card (swipe to decide).
  if (!wide) {
    return (
      <Page>
        {selected ? (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <IconButton label="Back to list" onClick={() => select(null)}><ArrowLeft className="size-5" aria-hidden /></IconButton>
              <span className="text-sm text-muted">{idx + 1} of {heads.length}</span>
            </div>
            <AnimatePresence mode="popLayout" custom={exiting} onExitComplete={() => setExiting(null)}>
              <SwipeCard key={groupKey(selected)} group={selGroup!} initialId={selId} exitDir={exiting} onDecided={afterDecision} onSkip={() => move(1)} onMoved={moved} />
            </AnimatePresence>
          </div>
        ) : (
          <>
            {header}
            <ErrorState error={list.error} onRetry={list.reload} />
            {list.loading ? <SkeletonList rows={5} /> : items.length === 0 ? empty : (
              <ListRows items={heads} groups={groups} selectedId={null} onSelect={select} checked={checked} />
            )}
            {bulkBar}
          </>
        )}
      </Page>
    );
  }

  return (
    <Page wide>
      {header}
      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading ? (
        <div className="grid grid-cols-[minmax(300px,380px)_1fr] gap-5"><SkeletonList rows={6} /><Skeleton className="h-[560px] rounded-xl" /></div>
      ) : items.length === 0 ? empty : (
        <div className="grid grid-cols-[minmax(300px,380px)_1fr] items-start gap-5">
          <div className="sticky top-[72px] max-h-[calc(100dvh-160px)] overflow-y-auto pr-1">
            <ListRows items={heads} groups={groups} selectedId={selected?.id ?? null} onSelect={select} checked={checked} />
          </div>
          <AnimatePresence mode="popLayout" custom={exiting} onExitComplete={() => setExiting(null)}>
            {selected && <DecisionCard key={groupKey(selected)} group={selGroup!} initialId={selId} exitDir={exiting} onDecided={afterDecision} onSkip={() => move(1)} onPrev={() => move(-1)} onMoved={moved} keyboard />}
          </AnimatePresence>
        </div>
      )}
      {bulkBar}
    </Page>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────────────────────
function ChannelIcon({ c }: { c: ApprovalCard['channel'] }) {
  const I = c === 'email' ? Mail : c === 'sms' ? MessageSquare : BriefcaseBusiness;
  return <I className="size-3.5" aria-label={c === 'email' ? 'Email' : c === 'sms' ? 'SMS' : 'LinkedIn'} />;
}
const groupKey = (d: ApprovalCard) => `${d.recipient.contactId}:${d.campaign.id}`;

/** Approve with an undo window: hidden now, sent to the API when the window closes. */
function approveLater(scope: { orgId: string; workspaceId: string }, id: string, message: string) {
  deferAction({ ids: [id], kind: 'approve', workspaceId: scope.workspaceId, message, commit: () => api.approve(scope, id),
    onFail: (e) => toast.error(e instanceof ApiError && e.status === 409 ? 'That draft changed before it was approved, so it is back in the list.' : e.message) });
}
function ListRows({ items, groups, selectedId, onSelect, checked }: { items: ApprovalCard[]; groups: Map<string, ApprovalCard[]>; selectedId: string | null; onSelect: (id: string) => void; checked: ReturnType<typeof useSelection> }) {
  const { tz } = useWorkspace();
  return (
    <ul className="space-y-1.5" aria-label="Drafts" data-kbd-list>
      <AnimatePresence initial={false}>
        {items.map((d, i) => {
          const on = d.id === selectedId;
          const st = draftStatus(d.status, d.dispatched);
          const seen = opened.has(d.id);
          const n = groups.get(groupKey(d))?.length ?? 1;
          return (
            <motion.li key={d.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.025 } }} exit={{ opacity: 0, x: -24, height: 0, marginTop: 0 }}
              className={cx('relative flex items-stretch rounded-xl border transition-colors', on ? 'border-ink/40 bg-surface shadow-md' : 'border-line bg-surface/70 hover:bg-surface')}>
              {d.status === 'review' && (
                <label className="flex w-10 shrink-0 cursor-pointer items-start justify-center pt-[calc(var(--row-py)+4px)]" title={seen ? 'Select for bulk approve' : 'Open it first to include it in bulk approve'}>
                  <span className="sr-only">Select {d.recipient.name}</span>
                  <input type="checkbox" disabled={!seen} checked={checked.has(groupKey(d))} className="size-4 accent-[var(--accent-ink)] disabled:opacity-40"
                    onChange={(e) => checked.toggle(groupKey(d), e.nativeEvent as MouseEvent)} />
                </label>
              )}
              <button onClick={() => onSelect(d.id)} aria-current={on || undefined} className={cx('row-d min-w-0 flex-1 pr-3 text-left', d.status !== 'review' && 'pl-3.5')}>
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{d.recipient.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted"><ChannelIcon c={d.channel} /><span className="tabular text-sm font-semibold text-fg">{d.fitScore ?? '—'}</span></span>
                </span>
                <span className="block truncate text-sm text-muted">{d.recipient.company}{n > 1 ? ` · ${n} drafts` : ` · step ${d.step + 1}`}</span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{d.subject}</span>
                  {d.status !== 'review' && <Badge tone={st.tone}>{st.label}</Badge>}
                  <span className="shrink-0 text-xs text-muted">{relTime(d.createdAt, tz)}</span>
                </span>
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

// ── The card ──────────────────────────────────────────────────────────────────────────────────
type DecisionProps = { group: ApprovalCard[]; initialId: string | null; exitDir: 'left' | 'right' | null; onDecided: (d: 'left' | 'right') => void; onSkip: () => void; onPrev?: () => void; keyboard?: boolean; onMoved?: (tab: Tab, id: string) => void };

const cardVariants = {
  enter: { opacity: 0, y: 16, scale: 0.985 },
  center: { opacity: 1, y: 0, scale: 1, x: 0, rotate: 0 },
  exit: (dir: 'left' | 'right' | null) => (dir ? { opacity: 0, x: dir === 'right' ? 160 : -160, rotate: dir === 'right' ? 3 : -3, transition: { duration: 0.2 } } : { opacity: 0, transition: { duration: 0.12 } }),
};

function DecisionCard({ group, initialId, exitDir, onDecided, onSkip, onPrev, keyboard, onMoved, dragProps }: DecisionProps & { dragProps?: Record<string, unknown> }) {
  const { scope, tz, can } = useWorkspace();
  const [activeId, setActiveId] = useState(() => group.find((d) => d.id === initialId)?.id ?? group[0].id);
  const item = group.find((d) => d.id === activeId) ?? group[0];
  const [step, setStep] = useState(item.step);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState<'save' | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [subject, setSubject] = useState(item.subject ?? '');
  const [body, setBody] = useState(item.body);
  const shown = item.sequence.find((s) => s.step === step);
  const isCurrent = !shown || shown.id === item.id;
  const blocked = item.status === 'blocked';
  const actionable = !item.dispatched && ['review', 'blocked'].includes(item.status) && isCurrent;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  useArrivalFocus(headRef, keyboard);
  useEffect(() => { opened.add(item.id); setStep(item.step); setSubject(item.subject ?? ''); setBody(item.body); setEditing(false); setConflict(null); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickStep = (s: { id: string; step: number }) => { setStep(s.step); if (group.some((d) => d.id === s.id)) setActiveId(s.id); };

  const approve = () => {
    if (!item.gate.passed || item.status !== 'review') return;
    setConflict(null);
    const rest = group.filter((d) => d.id !== item.id && d.status === 'review');
    approveLater(scope, item.id, rest.length ? `Approved step ${item.step + 1}. Now step ${rest[0].step + 1}.` : 'Approved. It sends in the next window.');
    if (rest.length) { setActiveId(rest[0].id); onMoved?.('review', rest[0].id); } else onDecided('right');
  };
  const save = async () => {
    setBusy('save');
    try {
      const r = await api.editDraft(scope, item.id, { subject: subject.trim() || null, body });
      setEditing(false);
      if (r.gate === 'passed') { toast.success('Saved. The claims gate passed the new text.'); if (item.status !== 'review') onMoved?.('review', item.id); }
      else { toast.error('Saved, but the claims gate blocked the new text. It moved to Blocked.'); if (item.status !== 'blocked') onMoved?.('blocked', item.id); }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const startEdit = () => { setEditing(true); setTimeout(() => bodyRef.current?.focus(), 30); };
  useCommands(keyboard ? [
    ...(actionable && !blocked && item.gate.passed && item.status === 'review' ? [{ id: 'approve', label: `Approve the draft to ${item.recipient.name}`, keys: 'A', icon: Check, run: approve }] : []),
    ...(actionable ? [{ id: 'edit', label: blocked ? 'Edit to fix' : 'Edit this draft', keys: 'E', icon: Pencil, run: startEdit },
      { id: 'reject', label: 'Reject this draft', keys: 'D', icon: X, tone: 'danger' as const, run: () => setRejecting(true) }] : []),
    { id: 'next', label: 'Next draft', keys: 'J', run: onSkip },
    ...(onPrev ? [{ id: 'prev', label: 'Previous draft', keys: 'K', run: onPrev }] : []),
    ...(item.sequence.length > 1 ? [{ id: 'step', label: 'Show a sequence step', keys: `1–${item.sequence.length}`, run: () => pickStep(item.sequence[0]) }] : []),
  ] : []);
  useHotkeys({
    j: onSkip, k: () => onPrev?.(), s: onSkip,
    a: () => { if (!editing && !blocked && actionable) approve(); },
    e: () => { if (actionable) startEdit(); },
    d: () => { if (actionable) setRejecting(true); },
    ...Object.fromEntries(item.sequence.map((s, i) => [String(i + 1), () => pickStep(s)])),
  }, [item.id, editing, blocked, actionable, item.sequence.length], keyboard && !editing);

  const marks = useMemo(() => [
    ...item.claims.filter((c) => c.text).map((c, i) => ({ text: c.text!, kind: 'claim' as const, ref: `ev-${item.id}-${i}` })),
    ...item.gate.findings.map((f) => findingSentence(f.code, f.detail)).filter((s): s is string => Boolean(s)).map((text) => ({ text, kind: 'finding' as const, ref: `find-${item.id}` })),
  ], [item]);

  return (
    <motion.article variants={cardVariants} custom={exitDir} initial="enter" animate="center" exit="exit" transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
      {...dragProps} aria-label={`Draft to ${item.recipient.name}`} className="card overflow-hidden lg:sticky lg:top-[72px] lg:flex lg:max-h-[calc(100dvh-228px)] lg:flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-start gap-4 border-b border-line p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 ref={headRef} tabIndex={-1} className="text-lg outline-none">{item.recipient.name}</h2>
            <Badge tone={draftStatus(item.status, item.dispatched).tone}>{draftStatus(item.status, item.dispatched).label}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted">{[item.recipient.title, item.recipient.company].filter(Boolean).join(' · ')}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="truncate">{item.recipient.email}</span>
            {item.recipient.emailStatus !== 'valid' && <Badge tone={EMAIL_STATUS[item.recipient.emailStatus].tone}>{EMAIL_STATUS[item.recipient.emailStatus].label}</Badge>}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{item.campaign.name}</span>
            {item.agent && <span className="inline-flex items-center gap-1"><Bot className="size-3.5" aria-hidden />{item.agent.name} · {TIER[item.agent.modelTier].label}</span>}
            <span>{relTime(item.createdAt, tz)}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-2xl leading-none font-semibold">{item.fitScore ?? '—'}</p>
          <p className="mt-1 text-xs text-muted">ICP fit</p>
          <AskButton about={{ kind: 'draft', id: item.id, label: `the draft to ${item.recipient.name ?? 'this contact'}` }} keys={Boolean(keyboard)} className="mt-2" />
        </div>
      </div>

      {/* Sequence stepper */}
      {item.sequence.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-sunken/60 px-5 py-2" role="tablist" aria-label="Sequence">
          {item.sequence.map((s, i) => {
            const on = s.step === step;
            return (
              <button key={s.id} role="tab" aria-selected={on} onClick={() => pickStep(s)}
                className={cx('relative isolate flex h-8 items-center gap-2 rounded-md px-3 text-sm whitespace-nowrap max-md:h-10', on ? 'font-medium text-fg' : 'text-muted hover:text-fg')}>
                {on && <motion.span layoutId={`step-${item.id}`} className="absolute inset-0 -z-10 rounded-md bg-surface shadow-sm" />}
                <span className="tabular">{i + 1}.</span>{s.step === 0 ? 'First touch' : 'Follow-up'}
                {s.status !== 'review' && <span className="text-xs text-muted">({draftStatus(s.status).label.toLowerCase()})</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      {/* Body */}
      <div className="p-5">
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
            <div><label htmlFor={`subj-${item.id}`} className="mb-1 block text-sm font-medium">Subject</label>
              <Input id={`subj-${item.id}`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></div>
            <div><label htmlFor={`body-${item.id}`} className="mb-1 block text-sm font-medium">Message</label>
              <Textarea id={`body-${item.id}`} ref={bodyRef} rows={12} value={body} onChange={(e) => setBody(e.target.value)} className="reading !max-w-none text-md"
                onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setBody(item.body); setSubject(item.subject ?? ''); } }} /></div>
            <p className="text-xs text-muted">Saving re-runs the claims gate on the new text. Approve appears again only if it passes.</p>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={busy === 'save'}>{busy === 'save' ? 'Re-checking…' : 'Save and re-check'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setEditing(false); setBody(item.body); setSubject(item.subject ?? ''); }}>Cancel</Button>
            </div>
          </form>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
              <p className="text-xs font-medium text-muted">Subject</p>
              <p className="mb-4 text-md font-semibold">{(isCurrent ? item.subject : shown?.subject) || '(no subject)'}</p>
              <div className="reading">{isCurrent ? <Highlighted body={item.body} marks={marks} /> : shown?.body}</div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Gate verdict */}
      {isCurrent && !editing && (blocked ? (
        <div id={`find-${item.id}`} className="mx-5 mb-5 rounded-lg border border-danger/25 bg-danger-soft p-4">
          <p className="flex items-center gap-2 font-semibold text-danger"><ShieldAlert className="size-4" aria-hidden />Blocked by the claims gate</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {item.gate.findings.map((f, i) => (
              <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
                <span>{findingText(f.code, f.detail)}{findingSentence(f.code, f.detail) && <span className="mt-0.5 block text-muted">&ldquo;{findingSentence(f.code, f.detail)}&rdquo;</span>}</span></li>
            ))}
          </ul>
        </div>
      ) : item.claims.length > 0 && (
        <div className="px-5 pb-5">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink"><ShieldCheck className="size-4" aria-hidden />Every claim is backed by evidence</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {item.claims.map((c, i) => c.evidence && (
              <div key={i} id={`ev-${item.id}-${i}`} className="rounded-lg border border-line bg-sunken/50 p-3 text-sm target:ring-2 target:ring-ring">
                <p className="font-medium">&ldquo;{c.text}&rdquo;</p>
                <a href={c.evidence.sourceUri} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-ink hover:underline">
                  {domainOf(c.evidence.sourceUri)}<ExternalLink className="size-3" aria-hidden /><span className="sr-only">(opens in a new tab)</span></a>
                <p className="mt-1 text-xs text-muted">{c.evidence.type.replace(/_/g, ' ')} · fetched {relTime(c.evidence.fetchedAt, tz)} · expires {new Date(c.evidence.expiresAt).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })}</p>
                {new Date(c.evidence.expiresAt) < new Date() && <Badge tone="warning" className="mt-1">Expired</Badge>}
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted">{factSummary(c.evidence.facts).map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      ))}

      {conflict && <div className="mx-5 mb-4 flex items-center gap-3 rounded-lg bg-warning-soft p-3 text-sm text-warning" role="alert">{conflict}<Button size="sm" className="ml-auto" onClick={() => location.reload()}>Reload</Button></div>}

      </div>

      {/* Action bar */}
      {actionable && can('approve') && !editing && (
        <div className="sticky bottom-0 flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-sunken px-5 py-3 max-lg:pb-[max(12px,env(safe-area-inset-bottom))]">
          {!blocked && <Button variant="primary" kbd="A" icon={<Check className="size-4" aria-hidden />} onClick={approve}>Approve</Button>}
          <Button kbd="E" icon={<Pencil className="size-4" aria-hidden />} onClick={() => { setEditing(true); setTimeout(() => bodyRef.current?.focus(), 30); }}>{blocked ? 'Edit to fix' : 'Edit'}</Button>
          <Button variant="danger" kbd="D" icon={<X className="size-4" aria-hidden />} onClick={() => setRejecting(true)}>Reject</Button>
          <Button variant="ghost" kbd="S" icon={<SkipForward className="size-4" aria-hidden />} onClick={onSkip} className="ml-auto">Skip</Button>
        </div>
      )}
      {!actionable && !isCurrent && <p className="border-t border-line bg-sunken px-5 py-3 text-sm text-muted">Showing step {item.sequence.findIndex((s) => s.step === step) + 1}. Decisions apply to the step this card opened on.</p>}
      <RejectSheet open={rejecting} onOpenChange={setRejecting} id={item.id} onDone={() => onDecided('left')} />
    </motion.article>
  );
}

/** Body text with claim sentences (green) and gate-flagged sentences (red) marked. Plain text only. */
function Highlighted({ body, marks }: { body: string; marks: { text: string; kind: 'claim' | 'finding'; ref: string }[] }) {
  const spans: { start: number; end: number; kind: 'claim' | 'finding'; ref: string }[] = [];
  const lower = body.toLowerCase();
  for (const m of marks) {
    const at = lower.indexOf(m.text.toLowerCase().trim());
    if (at >= 0 && !spans.some((s) => at < s.end && at + m.text.length > s.start)) spans.push({ start: at, end: at + m.text.trim().length, kind: m.kind, ref: m.ref });
  }
  spans.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let pos = 0;
  spans.forEach((s, i) => {
    out.push(body.slice(pos, s.start));
    const cls = s.kind === 'claim' ? 'bg-accent-soft text-fg underline decoration-ink/40 decoration-dotted underline-offset-4' : 'bg-danger-soft text-danger';
    out.push(s.kind === 'claim'
      ? <a key={i} href={`#${s.ref}`} className={cx('rounded-sm px-0.5', cls)} title="See the evidence">{body.slice(s.start, s.end)}</a>
      : <mark key={i} className={cx('rounded-sm px-0.5', cls)}>{body.slice(s.start, s.end)}</mark>);
    pos = s.end;
  });
  out.push(body.slice(pos));
  return <>{out}</>;
}

const REASONS = ['Tone', 'Wrong person', 'Claim feels off', 'Too pushy'];
function RejectSheet({ open, onOpenChange, id, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; id: string; onDone: () => void }) {
  const { scope } = useWorkspace();
  const [chip, setChip] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const submit = () => {
    const reason = [chip, note.trim()].filter(Boolean).join(': ') || undefined;
    onOpenChange(false);
    deferAction({ ids: [id], kind: 'reject', workspaceId: scope.workspaceId, message: 'Rejected. The reason helps Auto-adjust learn.', commit: () => api.reject(scope, id, reason) });
    onDone();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Reject this draft?" description="It won't be sent. Your reason trains Auto-adjust."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger-solid" onClick={submit}>Reject</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Why?</legend>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button type="button" key={r} aria-pressed={chip === r} onClick={() => setChip(chip === r ? null : r)}
                className={cx('rounded-full border px-3 py-1.5 text-sm transition-colors max-md:py-2.5', chip === r ? 'border-transparent bg-fill text-on-accent' : 'border-control hover:bg-sunken')}>{r}</button>
            ))}
          </div>
        </fieldset>
        <label htmlFor={`rj-${id}`} className="mt-4 mb-1.5 block text-sm font-medium">Anything else (optional)</label>
        <Input id={`rj-${id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="Other…" />
      </form>
    </Sheet>
  );
}

// ── Phone: swipe right to approve, left to reject (buttons do the same) ───────────────────────
function SwipeCard(props: DecisionProps) {
  const { scope } = useWorkspace();
  const x = useMotionValue(0);
  const approveOpacity = useTransform(x, [30, 120], [0, 1]);
  const rejectOpacity = useTransform(x, [-120, -30], [1, 0]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const head = props.group[0];
  const canApprove = head.status === 'review' && head.gate.passed && !head.dispatched;
  const canAct = ['review', 'blocked'].includes(head.status) && !head.dispatched;
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 110 && canApprove) {
      navigator.vibrate?.(12);
      const rest = props.group.filter((d) => d.id !== head.id && d.status === 'review');
      approveLater(scope, head.id, rest.length ? `Approved step ${head.step + 1}. Now step ${rest[0].step + 1}.` : 'Approved. It sends in the next window.');
      if (rest.length) animate(x, 0); else props.onDecided('right');
    } else if (info.offset.x < -110 && canAct) { animate(x, 0); setRejectOpen(true); }
    else animate(x, 0, { type: 'spring', bounce: 0.3 });
  };
  return (
    <div className="relative">
      <motion.div aria-hidden style={{ opacity: approveOpacity }} className="pointer-events-none absolute inset-0 flex items-center rounded-xl bg-fill pl-6 font-semibold text-on-accent"><Check className="mr-2 size-5" />Approve</motion.div>
      <motion.div aria-hidden style={{ opacity: rejectOpacity }} className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-xl bg-danger pr-6 font-semibold text-surface">Reject<X className="ml-2 size-5" /></motion.div>
      <DecisionCard {...props} dragProps={canAct ? { drag: 'x', dragDirectionLock: true, dragConstraints: { left: 0, right: 0 }, dragElastic: 0.6, style: { x, touchAction: 'pan-y' }, onDragEnd } : undefined} />
      {canAct && <p className="mt-3 text-center text-xs text-muted">{canApprove ? 'Swipe right to approve, left to reject.' : 'Swipe left to reject.'}</p>}
      <RejectSheet open={rejectOpen} onOpenChange={setRejectOpen} id={head.id} onDone={() => props.onDecided('left')} />
    </div>
  );
}

