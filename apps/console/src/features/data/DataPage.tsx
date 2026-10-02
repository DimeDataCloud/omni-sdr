// Setup → Data (WORKSPACE-PLAN.md): every dataset the agents can read, how big and fresh it is, the rules it carries,
// and which agents read it. Access is set here per dataset, or for everything at once in the access matrix.
// The rows themselves are corrected where they live (Leads, Approvals, Inbox…); "Open" goes there.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowUpRight, Database, Lock, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import type { Agent, Dataset } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { relTime } from '@/lib/format';
import { Badge, Button, EmptyState, ErrorState, Page, PageHeader, Segmented, Sheet, SkeletonList, Switch, cx } from '@/components/ui';

type View = 'datasets' | 'matrix';

/** Does this agent read this dataset? Matches the dataset's tag and its older aliases, the way the API does. */
export const readsSet = (d: Dataset, a: Agent) => d.always || d.readers.some((r) => r.agentId === a.id);
const ALIASES: Record<string, string[]> = { Evidence: ['Web'], Meetings: ['Calendar'] };
/** The agent's context sources with this dataset switched on or off. */
export function withAccess(a: Agent, d: Dataset, on: boolean) {
  const tags = [d.source, ...(ALIASES[d.source] ?? [])].map((t) => t.toLowerCase());
  const rest = a.contextSources.filter((t) => !tags.includes(t.toLowerCase()));
  return on ? [...rest, d.source] : rest;
}

