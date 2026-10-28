// Rep portal, prospect lists (DESIGN-frontend-4-sales-portal, screen 7). Fictional rows only: real prospect data needs
// Christian's approval and a privacy page line first. A rep sees only their own prospects; the store enforces it.
import { useState } from 'react';
import { toast } from 'sonner';
import { ListTodo } from 'lucide-react';
import { api } from '@/lib/api';
import type { Prospect, ProspectStatus } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { salesAccess } from './access';
import { Banner, Button, Card, EmptyState, ErrorState, Field, Input, NoAccess, Page, PageHeader, Select, SkeletonList, Textarea } from '@/components/ui';

const STATUS_LABEL: Record<ProspectStatus, string> = { new: 'New', contacted: 'Contacted', audit_run: 'Audit run', results_call: 'Results call', proposed: 'Proposed', signed: 'Signed' };
const ORDER = Object.keys(STATUS_LABEL) as ProspectStatus[];
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Not yet');

export default function ProspectsPage() {
  const { scope, role } = useWorkspace();
  const access = salesAccess(role);
  const q = useQuery(() => api.prospects(scope.orgId), [scope.orgId], { key: `prospects:${scope.orgId}`, enabled: access.portal });
  if (!access.portal) return <Page><NoAccess what="the sales portal" /></Page>;
  const rows = [...(q.data ?? [])].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

  return (
    <Page>
      <PageHeader title="Prospects" subtitle="Who to call, what we saw, and where each one stands. Set the status when something changes." />
      <Banner tone="info" title="Fictional prospects">These businesses are made up. Real names load only after Christian approves prospect data and the privacy page says so.</Banner>
      {q.error ? <ErrorState error={q.error} onRetry={q.reload} />
        : !q.data ? <SkeletonList rows={3} />
        : rows.length === 0 ? <EmptyState icon={<ListTodo className="size-5" aria-hidden />} title="No prospects loaded" body="Lists are loaded for you by niche. Ask Christian if yours is empty." />
        : <ul className="grid gap-3">{rows.map((p) => <li key={p.id + p.status}><ProspectCard p={p} onSaved={q.reload} /></li>)}</ul>}
    </Page>
  );
}

function ProspectCard({ p, onSaved }: { p: Prospect; onSaved: () => void }) {
  const { scope } = useWorkspace();
  const [nextStep, setNextStep] = useState(p.nextStep);
  const [notes, setNotes] = useState(p.notes);
  const [busy, setBusy] = useState(false);
  const patch = async (body: Parameters<typeof api.patchProspect>[2], ok: string) => {
    setBusy(true);
    try { await api.patchProspect(scope.orgId, p.id, body); toast.success(ok); onSaved(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card className="grid gap-3 p-4">
      <div>
        <h2 className="font-medium">{p.business}</h2>
        <p className="text-sm text-muted">{p.niche} · Last touch: {day(p.lastTouch)}</p>
        <p className="mt-1 text-sm">Signal: {p.signal}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">{(f) => (
          <Select {...f} value={p.status} disabled={busy} onChange={(e) => void patch({ status: e.target.value as ProspectStatus }, `${p.business} is now ${STATUS_LABEL[e.target.value as ProspectStatus].toLowerCase()}`)}>
            {ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>)}
        </Field>
        <Field label="Next step">{(f) => <Input {...f} value={nextStep} maxLength={200} onChange={(e) => setNextStep(e.target.value)} />}</Field>
        <Field label="Notes" className="sm:col-span-2">{(f) => <Textarea {...f} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
      <div><Button size="sm" loading={busy} disabled={nextStep === p.nextStep && notes === p.notes} onClick={() => void patch({ nextStep, notes }, 'Saved')}>Save</Button></div>
    </Card>
  );
}
