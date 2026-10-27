// Dev portal: CI/CD for one client (6a). Versions, plain diff, review, rollout, restore. Two people always: whoever wrote a version cannot approve it,
// checked by user id. Restoring an earlier version is a new version that goes through review like any other.
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Scope } from '@/lib/api/client';
import type { ClientRecord, Risk, SetupVersion, VersionStatus } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useSession, useWorkspace } from '@/lib/session';
import { Badge, Banner, Button, ErrorState, Field, Input, SkeletonList } from '@/components/ui';
import { errText, usePeople, type Tone } from './clientBits';

const STATUS: Record<VersionStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, in_review: { label: 'In review', tone: 'info' }, approved: { label: 'Approved', tone: 'info' }, applied: { label: 'Live', tone: 'success' },
  rejected: { label: 'Sent back', tone: 'warning' }, rolled_back: { label: 'Rolled back', tone: 'neutral' },
};
const RISK: Record<Risk, { label: string; tone: Tone }> = { low: { label: 'Low risk', tone: 'neutral' }, medium: { label: 'Medium risk', tone: 'warning' }, high: { label: 'High risk', tone: 'danger' } };
const LABELS: Record<string, string> = {
  hours: 'Business hours', timezone: 'Time zone', quietHours: 'Quiet hours', services: 'Services', tone: 'Tone', replyNotes: 'Reply notes', followUpDays: 'Follow-up days',
  ownerContacts: 'Owner contacts', consentBasis: 'Consent basis', closers: 'Closers', resolution: 'Resolution route', unknown: 'Unknown route', booking: 'Booking route', payment: 'Payment route',
};

export function VersionsTab({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const { role } = useWorkspace();
  const { me } = useSession();
  const operator = role === 'admin' || role === 'operator';
  const people = usePeople(scope.orgId);
  const q = useQuery(() => api.setupVersions(scope.orgId, c.id), [scope.orgId, c.id], { key: `setup-versions:${c.id}` });
  // Reasons for sent-back versions come from the history, which reviewers do not load.
  const sentBack = useQuery(() => api.clientEvents(scope.orgId, c.id, { kind: 'setup.reject' }), [scope.orgId, c.id], { key: `client-rejects:${c.id}`, enabled: operator });
  const reasonFor = (n: number) => sentBack.data?.items.find((e) => e.subjectId === String(n))?.detail.reason;
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  };
  const versions = q.data ?? [];
  const live = versions.filter((v) => v.status === 'applied').sort((a, b) => (b.appliedAt ?? '').localeCompare(a.appliedAt ?? ''))[0] ?? null;
  const open = versions.find((v) => v.status === 'in_review' || v.status === 'approved') ?? null;
  const draft = versions.find((v) => v.status === 'draft') ?? null;
  if (q.loading && !q.data) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <ErrorState error={q.error} onRetry={q.reload} />
      <p className="text-sm" role="status">
        {live ? <>The client runs <strong>v{live.version}</strong>, {live.note || 'no note'}.</> : 'Nothing is live yet. The first approved and rolled out version starts the client.'}{' '}
        <span className="text-muted">{draft ? `${draft.diff.length} change${draft.diff.length === 1 ? '' : 's'} sit in the draft.` : 'No draft changes.'}</span>
      </p>
      {!operator && <Banner tone="info" title="Review view">You see versions and their changes, not the rest of the record. Approving needs a version someone else wrote.</Banner>}
      {open && <Banner tone="info" title={`v${open.version} is ${open.status === 'in_review' ? 'waiting for review' : 'approved and ready to roll out'}`}>One version moves at a time. Finish it before sending another.</Banner>}
      {!versions.length ? <p className="text-sm text-muted">No versions yet. Save changes in the other tabs, then send them for review here.</p> : (
        <ul className="space-y-2">{versions.map((v) => (
          <VersionRow key={v.version} v={v} client={c} scope={scope} operator={operator} myId={me?.user.id ?? null} isLive={live?.version === v.version} canRestore={operator && !open && !draft && live !== null}
            people={people} reason={reasonFor(v.version)} busy={busy} run={run} />))}</ul>
      )}
    </div>
  );
}

