// Client portal, "Billing": read-only and not connected yet (Halo ruling 2026-10-27: billing is in the go-live client portal,
// read-only, behind a flag). No amounts here: the price is Christian's to set and nothing reads a billing system yet.
import { CreditCard } from 'lucide-react';
import { useWorkspace } from '@/lib/session';
import { askUsLink } from './askUs';
import { EmptyState, NoAccess, Page, PageHeader } from '@/components/ui';

/** Build-time flag. Off, the nav entry is hidden and the page refuses. */
const BILLING_ON = import.meta.env.VITE_CLIENT_BILLING === 'on';

export default function BillingPage() {
  const { role } = useWorkspace();
  if (!BILLING_ON || role !== 'client_viewer') return <Page><NoAccess what="this page" client /></Page>;
  const link = askUsLink('Question about my billing', 'My question:\n\n');
  return (
    <Page>
      <PageHeader title="Billing" subtitle="Your plan and invoices." />
      <EmptyState icon={<CreditCard className="size-5" aria-hidden />} title="Billing is not connected yet"
        body="Your plan and invoices will show here once billing is connected. Nothing is charged through this page."
        action={link ? <a className="text-sm underline" href={link}>Ask us a billing question</a> : <span className="text-sm text-muted">For billing questions, ask your account contact.</span>} />
    </Page>
  );
}
