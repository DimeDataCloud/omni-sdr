// Dev portal: the Checklist and History tabs on a client record (6a: checklist states, evidence and waive rules, events newest first with a cursor).
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Scope } from '@/lib/api/client';
import type { ChecklistGroup, ChecklistItem, ChecklistState, ClientEvent, ClientRecord } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { Badge, Button, ErrorState, Field, Input, SkeletonList } from '@/components/ui';
import { errText, usePeople, type Tone } from './clientBits';

const GROUPS: ChecklistGroup[] = ['Account', 'Connections', 'Compliance', 'Setup', 'Launch'];
const ITEM: Record<ChecklistState, { label: string; tone: Tone }> = {
  todo: { label: 'To do', tone: 'neutral' }, in_progress: { label: 'In progress', tone: 'info' }, blocked: { label: 'Blocked', tone: 'warning' },
  done: { label: 'Done', tone: 'success' }, waived: { label: 'Waived', tone: 'neutral' },
};

export function ChecklistTab({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const q = useQuery(() => api.clientChecklist(scope.orgId, c.id), [scope.orgId, c.id], { key: `client-checklist:${c.id}` });
  const items = q.data ?? [];
  const editable = c.status === 'onboarding' || c.status === 'building' || c.status === 'ready';
  if (q.loading && !q.data) return <SkeletonList rows={4} />;
  return (
    <section aria-label="Checklist" className="space-y-4">
      <ErrorState error={q.error} onRetry={q.reload} />
      <h3 className="section-title">Checklist, {c.checklist.done} of {c.checklist.required} required done</h3>
      {GROUPS.map((g) => {
        const rows = items.filter((i) => i.section === g);
        return rows.length ? (
          <div key={g}>
            <h4 className="mb-1 text-sm font-medium">{g}</h4>
            <ul className="space-y-1">{rows.map((i) => <ChecklistRow key={i.key} item={i} client={c} scope={scope} editable={editable} />)}</ul>
          </div>
        ) : null;
      })}
    </section>
  );
}

function ChecklistRow({ item: i, client: c, scope, editable }: { item: ChecklistItem; client: ClientRecord; scope: Scope; editable: boolean }) {
  const [mode, setMode] = useState<'done' | 'waive' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const people = usePeople(scope.orgId);
  const send = async (patch: Parameters<typeof api.patchChecklistItem>[3], ok: string) => {
    setBusy(true);
    try { await api.patchChecklistItem(scope.orgId, c.id, i.key, patch); toast.success(ok); setMode(null); setText(''); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const settled = i.state === 'done' || i.state === 'waived';
  return (
    <li className="space-y-2 rounded-md border border-control p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          {i.title}{!i.required && <span className="text-muted"> (optional)</span>}
          {i.blockedBy && <span className="block text-muted">Waiting on: {i.blockedBy}</span>}
          {i.state === 'done' && (i.evidenceRef || i.kind === 'auto') && <span className="block text-muted">{i.kind === 'auto' ? 'Checked by the system' : `${i.evidenceRef}, ${people(i.doneBy)}`}</span>}
          {i.state === 'waived' && <span className="block text-muted">Waived by {people(i.doneBy)}: {i.waivedReason}</span>}
        </span>
        <Badge tone={ITEM[i.state].tone}>{ITEM[i.state].label}</Badge>
        {editable && !mode && (
          <div className="flex flex-wrap gap-1">
            {i.state === 'todo' && <Button size="sm" loading={busy} onClick={() => void send({ state: 'in_progress' }, `${i.title}: started`)}>Start</Button>}
            {!settled && i.kind === 'manual' && <Button size="sm" onClick={() => setMode('done')}>Mark done</Button>}
            {!settled && <Button size="sm" onClick={() => setMode('waive')}>Waive</Button>}
            {settled && <Button size="sm" loading={busy} onClick={() => void send({ state: 'todo' }, `${i.title}: reopened`)}>Reopen</Button>}
          </div>
        )}
      </div>
      {editable && !settled && i.kind === 'auto' && <p className="text-muted">The system marks this done when its check passes. Waive it with a reason if it cannot.</p>}
      {mode && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(mode === 'done' ? { state: 'done', evidenceRef: text } : { state: 'waived', waivedReason: text }, `${i.title}: ${mode === 'done' ? 'done' : 'waived'}`); }}>
          <Field label={mode === 'done' ? 'Evidence or note' : 'Why waive it'} hint={mode === 'done' ? 'A link or a short note on how you checked.' : 'Recorded on the client history.'} className="min-w-0 flex-1">
            {(p) => <Input {...p} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />}
          </Field>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!text.trim()}>{mode === 'done' ? 'Mark done' : 'Waive'}</Button>
          <Button type="button" size="sm" onClick={() => { setMode(null); setText(''); }}>Cancel</Button>
        </form>
      )}
    </li>
  );
}