function VersionRow({ v, client: c, scope, operator, myId, isLive, canRestore, people, reason, busy, run }: {
  v: SetupVersion; client: ClientRecord; scope: Scope; operator: boolean; myId: string | null; isLive: boolean; canRestore: boolean; people: (id: string | null) => string;
  reason: unknown; busy: string | null; run: (key: string, fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const mine = v.authorId === myId;
  const key = (s: string) => `${v.version}${s}`;
  const act = (a: 'submit' | 'approve' | 'reject' | 'apply' | 'rollback', ok: string, why?: string) => run(key(a), () => api.setupAction(scope.orgId, c.id, v.version, a, why), ok);
  const replaced = v.status === 'applied' && !isLive;
  return (
    <li className="rounded-md border border-control p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-medium">v{v.version}{v.note && `, ${v.note}`}</p>
        <Badge tone={RISK[v.risk].tone}>{RISK[v.risk].label}</Badge>
        <Badge tone={replaced ? 'neutral' : STATUS[v.status].tone}>{replaced ? 'Replaced' : STATUS[v.status].label}</Badge>
      </div>
      <p className="text-muted">{people(v.authorId)}, {new Date(v.createdAt).toLocaleDateString('en-US')}{v.reviewerId && ` · reviewed by ${people(v.reviewerId)}`}</p>
      {v.status === 'rejected' && typeof reason === 'string' && <p className="mt-1">Sent back: {reason}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-muted">What changed ({v.diff.length})</summary>
        {!v.diff.length ? <p className="mt-1 text-muted">No field differences.</p> : (
          <table className="mt-2 w-full text-left">
            <thead><tr className="text-xs text-muted"><th className="pb-1 pr-2 font-medium">Setting</th><th className="pb-1 pr-2 font-medium">Was</th><th className="pb-1 pr-2 font-medium">Now</th><th className="pb-1 font-medium">Risk</th></tr></thead>
            <tbody>{v.diff.map((x) => (
              <tr key={x.path} className="align-top border-t border-control">
                <td className="py-1 pr-2">{LABELS[x.path] ?? x.path}</td><td className="py-1 pr-2 text-muted">{x.before}</td><td className="py-1 pr-2">{x.after}</td><td className="py-1"><Badge tone={RISK[x.risk].tone}>{RISK[x.risk].label}</Badge></td>
              </tr>))}</tbody>
          </table>
        )}
      </details>
      {v.checks.length > 0 && (
        <ul className="mt-2 space-y-0.5" aria-label="Checks after rollout (demo)">
          <li className="text-xs text-muted">Demo checks. Real post-checks arrive later.</li>
          {v.checks.map((k) => <li key={k.label}>{k.ok ? 'Passed' : 'Failed'}: {k.label}{k.why && <span className="text-muted"> ({k.why})</span>}</li>)}
        </ul>
      )}
      {v.status === 'draft' && operator && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void act('submit', `v${v.version} sent for review`, text).then(() => setText('')); }}>
          <Field label="Name this change" className="min-w-0 flex-1" hint="Say what it does, like Add Saturday hours.">{(p) => <Input {...p} value={text} maxLength={80} onChange={(e) => setText(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" loading={busy === key('submit')} disabled={!text.trim() || !v.diff.length}>Send for review</Button>
        </form>
      )}
      {v.status === 'in_review' && (
        <div className="mt-3 space-y-2">
          {mine ? <p className="text-muted">You wrote this version, so someone else has to review it.</p> : (
            <>
              {v.risk !== 'low' && <p className="text-muted">A {v.risk}-risk change. Check the table before approving.</p>}
              <Field label="Reason" hint="Required when sending back.">{(p) => <Input {...p} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />}</Field>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" loading={busy === key('approve')} onClick={() => void act('approve', `v${v.version} approved`)}>Approve</Button>
                <Button size="sm" loading={busy === key('reject')} disabled={!text.trim()} onClick={() => void act('reject', `v${v.version} sent back`, text)}>Send back</Button>
              </div>
            </>
          )}
        </div>
      )}
      {v.status === 'approved' && operator && (
        <div className="mt-3"><Button size="sm" variant="primary" loading={busy === key('apply')} onClick={() => void act('apply', `v${v.version} is live`)}>Roll out now</Button></div>
      )}
      {replaced && canRestore && (
        <div className="mt-3"><Button size="sm" loading={busy === key('rollback')} onClick={() => void act('rollback', `Proposed a restore of v${v.version}. A second person has to approve it.`)}>Restore this version</Button></div>
      )}
    </li>
  );
}
