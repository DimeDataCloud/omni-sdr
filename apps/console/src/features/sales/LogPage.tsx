// Rep portal, daily log (DESIGN-frontend-4-sales-portal, screen 8). One row per rep per day: the counts from the first-week
// checklist and the objection words owners actually used. Each rep sees and edits only their own day.
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { SalesLog, SalesLogInput } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { salesAccess } from './access';
import { Button, Card, ErrorState, Field, Input, NoAccess, Page, PageHeader, SkeletonList, Textarea } from '@/components/ui';

type Count = 'attempts' | 'conversations' | 'audits' | 'resultsCalls' | 'pilotsProposed' | 'pilotsSigned';
const COUNTS: { key: Count; label: string }[] = [
  { key: 'attempts', label: 'Attempts' }, { key: 'conversations', label: 'Conversations' }, { key: 'audits', label: 'Audits run' },
  { key: 'resultsCalls', label: 'Results calls' }, { key: 'pilotsProposed', label: 'Pilots proposed' }, { key: 'pilotsSigned', label: 'Pilots signed' },
];
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function LogPage() {
  const { scope, role } = useWorkspace();
  const access = salesAccess(role);
  const [date, setDate] = useState(todayIso);
  const q = useQuery(() => api.salesLog(scope.orgId, date), [scope.orgId, date], { key: `sales-log:${scope.orgId}:${date}`, enabled: access.portal && /^\d{4}-\d{2}-\d{2}$/.test(date) });
  if (!access.portal) return <Page><NoAccess what="the sales portal" /></Page>;

  return (
    <Page>
      <PageHeader title="Daily log" subtitle="Your numbers for the day and the exact words owners used when they pushed back." />
      <Field label="Day">{(f) => <Input {...f} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      {q.error ? <ErrorState error={q.error} onRetry={q.reload} />
        : !q.data ? <SkeletonList rows={3} />
        : <LogForm key={`${q.data.date}:${JSON.stringify(q.data)}`} log={q.data} orgId={scope.orgId} onSaved={q.reload} />}
    </Page>
  );
}

function LogForm({ log, orgId, onSaved }: { log: SalesLog; orgId: string; onSaved: () => void }) {
  const [counts, setCounts] = useState<Record<Count, string>>(() => Object.fromEntries(COUNTS.map((c) => [c.key, String(log[c.key])])) as Record<Count, string>);
  const [words, setWords] = useState(log.objectionWords);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const input: SalesLogInput = { date: log.date, objectionWords: words,
      ...(Object.fromEntries(COUNTS.map((c) => [c.key, counts[c.key].trim() === '' ? 0 : Number(counts[c.key])])) as Record<Count, number>) };
    setBusy(true);
    try { await api.putSalesLog(orgId, input); toast.success('Day saved'); onSaved(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card className="grid gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {COUNTS.map((c) => (
          <Field key={c.key} label={c.label}>{(f) => <Input {...f} inputMode="numeric" value={counts[c.key]} onChange={(e) => setCounts((x) => ({ ...x, [c.key]: e.target.value.replace(/[^0-9]/g, '') }))} />}</Field>
        ))}
      </div>
      <Field label="Objection words heard" hint="What owners said, in their words. Up to 500 characters.">{(f) => <Textarea {...f} value={words} maxLength={500} onChange={(e) => setWords(e.target.value)} />}</Field>
      <div><Button variant="primary" loading={busy} onClick={() => void save()}>Save day</Button></div>
    </Card>
  );
}
