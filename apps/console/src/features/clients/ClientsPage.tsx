// Dev portal, step 1 (DESIGN-frontend-1-dev-portal): the client record, with Sales and Onboarding views.
// One record, one status field. Sales lists closed deals; Onboarding lists clients being set up, with the checklist.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Briefcase, ListChecks, Lock, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import type { ChecklistGroup, ChecklistItem, ChecklistState, ClientRecord, ClientStatus } from '@/lib/api/types';
import type { Scope } from '@/lib/api/client';
import { useQuery, prefetchQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { Badge, Banner, Button, EmptyState, ErrorState, NoAccess, Page, PageHeader, Segmented, Sheet, SkeletonList } from '@/components/ui';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUS: Record<ClientStatus, { label: string; tone: Tone }> = {
  closed: { label: 'Closed', tone: 'info' }, onboarding: { label: 'Onboarding', tone: 'warning' }, building: { label: 'Building', tone: 'warning' },
  ready: { label: 'Ready', tone: 'info' }, live: { label: 'Live', tone: 'success' }, paused: { label: 'Paused', tone: 'neutral' }, ended: { label: 'Ended', tone: 'neutral' },
};
const GROUPS: ChecklistGroup[] = ['Account', 'Connections', 'Compliance', 'Setup', 'Launch'];
const ITEM: Record<ChecklistState, { label: string; tone: Tone }> = {
  todo: { label: 'To do', tone: 'neutral' }, doing: { label: 'In progress', tone: 'info' }, blocked: { label: 'Blocked', tone: 'warning' }, done: { label: 'Done', tone: 'success' },
};
const NEXT: Record<Exclude<ChecklistState, 'blocked'>, { to: ChecklistState; label: string }> = {
  todo: { to: 'doing', label: 'Start' }, doing: { to: 'done', label: 'Mark done' }, done: { to: 'todo', label: 'Reopen' },
};

const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const progress = (c: ClientRecord) => ({ done: c.checklist.filter((i) => i.state === 'done').length, total: c.checklist.length });
const nextBlocked = (c: ClientRecord) => c.checklist.find((i) => i.state === 'blocked');

/** Warmed on hover of the Clients nav link. */
export const prefetch = (s: Scope) => prefetchQuery(`clients:${s.orgId}`, () => api.clients(s.orgId));

export default function ClientsPage() {
  const { scope, role } = useWorkspace();
  const operator = role === 'admin' || role === 'operator';
  const [view, setView] = useState<'sales' | 'onboarding'>('sales');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery(() => api.clients(scope.orgId), [scope.orgId], { key: `clients:${scope.orgId}`, enabled: operator });
  const rows = useMemo(() => (q.data ?? []).filter((c) => (view === 'sales' ? c.status === 'closed' : c.status === 'onboarding')), [q.data, view]);
  const open = (q.data ?? []).find((c) => c.id === openId) ?? null;
  const counts = useMemo(() => ({ sales: (q.data ?? []).filter((c) => c.status === 'closed').length, onboarding: (q.data ?? []).filter((c) => c.status === 'onboarding').length }), [q.data]);

  if (!operator) return <Page><NoAccess what="the dev portal" /></Page>;
  const anyDraft = (q.data ?? []).some((c) => c.deal.priceDraft);

  return (
    <Page>
      <PageHeader title="Clients" subtitle="Every client is one record with one status. Sales and Onboarding are two views of it.">
        <div className="w-full">
          <Segmented id="cl" label="Section" value={view} onChange={setView}
            options={[{ value: 'sales', label: 'Sales', count: counts.sales }, { value: 'onboarding', label: 'Onboarding', count: counts.onboarding }]} />
        </div>
      </PageHeader>
      <Banner tone="info" title="Demo data">These clients are fictional and live in this browser only.</Banner>
      {anyDraft && <Banner tone="warning" title="Prices are not final">Every price here is a draft until Christian sets the final flag.</Banner>}
      <ErrorState error={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <SkeletonList rows={3} /> : !rows.length ? (
        view === 'sales'
          ? <EmptyState icon={<Briefcase className="size-5" aria-hidden />} title="No closed deals waiting" body="When a rep closes a sale it appears here with a Start onboarding action." />
          : <EmptyState icon={<ListChecks className="size-5" aria-hidden />} title="Nobody is in onboarding" body="Start onboarding from a closed deal in Sales." />
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => {
            const p = progress(c); const blocked = nextBlocked(c);
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setOpenId(c.id)} className="card flex w-full flex-wrap items-center gap-4 p-4 text-left hover:bg-sunken">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-sm text-muted">{c.niche} · {c.deal.level} · {money(c.deal.price)}{c.deal.priceDraft ? ' (draft)' : ''} · sold by {c.deal.rep}</p>
                    {view === 'onboarding' && blocked && <p className="mt-1 flex items-center gap-1 text-sm text-muted"><TriangleAlert className="size-4" aria-hidden />{blocked.label}: {blocked.blockedBy}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {view === 'onboarding' && <span className="tabular text-sm text-muted">{p.done} of {p.total} done</span>}
                    <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && <ClientSheet client={open} scope={scope} onClose={() => setOpenId(null)} />}
    </Page>
  );
}

function ClientSheet({ client: c, scope, onClose }: { client: ClientRecord; scope: Scope; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const p = progress(c);
  const footer = c.status === 'closed'
    ? <Button variant="primary" loading={busy === 'start'} onClick={() => run('start', () => api.startOnboarding(scope.orgId, c.id), `Onboarding started for ${c.name}`)}>Start onboarding</Button>
    : undefined;
  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }} title={c.name} description={`${c.niche} · ${STATUS[c.status].label}`} footer={footer} wide>
      <section aria-label="Deal" className="space-y-1 text-sm">
        <h3 className="section-title">Deal</h3>
        <p>{c.deal.level} at {money(c.deal.price)} {c.deal.priceDraft && <Badge tone="warning">Draft price</Badge>}</p>
        <p className="text-muted">Sold by {c.deal.rep} on {new Date(c.deal.closedAt).toLocaleDateString('en-US')}</p>
        <p className="text-muted">Contact: {c.contactName}, {c.contactEmail}</p>
        {c.deal.notes && <p>{c.deal.notes}</p>}
      </section>
      {c.status === 'closed' && <p className="mt-4 text-sm text-muted"><Lock className="mr-1 inline size-4" aria-hidden />The checklist is created when you start onboarding.</p>}
      {c.checklist.length > 0 && (
        <section aria-label="Checklist" className="mt-6 space-y-4">
          <h3 className="section-title">Checklist, {p.done} of {p.total} done</h3>
          {GROUPS.map((g) => {
            const items = c.checklist.filter((i) => i.group === g);
            return items.length ? (
              <div key={g}>
                <h4 className="mb-1 text-sm font-medium">{g}</h4>
                <ul className="space-y-1">
                  {items.map((i) => <ChecklistRow key={i.id} item={i} editable={c.status === 'onboarding'} busy={busy === i.id}
                    onNext={(to) => run(i.id, () => api.setChecklistItem(scope.orgId, c.id, i.id, to), `${i.label}: ${ITEM[to].label.toLowerCase()}`)} />)}
                </ul>
              </div>
            ) : null;
          })}
        </section>
      )}
      <section aria-label="History" className="mt-6">
        <h3 className="section-title mb-1">History</h3>
        <ul className="space-y-1 text-sm">
          {[...c.audit].reverse().map((a) => <li key={a.id}><span className="text-muted">{new Date(a.at).toLocaleDateString('en-US')}</span> {a.actor}: {a.detail}</li>)}
        </ul>
      </section>
    </Sheet>
  );
}

function ChecklistRow({ item: i, editable, busy, onNext }: { item: ChecklistItem; editable: boolean; busy: boolean; onNext: (to: ChecklistState) => void }) {
  const next = i.state === 'blocked' ? null : NEXT[i.state];
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-control p-2 text-sm">
      <span className="min-w-0 flex-1">{i.label}{i.blockedBy && <span className="block text-muted">Waiting on: {i.blockedBy}</span>}</span>
      <Badge tone={ITEM[i.state].tone}>{ITEM[i.state].label}</Badge>
      {editable && next && <Button size="sm" loading={busy} onClick={() => onNext(next.to)}>{next.label}</Button>}
    </li>
  );
}
