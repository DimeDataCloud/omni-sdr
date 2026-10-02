// Level G (0014): free checks on every address; a vendor check per Data credit; only that makes an address 'valid'.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { fakeVerifier, mxOk } from '../src/services/verify.mjs';

const MX = { 'clinic.example': [{ exchange: 'mx.clinic.example', priority: 10 }], 'nullmx.example': [{ exchange: '.', priority: 0 }] };
const resolveMx = async (d) => {
  if (d === 'flaky.example') throw Object.assign(new Error('servfail'), { code: 'ESERVFAIL' });
  if (MX[d]) return MX[d];
  throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
};
let decide = () => 'valid';
const verifier = fakeVerifier((e) => decide(e));
let api;
before(async () => { api = await startApi({ config: { verifier, resolveMx } }); });
after(async () => { await api.stop(); });

let n = 0;
async function contacts(...emails) {
  n++;
  const r = await api.call('POST', `${api.W}/contacts`, { body: { contacts: emails.map((email, i) => ({ name: `V ${n}-${i}`, email })) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.created.map((c) => c.id);
}
const dataBal = async () => Number((await api.q(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'data'`, [api.demo.org]))[0].balance);
const ledger = async (job) => (await api.q(`SELECT kind, delta::int AS d FROM credit_ledger WHERE ref_type = 'email_verify' AND ref_id = $1 ORDER BY id`, [job])).map((x) => [x.kind, x.d]);
const statusOf = async (id) => (await api.q(`SELECT email_status FROM contacts WHERE id = $1`, [id]))[0].email_status;
const verify = (ids, as) => api.call('POST', `${api.W}/contacts/verify`, { as, body: { contactIds: ids } });

test('mx: a domain with mail servers passes; no domain or a null MX fails; DNS trouble is "can\'t tell"', async () => {
  assert.equal(await mxOk('clinic.example', resolveMx), true);
  assert.equal(await mxOk('nope.example', resolveMx), false);
  assert.equal(await mxOk('nullmx.example', resolveMx), false);
  assert.equal(await mxOk('flaky.example', resolveMx), null);
});

test('free checks cost nothing; the vendor makes addresses valid, one Data credit each, settled; the verdicts are kept', async () => {
  decide = (e) => (e.startsWith('gone') ? 'invalid' : e.startsWith('maybe') ? 'risky' : 'valid');
  const [ok1, gone, maybe, nomx, nullmx, flaky] = await contacts('dana.v1@clinic.example', 'gone.v1@clinic.example', 'maybe.v1@clinic.example',
    'x.v1@nope.example', 'x.v1@nullmx.example', 'x.v1@flaky.example');
  const b0 = await dataBal(); verifier.calls.length = 0;
  const r = await verify([ok1, gone, maybe, nomx, nullmx, flaky]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const out = Object.fromEntries(r.body.results.map((x) => [x.contactId, [x.outcome, x.by, x.reason ?? null]]));
  assert.deepEqual(out[nomx], ['invalid', 'free', 'no_mx']);
  assert.deepEqual(out[nullmx], ['invalid', 'free', 'no_mx']);
  assert.deepEqual([out[ok1], out[gone], out[maybe], out[flaky]].map((x) => x[0]), ['valid', 'invalid', 'risky', 'valid'], 'DNS trouble still goes to the vendor');
  assert.equal(verifier.calls.length, 4, 'the vendor never sees what the free checks already ruled out');
  assert.deepEqual([r.body.credits.data, await dataBal()], [4, b0 - 4]);
  assert.deepEqual(await ledger(r.body.job), [['reserve', -4], ['settle', 0]]);
  assert.deepEqual([await statusOf(ok1), await statusOf(gone), await statusOf(maybe), await statusOf(nomx)], ['valid', 'invalid', 'risky', 'invalid']);
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM email_verifications WHERE job = $1 AND vendor = 'fake'`, [r.body.job]))[0].n, 4);
  // Checking again: the valid one is not paid for twice.
  verifier.calls.length = 0;
  const again = await verify([ok1]);
  assert.deepEqual([again.body.results[0].outcome, again.body.results[0].by, again.body.credits.data, verifier.calls.length], ['valid', 'earlier', 0, 0]);
});

test('what the vendor didn\'t answer is refunded; an address claimed by another check is skipped and not charged', async () => {
  decide = (e) => { if (e.startsWith('down')) throw new Error('vendor 500'); return 'valid'; };
  const [a, b, c] = await contacts('down.v2@clinic.example', 'fine.v2@clinic.example', 'busy.v2@clinic.example');
  await api.q(`UPDATE contacts SET verify_job = gen_random_uuid(), verify_at = now() WHERE id = $1`, [c]);
  const b0 = await dataBal();
  const r = await verify([a, b, c]);
  const out = Object.fromEntries(r.body.results.map((x) => [x.contactId, x.outcome]));
  assert.deepEqual([out[a], out[b], out[c]], ['unknown', 'valid', 'already_running']);
  assert.deepEqual(await ledger(r.body.job), [['reserve', -2], ['release', 1], ['settle', 0]]);
  assert.equal(await dataBal(), b0 - 1);
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM contacts WHERE verify_job = $1`, [r.body.job]))[0].n, 0, 'its claims let go');
  assert.equal(await statusOf(a), 'unknown');
});

test('vendor off: free checks still run and nothing is charged; short balance refuses; build roles only; another workspace\'s contact is not found', async () => {
  const off = await startApi({ config: { resolveMx } });
  try {
    const made = (await off.call('POST', `${off.W}/contacts`, { body: { contacts: [{ email: 'a.v3@clinic.example' }, { email: 'b.v3@nope.example' }] } })).body.created.map((x) => x.id);
    const r = await off.call('POST', `${off.W}/contacts/verify`, { body: { contactIds: made } });
    assert.deepEqual(r.body.results.map((x) => [x.outcome, x.reason]), [['unknown', 'vendor_off'], ['invalid', 'no_mx']]);
    assert.deepEqual([r.body.vendor, r.body.job, r.body.credits.data], ['off', null, 0]);
  } finally { await off.stop(); }
  decide = () => 'valid';
  const [x] = await contacts('short.v3@clinic.example');
  await api.q(`UPDATE credit_balances SET balance = 0 WHERE org_id = $1 AND meter = 'data'`, [api.demo.org]);
  const short = await verify([x], 'sam@example.com');
  assert.deepEqual([short.status, short.body.error], [402, 'insufficient_credits']);
  assert.equal((await api.q(`SELECT verify_job FROM contacts WHERE id = $1`, [x]))[0].verify_job, null, 'a refused press holds nothing');
  await api.q(`UPDATE credit_balances SET balance = 100 WHERE org_id = $1 AND meter = 'data'`, [api.demo.org]);
  for (const who of ['riley@example.com', 'client@example.com']) assert.equal((await verify([x], who)).status, 403, who);
  const other = (await api.call('POST', `${api.ws(1)}/contacts`, { body: { contacts: [{ email: 'w2.v3@clinic.example' }] } })).body.created[0].id;
  assert.deepEqual((await verify([other], 'sam@example.com')).body.results[0].outcome, 'not_found');
});
