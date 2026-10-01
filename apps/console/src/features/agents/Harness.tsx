// The agent harness (WORKSPACE-PLAN.md): everything that decides how one agent behaves, in one sheet.
// Role (prompt, model), Autonomy (how far it may go alone), Data (what it reads), Guardrails (the fixed floor every agent
// shares), Performance (its last 30 days and the corrections people made). Correcting a pattern starts here.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Archive, Lock, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { Agent, Autonomy, Badge as BadgeCode, ModelTier } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { deferAction } from '@/lib/undo';
import { TIER, relTime } from '@/lib/format';
import { Badge, Button, Field, Input, Segmented, Select, Sheet, SkeletonList, Switch, Textarea, cx } from '@/components/ui';

const BADGES: BadgeCode[] = ['EXEC', 'OPS', 'TRI', 'SDR', 'MKT', 'CS', 'FIN', 'INT', 'HR'];
type Tab = 'role' | 'autonomy' | 'data' | 'guardrails' | 'performance';

export const AUTONOMY: { value: Autonomy; label: string; hint: string; locked: string | null }[] = [
  { value: 'suggest', label: 'Suggest', hint: 'Answers and suggests. Writes nothing for approval.', locked: null },
  { value: 'draft', label: 'Draft for approval', hint: 'Writes drafts; a person approves every one before it sends.', locked: null },
  { value: 'guardrails', label: 'Send within guardrails', hint: 'Sends drafts that pass every check, inside the daily caps.', locked: 'Needs Trust Level 2 and a verified sending domain.' },
  { value: 'autopilot', label: 'Autopilot', hint: 'Runs its whole station and reports back.', locked: 'Needs Trust Level 3. Not offered in the MVP.' },
];

