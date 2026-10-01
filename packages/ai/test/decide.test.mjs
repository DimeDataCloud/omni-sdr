// The decider adapter and the reply-triage registry entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layaDecider, offDecider, DecideError } from '../src/decide.mjs';
import { REPLY_TRIAGE } from '../src/registry.mjs';

const noul = (p) => ({ type: 'noul', noul: p, answer_confidence: Math.max(p, 1 - p) });
const none = { intent: 'question', suppressed: false, stopped: true, slaDueAt: null };

test('reply triage: stop >= 0.30 suppresses, meet >= 0.5 starts the SLA; below that nothing is added', () => {
  assert.deepEqual(pick(REPLY_TRIAGE.effects({ stop: noul(0.30), meet: noul(0.5) }, none)), { suppress: true, stop: false, startSla: true });
  assert.deepEqual(pick(REPLY_TRIAGE.effects({ stop: noul(0.29), meet: noul(0.49) }, none)), { suppress: false, stop: false, startSla: false });
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
  const answers = { stop: noul(0.78), meet: noul(0.45), label: { type: 'choice', choice: 'meeting_request', answer_confidence: 0.92 } };
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
