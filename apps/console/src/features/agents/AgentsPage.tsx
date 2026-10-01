// Agents: agents, routines and the Auto-adjust log. Moved out of Studio on 2026-10-01, when Studio became the image and
// video suite (DECISIONS 2026-10-01; STUDIO-PLAN.md §2, default A pending Christian). Auto-adjust never changes guardrails.
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Plus, Bot, Repeat, Sparkles, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import type { Agent, Routine } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { useCommands } from '@/lib/commands';
import { usePending } from '@/lib/undo';
import { TIER, plural, relTime } from '@/lib/format';
import { AgentSheet, AUTONOMY } from './Harness';
import { Avatar, Badge, Button, EmptyState, Field, Input, Page, PageHeader, Segmented, Select, Sheet, SkeletonList, Switch, listItem, listStagger } from '@/components/ui';

type Tab = 'agents' | 'routines' | 'learning';

export default function AgentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'agents';
  return (
    <Page>
      <PageHeader title="Agents" subtitle="Shape your agents and what they do on a schedule. Everything they draft still needs approval.">
        <div className="w-full"><Segmented id="agents" label="Agents section" value={tab} onChange={(v) => setParams(v === 'agents' ? {} : { tab: v })}
          options={[{ value: 'agents', label: 'Agents' }, { value: 'routines', label: 'Routines' }, { value: 'learning', label: 'Auto-adjust' }]} /></div>
      </PageHeader>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {tab === 'agents' ? <Agents autoNew={params.get('new') === 'agent'} /> : tab === 'routines' ? <Routines /> : <Learning />}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}

function Agents({ autoNew }: { autoNew: boolean }) {
  const { scope, tz, can } = useWorkspace();
  const agents = useQuery(() => api.agents(scope), [scope.workspaceId]);
  const pending = usePending();
  const [edit, setEdit] = useState<Agent | 'new' | null>(autoNew ? 'new' : null);
  useCommands(can('build') ? [{ id: 'new', label: 'New agent', icon: Plus, run: () => setEdit('new') }] : []);
  return (
    <>
      {can('build') && <div className="mb-4 flex justify-end"><Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEdit('new')}>New agent</Button></div>}
      {agents.loading ? <SkeletonList rows={4} /> : !agents.data?.length ? <EmptyState icon={<Bot className="size-5" aria-hidden />} title="No agents yet" /> : (
        <motion.ul variants={listStagger} initial="hidden" animate="show" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.data.filter((a) => !pending.isHidden(a.id)).map((a) => (
            <motion.li key={a.id} variants={listItem}>
              <button onClick={() => setEdit(a)} className="card lift flex h-full w-full flex-col p-4 text-left">
                <div className="flex items-center gap-3">
                  <Avatar kind="agent" text={a.badge} size={40} />
                  <div className="min-w-0 flex-1"><p className="truncate font-semibold">{a.name}</p><p className="text-xs text-muted">{TIER[a.modelTier].label} · {plural(a.activeRoutines, 'routine')}</p></div>
                  <Badge tone={a.autonomy === 'draft' ? 'neutral' : 'info'}>{AUTONOMY.find((x) => x.value === a.autonomy)?.label}</Badge>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-muted">{a.systemPrompt || 'No role prompt yet.'}</p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-3">{a.contextSources.map((s) => <Badge key={s}>{s}</Badge>)}</div>
                <p className="mt-3 text-xs text-muted">{a.autonomousMode ? 'Runs its routines on schedule · ' : ''}Created {relTime(a.createdAt, tz)}</p>
              </button>
            </motion.li>
          ))}
        </motion.ul>
      )}
      <AgentSheet agent={edit} onClose={() => setEdit(null)} readOnly={!can('build')} />
    </>
  );
}

const CATEGORY: Record<Routine['category'], string> = { briefing: 'Briefing', triage: 'Triage', outbound: 'Outbound', sync: 'Sync' };
function Routines() {
  const { scope, tz, can } = useWorkspace();
  const routines = useQuery(() => api.routines(scope), [scope.workspaceId]);
  const agents = useQuery(() => api.agents(scope), [scope.workspaceId]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', category: 'briefing' as Routine['category'], schedule: 'weekdays 08:00', agentId: '' });
  const create = async () => {
    try { await api.createRoutine(scope, { ...f, agentId: f.agentId || agents.data?.[0]?.id || null }); toast.success('Routine saved.'); setOpen(false); setF({ ...f, name: '' }); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
      {can('build') && <div className="mb-4 flex justify-end"><Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>New routine</Button></div>}
      {routines.loading ? <SkeletonList rows={4} /> : !routines.data?.length ? <EmptyState icon={<Repeat className="size-5" aria-hidden />} title="No routines yet" body="A routine runs an agent on a schedule, like a morning briefing." /> : (
        <motion.ul variants={listStagger} initial="hidden" animate="show" className="card divide-y divide-line">
          {routines.data.map((r) => (
            <motion.li key={r.id} variants={listItem} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="text-sm text-muted">{CATEGORY[r.category]} · {r.schedule} · {r.agentName ?? 'No agent'} · last run {r.lastRunAt ? relTime(r.lastRunAt, tz) : '—'}</p>
              </div>
              {r.pausedByOps ? <Badge tone="warning" icon={<Lock className="size-3" aria-hidden />}>Paused by Omni-SDR</Badge> : (
                <div className="w-auto"><Switch checked={r.active} disabled={!can('build')} label={r.active ? 'On' : 'Off'} onChange={(v) => api.patchRoutine(scope, r.id, { active: v }).then(() => toast(`${r.name} is ${v ? 'on' : 'off'}.`)).catch((e) => toast.error(e.message))} /></div>
              )}
            </motion.li>
          ))}
        </motion.ul>
      )}
      <Sheet open={open} onOpenChange={setOpen} title="New routine" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} onClick={create}>Save routine</Button></>}>
        <div className="grid gap-3">
          <Field label="Name">{(p) => <Input id={p.id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Morning pipeline briefing" />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">{(p) => <Select id={p.id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Routine['category'] })}>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
            <Field label="Schedule">{(p) => <Input id={p.id} value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} />}</Field>
          </div>
          <Field label="Agent">{(p) => <Select id={p.id} value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value })}>{agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
        </div>
      </Sheet>
    </>
  );
}

function Learning() {
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Sparkles className="size-4" aria-hidden />What Auto-adjust has learned</h2>
        <p className="mt-1 text-sm text-muted">Auto-adjust tunes tone and angles from the sources you turn on in Settings. It never changes guardrails: the claims gate, approvals, caps and do-not-contact stay exactly as they are.</p>
      </div>
      <EmptyState title="Nothing learned yet" body="Each change will show here with the event it came from, and you'll be able to undo it." />
    </div>
  );
}
