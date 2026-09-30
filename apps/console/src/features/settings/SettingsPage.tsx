// Settings (DESIGN 6.11). Trust level and daily caps are read-only by design.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { ShieldCheck, UserPlus, PauseCircle, Ban, Clock3, CreditCard } from 'lucide-react';
import { api } from '@/lib/api';
import type { AutoAdjustSource, Role } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useSession, useWorkspace } from '@/lib/session';
import { AUTO_ADJUST, ROLE, relTime } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Field, Input, Meter, Page, PageHeader, Segmented, Select, Sheet, SkeletonList, Switch, Textarea } from '@/components/ui';
import { PauseSheet } from '../home/HomePage';

type Tab = 'workspace' | 'members' | 'safety' | 'activity' | 'billing';
const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney', 'UTC'];

export default function SettingsPage() {
  const { can } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const admin = can('members');
  const tabs: { value: Tab; label: string }[] = admin
    ? [{ value: 'workspace', label: 'Workspace' }, { value: 'members', label: 'Members' }, { value: 'safety', label: 'Sending & safety' }, { value: 'activity', label: 'Activity' }, { value: 'billing', label: 'Billing' }]
    : [{ value: 'workspace', label: 'Workspace' }, { value: 'safety', label: 'Sending & safety' }];
  const tab = tabs.find((t) => t.value === params.get('tab'))?.value ?? 'workspace';
  return (
    <Page>
      <PageHeader title="Settings">
        <div className="w-full"><Segmented id="settings" label="Settings section" value={tab} onChange={(v) => setParams(v === 'workspace' ? {} : { tab: v })} options={tabs} /></div>
      </PageHeader>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="max-w-3xl">
          {tab === 'workspace' ? <WorkspaceTab /> : tab === 'members' ? <MembersTab /> : tab === 'safety' ? <SafetyTab /> : tab === 'activity' ? <ActivityTab /> : <BillingTab />}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}

function WorkspaceTab() {
  const { scope, settings, can } = useWorkspace();
  const ro = !can('workspace_settings');
  const w = settings!.workspace;
  const [name, setName] = useState(w.name);
  const [addr, setAddr] = useState(w.postalAddress ?? '');
  useEffect(() => { setName(w.name); setAddr(w.postalAddress ?? ''); }, [w.name, w.postalAddress]);
  const patch = (p: Parameters<typeof api.patchSettings>[1], msg = 'Saved.') => api.patchSettings(scope, p).then(() => toast.success(msg)).catch((e) => toast.error(e.message));
  const addrErr = addr && (addr.trim().length < 10 || addr.length > 300) ? 'Use 10 to 300 characters.' : null;
  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3 p-4">
        <ShieldCheck className="size-5 shrink-0 text-ink" aria-hidden />
        <div className="flex-1"><p className="font-medium">Trust level 1</p><p className="text-sm text-muted">A person approves every message. Only Omni-SDR operations can change this.</p></div>
      </Card>
      <Card className="space-y-4 p-5">
        {ro && <p className="text-sm text-muted">Only admins change workspace settings.</p>}
        <fieldset disabled={ro} className="space-y-4">
          <Field label="Workspace name">{(p) => <div className="flex gap-2"><Input id={p.id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            {name !== w.name && <Button variant="primary" disabled={!name.trim()} onClick={() => patch({ name: name.trim() })}>Save</Button>}</div>}</Field>
          <Field label="Time zone" hint="SLA clocks, sending windows and analytics days use this.">{(p) => <Select id={p.id} aria-describedby={p.describedBy} value={w.timezone} onChange={(e) => patch({ timezone: e.target.value }, 'Time zone updated.')}>
            {ZONES.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}</Select>}</Field>
          <Field label="Postal address for outreach footers" hint="Required by law in commercial email. Nothing sends until it's set." error={addrErr}>{(p) => <div className="space-y-2">
            <Textarea id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} rows={2} value={addr} onChange={(e) => setAddr(e.target.value)} maxLength={300} />
            {addr !== (w.postalAddress ?? '') && !addrErr && <Button variant="primary" size="sm" onClick={() => patch({ postalAddress: addr.trim() })}>Save address</Button>}</div>}</Field>
        </fieldset>
      </Card>
      <Card className="space-y-4 p-5">
        <Switch checked={w.clientApprovalsEnabled} disabled={ro} onChange={(v) => patch({ clientApprovalsEnabled: v }, v ? 'Clients can now approve drafts.' : 'Client approvals are off.')}
          label="Client approvals" description="Let this workspace's client approve drafts too. Your team still can." />
        <Switch checked={w.autoAdjustEnabled} disabled={ro} onChange={(v) => patch({ autoAdjustEnabled: v })} label="Auto-adjust"
          description="Learn tone and angles from the sources below. Guardrails never change." />
        {w.autoAdjustEnabled && (
          <fieldset className="grid gap-x-4 sm:grid-cols-2" disabled={ro}>
            <legend className="sr-only">Auto-adjust sources</legend>
            {(Object.keys(AUTO_ADJUST) as AutoAdjustSource[]).map((k) => (
              <Checkbox key={k} label={AUTO_ADJUST[k]} checked={w.autoAdjustSources.includes(k)}
                onChange={(v) => patch({ autoAdjustSources: v ? [...w.autoAdjustSources, k] : w.autoAdjustSources.filter((x) => x !== k) })} />
            ))}
          </fieldset>
        )}
      </Card>
    </div>
  );
}

