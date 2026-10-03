// Playbook (SDR-PIVOT P3): the workspace's own replies per category, the qualification script, and how close each
// category is to earning auto-send. Auto-send stays off; the counter only shows the evidence.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BookOpenText, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Scope } from '@/lib/api/client';
import type { AutonomyRow, PlaybookCategory, PlaybookReply } from '@/lib/api/types';
import { useQuery, prefetchQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, IconButton, Input, Meter, Page, PageHeader, Select, Sheet, SkeletonList, Textarea } from '@/components/ui';

export const CATEGORY: Record<PlaybookCategory, string> = {
  meeting_request: 'Meeting request', positive_inquiry: 'Interested', question: 'Question', objection: 'Objection', referral: 'Referral',
  out_of_office: 'Out of office', not_interested: 'Not interested', wrong_person: 'Wrong person', unclassified: 'Unsorted',
};

/** Warmed on hover of the Playbook nav link. */
export const prefetch = (s: Scope) => prefetchQuery(`playbook:${s.workspaceId}`, () => api.playbook(s));

export default function PlaybookPage() {
  const { scope, can } = useWorkspace();
  const pb = useQuery(() => api.playbook(scope), [scope.workspaceId], { key: `playbook:${scope.workspaceId}` });
  const [editing, setEditing] = useState<PlaybookReply | 'new' | null>(null);
  const edit = can('build');
  const byCat = new Map<string, PlaybookReply[]>();
  for (const r of pb.data?.replies ?? []) byCat.set(r.category, [...(byCat.get(r.category) ?? []), r]);
  const auto = new Map((pb.data?.autonomy.categories ?? []).map((a) => [a.category, a]));
  return (
    <Page>
      <PageHeader title="Playbook" subtitle="Your replies, by what the person asked. Omni fills in the details; a person approves every reply. Opt-outs are never answered."
        actions={edit ? <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>New reply</Button> : undefined} />
      <ErrorState error={pb.error} onRetry={pb.reload} />
      {pb.loading ? <SkeletonList rows={4} /> : pb.data && (
        <div className="space-y-6">
          {!pb.data.replies.length && <EmptyState icon={<BookOpenText className="size-5" aria-hidden />} title="No replies yet" body="Write one reply per kind of message you get, in your own words." />}
          {(Object.keys(CATEGORY) as PlaybookCategory[]).filter((c) => byCat.has(c)).map((c) => (
            <section key={c} aria-label={CATEGORY[c]}>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h2 className="text-base font-semibold">{CATEGORY[c]}</h2>
                <AutonomyBadge row={auto.get(c)} window={pb.data!.autonomy.window} rate={pb.data!.autonomy.rate} />
              </div>
              <ul className="space-y-2">
                {byCat.get(c)!.map((r) => (
                  <li key={r.id}>
                    <Card className="flex items-start gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{r.name}{r.asksNextQuestion && <Badge className="ml-2">Asks the next question</Badge>}</p>
                        <p className="reading mt-1 whitespace-pre-wrap text-sm text-muted">{r.body}</p>
                      </div>
                      {edit && <IconButton label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil className="size-4" aria-hidden /></IconButton>}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <Questions initial={pb.data.questions.map((q) => ({ key: q.key, question: q.question }))} editable={edit} />
          <p className="text-xs text-muted">
            Fields you can use: {pb.data.fields.map((f) => `{${f}}`).join(', ')}. A reply that needs a field Omni doesn’t have for that person isn’t offered.
            Auto-send is off. A category shows as ready after {Math.round(pb.data.autonomy.rate * 100)}% of its last {pb.data.autonomy.window} replies were approved unedited
            (website-form replies never count, since anyone can type any address into a form).
          </p>
        </div>
      )}
      <ReplySheet open={editing !== null} reply={editing === 'new' ? null : editing} onOpenChange={(v) => { if (!v) setEditing(null); }} />
    </Page>
  );
}

function AutonomyBadge({ row, window, rate }: { row?: AutonomyRow; window: number; rate: number }) {
  if (!row) return <span className="text-xs text-muted">No decisions yet</span>;
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <Meter value={row.unedited} max={window} label={`${row.unedited} of the last ${row.decided} approved unedited`} className="w-28" />
      {row.unedited}/{row.decided} unedited{row.eligible ? '' : ` · ready at ${Math.round(rate * 100)}% of ${window}`}
      {row.eligible && <Badge tone="success">Ready for auto-send</Badge>}
    </span>
  );
}

function ReplySheet({ open, reply, onOpenChange }: { open: boolean; reply: PlaybookReply | null; onOpenChange: (v: boolean) => void }) {
  const { scope } = useWorkspace();
  const [category, setCategory] = useState<PlaybookCategory>('question');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [asks, setAsks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setCategory(reply?.category ?? 'question'); setName(reply?.name ?? ''); setBody(reply?.body ?? ''); setAsks(reply?.asksNextQuestion ?? false); setErr(null);
  }, [open, reply]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (reply) await api.patchPlaybookReply(scope, reply.id, { name, body, asksNextQuestion: asks });
      else await api.createPlaybookReply(scope, { category, name, body, asksNextQuestion: asks });
      toast.success('Saved.'); onOpenChange(false);
    } catch (e) {
      const x = e as { message: string; details?: { field?: string } };
      setErr({ field: x.details?.field, message: x.message });
    } finally { setBusy(false); }
  };
  const archive = async () => {
    if (!reply) return;
    setBusy(true);
    try { await api.archivePlaybookReply(scope, reply.id); toast.success('Archived.'); onOpenChange(false); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={reply ? `Edit “${reply.name}”` : 'New reply'}
      description="Write it the way you would answer yourself. Use {first_name} and the other fields; Omni fills them in for each person."
      footer={<>
        {reply && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-4" aria-hidden />} loading={busy} onClick={archive}>Archive</Button>}
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save}>Save</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="When they…">{(p) => (
            <Select id={p.id} value={category} disabled={Boolean(reply)} onChange={(e) => setCategory(e.target.value as PlaybookCategory)}>
              {(Object.keys(CATEGORY) as PlaybookCategory[]).map((c) => <option key={c} value={c}>{CATEGORY[c]}</option>)}
            </Select>
          )}</Field>
          <Field label="Name" error={err?.field === 'name' ? err.message : null}>{(p) => (
            <Input id={p.id} aria-invalid={p.invalid} aria-describedby={p.describedBy} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          )}</Field>
        </div>
        <Field label="Reply" error={err && err.field !== 'name' ? err.message : null}>{(p) => (
          <Textarea id={p.id} aria-invalid={p.invalid} aria-describedby={p.describedBy} rows={7} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
        )}</Field>
        <Checkbox checked={asks} onChange={setAsks} label="End with the next qualification question" />
      </div>
    </Sheet>
  );
}

function Questions({ initial, editable }: { initial: { key: string; question: string }[]; editable: boolean }) {
  const { scope } = useWorkspace();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(initial); }, [JSON.stringify(initial)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const save = async () => {
    const clean = rows.filter((r) => r.question.trim()).map((r) => ({ key: r.key, question: r.question.trim() }));
    setBusy(true);
    try { await api.setQuestions(scope, clean); toast.success('Questions saved.'); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section aria-label="Qualification questions">
      <h2 className="mb-1 text-base font-semibold">Qualification questions</h2>
      <p className="mb-3 text-sm text-muted">Asked one at a time, in this order, at the end of replies that are set to ask. Up to four.</p>
      <Card className="space-y-2 p-4">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="tabular w-5 text-sm text-muted">{i + 1}.</span>
            <Input aria-label={`Question ${i + 1}`} value={r.question} disabled={!editable} maxLength={300}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
            {editable && <IconButton label={`Remove question ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></IconButton>}
          </div>
        ))}
        {!rows.length && <p className="text-sm text-muted">No questions yet.</p>}
        {editable && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={rows.length >= 4}
              onClick={() => setRows([...rows, { key: `q${Date.now().toString(36).slice(-4)}`.replace(/[^a-z_]/g, 'x'), question: '' }])}>Add a question</Button>
            <Button size="sm" className="ml-auto" disabled={!dirty} loading={busy} onClick={save}>Save questions</Button>
          </div>
        )}
      </Card>
    </section>
  );
}
