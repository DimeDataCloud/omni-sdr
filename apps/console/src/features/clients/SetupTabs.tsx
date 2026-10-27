// Dev portal: the setup tabs on a client record (6a). Profile is record keeping and saves right away. Every other config tab edits the one open DRAFT;
// nothing the client runs changes until a version is approved and rolled out.
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Scope } from '@/lib/api/client';
import type { ClientRecord, ConnChannel, ConnState, SetupConfig, SetupDraft } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { Badge, Banner, Button, ErrorState, Field, Input, Select, SkeletonList, Textarea } from '@/components/ui';
import { errText } from './clientBits';
import { VersionsTab } from './VersionsTab';

export type SetupTab = 'profile' | 'business' | 'handoff' | 'custom' | 'connections' | 'drafts' | 'versions';
export const SETUP_TABS: { value: SetupTab; label: string }[] = [
  { value: 'profile', label: 'Profile' }, { value: 'business', label: 'Business' }, { value: 'handoff', label: 'Handoff' }, { value: 'custom', label: 'Customizations' },
  { value: 'connections', label: 'Connections' }, { value: 'drafts', label: 'First drafts' }, { value: 'versions', label: 'Versions' },
];

export function SetupPanel({ client: c, scope, tab }: { client: ClientRecord; scope: Scope; tab: SetupTab }) {
  const versions = useQuery(() => api.setupVersions(scope.orgId, c.id), [scope.orgId, c.id], { key: `setup-versions:${c.id}`, enabled: tab !== 'profile' });
  const pending = versions.data?.find((v) => v.status === 'draft')?.diff.length ?? 0;
  const editsConfig = tab === 'business' || tab === 'handoff' || tab === 'custom';
  return (
    <div className="space-y-4">
      {editsConfig && (
        <p className="text-sm text-muted" role="status">
          {pending ? `${pending} change${pending === 1 ? '' : 's'} in the draft since the live version.` : 'The draft matches the live version.'} Saving edits the draft. What the client runs does not change until a version is approved.
        </p>
      )}
      {tab === 'profile' && <ProfileForm key={c.id} client={c} scope={scope} />}
      {editsConfig && <ConfigTab client={c} scope={scope} tab={tab} />}
      {tab === 'connections' && <Connections client={c} scope={scope} />}
      {tab === 'drafts' && <Drafts client={c} scope={scope} />}
      {tab === 'versions' && <VersionsTab client={c} scope={scope} />}
    </div>
  );
}

function SaveBar({ saving, dirty, error, label = 'Save to draft' }: { saving: boolean; dirty: boolean; error: string | null; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>{label}</Button>
      {dirty && <span className="text-sm text-muted">Unsaved changes</span>}
      {error && <span className="text-sm font-medium text-danger" role="alert">{error}</span>}
    </div>
  );
}

/** Record keeping: edited now, no review, not versioned. The system never reads these at run time. */
function ProfileForm({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const base = c.profile;
  const [f, setF] = useState(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(base);
  const badEmail = f.contactEmail && !/@/.test(f.contactEmail) ? 'Add an email address' : null;
  const save = async () => {
    setSaving(true); setError(null);
    try { await api.patchClientProfile(scope.orgId, c.id, f); toast.success('Profile saved'); } catch (e) { setError(errText(e)); } finally { setSaving(false); }
  };
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!badEmail) void save(); }}>
      <Banner tone="info" title="Saved right away">Profile is record keeping. It is not versioned and does not change what the client runs.</Banner>
      <Field label="Niche">{(p) => <Input {...p} value={f.niche} onChange={(e) => setF({ ...f, niche: e.target.value })} />}</Field>
      <Field label="Contact name">{(p) => <Input {...p} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />}</Field>
      <Field label="Contact email" error={badEmail}>{(p) => <Input {...p} value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />}</Field>
      <Field label="Internal notes">{(p) => <Textarea {...p} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      <SaveBar saving={saving} dirty={dirty && !badEmail} error={error} label="Save profile" />
    </form>
  );
}