function MembersTab() {
  const { scope, tz } = useWorkspace();
  const { org } = useSession();
  const m = useQuery(() => api.members(scope), [scope.workspaceId]);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [scoped, setScoped] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const invite = async () => {
    setErr(null);
    try { const r = await api.invite(scope, { email, role, workspaceIds: scoped || role === 'client_viewer' ? [scope.workspaceId] : null }); setLink(r.inviteUrl); }
    catch (e) { setErr((e as Error).message); }
  };
  const wsName = (ids: string[] | null) => ids ? ids.map((id) => org?.workspaces.find((w) => w.id === id)?.name ?? 'another workspace').join(', ') : 'All workspaces';
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button variant="primary" icon={<UserPlus className="size-4" aria-hidden />} onClick={() => { setOpen(true); setLink(null); setEmail(''); }}>Invite</Button></div>
      {m.loading ? <SkeletonList rows={3} /> : (
        <Card className="divide-y divide-line">
          {m.data?.members.map((x) => (
            <div key={x.userId} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{x.email}</p><p className="text-sm text-muted">{wsName(x.workspaceIds)}</p></div>
              <Badge tone={x.role === 'admin' ? 'accent' : 'neutral'}>{ROLE[x.role].label}</Badge>
            </div>
          ))}
          {m.data?.pendingInvites.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1"><p className="font-medium">Pending invite · {ROLE[i.role].label}</p><p className="text-sm text-muted">Expires {relTime(i.expiresAt, tz)}</p></div>
              <Button size="sm" variant="danger" onClick={() => api.revokeInvite(scope, i.id).then(() => toast('Invite revoked.'))}>Revoke</Button>
            </div>
          ))}
        </Card>
      )}
      <Sheet open={open} onOpenChange={setOpen} title="Invite a teammate"
        footer={link ? <Button variant="primary" onClick={() => setOpen(false)}>Done</Button> : <><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!email} onClick={invite}>Create invite</Button></>}>
        {link ? (
          <div className="space-y-2">
            <p className="font-medium">Invite created for {email}</p>
            <p className="rounded-lg bg-sunken p-3 text-sm text-muted">In the demo, nothing is emailed and no link is made. In the live product you&rsquo;d copy a single-use link here. Anyone with the link and that email can join; it expires in 7 days.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Email" error={err}>{(p) => <Input id={p.id} type="email" aria-describedby={p.describedBy} aria-invalid={p.invalid} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
            <fieldset><legend className="mb-1.5 text-sm font-medium">Role</legend>
              <div className="space-y-1.5">{(Object.keys(ROLE) as Role[]).map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 has-[:checked]:border-ink has-[:checked]:bg-accent-soft">
                  <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="accent-[var(--accent-ink)]" />
                  <span><span className="font-medium">{ROLE[r].label}</span><span className="text-sm text-muted">: {ROLE[r].hint}</span></span></label>))}</div>
            </fieldset>
            {role !== 'client_viewer' ? <Checkbox checked={scoped} onChange={setScoped} label="Only this workspace" /> : <p className="text-sm text-muted">Clients only ever see this workspace.</p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function SafetyTab() {
  const { scope, can, tz } = useWorkspace();
  const cap = useQuery(() => api.capacity(scope), [scope.workspaceId]);
  const [pause, setPause] = useState(false);
  const [dnc, setDnc] = useState('');
  const d = cap.data;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="mb-3 text-base font-semibold">Mailboxes</h2>
        {!d ? <SkeletonList rows={2} /> : <div className="space-y-4">{d.mailboxes.map((mb) => (
          <div key={mb.id}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{mb.address}</span>
              <span className="tabular text-sm text-muted">{mb.sentToday} of {mb.dailyCap} today {mb.pausedReason && <Badge tone="warning">Paused</Badge>}</span></div>
            <Meter value={mb.sentToday} max={mb.dailyCap} label={`${mb.address} usage`} />
          </div>))}
          <p className="flex items-center gap-1.5 text-xs text-muted"><Clock3 className="size-3.5" aria-hidden />Daily caps are a safety floor set by Omni-SDR, not a setting. They reset at 00:00 UTC.</p>
          <p className="text-sm text-muted">{d.queue.approvedUnsent} approved and waiting to send · {d.queue.awaitingReview} in review</p>
        </div>}
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-base font-semibold">Holds</h2>
        {d?.holds.length ? d.holds.map((h) => (
          <div key={h.scopeType + h.scopeId} className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft p-3 text-warning">
            <PauseCircle className="size-5" aria-hidden /><div className="flex-1"><p className="font-medium">Sending paused ({h.scopeType})</p><p className="text-sm">&ldquo;{h.reason}&rdquo; · {relTime(h.setAt, tz)}</p></div>
            {can('clear_hold') && <Button size="sm" onClick={() => api.clearHold(scope, h.scopeType, h.scopeId).then(() => toast.success('Resumed.'))}>Resume</Button>}
          </div>
        )) : <div className="flex flex-wrap items-center gap-3"><p className="flex-1 text-sm text-muted">No holds. Sending runs on schedule.</p>
          {can('approve') && <Button variant="danger" icon={<PauseCircle className="size-4" aria-hidden />} onClick={() => setPause(true)}>Pause all sending</Button>}</div>}
      </Card>
      {can('approve') && (
        <Card className="p-5">
          <h2 className="mb-1 text-base font-semibold">Do not contact</h2>
          <p className="mb-3 text-sm text-muted">We store a fingerprint of the address, not the address itself.</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); api.suppress(scope, dnc).then(() => { toast.success('Added. They will never be contacted from this org.'); setDnc(''); }).catch((er) => toast.error(er.message)); }}>
            <label htmlFor="dnc" className="sr-only">Email address</label>
            <Input id="dnc" type="email" value={dnc} onChange={(e) => setDnc(e.target.value)} placeholder="name@company.com" />
            <Button type="submit" disabled={!dnc} icon={<Ban className="size-4" aria-hidden />}>Add</Button>
          </form>
        </Card>
      )}
      <PauseSheet open={pause} onOpenChange={setPause} />
    </div>
  );
}