/** Sentences are composed here from ids and enum values; the events themselves carry no prose. */
function sentence(e: ClientEvent, name: (id: string | null) => string, titleOf: (key: string) => string): string {
  const d = e.detail; const who = e.actorKind === 'system' ? 'The system' : name(e.actorUserId);
  switch (e.kind) {
    case 'deal.closed': return `Deal closed (${d.level}), price still a draft`;
    case 'client.transition': return `${who} moved it from ${d.from} to ${d.to}${d.reason ? `: ${d.reason}` : ''}`;
    case 'client.profile_updated': return `${who} updated the profile (${String(d.fields).split(',').join(', ')})`;
    case 'checklist.update': return `${who} set "${titleOf(String(e.subjectId))}" to ${String(d.state).replace('_', ' ')}`;
    case 'connection.tested': return `${who} ran a ${e.subjectId} test`;
    case 'draft.decided': return `${who} ${d.decision} a first draft`;
    case 'setup.draft_saved': return `${who} saved the draft (${d.risk} risk)`;
    case 'setup.submit': return `${who} sent v${e.subjectId} for review`;
    case 'setup.approve': return `${who} approved v${e.subjectId}`;
    case 'setup.reject': return `${who} sent v${e.subjectId} back: ${d.reason}`;
    case 'setup.apply': return `${who} rolled out v${e.subjectId}`;
    case 'setup.rollback': return `${who} proposed v${e.subjectId}, restoring v${d.restores}`;
    default: return `${who}: ${e.kind}`;
  }
}

export function HistoryTab({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const people = usePeople(scope.orgId);
  const [more, setMore] = useState<ClientEvent[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const q = useQuery(() => api.clientEvents(scope.orgId, c.id), [scope.orgId, c.id], { key: `client-events:${c.id}` });
  const checklist = useQuery(() => api.clientChecklist(scope.orgId, c.id), [scope.orgId, c.id], { key: `client-checklist:${c.id}` });
  const titleOf = (key: string) => checklist.data?.find((i) => i.key === key)?.title ?? key;
  const next = cursor === undefined ? q.data?.next ?? null : cursor;
  const items = [...(q.data?.items ?? []), ...more];
  const older = async () => {
    if (!next) return; setBusy(true);
    try { const r = await api.clientEvents(scope.orgId, c.id, { after: next }); setMore((m) => [...m, ...r.items]); setCursor(r.next); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  if (q.loading && !q.data) return <SkeletonList rows={3} />;
  return (
    <section aria-label="History" className="space-y-2">
      <ErrorState error={q.error} onRetry={q.reload} />
      <ul className="space-y-1 text-sm">
        {items.map((e) => <li key={e.id}><span className="text-muted">{new Date(e.at).toLocaleDateString('en-US')}</span> {sentence(e, people, titleOf)}</li>)}
      </ul>
      {next && <Button size="sm" loading={busy} onClick={() => void older()}>Show older</Button>}
    </section>
  );
}