type TextKey = Exclude<keyof SetupConfig, 'followUpDays' | 'tone'>;
const FIELDS: Record<'business' | 'handoff', { key: TextKey; label: string; hint?: string; area?: boolean }[]> = {
  business: [
    { key: 'hours', label: 'Business hours', hint: 'When a person is reachable. Used for the reply window.' }, { key: 'timezone', label: 'Time zone' },
    { key: 'quietHours', label: 'Quiet hours', hint: 'No texts or calls in this window.' }, { key: 'services', label: 'Services', area: true },
    { key: 'ownerContacts', label: 'Owner contacts and alert emails', hint: 'Where alerts go. Separate several with commas.' },
    { key: 'consentBasis', label: 'Consent basis', hint: 'Why we may contact these people. Recorded for compliance.', area: true },
  ],
  handoff: [
    { key: 'booking', label: 'When a lead wants to book' }, { key: 'payment', label: 'When a lead wants to pay' }, { key: 'resolution', label: 'When a lead has a problem to resolve' },
    { key: 'unknown', label: 'When the system is not sure', hint: 'Default is to ask a human.' }, { key: 'closers', label: 'Closers', hint: 'Who takes handed-off conversations.' },
  ],
};

/** The draft loads once; the inner form resets whenever the saved draft changes. */
function ConfigTab({ client: c, scope, tab }: { client: ClientRecord; scope: Scope; tab: 'business' | 'handoff' | 'custom' }) {
  const q = useQuery(() => api.setupDraft(scope.orgId, c.id), [scope.orgId, c.id], { key: `setup-draft:${c.id}` });
  if (q.loading && !q.data) return <SkeletonList rows={3} />;
  if (!q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  const key = `${q.data.version}:${JSON.stringify(q.data.config)}`;
  return tab === 'custom' ? <CustomForm key={key} draft={q.data} client={c} scope={scope} /> : <FieldsForm key={key} tab={tab} draft={q.data} client={c} scope={scope} />;
}

function useSaveDraft(c: ClientRecord, scope: Scope, draft: SetupDraft) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (part: Partial<SetupConfig>) => {
    setSaving(true); setError(null);
    try { await api.putSetupDraft(scope.orgId, c.id, { ...draft.config, ...part }); toast.success('Draft saved'); } catch (e) { setError(errText(e)); } finally { setSaving(false); }
  };
  return { saving, error, save };
}

function FieldsForm({ tab, draft, client: c, scope }: { tab: 'business' | 'handoff'; draft: SetupDraft; client: ClientRecord; scope: Scope }) {
  const fields = FIELDS[tab];
  const pick = (cfg: SetupConfig) => Object.fromEntries(fields.map((x) => [x.key, cfg[x.key]])) as Partial<SetupConfig>;
  const base = pick(draft.config);
  const [f, setF] = useState(base);
  const { saving, error, save } = useSaveDraft(c, scope, draft);
  const dirty = JSON.stringify(f) !== JSON.stringify(base);
  const badEmail = tab === 'business' && f.ownerContacts && !/@/.test(f.ownerContacts) ? 'Add at least one email address' : null;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!badEmail) void save(f); }}>
      {fields.map((x) => (
        <Field key={x.key} label={x.label} hint={x.hint} error={x.key === 'ownerContacts' ? badEmail : null}>
          {(p) => (x.area
            ? <Textarea {...p} rows={x.key === 'services' ? 3 : 2} value={String(f[x.key] ?? '')} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} />
            : <Input {...p} value={String(f[x.key] ?? '')} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} />)}
        </Field>
      ))}
      <SaveBar saving={saving} dirty={dirty && !badEmail} error={error} />
    </form>
  );
}

const TONE_SAMPLE = {
  warm: 'Thanks so much for reaching out. We would love to help, and a quick call is the easiest way to start.',
  direct: 'Thanks for reaching out. A quick call is the fastest way to answer this. What day works?',
  formal: 'Thank you for your inquiry. We would be pleased to assist and suggest a brief call at your convenience.',
} as const;
function CustomForm({ draft, client: c, scope }: { draft: SetupDraft; client: ClientRecord; scope: Scope }) {
  const base = draft.config;
  const [tone, setTone] = useState(base.tone);
  const [days, setDays] = useState(base.followUpDays.join(', '));
  const [notes, setNotes] = useState(base.replyNotes);
  const { saving, error, save } = useSaveDraft(c, scope, draft);
  const parsed = days.split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  const daysBad = parsed.some((d) => !Number.isInteger(d) || d < 1 || d > 30) ? 'Use whole days from 1 to 30, like 2, 5, 9' : null;
  const dirty = tone !== base.tone || JSON.stringify(parsed) !== JSON.stringify(base.followUpDays) || notes !== base.replyNotes;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!daysBad) void save({ tone, followUpDays: parsed, replyNotes: notes }); }}>
      <Field label="Tone">
        {(p) => <Select {...p} value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}><option value="warm">Warm</option><option value="direct">Direct</option><option value="formal">Formal</option></Select>}
      </Field>
      <Field label="Follow-up days" hint="Days after the first reply when a follow-up goes out." error={daysBad}>
        {(p) => <Input {...p} value={days} onChange={(e) => setDays(e.target.value)} />}
      </Field>
      <Field label="Reply notes" hint="Facts the replies should always use.">{(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      <figure className="rounded-md border border-control bg-sunken p-3 text-sm">
        <figcaption className="mb-1 text-xs text-muted">What a lead would read, in this tone</figcaption>
        <p>Hi Alex, {TONE_SAMPLE[tone]}{notes && ` ${notes}`}</p>
        <p className="mt-2 text-muted">{parsed.length && !daysBad ? `Follow-ups on day ${parsed.join(', ')}.` : 'No follow-ups.'}</p>
      </figure>
      <SaveBar saving={saving} dirty={dirty && !daysBad} error={error} />
    </form>
  );
}

