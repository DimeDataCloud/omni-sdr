// Workspace picker (DESIGN 6.2): which client needs attention, at a glance.
import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { Plus, CheckCheck, Inbox, CalendarDays, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { initials } from '@/lib/format';
import { Avatar, Button, Page, PageHeader, Skeleton, cx, listItem, listStagger } from '@/components/ui';
import { NewWorkspaceSheet } from '@/components/shell/AppShell';

function WorkspaceCard({ orgId, id, name }: { orgId: string; id: string; name: string }) {
  const { org } = useSession();
  const scope = { orgId, workspaceId: id };
  const can = org?.role !== 'client_viewer';
  const stats = useQuery(async () => {
    const [a, i, m] = await Promise.all([can ? api.approvals(scope, { status: 'review' }) : null, can ? api.inbox(scope) : null, api.meetings(scope, 'upcoming')]);
    return { review: a?.counts.review ?? 0, replies: i?.length ?? 0, urgent: i?.filter((r) => (r.slaMinutesRemaining ?? 999) < 60).length ?? 0, meetings: m.length };
  }, [id]);
  const s = stats.data;
  return (
    <motion.li variants={listItem}>
      <Link to={`/w/${id}/${can ? 'home' : 'analytics'}`} className={cx('card lift group flex h-full flex-col p-5', s?.urgent && 'ring-2 ring-danger/40')}>
        <div className="flex items-center gap-3">
          <Avatar text={initials(name)} size={40} className="rounded-lg" />
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{name}</h2>
          <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
        </div>
        {!s ? <Skeleton className="mt-4 h-10" /> : (
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            {can && <div className="rounded-lg bg-sunken py-2"><dt className="flex items-center justify-center gap-1 text-xs text-muted"><CheckCheck className="size-3.5" aria-hidden />To approve</dt><dd className="tabular text-lg font-semibold">{s.review}</dd></div>}
            {can && <div className={cx('rounded-lg py-2', s.urgent ? 'bg-danger-soft text-danger' : 'bg-sunken')}><dt className={cx('flex items-center justify-center gap-1 text-xs', !s.urgent && 'text-muted')}><Inbox className="size-3.5" aria-hidden />Replies</dt><dd className="tabular text-lg font-semibold">{s.replies}</dd></div>}
            <div className="rounded-lg bg-sunken py-2"><dt className="flex items-center justify-center gap-1 text-xs text-muted"><CalendarDays className="size-3.5" aria-hidden />Meetings</dt><dd className="tabular text-lg font-semibold">{s.meetings}</dd></div>
          </dl>
        )}
        {s?.urgent ? <p className="mt-3 text-sm font-medium text-danger">A meeting request is due within the hour.</p> : null}
      </Link>
    </motion.li>
  );
}

export default function WorkspacesPage() {
  const { org, loading } = useSession();
  const [adding, setAdding] = useState(false);
  return (
    <div className="ambient min-h-dvh">
      <Page>
        <div className="mb-6 flex items-center gap-2">{org?.role === 'client_viewer' ? <Avatar text={initials(org.name)} size={28} className="rounded-lg" />
          : <img src="/logo-mark-small.svg" alt="" width={28} height={28} />}<span className="font-semibold">{org?.role === 'client_viewer' ? org.name : 'Omni-SDR'}</span></div>
        <PageHeader title="Workspaces" subtitle={org ? `${org.name} · ${org.accountType === 'agency' ? 'one workspace per client' : 'owner account'}` : undefined}
          actions={org?.role === 'admin' && org.accountType === 'agency' && <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>New client workspace</Button>} />
        {loading || !org ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div> : (
          <motion.ul variants={listStagger} initial="hidden" animate="show" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {org.workspaces.map((w) => <WorkspaceCard key={w.id} orgId={org.id} id={w.id} name={w.name} />)}
          </motion.ul>
        )}
      </Page>
      <NewWorkspaceSheet open={adding} onOpenChange={setAdding} />
    </div>
  );
}