function ActivityTab() {
  const { scope, tz } = useWorkspace();
  const a = useQuery(() => api.activity(scope), [scope.workspaceId]);
  const [filter, setFilter] = useState('');
  const actions = [...new Set((a.data ?? []).map((x) => x.action))];
  const rows = (a.data ?? []).filter((x) => !filter || x.action === filter);
  return (
    <div className="space-y-3">
      <div className="w-48"><label htmlFor="act-f" className="sr-only">Filter by action</label>
        <Select id="act-f" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All actions</option>{actions.map((x) => <option key={x}>{x}</option>)}</Select></div>
      {a.loading ? <SkeletonList rows={6} /> : (
        <Card className="divide-y divide-line">{rows.map((x) => (
          <div key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
            <span className="font-medium">{x.actorEmail ?? x.actor}</span><span className="text-muted">{x.action.replace(/_/g, ' ')} · {x.entityType.replace(/_/g, ' ')}</span>
            <span className="ml-auto text-xs text-muted">{relTime(x.at, tz)}</span>
          </div>))}</Card>
      )}
    </div>
  );
}

function BillingTab() {
  const { settings, tz } = useWorkspace();
  const o = settings!.org;
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-3"><CreditCard className="size-5 text-muted" aria-hidden /><h2 className="flex-1 text-base font-semibold">Plan</h2><Badge tone="info">{o.subscriptionStatus === 'trialing' ? 'Trial' : o.subscriptionStatus}</Badge></div>
      {o.trialEndsAt && <p className="text-sm">Trial ends {relTime(o.trialEndsAt, tz)}.</p>}
      <p className="text-sm text-muted">Billing is managed in Stripe. In this demo there&rsquo;s no billing account to open.</p>
    </Card>
  );
}
