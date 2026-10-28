// Dev portal (DESIGN-frontend-1-dev-portal), on Backend's 6a shapes: one client record, one status field, three views of it.
// Sales lists closed deals; Onboarding lists clients being set up; Changes lists clients with setup versions to review.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Activity, Briefcase, GitPullRequest, ListChecks, Lock, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import type { ClientHealth, ClientRecord, ClientStatus, ClientSummary } from '@/lib/api/types';
import type { Scope } from '@/lib/api/client';
import { useQuery, prefetchQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { SETUP_TABS, SetupPanel, type SetupTab } from './SetupTabs';
import { ChecklistTab, HistoryTab } from './RecordTabs';
import { STATUS, errText, money, unhealthyReasons, usePeople } from './clientBits';
import { Badge, Banner, Button, EmptyState, Field, Input, ErrorState, NoAccess, Page, PageHeader, Segmented, Sheet, SkeletonList } from '@/components/ui';

type View = 'sales' | 'onboarding' | 'changes' | 'live';
type RecordTab = 'checklist' | 'history' | SetupTab;
const IN_SETUP: ClientStatus[] = ['onboarding', 'building', 'ready'];
const RUNNING: ClientStatus[] = ['live', 'paused'];

/** Warmed on hover of the Clients nav link. */
export const prefetch = (s: Scope) => prefetchQuery(`clients:${s.orgId}`, () => api.clients(s.orgId));

export default function ClientsPage() {
  const { scope, role } = useWorkspace();
  const operator = role === 'admin' || role === 'operator' || role === 'reviewer';
  const reviewer = role === 'reviewer';
  const [view, setView] = useState<View>(reviewer ? 'changes' : 'sales');
  const [openId, setOpenId] = useState<string | null>(null);
  const people = usePeople(scope.orgId);
  const q = useQuery(() => api.clients(scope.orgId), [scope.orgId], { key: `clients:${scope.orgId}`, enabled: operator });
  const health = useQuery(() => api.clientHealth(scope.orgId), [scope.orgId], { key: `client-health:${scope.orgId}`, enabled: operator && !reviewer });
  const healthOf = useMemo(() => new Map((health.data ?? []).map((h) => [h.clientId, h])), [health.data]);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => all.filter((c) => (view === 'sales' ? c.status === 'closed' : view === 'onboarding' ? IN_SETUP.includes(c.status) : view === 'live' ? RUNNING.includes(c.status) : c.appliedVersion !== null || c.pendingVersions > 0))
    .sort((a, b) => (view === 'changes' ? b.pendingVersions - a.pendingVersions : view === 'live' ? unhealthyReasons(healthOf.get(b.id)).length - unhealthyReasons(healthOf.get(a.id)).length : 0)), [all, view, healthOf]);
  const counts = { live: all.filter((c) => RUNNING.includes(c.status)).length, changes: all.reduce((n, c) => n + c.pendingVersions, 0), sales: all.filter((c) => c.status === 'closed').length, onboarding: all.filter((c) => IN_SETUP.includes(c.status)).length };

  if (!operator) return <Page><NoAccess what="the dev portal" /></Page>;

  return (
    <Page>
      <PageHeader title="Clients" subtitle="Every client is one record with one status. Sales, Onboarding, Changes and Management are four views of it.">
        <div className="w-full">
          <Segmented id="cl" label="Section" value={view} onChange={setView}
            options={reviewer ? [{ value: 'changes' as const, label: 'Changes', count: counts.changes }]
              : [{ value: 'sales' as const, label: 'Sales', count: counts.sales }, { value: 'onboarding' as const, label: 'Onboarding', count: counts.onboarding }, { value: 'changes' as const, label: 'Changes', count: counts.changes }, { value: 'live' as const, label: 'Management', count: counts.live }]} />
        </div>
      </PageHeader>
      <Banner tone="info" title="Demo data">These clients are fictional and live in this browser only.</Banner>
      {!reviewer && all.some((c) => c.deal.priceIsDraft) && <Banner tone="warning" title="Prices are not final">Every price here is a draft until Christian sets the final flag.</Banner>}
      {view === 'live' && <Banner tone="info" title="Demo numbers">Health comes from the Management rollup (6d), which is not built yet. These figures are made up so the table can be built now. Billing is not connected.</Banner>}
      {reviewer && <Banner tone="info" title="Review view">You see only clients with a version waiting for you, and no prices or contact details. In real data the server withholds them.</Banner>}
      <ErrorState error={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <SkeletonList rows={3} /> : !rows.length ? (
        view === 'changes'
          ? <EmptyState icon={<GitPullRequest className="size-5" aria-hidden />} title={reviewer ? 'Nothing waiting for you' : 'No setup versions yet'} body={reviewer ? 'A version sent for review appears here.' : "Save a draft on a client's Setup tabs, then send it for review."} />
          : view === 'live'
          ? <EmptyState icon={<Activity className="size-5" aria-hidden />} title="No live clients" body="A client appears here after Go live." />
          : view === 'sales'
          ? <EmptyState icon={<Briefcase className="size-5" aria-hidden />} title="No closed deals waiting" body="When a rep closes a sale it appears here with a Start onboarding action." />
          : <EmptyState icon={<ListChecks className="size-5" aria-hidden />} title="Nobody is in onboarding" body="Start onboarding from a closed deal in Sales." />
      ) : (
        <ul className="space-y-2">{rows.map((c) => <Row key={c.id} c={c} view={view} reviewer={reviewer} sold={people(c.deal.repId)} health={healthOf.get(c.id)} onOpen={() => setOpenId(c.id)} />)}</ul>
      )}
      {openId && <ClientSheet id={openId} scope={scope} reviewer={reviewer} startTab={view === 'changes' ? 'versions' : view === 'live' ? 'history' : 'checklist'} onClose={() => setOpenId(null)} />}
    </Page>
  );
}

