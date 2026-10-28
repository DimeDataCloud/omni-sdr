// Rep portal, deals and close-a-sale (DESIGN-frontend-4-sales-portal, screen 9). The one write a rep makes into the client
// record: it creates a client with status closed, which then shows in the Dev portal Sales view. The form has no price and
// no rep field on purpose: the server takes the amount from the price config and the rep from the session.
import { useState } from 'react';
import { toast } from 'sonner';
import { Handshake, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { invalidate } from '@/lib/api/client';
import type { CloseSaleInput, DealLevel, PriceConfig, SalesDeal } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { STATUS, errText, money } from '../clients/clientBits';
import { salesAccess } from './access';
import { Badge, Banner, Button, EmptyState, ErrorState, Field, Input, NoAccess, Page, PageHeader, Select, Sheet, SkeletonList, Textarea } from '@/components/ui';

const LEVELS: { level: 1 | 2 | 3; value: DealLevel }[] = [{ level: 1, value: 'L1 pilot' }, { level: 2, value: 'L2 recurring' }, { level: 3, value: 'L3 outcome' }];
const BLANK: CloseSaleInput = { business: '', niche: '', level: 'L1 pilot', contactName: '', contactEmail: '', notes: '' };

export default function DealsPage() {
  const { scope, role } = useWorkspace();
  const access = salesAccess(role);
  const [open, setOpen] = useState(false);
  const deals = useQuery(() => api.salesDeals(scope.orgId), [scope.orgId], { key: `sales-deals:${scope.orgId}`, enabled: access.portal });
  const prices = useQuery(() => api.priceConfig(scope.orgId), [scope.orgId], { key: `price-config:${scope.orgId}`, enabled: access.portal });

  if (!access.portal) return <Page><NoAccess what="the sales portal" /></Page>;
  const rows = deals.data ?? [];

  return (
    <Page>
      <PageHeader title={access.allDeals ? 'All deals' : 'My deals'} subtitle="Close a sale here and it lands in the dev portal for onboarding. You see where each one is after that."
        actions={<Button variant="primary" onClick={() => setOpen(true)} disabled={!prices.data}><Plus className="size-4" aria-hidden />Close a sale</Button>} />
      <Banner tone="info" title="Demo data">Deals are fictional and live in this browser only.</Banner>
      {deals.error ? <ErrorState error={deals.error} onRetry={deals.reload} />
        : !deals.data ? <SkeletonList rows={3} />
        : rows.length === 0 ? <EmptyState icon={<Handshake className="size-5" aria-hidden />} title="No deals yet" body="When an owner says yes, close the sale here." />
        : <ul className="grid gap-3">{rows.map((d) => <DealRow key={d.id} d={d} />)}</ul>}
      {prices.data && <CloseSheet open={open} onOpenChange={setOpen} orgId={scope.orgId} prices={prices.data} rep={role === 'rep'} onDone={() => { invalidate(); deals.reload(); }} />}
    </Page>
  );
}

function DealRow({ d }: { d: SalesDeal }) {
  const st = STATUS[d.status];
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{d.business}</p>
        <p className="text-sm text-muted">{d.niche} · {d.level} · {money(d.priceCents)}{d.priceIsDraft ? ' (DRAFT)' : ''}</p>
      </div>
      <Badge tone={st.tone}>{st.label}</Badge>
    </li>
  );
}

function CloseSheet({ open, onOpenChange, orgId, prices, rep, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; orgId: string; prices: PriceConfig; rep: boolean; onDone: () => void }) {
  const [f, setF] = useState<CloseSaleInput>(BLANK);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<CloseSaleInput>) => setF((x) => ({ ...x, ...patch }));
  // A rep can close only levels marked quotable; admin and operator can close any.
  const choices = LEVELS.filter((l) => !rep || prices.levels.find((p) => p.level === l.level)?.quotable);
  const chosen = prices.levels.find((p) => LEVELS.find((l) => l.value === f.level)?.level === p.level);

  const submit = async () => {
    setBusy(true);
    try {
      const d = await api.closeSale(orgId, f);
      toast.success(`${d.business} is closed and waiting for onboarding`);
      setF(BLANK); onOpenChange(false); onDone();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Close a sale" description="Only after the owner has said yes."
      footer={<Button variant="primary" loading={busy} onClick={() => void submit()}>Close the sale</Button>}>
      <div className="grid gap-3">
        <Field label="Business">{(p) => <Input {...p} value={f.business} maxLength={100} onChange={(e) => set({ business: e.target.value })} />}</Field>
        <Field label="Niche">{(p) => <Input {...p} value={f.niche} maxLength={60} onChange={(e) => set({ niche: e.target.value })} />}</Field>
        <Field label="Level" hint={chosen ? `${chosen.what}. ${chosen.amountCents / 100 > 0 ? `Agreed price: $${(chosen.amountCents / 100).toLocaleString('en-US')}${prices.isFinal ? '' : ' (DRAFT)'}, set by the price config.` : ''}` : undefined}>
          {(p) => <Select {...p} value={f.level} onChange={(e) => set({ level: e.target.value as DealLevel })}>{choices.map((l) => <option key={l.value} value={l.value}>{l.value}</option>)}</Select>}
        </Field>
        <Field label="Contact name">{(p) => <Input {...p} value={f.contactName} maxLength={100} onChange={(e) => set({ contactName: e.target.value })} />}</Field>
        <Field label="Contact email">{(p) => <Input {...p} type="email" value={f.contactEmail} maxLength={200} onChange={(e) => set({ contactEmail: e.target.value })} />}</Field>
        <Field label="Notes" hint="What the owner wants, in their words. Up to 500 characters.">{(p) => <Textarea {...p} value={f.notes} maxLength={500} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        <p className="text-sm text-muted">There is no price or discount field. The amount comes from the price config.</p>
      </div>
    </Sheet>
  );
}
