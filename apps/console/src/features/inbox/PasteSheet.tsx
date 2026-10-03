// Paste a LinkedIn message (SDR-PIVOT P7). LinkedIn has no general messaging API and automating a personal inbox
// breaks its terms, so Omni never reads or sends there: paste what you received, answer from your playbook, and copy
// the answer back into LinkedIn yourself.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/session';
import { Button, Field, Input, Sheet, Textarea } from '@/components/ui';

export function PasteSheet({ open, onOpenChange, onPasted }: { open: boolean; onOpenChange: (v: boolean) => void; onPasted?: (id: string) => void }) {
  const { scope } = useWorkspace();
  const [name, setName] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  useEffect(() => { if (open) { setName(''); setProfileUrl(''); setEmail(''); setBody(''); setErr(null); } }, [open]);
  const submit = async () => {
    if (!name.trim() || !body.trim()) { setErr({ message: 'Add their name and the message.' }); return; }
    setBusy(true); setErr(null);
    try {
      const out = await api.pasteLinkedIn(scope, { name: name.trim(), profileUrl: profileUrl.trim() || null, email: email.trim() || null, body });
      toast.success(`Added ${name.trim()}'s message to the inbox.`);
      onOpenChange(false); onPasted?.(out.id);
    } catch (e) {
      const x = e as { message: string; details?: { field?: string } };
      setErr({ field: x.details?.field, message: x.message });
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Paste a LinkedIn message"
      description="Omni never reads or sends on LinkedIn. Paste what they wrote; answer from your playbook; copy the answer back into LinkedIn."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Add to inbox</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Their name">{(p) => <Input id={p.id} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Email (optional)" hint="Only if they gave it.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} type="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        </div>
        <Field label="Profile link (optional)" hint="Keeps their messages in one thread." error={err?.field === 'profileUrl' ? err.message : null}>{(p) => (
          <Input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} inputMode="url" placeholder="https://www.linkedin.com/in/…" maxLength={300}
            value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} />
        )}</Field>
        <Field label="Their message" error={err && err.field !== 'profileUrl' ? err.message : null}>{(p) => (
          <Textarea id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} rows={6} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
        )}</Field>
      </div>
    </Sheet>
  );
}
