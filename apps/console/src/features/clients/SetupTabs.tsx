// Dev portal step 2: the Dev onboarding tabs on a client record. Every save edits the DRAFT setup (DESIGN-frontend-1-dev-portal).
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Scope } from '@/lib/api/client';
import type { ClientRecord, ClientSetup, ClientSetupPatch, ConnChannel, ConnState } from '@/lib/api/types';
import { Badge, Banner, Button, Field, Input, Select, Textarea } from '@/components/ui';

export type SetupTab = 'profile' | 'handoff' | 'custom' | 'connections' | 'drafts';
export const SETUP_TABS: { value: SetupTab; label: string }[] = [
  { value: 'profile', label: 'Profile' }, { value: 'handoff', label: 'Handoff' }, { value: 'custom', label: 'Customizations' },
  { value: 'connections', label: 'Connections' }, { value: 'drafts', label: 'First drafts' },
];

export function SetupPanel({ client: c, scope, tab }: { client: ClientRecord; scope: Scope; tab: SetupTab }) {
  const s = c.setup;
  if (!s) return null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted" role="status">
        {s.changesSinceApproved ? `${s.changesSinceApproved} change${s.changesSinceApproved === 1 ? '' : 's'} since the last approved version.` : 'No changes since the last approved version.'}{' '}
        Saving edits the draft. What the client runs does not change until a version is approved.
      </p>
      {tab === 'profile' && <ProfileForm key={c.id} client={c} scope={scope} />}
      {tab === 'handoff' && <HandoffForm key={c.id} client={c} scope={scope} />}
      {tab === 'custom' && <CustomForm key={c.id} client={c} scope={scope} />}
      {tab === 'connections' && <Connections client={c} scope={scope} />}
      {tab === 'drafts' && <Drafts client={c} scope={scope} />}
    </div>
  );
}

/** One save flow for the three form tabs: send the patch, show the server's message under the form if it refuses. */
function useSave(c: ClientRecord, scope: Scope) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: ClientSetupPatch) => {
    setSaving(true); setError(null);
    try { await api.updateClientSetup(scope.orgId, c.id, patch); toast.success('Draft saved'); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  return { saving, error, save };
}
function SaveBar({ saving, dirty, error }: { saving: boolean; dirty: boolean; error: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Save to draft</Button>
      {dirty && <span className="text-sm text-muted">Unsaved changes</span>}
      {error && <span className="text-sm font-medium text-danger" role="alert">{error}</span>}
    </div>
  );
}

function ProfileForm({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const base = c.setup!.profile;
  const [f, setF] = useState(base);
  const { saving, error, save } = useSave(c, scope);
  const dirty = JSON.stringify(f) !== JSON.stringify(base);
  const missing = (v: string) => (v.trim() ? null : 'Required');
  const badEmail = f.ownerContacts && !/@/.test(f.ownerContacts) ? 'Add at least one email address' : null;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save({ profile: f }); }}>
      <Field label="Business hours" hint="When a person is reachable. Used for the reply window." error={dirty ? missing(f.hours) : null}>
        {(p) => <Input {...p} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />}
      </Field>
      <Field label="Time zone">{(p) => <Input {...p} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />}</Field>
      <Field label="Services">{(p) => <Textarea {...p} rows={3} value={f.services} onChange={(e) => setF({ ...f, services: e.target.value })} />}</Field>
      <Field label="Owner contacts and alert emails" hint="Where alerts go. Separate several with commas." error={badEmail}>
        {(p) => <Input {...p} value={f.ownerContacts} onChange={(e) => setF({ ...f, ownerContacts: e.target.value })} />}
      </Field>
      <Field label="Consent basis" hint="Why we may contact these people. Recorded for compliance.">
        {(p) => <Textarea {...p} rows={2} value={f.consentBasis} onChange={(e) => setF({ ...f, consentBasis: e.target.value })} />}
      </Field>
      <SaveBar saving={saving} dirty={dirty} error={error} />
    </form>
  );
}

const ROUTES: { key: keyof ClientSetup['handoff']; label: string; hint?: string }[] = [
  { key: 'booking', label: 'When a lead wants to book' }, { key: 'payment', label: 'When a lead wants to pay' },
  { key: 'resolution', label: 'When a lead has a problem to resolve' }, { key: 'unknown', label: 'When the system is not sure', hint: 'Default is to ask a human.' },
  { key: 'closers', label: 'Closers', hint: 'Who takes handed-off conversations.' }, { key: 'quietHours', label: 'Quiet hours', hint: 'No texts or calls in this window.' },
];
function HandoffForm({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const base = c.setup!.handoff;
  const [f, setF] = useState(base);
  const { saving, error, save } = useSave(c, scope);
  const dirty = JSON.stringify(f) !== JSON.stringify(base);
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save({ handoff: f }); }}>
      {ROUTES.map((r) => (
        <Field key={r.key} label={r.label} hint={r.hint}>{(p) => <Input {...p} value={f[r.key]} onChange={(e) => setF({ ...f, [r.key]: e.target.value })} />}</Field>
      ))}
      <SaveBar saving={saving} dirty={dirty} error={error} />
    </form>
  );
}

const TONE_SAMPLE = {
  warm: 'Thanks so much for reaching out. We would love to help, and a quick call is the easiest way to start.',
  direct: 'Thanks for reaching out. A quick call is the fastest way to answer this. What day works?',
  formal: 'Thank you for your inquiry. We would be pleased to assist and suggest a brief call at your convenience.',
} as const;
function CustomForm({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const base = c.setup!.customizations;
  const [tone, setTone] = useState(base.tone);
  const [days, setDays] = useState(base.followUpDays.join(', '));
  const [notes, setNotes] = useState(base.replyNotes);
  const { saving, error, save } = useSave(c, scope);
  const parsed = days.split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  const daysBad = parsed.some((d) => !Number.isInteger(d) || d < 1 || d > 30) ? 'Use whole days from 1 to 30, like 2, 5, 9' : null;
  const dirty = tone !== base.tone || days !== base.followUpDays.join(', ') || notes !== base.replyNotes;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!daysBad) void save({ customizations: { tone, followUpDays: parsed, replyNotes: notes } }); }}>
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
  const [busy, setBusy] = useState<string | null>(null);
  const test = async (ch: ConnChannel) => {
    setBusy(ch);
    try { await api.testClientConnection(scope.orgId, c.id, ch); toast.success(`${CONN_LABEL[ch]} test finished`); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-3">
      <Banner tone="info" title="Simulated means no real account is touched">Connect and test buttons here only record a test. Real connections need the client to approve access.</Banner>
      <ul className="space-y-2">
        {c.setup!.connections.map((x) => (
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
    </div>
  );
}

function Drafts({ client: c, scope }: { client: ClientRecord; scope: Scope }) {
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (id: string, d: 'approved' | 'rejected') => {
    setBusy(id);
    try { await api.decideClientDraft(scope.orgId, c.id, id, d); toast.success(d === 'approved' ? 'Draft approved' : 'Draft rejected'); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const drafts = c.setup!.drafts;
  return (
    <div className="space-y-3">
      <Banner tone="info" title="Sample drafts">These are demo drafts. Real first drafts come from the approval queue once Backend ships it.</Banner>
      {!drafts.length ? <p className="text-sm text-muted">No drafts yet.</p> : (
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
