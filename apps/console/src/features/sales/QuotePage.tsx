// Rep portal, quote sheet (DESIGN-frontend-4-sales-portal, screen 4). The ladder reads from one price config; every amount
// is DRAFT until Christian sets the final flag. A rep can copy the exact sentence for a level, but only for levels marked
// quotable, and there is no discount field (deck slide 18).
import { useState } from 'react';
import { toast } from 'sonner';
import { Calculator, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { invalidate } from '@/lib/api/client';
import type { PriceConfig, PriceLevel } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { salesAccess } from './access';
import { quoteSentence, formatAmount, UNIT_LABEL } from './quote';
import { Badge, Banner, Button, Card, ErrorState, Field, Input, NoAccess, Page, PageHeader, SkeletonList, Switch } from '@/components/ui';

export default function QuotePage() {
  const { scope, role } = useWorkspace();
  const access = salesAccess(role);
  const q = useQuery(() => api.priceConfig(scope.orgId), [scope.orgId], { key: `price-config:${scope.orgId}`, enabled: access.portal });
  const [niche, setNiche] = useState('');

  if (!access.portal) return <Page><NoAccess what="the sales portal" /></Page>;
  const cfg = q.data;

  return (
    <Page>
      <PageHeader title="Quote sheet" subtitle="What each level is and the exact sentence to say. Copy it, do not paraphrase the price." />
      <Banner tone="info" title="Demo data">Prices are the draft values from the pricing slide. Nothing here is sent anywhere.</Banner>
      {q.error ? <ErrorState error={q.error} onRetry={q.reload} />
        : !cfg ? <SkeletonList rows={4} />
        : (
          <>
            {!cfg.isFinal && <Banner tone="warning" title="Every price is a DRAFT">The final price is set at go-live. Quote Level 1 only, and say it is a draft. Never call a price flat or the same for everyone.</Banner>}
            {cfg.isFinal && <Banner tone="info" title="Final prices">Set {cfg.effectiveDate}. Quote the levels marked ready to quote.</Banner>}
            <Field label="Their trade (optional)" hint="Goes into the sentence. Leave it blank if you do not know yet.">
              {(p) => <Input {...p} value={niche} maxLength={60} onChange={(e) => setNiche(e.target.value)} />}
            </Field>
            <ul className="grid gap-3">
              {cfg.levels.map((l) => <LevelCard key={l.level} l={l} cfg={cfg} niche={niche.trim()} />)}
            </ul>
            <p className="text-sm text-muted">There is no discount field on purpose. Change terms such as the start date, never the price.</p>
            {access.editPrices && <PriceEditor key={JSON.stringify(cfg)} cfg={cfg} orgId={scope.orgId} />}
          </>
        )}
    </Page>
  );
}

function LevelCard({ l, cfg, niche }: { l: PriceLevel; cfg: PriceConfig; niche: string }) {
  const sentence = quoteSentence(l, cfg, niche);
  const copy = async () => {
    try { await navigator.clipboard.writeText(sentence); toast.success('Copied'); } catch { toast.error('Could not copy. Select the sentence and copy it by hand.'); }
  };
  return (
    <li>
      <Card className="grid gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Level {l.level}: {l.label}</h2>
          {!cfg.isFinal && l.level > 0 && <Badge tone="warning">DRAFT</Badge>}
          <Badge tone={l.quotable ? 'success' : 'neutral'}>{l.quotable ? 'Ready to quote' : 'Do not say a number'}</Badge>
          <span className="tabular ml-auto text-sm">{formatAmount(l)}</span>
        </div>
        <p className="text-sm text-muted">{l.what}</p>
        <blockquote className="rounded-md border border-border p-3 text-sm">{sentence}</blockquote>
        <div><Button size="sm" onClick={() => void copy()}><Copy className="size-4" aria-hidden />Copy sentence</Button></div>
      </Card>
    </li>
  );
}

const dollars = (cents: number | null) => (cents === null ? '' : String(cents / 100));
const toCents = (s: string): number | null => { const n = Number.parseFloat(s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

/** Christian's edit form. Changing any amount puts the ladder back to DRAFT; the final flag only sticks on an unchanged ladder. */
function PriceEditor({ cfg, orgId }: { cfg: PriceConfig; orgId: string }) {
  const [rows, setRows] = useState(() => cfg.levels.map((l) => ({ amount: dollars(l.amountCents), to: dollars(l.rangeToCents), floor: dollars(l.floorCents), quotable: l.quotable })));
  const [final, setFinal] = useState(cfg.isFinal);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    const levels = cfg.levels.map((l, i) => {
      const r = rows[i]!;
      return { ...l, amountCents: toCents(r.amount) ?? NaN, rangeToCents: r.to === '' ? null : toCents(r.to) ?? NaN, floorCents: r.floor === '' ? null : toCents(r.floor) ?? NaN, quotable: r.quotable };
    });
    setBusy(true);
    try {
      const saved = await api.putPriceConfig(orgId, { ...cfg, levels, isFinal: final });
      invalidate();
      toast.success(final && !saved.isFinal ? 'Saved as DRAFT. Amounts changed, so save again with Final on to confirm them.' : 'Prices saved');
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card className="grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-medium"><Calculator className="size-4" aria-hidden />Edit prices</h2>
      {cfg.levels.map((l, i) => (
        <fieldset key={l.level} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm">Level {l.level}: {l.label} ({UNIT_LABEL[l.unit]})</legend>
          <Field label="Amount, dollars">{(p) => <Input {...p} inputMode="decimal" disabled={l.unit === 'free'} value={rows[i]!.amount} onChange={(e) => set(i, { amount: e.target.value })} />}</Field>
          <Field label="Top of range">{(p) => <Input {...p} inputMode="decimal" disabled={l.unit === 'free'} value={rows[i]!.to} onChange={(e) => set(i, { to: e.target.value })} />}</Field>
          <Field label="Monthly floor">{(p) => <Input {...p} inputMode="decimal" disabled={l.unit !== 'per_kept_appointment'} value={rows[i]!.floor} onChange={(e) => set(i, { floor: e.target.value })} />}</Field>
          <div className="sm:col-span-3"><Switch checked={rows[i]!.quotable} onChange={(v) => set(i, { quotable: v })} label="Reps may say this number" /></div>
        </fieldset>
      ))}
      <Switch checked={final} onChange={setFinal} label="Final" description="Off keeps every price a DRAFT. Turn it on only when these amounts are confirmed, in a save of their own." />
      <div><Button variant="primary" loading={busy} onClick={() => void save()}>Save prices</Button></div>
    </Card>
  );
}
