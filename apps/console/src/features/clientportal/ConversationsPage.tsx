// Client portal, "Conversations": names, masked phone numbers and a one-line summary. Full transcripts only by request
// (decided default), so the row carries no message body and the request is a prefilled email.
import { MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import type { ClientConversation } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { askUsLink } from './askUs';
import { Badge, Card, EmptyState, ErrorState, NoAccess, Page, PageHeader, SkeletonList } from '@/components/ui';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function ConversationsPage() {
  const { scope, role } = useWorkspace();
  const ok = role === 'client_viewer' || role === 'admin' || role === 'operator';
  const q = useQuery(() => api.clientConversations(scope), [scope.workspaceId], { key: `client-convos:${scope.workspaceId}`, enabled: ok });
  if (!ok) return <Page><NoAccess what="this page" /></Page>;
  return (
    <Page>
      <PageHeader title="Conversations" subtitle="Who wrote in and what it was about. Phone numbers show their last four digits. Ask us for a full transcript." />
      {q.error ? <ErrorState error={q.error} onRetry={q.reload} />
        : !q.data ? <SkeletonList rows={4} />
        : q.data.length === 0 ? <EmptyState icon={<MessageSquare className="size-5" aria-hidden />} title="No conversations yet" body="They show here as people write in." />
        : <ul className="grid gap-3">{q.data.map((c) => <li key={c.id}><Row c={c} /></li>)}</ul>}
    </Page>
  );
}

function Row({ c }: { c: ClientConversation }) {
  const link = askUsLink(`Transcript request: ${c.name}`, `Please send me the full conversation with ${c.name} (${c.maskedPhone ?? 'no phone on file'}), last active ${when(c.lastAt)}.`);
  return (
    <Card className="grid gap-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{c.name}</h2>
        <Badge tone={c.status === 'open' ? 'warning' : 'success'}>{c.status === 'open' ? 'Waiting' : 'Handled'}</Badge>
        <span className="text-sm text-muted">{c.maskedPhone ?? 'No phone on file'} · {c.channel} · {when(c.lastAt)}</span>
      </div>
      <p className="text-sm">{c.summary || 'No summary yet.'}</p>
      {link && <p><a className="text-sm underline" href={link}>Request the transcript</a></p>}
    </Card>
  );
}
