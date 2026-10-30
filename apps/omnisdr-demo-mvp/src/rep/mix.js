// Allowance mix (Christian 2026-10-28): a slider on the close-sale form moves a client's usage allowance between voice
// minutes and texts. It changes ONLY the mix. Price, allowance dollars, overage rates and rep/dev pay are not inputs here,
// so nothing in this file can move them. Cost rates: CREDIT-ALLOWANCE-MODEL sections 3, 4, 6 and 7.
//
// Integer math on purpose: every rate is in hundredths of a cent (1e-4 dollar), so $0.2585 is 2585 and the usable budget is
// a whole number. Floating point floors 77.55 / 0.2585 to 299.9999 and the default Standard mix would show 290 minutes.
export const MIX = {
  minuteUnits: 2585,        // $0.2585 a voice minute, highest tier
  textUnits: 180,           // $0.018 a text
  threadUnits: 200,         // $0.02 an AI text conversation
  textsPerThread: 3,        // one conversation per 3 texts, on every plan
  fixedUnits: 68000,        // $6.80 per number a month
  reserveNum: 108, reserveDen: 100, // custom quotes keep an 8% reserve (CREDIT-ALLOWANCE-MODEL section 7)
  minMinutes: 0, minTexts: 0,       // no floors (Christian 2026-10-28): the slider runs from all texts to all calls
  minuteStep: 10, textStep: 100, threadStep: 10,
  overage: { minuteCents: 40, textCents: 3 }, // shown on the quote sheet only; the slider never touches overage (Christian 2026-10-27)
  positions: 100,           // slider runs 0 (all texts) to 100 (all calls): the share of the budget spent on voice, in percent
  customDefaultPosition: 51, // custom and larger pilots start where Standard sits
  // Published plans (CREDIT-ALLOWANCE-MODEL section 6). A plan is matched by its allowance, and its quantities are the default.
  plans: [
    { key: 'lite', label: 'Lite', allowanceCents: 7500, minutes: 180, texts: 1500, threads: 500 },
    { key: 'standard', label: 'Standard', allowanceCents: 15000, minutes: 300, texts: 3000, threads: 1000 },
    { key: 'plus', label: 'Plus', allowanceCents: 35000, minutes: 600, texts: 6000, threads: 2000 },
  ],
};

const down = (n, step) => n - (n % step);
export const costUnits = (minutes, texts, threads) => minutes * MIX.minuteUnits + texts * MIX.textUnits + threads * MIX.threadUnits;

/** Usable budget in cost units: the cost of the plan's published quantities, else the allowance less the fixed cost and the 8% reserve. */
export function budgetFor(allowanceCents, numbers = 1) {
  const plan = MIX.plans.find((p) => p.allowanceCents === allowanceCents);
  if (plan) return { plan, units: costUnits(plan.minutes, plan.texts, plan.threads) };
  const usable = allowanceCents * 100 - MIX.fixedUnits * numbers;
  return { plan: null, units: usable > 0 ? Math.floor((usable * MIX.reserveDen) / MIX.reserveNum) : 0 };
}

/** The mix at slider position p. Rounds down at every step, so the cost can never pass the budget. */
export function mixAt(units, p) {
  const voice = Math.floor((units * p) / MIX.positions), text = Math.floor((units * (MIX.positions - p)) / MIX.positions);
  const minutes = down(Math.floor(voice / MIX.minuteUnits), MIX.minuteStep);
  // a text with its share of a conversation costs 3 * 180 + 200 = 740 per three texts
  const texts = down(Math.floor((text * MIX.textsPerThread) / (MIX.textUnits * MIX.textsPerThread + MIX.threadUnits)), MIX.textStep);
  const threads = down(Math.floor(texts / MIX.textsPerThread), MIX.threadStep);
  return { minutes, texts, threads };
}

/**
 * Every slider step for an allowance. Matched plans snap to the published quantities at their own position, returned directly
 * rather than recomputed. `lo` and `hi` bound the range where the floors hold; with none they are 0 and 100.
 */
export function mixSteps(allowanceCents, numbers = 1) {
  const { plan, units } = budgetFor(allowanceCents, numbers);
  if (units <= 0) return null; // no allowance, nothing to split
  const def = plan ? Math.round((MIX.positions * plan.minutes * MIX.minuteUnits) / units) : MIX.customDefaultPosition;
  const steps = [];
  for (let p = 0; p <= MIX.positions; p++) steps.push({ p, ...(plan && p === def ? { minutes: plan.minutes, texts: plan.texts, threads: plan.threads } : mixAt(units, p)) });
  const ok = steps.filter((s) => s.minutes >= MIX.minMinutes && s.texts >= MIX.minTexts);
  if (!ok.length) return null; // no allowance, so nothing to split
  const lo = ok[0].p, hi = ok[ok.length - 1].p;
  return {
    plan: plan ? plan.key : null, budgetUnits: units, defaultPosition: Math.min(Math.max(def, lo), hi), lo, hi,
    // what 10 minutes buys in texts: the live "10 minutes = N texts" line
    tradeTexts: Math.round((MIX.minuteStep * MIX.minuteUnits * MIX.textsPerThread) / (MIX.textUnits * MIX.textsPerThread + MIX.threadUnits)),
    steps: steps.filter((s) => s.p >= lo && s.p <= hi),
  };
}

/** Validate a position the rep picked and return the mix to save. Null position means the plan default. */
export function resolveMix(allowanceCents, position, numbers = 1) {
  const m = mixSteps(allowanceCents, numbers);
  if (!m) return null;
  const p = position == null ? m.defaultPosition : position;
  const s = Number.isInteger(p) && m.steps.find((x) => x.p === p);
  if (!s) return undefined; // not a position on this slider
  return { position: s.p, minutes: s.minutes, texts: s.texts, threads: s.threads, plan: m.plan };
}
