// Dev portal step 3: CI/CD for one client. Versions, plain diff, review, rollout, rollback (DESIGN-frontend-1-dev-portal).
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Scope } from '@/lib/api/client';
import type { ClientRecord, Risk, SetupVersion, VersionStatus } from '@/lib/api/types';
import { useWorkspace } from '@/lib/session';
import { Badge, Banner, Button, Field, Input, Textarea } from '@/components/ui';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUS: Record<VersionStatus, { label: string; tone: Tone }> = {
  in_review: { label: 'In review', tone: 'info' }, sent_back: { label: 'Sent back', tone: 'warning' }, approved: { label: 'Approved', tone: 'info' },
  live: { label: 'Live', tone: 'success' }, failed: { label: 'Rollout failed', tone: 'danger' }, retired: { label: 'Replaced', tone: 'neutral' },
};
const RISK: Record<Risk, { label: string; tone: Tone }> = { low: { label: 'Low risk', tone: 'neutral' }, medium: { label: 'Medium risk', tone: 'warning' }, high: { label: 'High risk', tone: 'danger' } };

export function VersionsTab({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const { role } = useWorkspace();
  const operator = role === 'admin' || role === 'operator';
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<ClientRecord>, ok: (r: ClientRecord) => string) => {
    setBusy(key);
    try { toast.success(ok(await fn())); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const live = c.versions.find((v) => v.status === 'live') ?? null;
  const open = c.versions.find((v) => v.status === 'in_review' || v.status === 'approved') ?? null;
  const pending = c.setup?.changesSinceApproved ?? 0;
  const canRollBack = operator && live && !open && c.versions.some((v) => v.status === 'retired' && v.number < live.number);
  const sorted = [...c.versions].sort((a, b) => b.number - a.number);

  return (
    <div className="space-y-4">
      <p className="text-sm" role="status">
        {live ? <>The client runs <strong>v{live.number}</strong>, {live.title}.</> : 'Nothing is live yet. The first approved version starts the client.'}{' '}
        <span className="text-muted">{pending ? `${pending} change${pending === 1 ? '' : 's'} sit in the draft.` : 'The draft matches the live version.'}</span>
      </p>
      {operator && !open && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run('propose', () => api.proposeVersion(scope.orgId, c.id, title), (r) => `Proposed v${Math.max(...r.versions.map((v) => v.number))}`).then(() => setTitle('')); }}>
          <Field label="Name this change" className="min-w-0 flex-1" hint="Say what it does, like Add Saturday hours.">{(p) => <Input {...p} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" loading={busy === 'propose'} disabled={!title.trim() || !pending}>Propose version</Button>
        </form>
      )}
      {open && <Banner tone="info" title={`v${open.number} is ${open.status === 'in_review' ? 'waiting for review' : 'approved and ready to roll out'}`}>One version moves at a time. Finish it before proposing another.</Banner>}
      {canRollBack && <Button loading={busy === 'rollback'} onClick={() => void run('rollback', () => api.rollbackVersion(scope.orgId, c.id), () => 'Rolled back as a new version')}>Roll back to the previous version</Button>}
      {!sorted.length ? <p className="text-sm text-muted">No versions yet. Save changes in the other tabs, then propose one here.</p> : (
        <ul className="space-y-2">{sorted.map((v) => <VersionRow key={v.id} v={v} client={c} scope={scope} operator={operator} busy={busy} run={run} />)}</ul>
      )}
    </div>
  );
}

function VersionRow({ v, client: c, scope, operator, busy, run }: {
  v: SetupVersion; client: ClientRecord; scope: Scope; operator: boolean; busy: string | null;
  run: (key: string, fn: () => Promise<ClientRecord>, ok: (r: ClientRecord) => string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  return (
    <li className="rounded-md border border-control p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-medium">v{v.number}, {v.title}</p>
        <Badge tone={RISK[v.risk].tone}>{RISK[v.risk].label}</Badge>
        <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
      </div>
      <p className="text-muted">{v.author}, {new Date(v.createdAt).toLocaleDateString('en-US')}{v.reviewer && ` · reviewed by ${v.reviewer}${v.selfApproved ? ' (own low-risk change)' : ''}`}{v.rollbackOf !== null && ` · restores v${v.rollbackOf}`}</p>
      {v.reviewNote && <p className="mt-1">Reviewer note: {v.reviewNote}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-muted">What changed ({v.changes.length})</summary>
        {!v.changes.length ? <p className="mt-1 text-muted">No field differences.</p> : (
          <table className="mt-2 w-full text-left">
            <thead><tr className="text-xs text-muted"><th className="pb-1 pr-2 font-medium">Setting</th><th className="pb-1 pr-2 font-medium">Was</th><th className="pb-1 pr-2 font-medium">Now</th><th className="pb-1 font-medium">Risk</th></tr></thead>
            <tbody>{v.changes.map((x) => (
              <tr key={x.area + x.field} className="align-top border-t border-control">
                <td className="py-1 pr-2">{x.label}</td><td className="py-1 pr-2 text-muted">{x.before}</td><td className="py-1 pr-2">{x.after}</td><td className="py-1"><Badge tone={RISK[x.risk].tone}>{RISK[x.risk].label}</Badge></td>
              </tr>))}</tbody>
          </table>
        )}
      </details>
      {v.checks && (
        <ul className="mt-2 space-y-0.5" aria-label="Checks after rollout">
          {v.checks.map((k) => <li key={k.label}>{k.ok ? 'Passed' : 'Failed'}: {k.label}{k.why && <span className="text-muted"> ({k.why})</span>}</li>)}
        </ul>
      )}
      {v.status === 'failed' && <p className="mt-2 font-medium text-danger">The client stays on the previous version. Fix the cause in the draft, then propose a new version.</p>}
      {v.status === 'in_review' && (
        <div className="mt-3 space-y-2">
          {v.risk !== 'low' && <p className="text-muted">A {v.risk}-risk change needs a second person. The author cannot approve it.</p>}
          <Field label="Review note" hint="Required when sending back.">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={busy === v.id + 'a'} onClick={() => void run(v.id + 'a', () => api.reviewVersion(scope.orgId, c.id, v.id, 'approve', note), () => `v${v.number} approved`)}>Approve</Button>
            <Button size="sm" loading={busy === v.id + 's'} disabled={!note.trim()} onClick={() => void run(v.id + 's', () => api.reviewVersion(scope.orgId, c.id, v.id, 'send_back', note), () => `v${v.number} sent back`)}>Send back</Button>
          </div>
        </div>
      )}
      {v.status === 'approved' && operator && (
        <div className="mt-3"><Button size="sm" variant="primary" loading={busy === v.id + 'r'} onClick={() => void run(v.id + 'r', () => api.rolloutVersion(scope.orgId, c.id, v.id), (r) => (r.versions.find((x) => x.id === v.id)?.status === 'live' ? `v${v.number} is live` : 'Rollout stopped, see the checks'))}>Roll out now</Button></div>
      )}
    </li>
  );
}
