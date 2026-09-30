// Leads (DESIGN 6.7): contacts, campaigns, ICPs. Evidence can't be typed in; it comes from research.
import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Upload, Search, ExternalLink, Plus, Target, Megaphone, Users, History, ChevronRight } from 'lucide-react';
import { api, type Campaign, type Icp } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { EMAIL_STATUS, domainOf, enrollmentState, factSummary, plural, relTime } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Page, PageHeader, Segmented, Select, Sheet, SkeletonList, Textarea, cx, listItem, listStagger } from '@/components/ui';

type Tab = 'contacts' | 'campaigns' | 'icps';

export default function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'contacts';
  return (
    <Page>
      <PageHeader title="Leads" subtitle="Who you reach, which campaign they're in, and the ideal customer behind it.">
        <div className="w-full"><Segmented id="leads" label="Leads section" value={tab} onChange={(v) => setParams(v === 'contacts' ? {} : { tab: v })}
          options={[{ value: 'contacts', label: 'Contacts' }, { value: 'campaigns', label: 'Campaigns' }, { value: 'icps', label: 'ICPs' }]} /></div>
      </PageHeader>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {tab === 'contacts' ? <Contacts /> : tab === 'campaigns' ? <Campaigns /> : <Icps />}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}

// ── Contacts ──────────────────────────────────────────────────────────────────────────────────
function Contacts() {
  const { scope, tz } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const list = useQuery(() => api.contacts(scope, q), [scope.workspaceId, q]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const open = params.get('c');
  const items = list.data ?? [];
  const toggle = (id: string) => { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); setSel(s); };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">Search contacts</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, email" className="pl-9" />
        </label>
        <AnimatePresence>{sel.size > 0 && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
            <Button variant="primary" icon={<Megaphone className="size-4" aria-hidden />} onClick={() => setEnrolling(true)}>Add {sel.size} to a campaign</Button>
          </motion.div>)}</AnimatePresence>
        <Button icon={<Upload className="size-4" aria-hidden />} onClick={() => setImporting(true)}>Import</Button>
      </div>
      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading ? <SkeletonList rows={6} /> : !items.length ? (
        <EmptyState icon={<Users className="size-5" aria-hidden />} title={q ? 'No matches' : 'No contacts yet'} body={q ? 'Try a name, company or email.' : 'Import a list, or let research find leads that fit your ICP.'}
          action={!q && <Button variant="primary" icon={<Upload className="size-4" aria-hidden />} onClick={() => setImporting(true)}>Import contacts</Button>} />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm max-md:hidden">
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr><th className="w-10 px-3 py-2"><span className="sr-only">Select</span></th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 text-right font-medium">Fit</th><th className="px-3 py-2 font-medium">Added</th></tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className={cx('row-d border-t border-line transition-colors hover:bg-sunken/50', sel.has(c.id) && 'bg-accent-soft/50')}>
                  <td className="px-3"><input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="size-4 accent-[var(--accent-ink)]" /></td>
                  <td className="px-3"><button className="text-left font-medium hover:text-ink hover:underline" onClick={() => setParams({ c: c.id })}>{c.name ?? '—'}</button>
                    <span className="block text-xs text-muted">{c.title}</span></td>
                  <td className="px-3">{c.company}</td>
                  <td className="px-3"><span className="flex items-center gap-2"><span className="max-w-56 truncate">{c.email}</span><Badge tone={EMAIL_STATUS[c.emailStatus].tone}>{EMAIL_STATUS[c.emailStatus].label}</Badge></span></td>
                  <td className="tabular px-3 text-right font-semibold">{c.fitScore ?? '—'}</td>
                  <td className="px-3 text-muted">{relTime(c.createdAt, tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line md:hidden">
            {items.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3">
                <label className="-ml-3 grid size-11 shrink-0 cursor-pointer place-items-center"><input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="size-5 accent-[var(--accent-ink)]" /></label>
                <button onClick={() => setParams({ c: c.id })} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 text-left">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-sm text-muted">{c.company}</span></span>
                  <span className="tabular font-semibold">{c.fitScore ?? '—'}</span><ChevronRight className="size-4 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-xs text-muted">Free checks can only mark an address invalid. Only verified addresses (paid check) can be emailed.</p>
      <ContactSheet id={open} onClose={() => setParams({})} />
      <ImportSheet open={importing} onOpenChange={setImporting} />
      <EnrollSheet open={enrolling} onOpenChange={setEnrolling} ids={[...sel]} onDone={() => setSel(new Set())} />
    </>
  );
}

function ContactSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { scope, tz } = useWorkspace();
  const c = useQuery(() => api.contact(scope, id!), [id], { enabled: Boolean(id) });
  const d = c.data;
  return (
    <Sheet open={Boolean(id)} onOpenChange={(v) => !v && onClose()} title={d?.name ?? 'Contact'} description={d ? [d.title, d.company].filter(Boolean).join(' · ') : undefined} wide>
      {!d ? <SkeletonList rows={3} /> : (
        <div className="space-y-5 pb-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">Email</dt><dd className="flex items-center gap-2">{d.email ?? '—'}<Badge tone={EMAIL_STATUS[d.emailStatus].tone}>{EMAIL_STATUS[d.emailStatus].label}</Badge></dd>
            <dt className="text-muted">ICP fit</dt><dd className="tabular font-semibold">{d.fitScore ?? '—'}</dd>
            {d.phone && <><dt className="text-muted">Phone</dt><dd>{d.phone}</dd></>}
          </dl>
          <section>
            <h3 className="section-title mb-2">Evidence</h3>
            {d.evidence.length ? <ul className="space-y-2">{d.evidence.map((e) => (
              <li key={e.id} className="rounded-lg border border-line bg-sunken/50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Badge>{e.type.replace(/_/g, ' ')}</Badge>
                  <a href={e.sourceUri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink hover:underline">{domainOf(e.sourceUri)}<ExternalLink className="size-3" aria-hidden /><span className="sr-only">(opens in a new tab)</span></a>
                  {new Date(e.expiresAt) < new Date() && <Badge tone="warning">Expired</Badge>}</div>
                <ul className="mt-1.5 space-y-0.5">{factSummary(e.facts).map((f) => <li key={f}>{f}</li>)}</ul>
                <p className="mt-1 text-xs text-muted">Fetched {relTime(e.fetchedAt, tz)} · expires {new Date(e.expiresAt).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })}</p>
              </li>))}</ul> : <p className="text-sm text-muted">No evidence yet. Research adds it; it can&rsquo;t be typed in.</p>}
          </section>
          <section>
            <h3 className="section-title mb-2">Campaigns</h3>
            {d.enrollments.length ? <ul className="divide-y divide-line rounded-lg border border-line">{d.enrollments.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"><span className="font-medium">{e.campaignName}</span><span className="text-muted">{enrollmentState(e.state, e.stopReason)}</span></li>
            ))}</ul> : <p className="text-sm text-muted">Not in a campaign.</p>}
          </section>
        </div>
      )}
    </Sheet>
  );
}

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { header: [] as string[], rows: [] as string[][] };
  const split = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  return { header: split(lines[0]).map((h) => h.toLowerCase()), rows: lines.slice(1).map(split) };
}
const FIELDS = ['name', 'email', 'company', 'title', 'phone'] as const;

function ImportSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { scope } = useWorkspace();
  const [text, setText] = useState('name,email,company,title\nJordan Lee,jordan@lakeside-dental.example,Lakeside Dental,Owner\nsupport@lakeside-dental.example,support@lakeside-dental.example,Lakeside Dental,');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: { index: number; reason: string }[]; invalid: number; role: number } | null>(null);
  const parsed = useMemo(() => parseCsv(text), [text]);
  const rows = parsed.rows.map((r) => Object.fromEntries(FIELDS.map((f) => [f, r[parsed.header.indexOf(f)] || undefined])));
  const unknownCols = parsed.header.filter((h) => !(FIELDS as readonly string[]).includes(h));
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.importContacts(scope, rows);
      setResult({ created: r.created.length, skipped: r.skipped, invalid: r.created.filter((c) => c.emailStatus === 'invalid').length, role: r.created.filter((c) => c.role).length });
      toast.success(`Imported ${plural(r.created.length, 'contact')}.`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setResult(null); }} title="Import contacts" description="Paste CSV with a header row. Columns: name, email, company, title, phone." wide
      footer={result ? <Button variant="primary" onClick={() => { onOpenChange(false); setResult(null); }}>Done</Button>
        : <><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!rows.length} onClick={submit}>Import {plural(rows.length, 'row')}</Button></>}>
      {result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-success-soft p-3 text-success"><p className="tabular text-2xl font-semibold">{result.created}</p><p className="text-xs">created</p></div>
            <div className="rounded-lg bg-sunken p-3"><p className="tabular text-2xl font-semibold">{result.skipped.length}</p><p className="text-xs text-muted">skipped</p></div>
            <div className="rounded-lg bg-danger-soft p-3 text-danger"><p className="tabular text-2xl font-semibold">{result.invalid}</p><p className="text-xs">invalid address</p></div>
          </div>
          {result.role > 0 && <p className="text-sm text-muted">{plural(result.role, 'address')} {result.role === 1 ? 'looks' : 'look'} like a shared inbox (info@, support@). They&rsquo;re imported but rarely reply.</p>}
          {result.skipped.length > 0 && <ul className="text-sm text-muted">{result.skipped.map((s) => <li key={s.index}>Row {s.index + 2}: {s.reason}</li>)}</ul>}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="CSV">{(p) => <Textarea id={p.id} rows={6} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-sm" spellCheck={false} />}</Field>
          {unknownCols.length > 0 && <p className="text-sm text-warning">Ignored columns: {unknownCols.join(', ')}</p>}
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm"><thead className="bg-sunken text-left text-xs text-muted"><tr>{FIELDS.map((f) => <th key={f} className="px-3 py-1.5 font-medium capitalize">{f}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-line">{FIELDS.map((f) => <td key={f} className="max-w-40 truncate px-3 py-1.5">{r[f] ?? ''}</td>)}</tr>)}</tbody></table>
              {rows.length > 5 && <p className="border-t border-line px-3 py-1.5 text-xs text-muted">and {rows.length - 5} more</p>}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function EnrollSheet({ open, onOpenChange, ids, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; ids: string[]; onDone: () => void }) {
  const { scope } = useWorkspace();
  const camps = useQuery(() => api.campaigns(scope), [scope.workspaceId], { enabled: open });
  const [camp, setCamp] = useState('');
  const [busy, setBusy] = useState(false);
  const usable = (camps.data ?? []).filter((c) => c.status !== 'archived');
  const submit = async () => {
    const id = camp || usable[0]?.id; if (!id) return;
    setBusy(true);
    try { const r = await api.enroll(scope, id, ids); toast.success(`Added ${plural(r.enrolled, 'contact')}${r.skipped ? `; ${r.skipped} already in it or on do-not-contact` : ''}.`); onOpenChange(false); onDone(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Add ${plural(ids.length, 'contact')} to a campaign`} description="Agents draft for them; every draft still comes to Approvals."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!usable.length} onClick={submit}>Add to campaign</Button></>}>
      <Field label="Campaign">{(p) => <Select id={p.id} value={camp || usable[0]?.id || ''} onChange={(e) => setCamp(e.target.value)}>{usable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
    </Sheet>
  );
}

// ── Campaigns ─────────────────────────────────────────────────────────────────────────────────
const CAMP_TONE: Record<Campaign['status'], 'neutral' | 'success' | 'warning'> = { draft: 'neutral', active: 'success', paused: 'warning', archived: 'neutral' };
function Campaigns() {
  const { scope } = useWorkspace();
  const camps = useQuery(() => api.campaigns(scope), [scope.workspaceId]);
  const icps = useQuery(() => api.icps(scope), [scope.workspaceId]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [icp, setIcp] = useState('');
  const icpName = (id: string | null) => { const i = icps.data?.find((x) => x.id === id); return i ? `${i.name} v${i.version}` : 'No ICP'; };
  const create = async () => {
    try { await api.createCampaign(scope, { name, icpId: icp || icps.data?.[0]?.id || null }); toast.success('Campaign created as a draft.'); setCreating(false); setName(''); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
      <div className="mb-4 flex justify-end"><Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>New campaign</Button></div>
      <ErrorState error={camps.error} onRetry={camps.reload} />
      {camps.loading ? <SkeletonList rows={3} /> : !camps.data?.length ? <EmptyState icon={<Megaphone className="size-5" aria-hidden />} title="No campaigns yet" body="A campaign pairs an ICP with the people you want to reach." /> : (
        <motion.ul variants={listStagger} initial="hidden" animate="show" className="grid gap-3 md:grid-cols-2">
          {camps.data.map((c) => (
            <motion.li key={c.id} variants={listItem} className="card p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold">{c.name}</h2><p className="text-sm text-muted">{icpName(c.icpId)}</p></div>
                <Badge tone={CAMP_TONE[c.status]}>{c.status[0].toUpperCase() + c.status.slice(1)}</Badge>
              </div>
              <div className="mt-4 flex items-end gap-6">
                <div><p className="tabular text-2xl font-semibold">{c.enrolled}</p><p className="text-xs text-muted">enrolled</p></div>
                <div><p className="tabular text-2xl font-semibold">{c.live}</p><p className="text-xs text-muted">live</p></div>
                <div className="ml-auto w-36">
                  <label htmlFor={`cs-${c.id}`} className="sr-only">Status of {c.name}</label>
                  <Select id={`cs-${c.id}`} value={c.status} onChange={(e) => api.patchCampaign(scope, c.id, { status: e.target.value as Campaign['status'] }).then(() => toast(`${c.name}: ${e.target.value}.`))}>
                    {(['draft', 'active', 'paused', 'archived'] as const).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </Select>
                </div>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      )}
      <Sheet open={creating} onOpenChange={setCreating} title="New campaign" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={create}>Create</Button></>}>
        <div className="space-y-3">
          <Field label="Name">{(p) => <Input id={p.id} value={name} onChange={(e) => setName(e.target.value)} placeholder="New patients, Q4" autoFocus />}</Field>
          <Field label="ICP" hint="The campaign keeps using this version even if the ICP changes later.">{(p) => <Select id={p.id} aria-describedby={p.describedBy} value={icp} onChange={(e) => setIcp(e.target.value)}>
            {icps.data?.map((i) => <option key={i.id} value={i.id}>{i.name} v{i.version}</option>)}</Select>}</Field>
        </div>
      </Sheet>
    </>
  );
}

// ── ICPs ──────────────────────────────────────────────────────────────────────────────────────
function Icps() {
  const { scope, tz } = useWorkspace();
  const icps = useQuery(() => api.icps(scope), [scope.workspaceId]);
  const [edit, setEdit] = useState<Icp | 'new' | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end"><Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEdit('new')}>New ICP</Button></div>
      {icps.loading ? <SkeletonList rows={2} /> : !icps.data?.length ? <EmptyState icon={<Target className="size-5" aria-hidden />} title="No ICP yet" body="Describe your ideal customer once; research and drafting use it everywhere." /> : (
        <motion.ul variants={listStagger} initial="hidden" animate="show" className="grid gap-3 md:grid-cols-2">
          {icps.data.map((i) => (
            <motion.li key={i.id} variants={listItem} className="card p-4">
              <div className="flex items-start gap-2"><h2 className="flex-1 text-base font-semibold">{i.name}</h2><Badge tone="info">v{i.version}</Badge></div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {Object.entries(i.data).map(([k, v]) => (<Fragment key={k}><dt className="text-muted capitalize">{k}</dt><dd>{Array.isArray(v) ? v.join(', ') : String(v)}</dd></Fragment>))}
              </dl>
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" onClick={() => setEdit(i)}>Edit</Button>
                <span className="ml-auto flex items-center gap-1 text-xs text-muted"><History className="size-3.5" aria-hidden />{relTime(i.createdAt, tz)}</span>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      )}
      <IcpSheet icp={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function IcpSheet({ icp, onClose }: { icp: Icp | 'new' | null; onClose: () => void }) {
  const { scope } = useWorkspace();
  const base = icp && icp !== 'new' ? icp : null;
  const [form, setForm] = useState<Record<string, string>>({});
  const val = (k: string) => form[k] ?? (base ? (Array.isArray(base.data[k]) ? (base.data[k] as string[]).join(', ') : String(base.data[k] ?? '')) : '');
  const nameVal = form.name ?? base?.name ?? '';
  const save = async () => {
    const data: Record<string, unknown> = {};
    for (const k of ['industry', 'size', 'region']) if (val(k)) data[k] = val(k);
    for (const k of ['pains', 'titles']) if (val(k)) data[k] = val(k).split(',').map((s) => s.trim()).filter(Boolean);
    try { await api.createIcp(scope, { name: nameVal, data, lineageId: base?.lineageId }); toast.success(base ? `Saved as v${base.version + 1}. Running campaigns keep v${base.version}.` : 'ICP created.'); setForm({}); onClose(); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Sheet open={Boolean(icp)} onOpenChange={(v) => { if (!v) { setForm({}); onClose(); } }} title={base ? `Edit ${base.name}` : 'New ICP'} description={base ? 'Saving creates a new version. Campaigns keep the version they started with.' : undefined} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!nameVal.trim()} onClick={save}>{base ? `Save as v${base.version + 1}` : 'Create'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(p) => <Input id={p.id} value={nameVal} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label="Industry">{(p) => <Input id={p.id} value={val('industry')} onChange={(e) => setForm({ ...form, industry: e.target.value })} />}</Field>
        <Field label="Size">{(p) => <Input id={p.id} value={val('size')} onChange={(e) => setForm({ ...form, size: e.target.value })} />}</Field>
        <Field label="Region">{(p) => <Input id={p.id} value={val('region')} onChange={(e) => setForm({ ...form, region: e.target.value })} />}</Field>
        <Field label="Titles" hint="Comma-separated">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={val('titles')} onChange={(e) => setForm({ ...form, titles: e.target.value })} />}</Field>
        <Field label="Pains they have" hint="Comma-separated" className="sm:col-span-2">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={val('pains')} onChange={(e) => setForm({ ...form, pains: e.target.value })} />}</Field>
      </div>
    </Sheet>
  );
}

