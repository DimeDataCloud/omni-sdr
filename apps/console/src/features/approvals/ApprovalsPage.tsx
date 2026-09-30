// Approvals (DESIGN 6.4). One decision at a time; blocked drafts have no Approve button at all;
// editing re-runs the claims gate; bulk approve covers only drafts the person has opened.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion, useMotionValue, useTransform, animate, type PanInfo } from 'motion/react';
import { toast } from 'sonner';
import { Check, X, Pencil, SkipForward, ShieldCheck, ShieldAlert, ExternalLink, Mail, BriefcaseBusiness, MessageSquare, CheckCheck, Bot, AlertTriangle, ArrowLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { ApprovalCard, DraftStatus } from '@/lib/api/types';
import { useHotkeys, useMedia, useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { EMAIL_STATUS, TIER, draftStatus, domainOf, factSummary, findingSentence, findingText, relTime, plural } from '@/lib/format';
import { Badge, Button, EmptyState, ErrorState, IconButton, Input, Page, PageHeader, Segmented, Sheet, SkeletonList, Skeleton, Textarea, cx } from '@/components/ui';

type Tab = 'review' | 'blocked' | 'approved' | 'all';
const opened = new Set<string>(); // drafts this person has actually looked at, this session (bulk approve rule)

export default function ApprovalsPage() {
  const { scope } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'review';
  const list = useQuery(() => api.approvals(scope, { status: tab as DraftStatus | 'all' }), [scope.workspaceId, tab]);
  const wide = useMedia('(min-width: 1100px)');
  const items = list.data?.items ?? [];
  const selId = params.get('d');
  // One row per person and campaign; the card's stepper moves between that person's drafts.
  const groups = useMemo(() => {
    const m = new Map<string, ApprovalCard[]>();
    for (const d of items) m.set(groupKey(d), [...(m.get(groupKey(d)) ?? []), d]);
    for (const g of m.values()) g.sort((a, b) => a.step - b.step);
    return m;
  }, [items]);
  const heads = useMemo(() => [...groups.values()].map((g) => g[0]), [groups]);
  const selGroup = [...groups.values()].find((g) => g.some((d) => d.id === selId)) ?? (wide && heads[0] ? groups.get(groupKey(heads[0])) : undefined);
  const selected = selGroup?.[0];
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exiting, setExiting] = useState<'left' | 'right' | null>(null);

  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const select = (id: string | null) => setParam('d', id);
  const idx = selected ? heads.findIndex((d) => d.id === selected.id) : -1;
  const move = (d: number) => { const n = heads[Math.min(heads.length - 1, Math.max(0, idx + d))]; if (n) select(n.id); };
  const moved = (t: Tab, id: string) => { const p = new URLSearchParams(); if (t !== 'review') p.set('tab', t); p.set('d', id); setParams(p, { replace: true }); };
  const afterDecision = (dir: 'left' | 'right') => {
    setExiting(dir);
    const nextItem = heads[idx + 1] ?? heads[idx - 1];
    select(nextItem && nextItem.id !== selected?.id ? nextItem.id : null);
  };

  const counts = list.data?.counts ?? {};
  const reviewable = [...checked].flatMap((k) => groups.get(k) ?? []).filter((d) => opened.has(d.id) && d.status === 'review').map((d) => d.id);
  const bulk = async () => {
    setBulkBusy(true);
    try {
      const r = await api.bulkApprove(scope, reviewable);
      toast.success(`Approved ${plural(r.approved, 'draft')}. They send in the next window.`);
      if (r.approved < reviewable.length) toast.error(`${reviewable.length - r.approved} changed before approval. Reload to see them.`);
      setChecked(new Set());
    } catch (e) { toast.error((e as Error).message); } finally { setBulkBusy(false); }
  };

  const header = (
    <PageHeader title="Approvals" subtitle="Every draft here passed the claims gate. Nothing goes out until you approve it."
      actions={reviewable.length > 0 && <Button variant="primary" loading={bulkBusy} icon={<CheckCheck className="size-4" aria-hidden />} onClick={bulk}>Approve {reviewable.length} reviewed</Button>}>
      <div className="w-full">
        <Segmented id="appr-tabs" label="Draft status" value={tab} onChange={(v) => { const p = new URLSearchParams(); if (v !== 'review') p.set('tab', v); setParams(p); setChecked(new Set()); }}
          options={[{ value: 'review', label: 'In review', count: counts.review ?? 0 }, { value: 'blocked', label: 'Blocked', count: counts.blocked ?? 0 },
            { value: 'approved', label: 'Approved', count: counts.approved ?? 0 }, { value: 'all', label: 'All' }]} />
      </div>
    </PageHeader>
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
              <ListRows items={heads} groups={groups} selectedId={null} onSelect={select} checked={checked} setChecked={setChecked} />
            )}
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
            <ListRows items={heads} groups={groups} selectedId={selected?.id ?? null} onSelect={select} checked={checked} setChecked={setChecked} />
          </div>
          <AnimatePresence mode="popLayout" custom={exiting} onExitComplete={() => setExiting(null)}>
            {selected && <DecisionCard key={groupKey(selected)} group={selGroup!} initialId={selId} exitDir={exiting} onDecided={afterDecision} onSkip={() => move(1)} onPrev={() => move(-1)} onMoved={moved} keyboard />}
          </AnimatePresence>
        </div>
      )}
    </Page>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────────────────────