export function AgentSheet({ agent, onClose, readOnly }: { agent: Agent | 'new' | null; onClose: () => void; readOnly: boolean }) {
  const { scope } = useWorkspace();
  const base = agent && agent !== 'new' ? agent : null;
  const blank = { name: '', badge: 'SDR' as BadgeCode, modelTier: 'flash' as ModelTier, systemPrompt: '', contextSources: [] as string[], autonomousMode: false, autonomy: 'draft' as Autonomy };
  const [f, setF] = useState(blank);
  const [tab, setTab] = useState<Tab>('role');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!agent) return;
    setTab('role');
    setF(base ? { name: base.name, badge: base.badge, modelTier: base.modelTier, systemPrompt: base.systemPrompt, contextSources: base.contextSources, autonomousMode: base.autonomousMode, autonomy: base.autonomy } : blank);
  }, [agent]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    const body = { name: f.name.trim(), badge: f.badge, modelTier: f.modelTier, systemPrompt: f.systemPrompt, autonomousMode: f.autonomousMode, contextSources: f.contextSources };
    try {
      if (base) await api.patchAgent(scope, base.id, { ...body, autonomy: f.autonomy });
      else { const a = await api.createAgent(scope, body); if (f.autonomy !== 'draft') await api.patchAgent(scope, a.id, { autonomy: f.autonomy }); }
      toast.success(base ? 'Saved.' : `${body.name} is ready. Find it on Home.`); onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const archive = () => {
    const b = base!;
    deferAction({ ids: [b.id], kind: 'archive', workspaceId: scope.workspaceId, message: `${b.name} archived. Its routines stopped.`, commit: () => api.archiveAgent(scope, b.id) });
    onClose();
  };
  const tabs: { value: Tab; label: string }[] = [
    { value: 'role', label: 'Role' }, { value: 'autonomy', label: 'Autonomy' }, { value: 'data', label: 'Data' }, { value: 'guardrails', label: 'Guardrails' },
    ...(base ? [{ value: 'performance' as Tab, label: 'Performance' }] : []),
  ];
  return (
    <Sheet open={Boolean(agent)} onOpenChange={(v) => !v && onClose()} title={base ? base.name : 'New agent'} description="Agents draft and answer. They never send on their own today." wide
      footer={readOnly ? undefined : <>
        {base && <Button variant="ghost" icon={<Archive className="size-4" aria-hidden />} onClick={archive} className="mr-auto">Archive</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={() => void save()}>{base ? 'Save' : 'Create agent'}</Button></>}>
      <div className="mb-4"><Segmented id="agent-tab" size="sm" label="Agent setup" value={tab} onChange={setTab} options={tabs} /></div>
      <fieldset disabled={readOnly}>
        {tab === 'role' && (
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field label="Name">{(p) => <Input id={p.id} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sales Outbound" />}</Field>
            <Field label="Badge">{(p) => <Select id={p.id} value={f.badge} onChange={(e) => setF({ ...f, badge: e.target.value as BadgeCode })}>{BADGES.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Model tier</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(TIER) as ModelTier[]).map((t) => (
                  <label key={t} className={cx('flex cursor-pointer flex-col rounded-lg border p-3 transition-colors', f.modelTier === t ? 'border-ink bg-accent-soft' : 'border-line hover:bg-sunken')}>
                    <span className="flex items-center gap-2"><input type="radio" name="tier" checked={f.modelTier === t} onChange={() => setF({ ...f, modelTier: t })} className="accent-[var(--accent-ink)]" /><span className="font-medium">{TIER[t].label}</span>
                      <span className="ml-auto text-xs text-muted">≈{TIER[t].credits}×</span></span>
                    <span className="mt-1 text-xs text-muted">{TIER[t].hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Role prompt" hint={`${f.systemPrompt.length} / 8000 · To correct a pattern you see in Performance, say it here.`} className="sm:col-span-2">
              {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} rows={7} maxLength={8000} value={f.systemPrompt} onChange={(e) => setF({ ...f, systemPrompt: e.target.value })} placeholder="What this agent is for, and how it should work." />}
            </Field>
          </div>
        )}
        {tab === 'autonomy' && <AutonomyTab value={f.autonomy} onChange={(v) => setF({ ...f, autonomy: v })} routines={f.autonomousMode} onRoutines={(v) => setF({ ...f, autonomousMode: v })} readOnly={readOnly} />}
        {tab === 'data' && <DataTab sources={f.contextSources} onChange={(v) => setF({ ...f, contextSources: v })} />}
        {tab === 'guardrails' && <Guardrails />}
        {tab === 'performance' && base && <Performance agent={base} onSteer={() => setTab('role')} />}
      </fieldset>
    </Sheet>
  );
}

function AutonomyTab({ value, onChange, routines, onRoutines, readOnly }: { value: Autonomy; onChange: (v: Autonomy) => void; routines: boolean; onRoutines: (v: boolean) => void; readOnly: boolean }) {
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Autonomy" className="grid gap-2">
        {AUTONOMY.map((l, i) => {
          const on = value === l.value;
          return (
            <label key={l.value} className={cx('flex items-start gap-3 rounded-lg border p-3', l.locked ? 'cursor-not-allowed border-line opacity-75' : on ? 'cursor-pointer border-ink bg-accent-soft' : 'cursor-pointer border-line hover:bg-sunken')}>
              <input type="radio" name="autonomy" value={l.value} checked={on} disabled={Boolean(l.locked) || readOnly} onChange={() => onChange(l.value)} className="mt-1 accent-[var(--accent-ink)]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium"><span className="tabular text-xs text-muted">{i + 1}</span>{l.label}{l.locked && <Lock className="size-3.5 text-muted" aria-hidden />}</span>
                <span className="block text-xs text-muted">{l.hint}</span>
                {l.locked && <span className="mt-1 block text-xs text-warning">{l.locked}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <div className="rounded-lg border border-line p-3">
        <Switch checked={routines} onChange={onRoutines} disabled={readOnly} label="Run routines on schedule"
          description="Runs its routines without being asked. Whatever it drafts still waits for approval." />
      </div>
    </div>
  );
}

function DataTab({ sources, onChange }: { sources: string[]; onChange: (v: string[]) => void }) {
  const { scope } = useWorkspace();
  const sets = useQuery(() => api.datasets(scope), [scope.workspaceId]);
  const has = (src: string, aliases: string[] = []) => sources.some((t) => [src, ...aliases].some((x) => x.toLowerCase() === t.toLowerCase()));
  const ALIASES: Record<string, string[]> = { Evidence: ['Web'], Meetings: ['Calendar'] };
  const set = (src: string, on: boolean) => { const tags = [src, ...(ALIASES[src] ?? [])].map((t) => t.toLowerCase()); const rest = sources.filter((t) => !tags.includes(t.toLowerCase())); onChange(on ? [...rest, src] : rest); };
  if (!sets.data) return <SkeletonList rows={4} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">What this agent may read when it works. Less is safer and cheaper: give it what its job needs.</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {sets.data.map((d) => (
          <li key={d.key} className="px-3 py-2">
            {d.always ? (
              <p className="flex items-center gap-2 py-1 text-sm"><Lock className="size-4 text-muted" aria-hidden /><span className="font-medium">{d.name}</span><span className="text-xs text-muted">Always honored by every agent</span></p>
            ) : (
              <Switch checked={has(d.source, ALIASES[d.source])} onChange={(v) => set(d.source, v)} label={d.name} description={`${d.about} ${d.count.toLocaleString('en-US')} ${d.count === 1 ? 'item' : 'items'}.`} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Guardrails() {
  const { scope } = useWorkspace();
  const cap = useQuery(() => api.capacity(scope), [scope.workspaceId]);
  const rules = [
    'It can’t send, publish or contact anyone itself. A person approves every message (Trust Level 1).',
    'Every claim must point to a fetched fact. A draft that fails the claims gate is blocked and can’t be approved.',
    'Filler phrases, implied prior contact and competitor names are blocked by the gate.',
    'The do-not-contact list is checked before anything is written or sent.',
    `Sending stops at each mailbox’s daily cap${cap.data ? ` (${cap.data.today.cap} today across ${cap.data.mailboxes.length} mailbox${cap.data.mailboxes.length === 1 ? '' : 'es'})` : ''}.`,
    'A reply stops the lead’s sequence; an opt-out suppresses the address at once.',
    'Auto-adjust tunes tone and angles, never these rules.',
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">The floor every agent shares. No setting here or anywhere in the app turns these off.</p>
      <ul className="space-y-2">{rules.map((r) => <li key={r} className="flex gap-2.5 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{r}</li>)}</ul>
      <Link to={`/w/${scope.workspaceId}/settings?tab=safety`} className="inline-flex items-center gap-1 text-sm font-medium text-ink hover:underline"><ArrowUpRight className="size-4" aria-hidden />Caps, holds and do-not-contact in Settings</Link>
    </div>
  );
}

function Performance({ agent, onSteer }: { agent: Agent; onSteer: () => void }) {
  const { scope, tz } = useWorkspace();
  const st = useQuery(() => api.agentStats(scope, agent.id, 30), [scope.workspaceId, agent.id]);
  if (!st.data) return <SkeletonList rows={3} />;
  const s = st.data;
  const tile = (label: string, n: number | string, hint?: string) => (
    <div className="rounded-lg border border-line p-3"><p className="tabular text-xl font-semibold">{n}</p><p className="text-xs text-muted">{label}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
  );
  const KIND = { rejected: { label: 'Rejected', tone: 'danger' as const }, edited: { label: 'Edited before approval', tone: 'warning' as const }, blocked: { label: 'Blocked by the gate', tone: 'warning' as const } };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tile('Drafted', s.drafted, `last ${s.days} days`)}{tile('Approved', s.approved)}{tile('Approval rate', s.approvalRate === null ? '—' : `${s.approvalRate}%`, 'approved ÷ decided')}
        {tile('Rejected', s.rejected)}{tile('Edited first', s.edited)}{tile('Blocked by the gate', s.blocked)}
      </div>
      <section aria-labelledby="corr-h">
        <div className="mb-2 flex items-center gap-2"><h3 id="corr-h" className="text-sm font-semibold">Corrections</h3>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onSteer}>Steer it in the role prompt</Button></div>
        {!s.corrections.length ? <p className="text-sm text-muted">Nothing corrected in the last {s.days} days.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {s.corrections.map((c) => (
              <li key={`${c.draftId}:${c.kind}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <Badge tone={KIND[c.kind].tone}>{KIND[c.kind].label}</Badge>
                <span className="font-medium">{c.recipient}</span>
                {c.note && <span className="min-w-0 flex-1 basis-full truncate text-muted sm:basis-auto" title={c.note}>“{c.note}”</span>}
                <span className="ml-auto text-xs text-muted">{relTime(c.at, tz)}</span>
                <Link to={`/w/${scope.workspaceId}/approvals?d=${c.draftId}`} className="text-xs font-medium text-ink hover:underline">Open draft</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
