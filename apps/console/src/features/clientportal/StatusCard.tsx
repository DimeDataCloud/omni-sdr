// Client portal: where my setup stands, in one word. It reads the same client status the dev portal moves, through a narrow
// read that returns the word and the live setup version, never the client record.
import { api } from '@/lib/api';
import type { Scope } from '@/lib/api/client';
import type { ClientStatusWord } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { Badge, Card } from '@/components/ui';

const TONE: Record<ClientStatusWord, 'success' | 'warning' | 'neutral' | 'info'> = { 'Setting up': 'warning', 'Approval week': 'info', Live: 'success', Paused: 'neutral' };
const WHAT: Record<ClientStatusWord, string> = {
  'Setting up': 'We are getting your system ready. Nothing is sent to your customers yet.',
  'Approval week': 'You approve every message before it goes out this week.',
  Live: 'Your system is running.',
  Paused: 'Your system is paused. Nothing new is sent until it is switched back on.',
};
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export function StatusCard({ scope }: { scope: Scope }) {
  const q = useQuery(() => api.clientStatus(scope), [scope.workspaceId], { key: `client-status:${scope.workspaceId}` });
  const s = q.data;
  if (!s) return null;   // loading, no record, or ended: show nothing rather than a guess
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <Badge tone={TONE[s.word]}>{s.word}</Badge>
      <p className="min-w-0 flex-1 text-sm">{WHAT[s.word]}</p>
      {s.appliedVersion !== null && s.appliedAt && <p className="text-sm text-muted">Setup version {s.appliedVersion}, updated {day(s.appliedAt)}</p>}
    </Card>
  );
}
