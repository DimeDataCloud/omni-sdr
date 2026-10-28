// What a rep says for each level. Pure, so it can be tested without the page. Wording follows deck slide 13: the Level 1 pilot is
// quoted as "$499 (DRAFT, confirm with Christian before quoting)"; a level that is not quotable never carries a number.
import type { PriceConfig, PriceLevel, PriceUnit } from '@/lib/api/types';

export const UNIT_LABEL: Record<PriceUnit, string> = { free: 'free', one_time: 'one time', per_month: 'a month', per_kept_appointment: 'per kept appointment' };

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** The amount as the sheet shows it to the rep, with the range and floor where they exist. */
export function formatAmount(l: PriceLevel): string {
  if (l.unit === 'free') return 'Free';
  const base = l.rangeToCents !== null ? `${usd(l.amountCents)} to ${usd(l.rangeToCents)}` : usd(l.amountCents);
  const floor = l.floorCents !== null ? ` plus ${usd(l.floorCents)} monthly floor` : '';
  return `${base} ${UNIT_LABEL[l.unit]}${floor}`;
}

export function quoteSentence(l: PriceLevel, cfg: PriceConfig, niche: string): string {
  const forThem = niche ? ` for your ${niche} business` : '';
  if (l.level === 0) return `The first step${forThem} is free: we run a missed-call audit and a response-time test and show you what we find.`;
  if (!l.quotable) return `After the pilot we look at your numbers and set a monthly plan that fits your trade.`;
  const tag = cfg.isFinal ? '' : ' (DRAFT, confirm with Christian before quoting)';
  const price = `${formatAmount(l)}${tag}`;
  return `${l.label}${forThem}: ${l.what.charAt(0).toLowerCase()}${l.what.slice(1)}. The price is ${price}.${cfg.isFinal ? '' : ' Everything here is a draft; the final price is set at go-live and I will tell you when it changes.'}`;
}