export default function DataPage() {
  const { scope, can, tz } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'matrix' ? 'matrix' : 'datasets';
  const sets = useQuery(() => api.datasets(scope), [scope.workspaceId]);
  const agents = useQuery(() => api.agents(scope), [scope.workspaceId]);
  const open = sets.data?.find((d) => d.key === params.get('d')) ?? null;
  const setOpen = (k: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (k) n.set('d', k); else n.delete('d'); return n; });
  const build = can('build');
  const toggle = async (a: Agent, d: Dataset, on: boolean) => {
    try { await api.patchAgent(scope, a.id, { contextSources: withAccess(a, d, on) }); toast(`${a.name} ${on ? 'now reads' : 'no longer reads'} ${d.name}.`); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Page>
      <PageHeader title="Data" subtitle="What your agents can read. Each dataset shows its rules and who reads it; access is yours to set.">
        <div className="w-full"><Segmented id="data-view" label="Data view" value={view} onChange={(v) => setParams(v === 'datasets' ? {} : { view: v })}
          options={[{ value: 'datasets', label: 'Datasets' }, { value: 'matrix', label: 'Access by agent' }]} /></div>
      </PageHeader>
      {sets.error ? <ErrorState error={sets.error} onRetry={sets.reload} /> : !sets.data || !agents.data ? <SkeletonList rows={5} /> : !sets.data.length ? <EmptyState icon={<Database className="size-5" aria-hidden />} title="No datasets yet" /> : view === 'datasets' ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sets.data.map((d) => (
            <li key={d.key}>
              <button type="button" onClick={() => setOpen(d.key)} className="card lift flex h-full w-full flex-col gap-2 p-4 text-left">
                <div className="flex items-start gap-2">
                  <p className="flex-1 font-semibold">{d.name}</p>
                  {d.always && <Badge tone="info" icon={<Lock className="size-3" aria-hidden />}>Always on</Badge>}
                </div>
                <p className="tabular text-sm"><span className="font-medium">{d.count.toLocaleString('en-US')}</span> <span className="text-muted">{d.count === 1 ? 'item' : 'items'}{d.updatedAt ? ` · updated ${relTime(d.updatedAt, tz)}` : ''}</span></p>
                <p className="text-sm text-muted">{d.about}</p>
                <p className="mt-auto pt-1 text-xs text-muted">{d.always ? 'Every agent and every send' : d.readers.length ? `Read by ${d.readers.map((r) => r.name).join(', ')}` : 'No agent reads this yet'}</p>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Matrix sets={sets.data} agents={agents.data} build={build} onToggle={toggle} onOpen={setOpen} />
      )}
      <DatasetSheet d={open} agents={agents.data ?? []} build={build} onClose={() => setOpen(null)} onToggle={toggle} />
    </Page>
  );
}

function Matrix({ sets, agents, build, onToggle, onOpen }: { sets: Dataset[]; agents: Agent[]; build: boolean; onToggle: (a: Agent, d: Dataset, on: boolean) => void; onOpen: (k: string) => void }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[880px] text-sm">
        <caption className="sr-only">Which agent reads which dataset</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">Agent</th>
            {sets.map((d) => (
              <th key={d.key} scope="col" className="px-1.5 py-2 text-center align-bottom font-medium">
                <button type="button" onClick={() => onOpen(d.key)} className="rounded px-1 text-xs leading-tight hover:underline">{d.name}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {agents.map((a) => (
            <tr key={a.id}>
              <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-medium whitespace-nowrap">{a.name}</th>
              {sets.map((d) => {
                const on = readsSet(d, a);
                return (
                  <td key={d.key} className="px-1.5 py-1 text-center">
                    {d.always ? <Lock className="mx-auto size-3.5 text-muted" aria-label={`${a.name} always honors ${d.name}`} /> : (
                      <input type="checkbox" checked={on} disabled={!build} onChange={(e) => onToggle(a, d, e.target.checked)} aria-label={`${a.name} reads ${d.name}`}
                        className="size-5 accent-[var(--accent-ink)] max-md:size-6" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DatasetSheet({ d, agents, build, onClose, onToggle }: { d: Dataset | null; agents: Agent[]; build: boolean; onClose: () => void; onToggle: (a: Agent, d: Dataset, on: boolean) => void }) {
  const { tz, scope } = useWorkspace();
  const [shown, setShown] = useState<Dataset | null>(d);
  if (d && d !== shown) setShown(d);
  const x = d ?? shown;
  return (
    <Sheet open={Boolean(d)} onOpenChange={(v) => !v && onClose()} title={x?.name ?? 'Dataset'} description={x?.about} wide
      footer={x && <>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Link to={`/w/${scope.workspaceId}/${x.manage}`} className="press inline-flex h-9 items-center gap-2 rounded-md border border-transparent bg-fill px-3.5 font-medium text-on-accent shadow-sm hover:bg-fill-hover max-md:min-h-11">
          <ArrowUpRight className="size-4" aria-hidden />Open {x.name.toLowerCase()}</Link></>}>
      {x && (
        <div className="space-y-5">
          <p className="tabular text-sm"><span className="font-medium">{x.count.toLocaleString('en-US')}</span> <span className="text-muted">{x.count === 1 ? 'item' : 'items'}{x.updatedAt ? ` · updated ${relTime(x.updatedAt, tz)}` : ''}</span></p>
          <section aria-labelledby="ds-rules">
            <h3 id="ds-rules" className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck className="size-4" aria-hidden />Rules it carries</h3>
            <ul className="space-y-1.5 text-sm">{x.rules.map((r) => <li key={r} className="flex gap-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />{r}</li>)}</ul>
          </section>
          <section aria-labelledby="ds-readers">
            <h3 id="ds-readers" className="mb-2 text-sm font-semibold">Agents that read it</h3>
            {x.always ? <p className="text-sm text-muted">Every agent and every send honors this list. It can't be switched off.</p> : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {agents.map((a) => (
                  <li key={a.id} className={cx('px-3 py-2')}>
                    <Switch checked={readsSet(x, a)} disabled={!build} onChange={(v) => onToggle(a, x, v)} label={a.name}
                      description={readsSet(x, a) ? `Reads ${x.name.toLowerCase()}` : `Doesn't read ${x.name.toLowerCase()}`} />
                  </li>
                ))}
              </ul>
            )}
            {!build && <p className="mt-2 text-xs text-muted">Your role can see access but not change it.</p>}
          </section>
        </div>
      )}
    </Sheet>
  );
}

