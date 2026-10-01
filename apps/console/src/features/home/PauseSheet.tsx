import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/session';
import { Button, Sheet, Textarea } from '@/components/ui';

/** Pause all sending in the workspace (a hold). The one control on Home that asks before it acts. */
export function PauseSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { scope } = useWorkspace();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.setHold(scope, { scopeType: 'workspace', reason: reason.trim() || 'Paused from Home' }); onOpenChange(false); setReason(''); toast.success('Paused. Nothing sends from this workspace until an admin resumes it.'); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Pause all sending?" description="Approved drafts wait. Replies still arrive, and you can keep approving. An admin resumes it."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger-solid" loading={busy} onClick={submit}>Pause sending</Button></>}>
      <label htmlFor="hold-reason" className="mb-1.5 block text-sm font-medium">Reason (your team sees it)</label>
      <Textarea id="hold-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reviewing copy before the next batch" />
    </Sheet>
  );
}
