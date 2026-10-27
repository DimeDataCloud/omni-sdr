// Client portal, "My setup": what the system does for me, read-only. It reads the live version only: no drafts, no review
// notes, no reply notes. A change is an email to us, never an edit here.
import { api } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { askUsLink } from './askUs';
import { Card, EmptyState, ErrorState, NoAccess, Page, PageHeader, SkeletonList } from '@/components/ui';
import { Settings2 } from 'lucide-react';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export default function MySetupPage() {
  const { scope, role } = useWorkspace();
  const ok = role === 'client_viewer' || role === 'admin' || role === 'operator';
  const q = useQuery(() => api.clientSetup(scope), [scope.workspaceId], { key: `client-setup:${scope.workspaceId}`, enabled: ok });
  if (!ok) return <Page><NoAccess what="this page" /></Page>;
  const s = q.data;
  const link = s ? askUsLink(`Change to my setup (version ${s.appliedVersion})`, 'What I would like changed:\n\n') : null;

  return (
    <Page>
      <PageHeader title="My setup" subtitle="What your system does for you today. To change anything, ask us." />
      {q.error ? <ErrorState error={q.error} onRetry={q.reload} />
        : q.data === undefined ? <SkeletonList rows={4} />
        : !s ? <EmptyState icon={<Settings2 className="size-5" aria-hidden />} title="Nothing is switched on yet" body="Your setup shows here once it goes live." />
        : (
          <>
            <Card className="grid gap-4 p-4">
              <Row label="What it does for you" value={s.services} />
              <Row label="Hours" value={`${s.hours} (${s.timezone})`} />
              <Row label="Booking" value={s.booking} />
              <Row label="Who takes over a conversation" value={s.handoffRoute} />
              <Row label="Who gets alerts" value={s.alertContacts} />
              <Row label="How it sounds" value={s.tone} />
            </Card>
            <Card className="grid gap-2 p-4">
              <p className="text-sm">Setup version {s.appliedVersion}, updated {day(s.appliedAt)}.</p>
              {s.history.length > 1 && <ul className="text-sm text-muted">{s.history.map((h) => <li key={h.version}>Version {h.version}, {day(h.appliedAt)}</li>)}</ul>}
              {link ? <p><a className="text-sm underline" href={link}>Ask us to change this</a></p> : <p className="text-sm text-muted">To change anything, ask your account contact.</p>}
            </Card>
          </>
        )}
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><p className="text-sm text-muted">{label}</p><p className="whitespace-pre-line">{value || 'Not set'}</p></div>;
}
