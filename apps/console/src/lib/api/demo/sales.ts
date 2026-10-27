// Rep portal demo store (DESIGN-frontend-4-sales-portal). The price config is data, not copy: every amount is DRAFT until
// Christian sets the final flag. Defaults are the slide 13 draft values (SALES-DECK-COPY). Fake data only.
import { ApiError } from '../client';
import type { PriceConfig, PriceLevel } from '../types';
import type { MemberRow, World } from './seed';

export const DEFAULT_PRICES = (): PriceConfig => ({
  isFinal: false,
  effectiveDate: null,
  levels: [
    { level: 0, label: 'Free proof', what: 'Missed-call audit and response-time test', amountCents: 0, unit: 'free', rangeToCents: null, floorCents: null, quotable: true },
    { level: 1, label: 'Pilot', what: 'One system, 30 days, results report at day 14', amountCents: 49900, unit: 'one_time', rangeToCents: null, floorCents: null, quotable: true },
    { level: 2, label: 'Core recurring', what: 'Priced per niche after the pilot', amountCents: 29900, unit: 'per_month', rangeToCents: 49900, floorCents: null, quotable: false },
    { level: 3, label: 'Outcome pricing', what: 'Remodelers first. A fee per kept appointment plus a monthly floor', amountCents: 14900, unit: 'per_kept_appointment', rangeToCents: null, floorCents: 39900, quotable: false },
  ],
});

type Helpers = {
  read: <T>(fn: (w: World) => T) => Promise<T>; write: <T>(fn: (w: World) => T) => Promise<T>;
  me: (w: World) => MemberRow; nf: (what: string) => ApiError;
};

const forbidden = (action: string) => new ApiError(403, 'forbidden', `Your role cannot do that (${action})`, { action });
const bad = (msg: string) => new ApiError(400, 'bad_request', msg);
const okAmount = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 10_000_000;
const amounts = (levels: PriceLevel[]) => JSON.stringify(levels.map((l) => [l.amountCents, l.rangeToCents, l.floorCents]));

export function makeSalesApi({ read, write, me, nf }: Helpers) {
  const org = (w: World, orgId: string) => { if (orgId !== w.org.id) throw nf('organization'); };
  const mayRead = (m: MemberRow) => { if (m.role !== 'admin' && m.role !== 'operator' && m.role !== 'rep') throw forbidden('sales_read'); };
  return {
    priceConfig: (orgId: string) => read((w): PriceConfig => { org(w, orgId); mayRead(me(w)); return structuredClone(w.priceConfig); }),
    /** Admin only. Changing any amount puts the config back to DRAFT; only the explicit final flag on an unchanged ladder clears it. */
    putPriceConfig: (orgId: string, next: PriceConfig) => write((w): PriceConfig => {
      org(w, orgId);
      if (me(w).role !== 'admin') throw forbidden('price_write');
      if (next.levels.length !== w.priceConfig.levels.length) throw bad('The ladder has four levels');
      const levels: PriceLevel[] = next.levels.map((l, i) => {
        const cur = w.priceConfig.levels[i]!;
        if (l.level !== cur.level) throw bad('Levels are fixed');
        if (!okAmount(l.amountCents) || (l.rangeToCents !== null && !okAmount(l.rangeToCents)) || (l.floorCents !== null && !okAmount(l.floorCents))) throw bad(`Level ${l.level}: amounts are whole cents`);
        if (l.rangeToCents !== null && l.rangeToCents < l.amountCents) throw bad(`Level ${l.level}: the top of the range is below the bottom`);
        return { ...cur, amountCents: l.amountCents, rangeToCents: l.rangeToCents, floorCents: l.floorCents, quotable: l.quotable };
      });
      const unchanged = amounts(levels) === amounts(w.priceConfig.levels);
      const final = next.isFinal && unchanged;
      w.priceConfig = { levels, isFinal: final, effectiveDate: final ? (next.effectiveDate ?? new Date().toISOString().slice(0, 10)) : null };
      return structuredClone(w.priceConfig);
    }),
  };
}