function ChannelIcon({ c }: { c: ApprovalCard['channel'] }) {
  const I = c === 'email' ? Mail : c === 'sms' ? MessageSquare : BriefcaseBusiness;
  return <I className="size-3.5" aria-label={c === 'email' ? 'Email' : c === 'sms' ? 'SMS' : 'LinkedIn'} />;
}
const groupKey = (d: ApprovalCard) => `${d.recipient.contactId}:${d.campaign.id}`;
function ListRows({ items, groups, selectedId, onSelect, checked, setChecked }: { items: ApprovalCard[]; groups: Map<string, ApprovalCard[]>; selectedId: string | null; onSelect: (id: string) => void; checked: Set<string>; setChecked: (s: Set<string>) => void }) {
  const { tz } = useWorkspace();
  return (
    <ul className="space-y-1.5" aria-label="Drafts">
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
                <label className="flex w-10 shrink-0 cursor-pointer items-start justify-center pt-4" title={seen ? 'Select for bulk approve' : 'Open it first to include it in bulk approve'}>
                  <span className="sr-only">Select {d.recipient.name}</span>
                  <input type="checkbox" disabled={!seen} checked={checked.has(groupKey(d))} className="size-4 accent-[var(--accent-ink)] disabled:opacity-40"
                    onChange={(e) => { const s = new Set(checked); if (e.target.checked) s.add(groupKey(d)); else s.delete(groupKey(d)); setChecked(s); }} />
                </label>
              )}
              <button onClick={() => onSelect(d.id)} aria-current={on || undefined} className={cx('min-w-0 flex-1 py-3 pr-3 text-left', d.status !== 'review' && 'pl-3.5')}>
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
  const [busy, setBusy] = useState<'approve' | 'save' | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [subject, setSubject] = useState(item.subject ?? '');
  const [body, setBody] = useState(item.body);
  const shown = item.sequence.find((s) => s.step === step);
  const isCurrent = !shown || shown.id === item.id;
  const blocked = item.status === 'blocked';
  const actionable = !item.dispatched && ['review', 'blocked'].includes(item.status) && isCurrent;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { opened.add(item.id); setStep(item.step); setSubject(item.subject ?? ''); setBody(item.body); setEditing(false); setConflict(null); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickStep = (s: { id: string; step: number }) => { setStep(s.step); if (group.some((d) => d.id === s.id)) setActiveId(s.id); };

  const approve = async () => {
    if (!item.gate.passed || item.status !== 'review') return;
    setBusy('approve'); setConflict(null);
    try {
      await api.approve(scope, item.id);
      const rest = group.filter((d) => d.id !== item.id && d.status === 'review');
      if (rest.length) { toast.success(`Approved step ${item.step + 1}. Now step ${rest[0].step + 1}.`); setActiveId(rest[0].id); }
      else { toast.success('Approved. It sends in the next window.'); onDecided('right'); }
    }
    catch (e) { if (e instanceof ApiError && e.status === 409) setConflict('This draft changed. Reload to see the latest.'); else toast.error((e as Error).message); }
    finally { setBusy(null); }
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

  useHotkeys({
    j: onSkip, k: () => onPrev?.(), s: onSkip,
    a: () => { if (!editing && !blocked && actionable) approve(); },
    e: () => { if (actionable) { setEditing(true); setTimeout(() => bodyRef.current?.focus(), 30); } },
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
            <h2 className="text-lg">{item.recipient.name}</h2>
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
          {!blocked && <Button variant="primary" kbd="A" loading={busy === 'approve'} icon={<Check className="size-4" aria-hidden />} onClick={approve}>Approve</Button>}
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
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.reject(scope, id, [chip, note.trim()].filter(Boolean).join(': ') || undefined); onOpenChange(false); toast('Rejected. The reason helps Auto-adjust learn.'); onDone(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Reject this draft?" description="It won't be sent. Your reason trains Auto-adjust."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger-solid" loading={busy} onClick={submit}>Reject</Button></>}>
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
  const onDragEnd = async (_: unknown, info: PanInfo) => {
    if (info.offset.x > 110 && canApprove) {
      try {
        navigator.vibrate?.(12);
        await api.approve(scope, head.id);
        const rest = props.group.filter((d) => d.id !== head.id && d.status === 'review');
        if (rest.length) { animate(x, 0); toast.success(`Approved step ${head.step + 1}. Now step ${rest[0].step + 1}.`); }
        else { toast.success('Approved. It sends in the next window.'); props.onDecided('right'); }
      }
      catch (e) { toast.error((e as Error).message); animate(x, 0); }
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

