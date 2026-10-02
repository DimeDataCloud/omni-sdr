import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { pglitePool } from '../src/pool.mjs';
import { classifyReply } from '../src/services/inbox.mjs';
import { runRefine } from '../src/jobs/refine.mjs';
import { fakeDecider } from '../../ai/src/decide.mjs';
import { withService } from '../../db/src/context.mjs';

const api = await startApi();
after(() => api.stop());
const noul = (p) => ({ type: 'noul', noul: p, answer_confidence: Math.max(p, 1 - p) });
const optOut = fakeDecider((s) => (s.body.includes('again') ? { stop: noul(0.9), meet: noul(0.05) } : { stop: noul(0.02), meet: noul(0.1) }));
const down = fakeDecider(() => { throw new Error('decider down'); });

async function reply(email, body) {
  const [c] = await api.q(`SELECT id, org_id, workspace_id FROM contacts WHERE email = $1`, [email]);
  const v = classifyReply({ body });
  await withService(api.db, { orgId: c.org_id, workspaceId: c.workspace_id, role: 'inbox_svc' }, (tx) => tx.query(
    `INSERT INTO inbound_messages (org_id, workspace_id, contact_id, channel, from_address, subject, body, received_at, intent, intent_confidence, classified_by)
     VALUES ($1, $2, $3, 'email', $4, 'Re: hello', $5, now(), $6, $7, $8)`,
    [c.org_id, c.workspace_id, c.id, email, body, v.intent, v.confidence, v.by]));
}
const undecided = async () => (await api.q(`SELECT count(*)::int AS n FROM inbound_messages WHERE decided_at IS NULL`))[0].n;

test('refine job: missing config exits 2 and touches nothing', async () => {
  const logs = [];
  assert.equal(await runRefine({}, { log: (e) => logs.push(e) }), 2);
  assert.match(logs[0].error, /DATABASE_URL, OMNI_DECIDER_URL/);
  assert.equal(await runRefine({ OMNI_REFINE_LIMIT: '0' }, { pool: pglitePool(api.db), decider: optOut, log: (e) => logs.push(e) }), 2);
});

test('refine job: a down decider exits 1 and leaves replies for the next pass; a working one decides them', async () => {
  // The rules must miss it for the decider to matter (they learned "do not write to me" in L11).
  await reply('daniel@northgate-dental.example', 'I never asked for this. One more and I report you as spam again.');
  const before = await undecided();
  assert.ok(before >= 1);
  const logs = [];
  assert.equal(await runRefine({}, { pool: pglitePool(api.db), decider: down, log: (e) => logs.push(e) }), 1);
  assert.equal(await undecided(), before);
  assert.deepEqual(logs.at(-1), { job: 'refine', decided: 0, failed: 1, skipped: 0 });
  assert.equal(await runRefine({ OMNI_REFINE_LIMIT: '500' }, { pool: pglitePool(api.db), decider: optOut, log: (e) => logs.push(e) }), 0);
  assert.equal(await undecided(), 0);
  assert.ok(!JSON.stringify(logs).includes('write to me'), 'the job never logs reply text');
  const sup = await api.q(`SELECT reason FROM suppression WHERE value_hash = value_hash('daniel@northgate-dental.example')`);
  assert.ok(sup.some((s) => s.reason === 'reply_unsubscribe_model'), 'the opt-out the model found is suppressed');
});