function Row({ c, view, reviewer, sold, health, onOpen }: { c: ClientSummary; view: View; reviewer: boolean; sold: string; health: ClientHealth | undefined; onOpen: () => void }) {
  const reasons = view === 'live' ? unhealthyReasons(health) : [];
  return (
    <li>
      <button type="button" onClick={onOpen} className="card flex w-full flex-wrap items-center gap-4 p-4 text-left hover:bg-sunken">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{c.name}</p>
          <p className="truncate text-sm text-muted">{c.deal.level}{!reviewer && ` · ${money(c.deal.priceCents)}${c.deal.priceIsDraft ? ' (draft)' : ''} · sold by ${sold}`}</p>
          {view === 'live' && (reasons.length
            ? <p className="mt-1 flex items-center gap-1 text-sm"><TriangleAlert className="size-4" aria-hidden />{reasons.join('. ')}</p>
            : <p className="mt-1 text-sm text-muted">Healthy{health ? ` · ${health.openDrafts} open drafts · ${health.openHandoffs} open handoffs` : ''}</p>)}
          {view === 'onboarding' && c.checklist.nextBlocked && <p className="mt-1 flex items-center gap-1 text-sm text-muted"><TriangleAlert className="size-4" aria-hidden />Blocked: {c.checklist.nextBlocked}</p>}
        </div>
        <div className="flex items-center gap-2">
          {view === 'live' && <span className="text-sm text-muted">{c.appliedVersion ? `v${c.appliedVersion}` : 'No version'}{c.pendingVersions ? ` · ${c.pendingVersions} pending` : ''} · Billing not connected yet</span>}
          {view === 'onboarding' && <span className="tabular text-sm text-muted">{c.checklist.done} of {c.checklist.required} done</span>}
          {view === 'changes' && <span className="text-sm text-muted">{c.pendingVersions ? `${c.pendingVersions} waiting` : c.appliedVersion ? `Live on v${c.appliedVersion}` : 'No live version'}</span>}
          <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
        </div>
      </button>
    </li>
  );
}

