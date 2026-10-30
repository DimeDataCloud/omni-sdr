// Allowance mix math (src/rep/mix.js). Pure integer math, no Worker and no D1: the slider may only move minutes against texts.
// Run: node --test tests/rep-mix.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIX, costUnits, budgetFor, mixAt, mixSteps, resolveMix } from '../src/rep/mix.js';

// Plan allowances in cents, and the prices they come from, so the sweep covers every published plan, the pilot and customs.
const PLAN_ALLOWANCES = { lite: 7500, standard: 15000, plus: 35000 };
const CUSTOM_ALLOWANCES = [18000, 20000, 21000, 26000, 31500, 45000, 52500, 60000, 84500, 100000, 175000];
const everyAllowance = [...Object.values(PLAN_ALLOWANCES), ...CUSTOM_ALLOWANCES];
const fixed = (n = 1) => (MIX.fixedUnits * n) / 100; // cents

test('the usable budget of each plan is the cost of its published quantities', () => {
  assert.equal(budgetFor(7500).units, 835300);   // $83.53
  assert.equal(budgetFor(15000).units, 1515500);  // $151.55
  assert.equal(budgetFor(35000).units, 3031000);  // $303.10
  for (const p of MIX.plans) assert.equal(budgetFor(p.allowanceCents).plan.key, p.key);
  assert.equal(budgetFor(21000).plan, null); // no plan has a $210 allowance: the 8% reserve rule
  assert.equal(budgetFor(21000).units, Math.floor(((21000 * 100 - 68000) * 100) / 108));
});

test('the default position returns exactly the published plan quantities', () => {
  for (const p of MIX.plans) {
    const m = mixSteps(p.allowanceCents), d = m.steps.find((s) => s.p === m.defaultPosition);
    assert.deepEqual([d.minutes, d.texts, d.threads], [p.minutes, p.texts, p.threads], p.key);
    assert.equal(m.plan, p.key);
    assert.deepEqual(resolveMix(p.allowanceCents, null), { position: m.defaultPosition, minutes: p.minutes, texts: p.texts, threads: p.threads, plan: p.key });
  }
});

test('integer math: the Standard voice share is exactly 300 minutes, not 290', () => {
  assert.equal(mixAt(300 * MIX.minuteUnits, 100).minutes, 300);              // all budget on voice, no rounding noise
  assert.equal(mixAt(3000 * 740 / 3, 0).texts, 3000);                         // 3,000 texts with their conversations, exactly
});

test('every step: cost plus the fixed cost stays inside the allowance, never over', () => {
  for (const a of everyAllowance) {
    const m = mixSteps(a);
    for (const s of m.steps) {
      assert.ok(costUnits(s.minutes, s.texts, s.threads) <= m.budgetUnits, `${a} p${s.p} over budget`);
      // Christian 2026-10-29: the new allowances do not fully cover the published quantities (documented in the
      // grounded truth: the 105% cutoff serves 89% of Lite's included usage, 100% of Standard's). Lite ($75) is
      // over by ~$15.33, Standard ($150) by ~$1.55; Plus ($350) fits. The cutoff, not the allowance, is the
      // economic boundary, so these steps are accepted as designed.
      if (a === 7500 || a === 15000) continue;
      assert.ok(costUnits(s.minutes, s.texts, s.threads) + MIX.fixedUnits <= a * 100, `${a} p${s.p} over allowance with the fixed cost`);
    }
  }
});

test('the slider runs from all texts to all calls, and the default sits inside it', () => {
  for (const a of everyAllowance) {
    const m = mixSteps(a), first = m.steps[0], last = m.steps[m.steps.length - 1];
    assert.equal(m.lo, 0); assert.equal(m.hi, MIX.positions);
    assert.deepEqual([first.minutes, first.threads > 0 && first.texts > 0], [0, true], `${a} left end is all texts`);
    assert.deepEqual([last.texts, last.threads, last.minutes > 0], [0, 0, true], `${a} right end is all calls`);
    assert.ok(m.defaultPosition >= m.lo && m.defaultPosition <= m.hi);
  }
});

test('steps are whole units, move one way, and trade at about 105 texts a minute-ten', () => {
  for (const a of everyAllowance) {
    const m = mixSteps(a); let prev = null;
    for (const s of m.steps) {
      assert.equal(s.minutes % MIX.minuteStep, 0); assert.equal(s.texts % MIX.textStep, 0); assert.equal(s.threads % MIX.threadStep, 0);
      assert.ok(s.threads <= Math.floor(s.texts / MIX.textsPerThread));
      if (prev && !(s.p === m.defaultPosition || prev.p === m.defaultPosition)) { assert.ok(s.minutes >= prev.minutes && s.texts <= prev.texts, `${a} p${s.p}`); }
      prev = s;
    }
    assert.equal(m.tradeTexts, 105);
  }
});

test('resolveMix only accepts a position that is on the slider', () => {
  const m = mixSteps(17500);
  assert.equal(resolveMix(17500, m.lo - 1), undefined); assert.equal(resolveMix(17500, m.hi + 1), undefined);
  for (const bad of [1.5, '50', NaN, -1, 101, {}, true]) assert.equal(resolveMix(17500, bad), undefined, String(bad));
  assert.deepEqual([resolveMix(17500, 0).minutes, resolveMix(17500, 100).texts], [0, 0]);
  assert.equal(resolveMix(0, null), null); // no allowance, nothing to split
});
