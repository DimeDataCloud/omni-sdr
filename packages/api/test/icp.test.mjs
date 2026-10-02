// Level E2: an ICP proposal from past clients, every trait citing the rows behind it (acceptance step 3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { fakeModel } from '../src/services/model.mjs';
import { cleanRows, parseIcp } from '../src/services/icp.mjs';

let api; let reply = () => '{}';
const model = fakeModel((input) => reply(input));
before(async () => { api = await startApi({ model }); });
after(async () => { await api.stop(); });

const CLIENTS = [
  { company: 'Harbor Dental', title: 'Owner', industry: 'Dental', city: 'Nashville' },
  { company: 'Brightline Family Dental', title: 'Practice manager', industry: 'Dental', city: 'Franklin' },
  { company: 'Oak Pediatric Dentistry', title: 'Owner', industry: 'Dental', city: 'Nashville' },
  { company: 'Ridgeline Roofing', title: 'Office manager', industry: 'Roofing', city: 'Murfreesboro' },
];
const balance = async () => Number((await api.q(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'action'`, [api.demo.org]))[0].balance);

test('pure: rows are numbered and trimmed; a trait without real rows is dropped; one-row traits are weak', () => {
  const rows = cleanRows([...CLIENTS, { unknown: 'x' }, { company: '  Spaced  ' }]);
  assert.deepEqual(rows.map((r) => r.row), [1, 2, 3, 4, 6]);
  assert.equal(rows.at(-1).company, 'Spaced');
  const { proposal, problems } = parseIcp(JSON.stringify({ name: 'Dental owners', summary: 's', traits: [
    { kind: 'industry', value: 'Dental practices', rows: [1, 2, 3] },
    { kind: 'region', value: 'Middle Tennessee', rows: [99] },
    { kind: 'size', value: '50+ employees', rows: [] },
    { kind: 'title', value: 'Office manager', rows: [4] },
    { kind: 'other', value: 'Values speed', notes: true },
  ] }), rows, { hasNotes: false });
  assert.deepEqual(proposal.traits.map((t) => [t.value, t.rows, t.weak]), [['Dental practices', [1, 2, 3], false], ['Office manager', [4], true]]);
  assert.deepEqual(problems, ['unknown_rows:Middle Tennessee', 'uncited:Middle Tennessee', 'uncited:50+ employees', 'uncited:Values speed']);
  assert.equal(parseIcp('nope', rows).proposal, null);
});

test('propose: a cited proposal, 2 credits at the press, the clients in a data block; saving makes v1 with its sources', async () => {
  reply = (input) => {
    assert.match(input.messages[0].text, /<clients>[\s\S]*Harbor Dental[\s\S]*<\/clients>/);
    assert.equal(input.tier, 'pro');
    return JSON.stringify({ name: 'Owner-run dental practices', summary: 'Dental practices around Nashville run by their owners.',
      traits: [{ kind: 'industry', value: 'Dental practices', rows: [1, 2, 3] }, { kind: 'title', value: 'Owner', rows: [1, 3] },
        { kind: 'region', value: 'Nashville area', rows: [1, 2, 3, 4] }, { kind: 'other', value: 'Busy front desk', notes: true }] });
  };
  const b0 = await balance();
  const r = await api.call('POST', `${api.W}/icps/propose`, { body: { clients: CLIENTS, notes: 'Our best clients have a busy front desk.' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await balance(), b0 - 2);
  const kinds = async (job) => (await api.q(`SELECT kind, delta::int AS d FROM credit_ledger WHERE ref_type = 'icp_proposal' AND ref_id = $1 ORDER BY id`, [job])).map((x) => [x.kind, x.d]);
  assert.deepEqual(await kinds(r.body.provenance.job), [['reserve', -2], ['settle', 0]], 'a usable proposal settles its job');
  assert.equal(r.body.proposal.traits.length, 4);
  assert.ok(r.body.proposal.traits.every((t) => t.rows.length || t.notes), 'every trait has a source');
  assert.deepEqual(r.body.data.sources.map((s) => s.row), [1, 2, 3, 4]);
  assert.equal(r.body.provenance.prompt, 'icp@1');
  // Nothing saved until the person saves it; then it's v1 and carries its citations.
  const before = (await api.q(`SELECT count(*)::int AS n FROM icps WHERE workspace_id = $1`, [api.demo.workspaces[0]]))[0].n;
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM icps WHERE workspace_id = $1`, [api.demo.workspaces[0]]))[0].n, before);
  const saved = await api.call('POST', `${api.W}/icps`, { body: { name: r.body.proposal.name, data: r.body.data } });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.version, 1);
  assert.deepEqual(saved.body.data.traits[0].rows, [1, 2, 3]);
});

