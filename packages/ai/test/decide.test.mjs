// The decider adapter and the reply-triage registry entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layaDecider, offDecider, DecideError } from '../src/decide.mjs';
import { REPLY_TRIAGE, CATEGORIES, pickCategory } from '../src/registry.mjs';

const noul = (p) => ({ type: 'noul', noul: p, answer_confidence: Math.max(p, 1 - p) });
const none = { intent: 'question', suppressed: false, stopped: true, slaDueAt: null };

test('reply triage: stop >= 0.30 suppresses, meet >= 0.30 starts the SLA; below that nothing is added', () => {
  assert.deepEqual(pick(REPLY_TRIAGE.effects({ stop: noul(0.30), meet: noul(0.30) }, none)), { suppress: true, stop: false, startSla: true });
  assert.deepEqual(pick(REPLY_TRIAGE.effects({ stop: noul(0.29), meet: noul(0.29) }, none)), { suppress: false, stop: false, startSla: false });
});

test('reply triage never removes: an existing suppression, stop or SLA is not re-added, and nothing says "unsuppress"', () => {
  const done = { intent: 'unsubscribe', suppressed: true, stopped: true, slaDueAt: new Date() };
  const fx = REPLY_TRIAGE.effects({ stop: noul(0.0), meet: noul(0.0) }, done);
  assert.deepEqual(pick(fx), { suppress: false, stop: false, startSla: false });
  assert.deepEqual(Object.keys(fx).sort(), ['record', 'startSla', 'stop', 'suppress'], 'an effect key that is not an addition appeared');
});

test('an opt-out read by the rules as out-of-office still stops the sequence', () => {
  const ooo = { intent: 'out_of_office', suppressed: false, stopped: false, slaDueAt: null };
  assert.deepEqual(pick(REPLY_TRIAGE.effects({ stop: noul(0.8), meet: noul(0.1) }, ooo)), { suppress: true, stop: true, startSla: false });
});

test('an injected label cannot move the safety answers: the label is recorded as shadow only', () => {
  const answers = { stop: noul(0.78), meet: noul(0.25), label: { type: 'choice', choice: 'meeting_request', answer_confidence: 0.92 } };
  const fx = REPLY_TRIAGE.effects(answers, none);
  assert.deepEqual(pick(fx), { suppress: true, stop: false, startSla: false });
  assert.equal(fx.record.shadow_label, 'meeting_request');
});

test('missing safety answers throw instead of defaulting to "no"', () => {
  assert.throws(() => REPLY_TRIAGE.effects({ stop: noul(0.9) }, none), /missing safety answers/);
});

test('the live path asks two questions; the label only on request', () => {
  assert.deepEqual(Object.keys(REPLY_TRIAGE.questions()).sort(), ['meet', 'stop']);
  assert.deepEqual(Object.keys(REPLY_TRIAGE.questions({ shadowLabel: true })).sort(), ['label', 'meet', 'stop']);
});

test('layaDecider: bearer token, pinned revision read from /health, every asked question answered', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, auth: init.headers?.authorization, body: init.body && JSON.parse(init.body) });
    if (url.endsWith('/health')) return json({ revisions: { english: 'abc123' } });
    return json({ model: 'laya-rl-agent', answers: { stop: noul(0.9), meet: noul(0.1) }, usage: { input_tokens: 149 } });
  };
  const d = layaDecider({ url: 'https://decider.test', getToken: async () => 'tok', fetchImpl });
  const out = await d.decide({ state: { body: 'stop' }, questions: REPLY_TRIAGE.questions() });
  assert.equal(out.revision, 'abc123');
  assert.equal(out.inputTokens, 149);
  assert.ok(seen.every((s) => s.auth === 'Bearer tok'));
  assert.equal(seen[1].body.model, 'english');
  await d.decide({ state: { body: 'x' }, questions: REPLY_TRIAGE.questions() });
  assert.equal(seen.filter((s) => s.url.endsWith('/health')).length, 1, 'health is read once');
});

test('layaDecider fails closed: a non-200, a missing answer, no revision or a network error is a DecideError', async () => {
  const cases = [
    async (u) => u.endsWith('/health') ? json({ revisions: { english: 'r' } }) : json({ detail: 'busy' }, 503),
    async (u) => u.endsWith('/health') ? json({ revisions: { english: 'r' } }) : json({ answers: { stop: noul(0.1) } }),
    async () => json({ revisions: {} }),
    async () => { throw new TypeError('fetch failed'); },
  ];
  for (const fetchImpl of cases) {
    const d = layaDecider({ url: 'https://decider.test', getToken: async () => 't', fetchImpl });
    await assert.rejects(d.decide({ state: {}, questions: REPLY_TRIAGE.questions() }), DecideError);
  }
  await assert.rejects(offDecider().decide({}), DecideError);
});

const pick = ({ suppress, stop, startSla }) => ({ suppress, stop, startSla });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ─── reply_triage@3 categories (SDR-PIVOT P2): shadow only ───────────────────────────────────────────────────────
const cats = (over = {}) => Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, noul(over[k] ?? 0.01)]));

test('categories: asked only on request; every category has a question; stop and meet keep their @2 wording', () => {
  assert.deepEqual(Object.keys(REPLY_TRIAGE.questions()), ['stop', 'meet']);
  const q = REPLY_TRIAGE.questions({ categories: true });
  assert.deepEqual(Object.keys(q).sort(), Object.keys(CATEGORIES).sort());
  assert.equal(q.stop.instructions, CATEGORIES.stop.question);
  assert.equal(q.meet.instructions, CATEGORIES.meet.question);
  for (const c of Object.values(CATEGORIES)) assert.ok(c.threshold > 0 && c.threshold < 1 && c.question.endsWith('?'));
});

test('pickCategory: safety categories win in order; else the one furthest above its own threshold; none above → unclassified', () => {
  assert.equal(pickCategory(cats({ stop: 0.95, meet: 0.99, interested: 0.99 })).category, 'stop', 'an opt-out is an opt-out, however keen the rest reads');
  assert.equal(pickCategory(cats({ ooo: 0.9, spam: 0.95 })).category, 'ooo');
  assert.equal(pickCategory(cats({ question: CATEGORIES.question.threshold + 0.2, interested: CATEGORIES.interested.threshold + 0.01 })).category, 'question');
  assert.deepEqual(pickCategory(cats()), { category: 'unclassified', intent: 'unclassified', p: null });
  assert.equal(pickCategory({}).category, 'unclassified', 'no answers: unclassified, not a guess');
});

test('categories never act: the effects are the @2 safety effects whatever the category says', () => {
  const keen = { ...cats({ interested: 0.99, meet: 0.25, spam: 0.99, decline: 0.99 }) };
  const fx = REPLY_TRIAGE.effects(keen, none);
  assert.deepEqual(pick(fx), { suppress: false, stop: false, startSla: REPLY_TRIAGE.thresholds.meet <= 0.25 });
  assert.equal(fx.record.category, 'spam', 'recorded for review');
  assert.equal(typeof fx.record.category_scores.interested, 'number');
  assert.deepEqual(Object.keys(fx).sort(), ['record', 'startSla', 'stop', 'suppress']);
  const partial = REPLY_TRIAGE.effects({ stop: noul(0.1), meet: noul(0.1), interested: noul(0.9) }, none);
  assert.equal(partial.record.category, undefined, 'a partial set of answers records no category');
});