function ClientSheet({ id, scope, reviewer, startTab, onClose }: { id: string; scope: Scope; reviewer: boolean; startTab: RecordTab; onClose: () => void }) {
  const q = useQuery(() => api.client(scope.orgId, id), [scope.orgId, id], { key: `client:${id}` });
  const c = q.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<RecordTab>(startTab);
  const people = usePeople(scope.orgId);
  const move = async (to: ClientStatus, reason: string, ok: string) => {
    setBusy(to);
    try { await api.transitionClient(scope.orgId, id, to, reason); toast.success(ok); } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  };
  const [unmet, setUnmet] = useState<string[]>([]);
  const [why, setWhy] = useState('');
  const go = async (to: ClientStatus, reason: string, ok: string) => {
    setBusy(to); setUnmet([]);
    try { await api.transitionClient(scope.orgId, id, to, reason); toast.success(ok); setWhy(''); } catch (e) {
      const u = (e as { details?: { unmet?: unknown } }).details?.unmet;
      if (Array.isArray(u)) setUnmet(u.map(String)); else toast.error(errText(e));
    } finally { setBusy(null); }
  };
  const footer = !c || reviewer ? undefined
    : c.status === 'closed' ? <Button variant="primary" loading={busy === 'onboarding'} onClick={() => void move('onboarding', 'Start onboarding', `Onboarding started for ${c.name}`)}>Start onboarding</Button>
    : c.status === 'onboarding' ? <Button variant="primary" loading={busy === 'building'} onClick={() => void move('building', 'Checklist underway, start building the setup', `${c.name} is now in building`)}>Start building</Button>
    : c.status === 'ready' ? <Button variant="primary" loading={busy === 'live'} onClick={() => void go('live', 'Go live', `${c.name} is live`)}>Go live</Button>
    : c.status === 'live' ? (
      <form className="flex w-full flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void go('paused', why, `${c.name} is paused`); }}>
        <Field label="Why pause" className="min-w-0 flex-1">{(p) => <Input {...p} value={why} maxLength={200} onChange={(e) => setWhy(e.target.value)} />}</Field>
        <Button type="submit" loading={busy === 'paused'} disabled={!why.trim()}>Pause</Button>
      </form>)
    : c.status === 'paused' ? <Button variant="primary" loading={busy === 'live'} onClick={() => void go('live', 'Resume', `${c.name} is live again`)}>Resume</Button>
    : undefined;
  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }} title={c?.name ?? 'Client'} description={c ? `${c.profile.niche} · ${STATUS[c.status].label}` : undefined} footer={footer} wide>
      <ErrorState error={q.error} onRetry={q.reload} />
      {unmet.length > 0 && <Banner tone="warning" title="Not ready to go live"><ul className="list-disc pl-5">{unmet.map((u) => <li key={u}>{u}</li>)}</ul></Banner>}
      {c?.status === 'building' && <Banner tone="info" title="Next: an approved setup version">When a second person approves the first version, this client moves to ready and Go live appears.</Banner>}
      {!c ? <SkeletonList rows={3} /> : <Record c={c} scope={scope} reviewer={reviewer} tab={tab} setTab={setTab} sold={people(c.deal.repId)} />}
    </Sheet>
  );
}

function Record({ c, scope, reviewer, tab, setTab, sold }: { c: ClientRecord; scope: Scope; reviewer: boolean; tab: RecordTab; setTab: (t: RecordTab) => void; sold: string }) {
  const started = c.status !== 'lead' && c.status !== 'closed';
  return (
    <>
      {!reviewer && (
        <section aria-label="Deal" className="space-y-1 text-sm">
          <h3 className="section-title">Deal</h3>
          <p>{c.deal.level} at {money(c.deal.priceCents)} {c.deal.priceIsDraft && <Badge tone="warning">Draft price</Badge>}</p>
          <p className="text-muted">Sold by {sold} on {new Date(c.deal.closedAt).toLocaleDateString('en-US')}</p>
          <p className="text-muted">Contact: {c.profile.contactName}, {c.profile.contactEmail}</p>
          {c.profile.notes && <p>{c.profile.notes}</p>}
        </section>
      )}
      {c.status === 'closed' && <p className="mt-4 text-sm text-muted"><Lock className="mr-1 inline size-4" aria-hidden />The checklist is created when you start onboarding.</p>}
      {started && (
        <div className="mt-6">
          <Segmented id="cl-tab" label="Record section" value={tab} onChange={setTab}
            options={reviewer ? SETUP_TABS.filter((t) => t.value === 'versions') : [{ value: 'checklist' as const, label: 'Checklist' }, ...SETUP_TABS, { value: 'history' as const, label: 'History' }]} />
        </div>
      )}
      {!reviewer && !started && <div className="mt-6"><HistoryTab client={c} scope={scope} /></div>}
      {started && tab === 'checklist' && !reviewer && <div className="mt-4"><ChecklistTab client={c} scope={scope} /></div>}
      {started && tab === 'history' && !reviewer && <div className="mt-4"><HistoryTab client={c} scope={scope} /></div>}
      {started && tab !== 'checklist' && tab !== 'history' && <div className="mt-4"><SetupPanel client={c} scope={scope} tab={tab} /></div>}
    </>
  );
}
