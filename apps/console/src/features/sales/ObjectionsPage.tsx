// Rep portal, objection answers and the never-say card (DESIGN-frontend-4-sales-portal, screens 5 and 6).
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { useWorkspace } from '@/lib/session';
import { salesAccess } from './access';
import { NEVER_SAY, OBJECTIONS, OBJECTION_METHOD, SWAPS } from './playbookData';
import { Button, Card, EmptyState, Field, Input, NoAccess, Page, PageHeader } from '@/components/ui';

const copy = async (text: string) => {
  try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error('Could not copy. Select the text and copy it by hand.'); }
};

export default function ObjectionsPage() {
  const { role } = useWorkspace();
  const [term, setTerm] = useState('');
  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? OBJECTIONS.filter((o) => `${o.heard} ${o.answer}`.toLowerCase().includes(t)) : OBJECTIONS;
  }, [term]);

  if (!salesAccess(role).portal) return <Page><NoAccess what="the sales portal" /></Page>;

  return (
    <Page>
      <PageHeader title="Objections" subtitle={OBJECTION_METHOD} />
      <Field label="Search what you heard">{(p) => <Input {...p} type="search" value={term} onChange={(e) => setTerm(e.target.value)} />}</Field>
      {shown.length === 0
        ? <EmptyState title="No match" body="Try one word from what the owner said, such as price or spam." />
        : (
          <ul className="grid gap-3">
            {shown.map((o) => (
              <li key={o.id}>
                <Card className="grid gap-2 p-4">
                  <h2 className="font-medium">{o.heard}</h2>
                  <p className="text-sm">{o.answer}</p>
                  <div><Button size="sm" onClick={() => void copy(o.answer)}><Copy className="size-4" aria-hidden />Copy answer</Button></div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      <Card className="grid gap-3 p-4">
        <h2 className="font-medium">Never say</h2>
        <ul className="list-disc pl-5 text-sm">{NEVER_SAY.map((r) => <li key={r}>{r}</li>)}</ul>
        <h3 className="text-sm font-medium">Say this instead</h3>
        <ul className="grid gap-2 text-sm">
          {SWAPS.map((s) => (
            <li key={s.instead}><span className="text-muted">Not &quot;{s.instead}&quot;. </span>{s.say}</li>
          ))}
        </ul>
        <p className="text-sm text-muted">If a prospect pushes, the answer is always the same: we measure it, we show you at day 14, and you decide from your own numbers.</p>
      </Card>
    </Page>
  );
}