test('a model that cites nothing real gets no proposal, and the credits come back', async () => {
  reply = () => JSON.stringify({ name: 'x', traits: [{ kind: 'industry', value: 'Aerospace', rows: [42] }] });
  const b0 = await balance();
  const r = await api.call('POST', `${api.W}/icps/propose`, { body: { clients: CLIENTS } });
  assert.equal(r.status, 502);
  assert.equal(r.body.details.reason, 'no_supported_traits');
  assert.equal(await balance(), b0, 'refunded');
  const last = (await api.q(`SELECT ref_id FROM credit_ledger WHERE ref_type = 'icp_proposal' ORDER BY id DESC LIMIT 1`))[0].ref_id;
  assert.deepEqual((await api.q(`SELECT kind FROM credit_ledger WHERE ref_id = $1 ORDER BY id`, [last])).map((x) => x.kind), ['reserve', 'release']);
  reply = () => { throw new Error('vertex 500'); };
  assert.equal((await api.call('POST', `${api.W}/icps/propose`, { body: { clients: CLIENTS } })).status, 502);
  assert.equal(await balance(), b0);
});

test('who and how much: build roles only; 402 when short; input limits', async () => {
  for (const who of ['riley@example.com', 'client@example.com']) {
    assert.equal((await api.call('POST', `${api.W}/icps/propose`, { as: who, body: { clients: CLIENTS } })).status, 403, who);
  }
  assert.equal((await api.call('POST', `${api.W}/icps/propose`, { body: { clients: [] } })).status, 400);
  assert.equal((await api.call('POST', `${api.W}/icps/propose`, { body: { clients: [{ unknown: 'x' }] } })).status, 400);
  await api.q(`UPDATE credit_balances SET balance = 1 WHERE org_id = $1 AND meter = 'action'`, [api.demo.org]);
  assert.equal((await api.call('POST', `${api.W}/icps/propose`, { body: { clients: CLIENTS } })).status, 402);
  assert.equal(await balance(), 1);
  await api.q(`UPDATE credit_balances SET balance = 1000 WHERE org_id = $1 AND meter = 'action'`, [api.demo.org]);
  assert.deepEqual((await api.call('GET', `${api.W}/icps/propose/estimate`)).body, { credits: { action: 2 }, available: true, tier: 'pro' });
});

test('icp eval harness: a model that cites rows passes 10/10; one that invents fails', async () => {
  const { runIcpEval } = await import('../src/jobs/eval-icp.mjs');
  const honest = fakeModel((input) => {
    const rows = JSON.parse(/<clients>\n([\s\S]*?)\n<\/clients>/.exec(input.messages[0].text)[1]);
    const by = (f) => Object.entries(rows.reduce((m, r) => (r[f] ? { ...m, [r[f]]: [...(m[r[f]] ?? []), r.row] } : m), {}));
    const traits = [...by('industry').map(([v, rs]) => ({ kind: 'industry', value: v, rows: rs })), ...by('title').map(([v, rs]) => ({ kind: 'title', value: v, rows: rs })),
      ...by('city').map(([v, rs]) => ({ kind: 'region', value: v, rows: rs })), ...by('company').filter(([v]) => /fitness/i.test(v)).map(([, rs]) => ({ kind: 'industry', value: 'Fitness studios', rows: rs }))];
    const notes = /<notes>\n"([^"]*)"/.exec(input.messages[0].text)?.[1];
    if (notes && /vets?\b/i.test(notes)) traits.push({ kind: 'other', value: 'Vet clinics with several vets', notes: true });
    return JSON.stringify({ name: 'x', summary: 'y', traits });
  });
  const lines = [];
  const r = await runIcpEval(honest, { log: (l) => lines.push(l) });
  assert.equal(r.pass, r.total, lines.join('\n'));
  const liar = fakeModel(() => JSON.stringify({ name: 'x', traits: [{ kind: 'industry', value: 'Aerospace', rows: [1] }] }));
  assert.equal((await runIcpEval(liar, { log: () => {} })).pass, 0);
});

test('a cited row must show the trait (#51 audit P3)', () => {
  const rows = cleanRows(CLIENTS);
  const { proposal, problems } = parseIcp(JSON.stringify({ name: 'x', traits: [
    { kind: 'industry', value: 'Dental practices', rows: [1, 4] },          // row 4 is a roofer
    { kind: 'industry', value: 'Aerospace suppliers', rows: [1, 2] },       // no row says aerospace
  ] }), rows);
  assert.deepEqual(proposal.traits.map((t) => [t.value, t.rows]), [['Dental practices', [1]]]);
  assert.ok(problems.includes('rows_dont_show:Dental practices') && problems.includes('uncited:Aerospace suppliers'));
  // A region spanning towns keeps its rows; one no row shows at all is kept but marked weak.
  const r2 = parseIcp(JSON.stringify({ name: 'x', traits: [{ kind: 'region', value: 'Nashville area', rows: [1, 2, 3] }, { kind: 'region', value: 'Pacific Northwest', rows: [1, 2] }] }), rows);
  assert.deepEqual(r2.proposal.traits.map((t) => [t.value, t.rows, t.weak]), [['Nashville area', [1, 2, 3], false], ['Pacific Northwest', [1, 2], true]]);
});
