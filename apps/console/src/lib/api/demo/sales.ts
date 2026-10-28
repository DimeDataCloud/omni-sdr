// Rep portal demo store (DESIGN-frontend-4-sales-portal). The price config is data, not copy: every amount is DRAFT until
// Christian sets the final flag. Defaults are the slide 13 draft values (SALES-DECK-COPY). Fake data only.
import { ApiError } from '../client';
import type { PriceConfig, PriceLevel, Prospect, ProspectPatch, ProspectStatus, SalesLog, SalesLogInput } from '../types';
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

const P = (repId: string, business: string, niche: string, signal: string, days: number | null, nextStep: string, status: ProspectStatus, at: (d: number) => string): Prospect =>
  ({ id: 'pr-' + business.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24), repId, business, niche, signal, lastTouch: days === null ? null : at(days), nextStep, status, notes: '' });

/** Fictional prospects for the rep persona, and one for the admin so the all-rep view shows more than a rep's. */
export function seedProspects(at: (d: number) => string, members: MemberRow[]): Prospect[] {
  const jordan = members.find((m) => m.role === 'rep')!.userId;
  const maya = members[0]!.userId;
  return [
    P(jordan, 'Birchwood Roofing', 'Roofing', 'Contact form promises a call back within the day', null, 'Run the free check on the form', 'new', at),
    P(jordan, 'Lakeview Dental Group', 'Dental practice', 'Voicemail after 5 pm, no text-back', 3, 'Send the audit numbers', 'audit_run', at),
    P(jordan, 'Ashford Remodeling', 'Remodeler', 'Estimate requests go quiet after the first visit', 6, 'Book the results call', 'contacted', at),
    P(maya, 'Corbin Plumbing', 'Plumbing', 'No after-hours line listed', 9, 'Follow up on the proposal', 'proposed', at),
  ];
}

type Helpers = {
  read: <T>(fn: (w: World) => T) => Promise<T>; write: <T>(fn: (w: World) => T) => Promise<T>;
  me: (w: World) => MemberRow; nf: (what: string) => ApiError;
};

const forbidden = (action: string) => new ApiError(403, 'forbidden', `Your role cannot do that (${action})`, { action });
const bad = (msg: string) => new ApiError(400, 'bad_request', msg);
const okAmount = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 10_000_000;
const amounts = (levels: PriceLevel[]) => JSON.stringify(levels.map((l) => [l.amountCents, l.rangeToCents, l.floorCents]));

const STATUSES: ProspectStatus[] = ['new', 'contacted', 'audit_run', 'results_call', 'proposed', 'signed'];
const dateOk = (d: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw bad('Date must be YYYY-MM-DD'); };
const emptyLog = (repId: string, date: string): SalesLog => ({ date, repId, attempts: 0, conversations: 0, audits: 0, resultsCalls: 0, pilotsProposed: 0, pilotsSigned: 0, objectionWords: '' });

export function makeSalesApi({ read, write, me, nf }: Helpers) {
  const org = (w: World, orgId: string) => { if (orgId !== w.org.id) throw nf('organization'); };
  const mayRead = (m: MemberRow) => { if (m.role !== 'admin' && m.role !== 'operator' && m.role !== 'rep') throw forbidden('sales_read'); };
  return {
    /** A rep gets only their own prospects; admin and operator get every rep's. */
    prospects: (orgId: string) => read((w): Prospect[] => {
      org(w, orgId); const m = me(w); mayRead(m);
      return w.prospects.filter((p) => m.role !== 'rep' || p.repId === m.userId).map((p) => ({ ...p }));
    }),
    patchProspect: (orgId: string, id: string, patch: ProspectPatch) => write((w): Prospect => {
      org(w, orgId); const m = me(w); mayRead(m);
      const p = w.prospects.find((x) => x.id === id && (m.role !== 'rep' || x.repId === m.userId));
      if (!p) throw nf('prospect');
      if (patch.status !== undefined) { if (!STATUSES.includes(patch.status)) throw bad('Unknown status'); if (patch.status !== p.status) { p.status = patch.status; p.lastTouch = new Date().toISOString(); } }
      if (patch.nextStep !== undefined) { if (patch.nextStep.length > 200) throw bad('Next step is limited to 200 characters'); p.nextStep = patch.nextStep.trim(); }
      if (patch.notes !== undefined) { if (patch.notes.length > 500) throw bad('Notes are limited to 500 characters'); p.notes = patch.notes.trim(); }
      return { ...p };
    }),
    salesLog: (orgId: string, date: string) => read((w): SalesLog => {
      org(w, orgId); const m = me(w); mayRead(m); dateOk(date);
      return { ...(w.salesLogs.find((l) => l.repId === m.userId && l.date === date) ?? emptyLog(m.userId, date)) };
    }),
    putSalesLog: (orgId: string, input: SalesLogInput) => write((w): SalesLog => {
      org(w, orgId); const m = me(w); mayRead(m); dateOk(input.date);
      const counts = [input.attempts, input.conversations, input.audits, input.resultsCalls, input.pilotsProposed, input.pilotsSigned];
      if (counts.some((n) => !Number.isInteger(n) || n < 0 || n > 1000)) throw bad('Counts are whole numbers from 0 to 1000');
      if (input.objectionWords.length > 500) throw bad('Objection words are limited to 500 characters');
      const row: SalesLog = { ...input, repId: m.userId, objectionWords: input.objectionWords.trim() };
      const i = w.salesLogs.findIndex((l) => l.repId === m.userId && l.date === input.date);
      if (i >= 0) w.salesLogs[i] = row; else w.salesLogs.push(row);
      return { ...row };
    }),
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
