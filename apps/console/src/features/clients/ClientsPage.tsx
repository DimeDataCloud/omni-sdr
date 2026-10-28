// Dev portal (DESIGN-frontend-1-dev-portal), on Backend's 6a shapes: one client record, one status field, three views of it.
// Sales lists closed deals; Onboarding lists clients being set up; Changes lists clients with setup versions to review.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Briefcase, GitPullRequest, ListChecks, Lock, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import type { ClientRecord, ClientStatus, ClientSummary } from '@/lib/api/types';
import type { Scope } from '@/lib/api/client';
import { useQuery, prefetchQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { SETUP_TABS, SetupPanel, type SetupTab } from './SetupTabs';
import { ChecklistTab, HistoryTab } from './RecordTabs';
import { STATUS, errText, money, usePeople } from './clientBits';
import { Badge, Banner, Button, EmptyState, ErrorState, NoAccess, Page, PageHeader, Segmented, Sheet, SkeletonList } from '@/components/ui';

type View = 'sales' | 'onboarding' | 'changes';
type RecordTab = 'checklist' | 'history' | SetupTab;
const IN_SETUP: ClientStatus[] = ['onboarding', 'building', 'ready'];

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
  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => all.filter((c) => (view === 'sales' ? c.status === 'closed' : view === 'onboarding' ? IN_SETUP.includes(c.status) : c.appliedVersion !== null || c.pendingVersions > 0))
    .sort((a, b) => (view === 'changes' ? b.pendingVersions - a.pendingVersions : 0)), [all, view]);
  const counts = { changes: all.reduce((n, c) => n + c.pendingVersions, 0), sales: all.filter((c) => c.status === 'closed').length, onboarding: all.filter((c) => IN_SETUP.includes(c.status)).length };

  if (!operator) return <Page><NoAccess what="the dev portal" /></Page>;

  return (
    <Page>
      <PageHeader title="Clients" subtitle="Every client is one record with one status. Sales, Onboarding and Changes are three views of it.">
        <div className="w-full">
          <Segmented id="cl" label="Section" value={view} onChange={setView}
            options={reviewer ? [{ value: 'changes' as const, label: 'Changes', count: counts.changes }]
              : [{ value: 'sales' as const, label: 'Sales', count: counts.sales }, { value: 'onboarding' as const, label: 'Onboarding', count: counts.onboarding }, { value: 'changes' as const, label: 'Changes', count: counts.changes }]} />
        </div>
      </PageHeader>
      <Banner tone="info" title="Demo data">These clients are fictional and live in this browser only.</Banner>
      {!reviewer && all.some((c) => c.deal.priceIsDraft) && <Banner tone="warning" title="Prices are not final">Every price here is a draft until Christian sets the final flag.</Banner>}
      {reviewer && <Banner tone="info" title="Review view">You see only clients with a version waiting for you, and no prices or contact details. In real data the server withholds them.</Banner>}
      <ErrorState error={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <SkeletonList rows={3} /> : !rows.length ? (
        view === 'changes'
          ? <EmptyState icon={<GitPullRequest className="size-5" aria-hidden />} title={reviewer ? 'Nothing waiting for you' : 'No setup versions yet'} body={reviewer ? 'A version sent for review appears here.' : "Save a draft on a client's Setup tabs, then send it for review."} />
          : view === 'sales'
          ? <EmptyState icon={<Briefcase className="size-5" aria-hidden />} title="No closed deals waiting" body="When a rep closes a sale it appears here with a Start onboarding action." />
          : <EmptyState icon={<ListChecks className="size-5" aria-hidden />} title="Nobody is in onboarding" body="Start onboarding from a closed deal in Sales." />
      ) : (
        <ul className="space-y-2">{rows.map((c) => <Row key={c.id} c={c} view={view} reviewer={reviewer} sold={people(c.deal.repId)} onOpen={() => setOpenId(c.id)} />)}</ul>
      )}
      {openId && <ClientSheet id={openId} scope={scope} reviewer={reviewer} startTab={view === 'changes' ? 'versions' : 'checklist'} onClose={() => setOpenId(null)} />}
    </Page>
  );
}

function Row({ c, view, reviewer, sold, onOpen }: { c: ClientSummary; view: View; reviewer: boolean; sold: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="card flex w-full flex-wrap items-center gap-4 p-4 text-left hover:bg-sunken">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{c.name}</p>
          <p className="truncate text-sm text-muted">{c.deal.level}{!reviewer && ` · ${money(c.deal.priceCents)}${c.deal.priceIsDraft ? ' (draft)' : ''} · sold by ${sold}`}</p>
          {view === 'onboarding' && c.checklist.nextBlocked && <p className="mt-1 flex items-center gap-1 text-sm text-muted"><TriangleAlert className="size-4" aria-hidden />Blocked: {c.checklist.nextBlocked}</p>}
        </div>
        <div className="flex items-center gap-2">
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
  const footer = !c || reviewer ? undefined
    : c.status === 'closed' ? <Button variant="primary" loading={busy === 'onboarding'} onClick={() => void move('onboarding', 'Start onboarding', `Onboarding started for ${c.name}`)}>Start onboarding</Button>
    : c.status === 'onboarding' ? <Button variant="primary" loading={busy === 'building'} onClick={() => void move('building', 'Checklist underway, start building the setup', `${c.name} is now in building`)}>Start building</Button>
    : undefined;
  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }} title={c?.name ?? 'Client'} description={c ? `${c.profile.niche} · ${STATUS[c.status].label}` : undefined} footer={footer} wide>
      <ErrorState error={q.error} onRetry={q.reload} />
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
