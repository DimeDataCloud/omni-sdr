// The suggested reply under a conversation in the Inbox (SDR-PIVOT P3): a playbook reply filled in for this person,
// which a person approves as is, edits, or discards. Approving records the words; nothing is sent from here yet, so the
// approved text is offered to copy.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, MessageSquareText, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { ReplyDraft } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { Badge, Button, Card, Textarea } from '@/components/ui';

export function ReplyPanel({ conversationId, channel }: { conversationId: string; channel: string }) {
  const { scope, can } = useWorkspace();
  const pending = useQuery(() => api.replyDraft(scope, conversationId), [scope.workspaceId, conversationId]);
  const [approved, setApproved] = useState<ReplyDraft | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const draft = pending.data ?? null;
  useEffect(() => { setText(draft?.bodyProposed ?? ''); }, [draft?.id, draft?.bodyProposed]);
  useEffect(() => { setApproved(null); setErr(null); }, [conversationId]);
  if (!can('inbox_draft')) return null;
  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied.'), () => toast.error('Couldn’t copy.'));

  if (approved) {
    return (
      <Card className="p-5">
        <h3 className="mb-2 flex items-center gap-2 text-base font-semibold"><Check className="size-4" aria-hidden />Reply approved{approved.edited ? ' (edited)' : ''}</h3>
        <p className="reading whitespace-pre-wrap text-sm">{approved.bodyFinal}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<Copy className="size-4" aria-hidden />} onClick={() => copy(approved.bodyFinal ?? '')}>Copy reply</Button>
          <span className="text-xs text-muted">Sending from Omni comes next; for now, paste it into your {channel === 'email' ? 'mail' : channel.replace('_', ' ')} reply.</span>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold"><MessageSquareText className="size-4" aria-hidden />Suggested reply</h3>
        {draft && <Badge>From your playbook</Badge>}
        {draft && !draft.countsForAutonomy && <Badge tone="warning">Always needs a person</Badge>}
      </div>
      {!draft ? (<>
        <p className="text-sm text-muted">Fill in your playbook’s reply for what this person asked.</p>
        <Button size="sm" className="mt-3" loading={busy === 'suggest'} onClick={() => run('suggest', () => api.createReplyDraft(scope, conversationId))}>Suggest a reply</Button>
      </>) : (<>
        <Textarea aria-label="Reply" rows={6} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" loading={busy === 'approve'} icon={<Check className="size-4" aria-hidden />}
            onClick={() => run('approve', async () => { setApproved(await api.approveReplyDraft(scope, draft.id, text === draft.bodyProposed ? undefined : text)); })}>
            {text === draft.bodyProposed ? 'Approve' : 'Approve edited'}
          </Button>
          <Button size="sm" variant="ghost" loading={busy === 'discard'} icon={<X className="size-4" aria-hidden />}
            onClick={() => run('discard', () => api.discardReplyDraft(scope, draft.id))}>Discard</Button>
          <span className="text-xs text-muted">Unedited approvals count toward this kind of reply earning auto-send.</span>
        </div>
      </>)}
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </Card>
  );
}
