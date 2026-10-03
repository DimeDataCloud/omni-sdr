// Hand a conversation to a closer (SDR-PIVOT P4): a draft summary from what the thread holds, the people who can take
// it, and the answers that qualified it. The closer gets it on their Handoffs page with an accept-by time.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { HandoffReason } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { ROLE } from '@/lib/format';
import { Button, ErrorState, Field, Input, Select, Sheet, Skeleton, Textarea } from '@/components/ui';
import { REASON } from './HandoffsPage';

const QUESTIONS = [['need', 'What they need'], ['timing', 'Timing'], ['decisionMaker', 'Decision-maker']] as const;

export function HandoffSheet({ open, onOpenChange, conversationId, who, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; conversationId: string; who: string; onDone?: () => void;
}) {
  const { scope } = useWorkspace();
  const draft = useQuery(() => api.handoffDraft(scope, conversationId), [scope.workspaceId, conversationId, open], { enabled: open });
  const [closerId, setCloserId] = useState('');
  const [reason, setReason] = useState<HandoffReason>('qualified');
  const [summary, setSummary] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !draft.data) return;
    setCloserId(draft.data.closers[0]?.id ?? ''); setReason(draft.data.reason); setSummary(draft.data.summary); setAnswers({}); setErr(null);
  }, [open, draft.data]);
  const submit = async () => {
    if (!closerId) { setErr('Pick who takes it.'); return; }
    if (!summary.trim()) { setErr('Write a line about why it is ready.'); return; }
    setBusy(true); setErr(null);
    try {
      const filled = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      await api.createHandoff(scope, conversationId, { closerId, reason, summary: summary.trim(), answers: filled });
      onOpenChange(false);
      toast.success(`Handed ${who} to ${draft.data?.closers.find((c) => c.id === closerId)?.email ?? 'the closer'}.`);
      onDone?.();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Hand off ${who}`} description="The closer sees this card, the whole thread and your answers. They have until the SLA to accept it."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!draft.data?.closers.length} onClick={submit}>Hand off</Button></>}>
      <ErrorState error={draft.error} onRetry={draft.reload} />
      {!draft.data ? <Skeleton className="h-64 rounded-xl" /> : !draft.data.closers.length ? (
        <p className="text-sm text-muted">Nobody in this workspace can take handoffs yet. Invite someone as a closer in Settings.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who takes it">{(p) => (
              <Select id={p.id} value={closerId} onChange={(e) => setCloserId(e.target.value)}>
                {draft.data!.closers.map((c) => <option key={c.id} value={c.id}>{c.email} · {ROLE[c.role].label}{c.hasBookingLink ? '' : ' (no booking link)'}</option>)}
              </Select>
            )}</Field>
            <Field label="Why now">{(p) => (
              <Select id={p.id} value={reason} onChange={(e) => setReason(e.target.value as HandoffReason)}>
                {(Object.keys(REASON) as HandoffReason[]).map((r) => <option key={r} value={r}>{REASON[r]}</option>)}
              </Select>
            )}</Field>
          </div>
          <Field label="Summary" hint="A first draft from the thread. Edit it so the closer can act without reading everything." error={err}>{(p) => (
            <Textarea id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} rows={5} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} />
          )}</Field>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium">What qualified them (optional)</legend>
            {QUESTIONS.map(([k, label]) => (
              <Field key={k} label={label}>{(p) => (
                <Input id={p.id} maxLength={200} value={answers[k] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [k]: e.target.value }))} />
              )}</Field>
            ))}
          </fieldset>
        </div>
      )}
    </Sheet>
  );
}