const CONN_LABEL: Record<ConnChannel, string> = { mailbox: 'Mailbox', calendar: 'Calendar', phone: 'Phone number', voice: 'Voice line', crm: 'CRM' };
const CONN_STATE: Record<ConnState, { label: string; tone: 'success' | 'info' | 'warning' }> = {
  live: { label: 'Live', tone: 'success' }, simulated: { label: 'Simulated', tone: 'info' }, needs_approval: { label: 'Needs approval', tone: 'warning' },
};
function Connections({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const q = useQuery(() => api.demoConnections(scope.orgId, c.id), [scope.orgId, c.id], { key: `demo-conns:${c.id}` });
  const [busy, setBusy] = useState<string | null>(null);
  const test = async (ch: ConnChannel) => {
    setBusy(ch);
    try { await api.demoTestConnection(scope.orgId, c.id, ch); toast.success(`${CONN_LABEL[ch]} test finished`); } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-3">
      <Banner tone="info" title="Demo only: simulated means no real account is touched">Connection cards and tests are not in the 6a API yet. Run test only records a test here. Real connections need the client to approve access.</Banner>
      <ErrorState error={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <SkeletonList rows={3} /> : (
        <ul className="space-y-2">
          {(q.data ?? []).map((x) => (
            <li key={x.channel} className="flex flex-wrap items-center gap-3 rounded-md border border-control p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{CONN_LABEL[x.channel]}</p>
                <p className="text-muted">{x.note}{x.lastTest && ` · last test ${new Date(x.lastTest).toLocaleString('en-US')}`}</p>
              </div>
              <Badge tone={CONN_STATE[x.state].tone}>{CONN_STATE[x.state].label}</Badge>
              <Button size="sm" loading={busy === x.channel} onClick={() => void test(x.channel)}>Run test</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Drafts({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const q = useQuery(() => api.demoReplyDrafts(scope.orgId, c.id), [scope.orgId, c.id], { key: `demo-drafts:${c.id}` });
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (id: string, d: 'approved' | 'rejected') => {
    setBusy(id);
    try { await api.demoDecideReplyDraft(scope.orgId, c.id, id, d); toast.success(d === 'approved' ? 'Draft approved' : 'Draft rejected'); } catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  };
  const drafts = q.data ?? [];
  return (
    <div className="space-y-3">
      <Banner tone="info" title="Demo only: sample drafts">These are demo drafts. Real first drafts come from the approval queue once Backend ships it.</Banner>
      <ErrorState error={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <SkeletonList rows={2} /> : !drafts.length ? <p className="text-sm text-muted">No drafts yet.</p> : (
        <ul className="space-y-2">
          {drafts.map((d) => (
            <li key={d.id} className="space-y-2 rounded-md border border-control p-3 text-sm">
              <div className="flex items-center gap-2"><p className="min-w-0 flex-1 font-medium">{d.subject}</p>
                <Badge tone={d.state === 'approved' ? 'success' : d.state === 'rejected' ? 'danger' : 'neutral'}>{d.state === 'pending' ? 'Waiting' : d.state === 'approved' ? 'Approved' : 'Rejected'}</Badge></div>
              <p className="whitespace-pre-wrap text-muted">{d.body}</p>
              {d.state === 'pending' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" loading={busy === d.id} onClick={() => void decide(d.id, 'approved')}>Approve</Button>
                  <Button size="sm" loading={busy === d.id} onClick={() => void decide(d.id, 'rejected')}>Reject</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
