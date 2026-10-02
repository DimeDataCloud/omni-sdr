// Level E3 (0011): competitor suggestions, research snapshots, battlecards whose every statement quotes its page,
// the gap map and the version diff (acceptance step 4; Station 10).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { as } from '../../db/test/helpers.mjs';
import { fakeModel } from '../src/services/model.mjs';
import { pageText, validateCard, parseSuggestions } from '../src/services/research.mjs';

const SITES = {
  'https://rival-answering.com/': '<html><title>Rival</title><body><h1>24/7 answering for dental offices</h1><p>Plans start at $199 per month.</p>'
    + '<a href="/pricing">Pricing</a><a href="/about">About us</a><script>steal()</script></body></html>',
  'https://rival-answering.com/pricing': '<p>Starter plan: $199 per month for 200 calls.</p><p>Overage is billed per call.</p>',
  'https://rival-answering.com/about': '<p>Founded in Ohio, we serve clinics across the Midwest with live operators.</p>',
};
let pricingNow = SITES['https://rival-answering.com/pricing'];
const fetchPage = async (url) => {
  const body = url === 'https://rival-answering.com/pricing' ? pricingNow : SITES[url];
  if (!body) throw new Error('unreachable');
  return { url, status: 200, body };
};
let reply = () => '{}';
const model = fakeModel((input) => reply(input));
let api;
before(async () => { api = await startApi({ model, config: { fetchPage } }); });
after(async () => { await api.stop(); });

const pagesOf = (input) => JSON.parse(/<pages>\n([\s\S]*?)\n<\/pages>/.exec(input.messages[0].text)[1].replace(/\\u003c/g, '<'));
const honestCard = (input) => {
  const p = pagesOf(input);
  const find = (re) => p.find((x) => re.test(x.text));
  const price = find(/Starter plan/); const home = find(/answering for dental/); const about = find(/Founded in Ohio/);
  return JSON.stringify({
    targets: [{ text: 'Dental offices', cite: home.id, quote: '24/7 answering for dental offices' }],
    claims: [{ text: 'Live operators', cite: about.id, quote: 'with live operators' }],
    pricing: [(() => { const q = price.text.match(/Starter plan: \$\d+ per month for \d+ calls/)[0]; return { text: q, cite: price.id, quote: q }; })()],
    strengths: [], weaknesses: [{ text: 'Overage billed per call', cite: price.id, quote: 'Overage is billed per call' }],
    where_we_win: [{ text: 'They charge per call over the plan', cite: price.id, quote: 'Overage is billed per call' }],
    objection_handlers: [{ objection: 'We already use Rival', answer: 'Compare overage costs.', cite: price.id, quote: 'Overage is billed per call' }],
    // An invented one: its quote is on no page, so it must be dropped.
    claims_extra: [], strengths_extra: [],
  }).replace('"strengths":[]', '"strengths":[{"text":"Award-winning","cite":"S1","quote":"voted best answering service 2025"}]');
};

test('pure: page text drops scripts and tags; a quote must really be on its page; suggestions need a reason and a real site', () => {
  const t = pageText(SITES['https://rival-answering.com/']);
  assert.ok(t.includes('24/7 answering for dental offices') && !t.includes('steal'));
  const snaps = [{ ref: 'S1', id: 'a', url: 'u', text: t, sha: 'x' }];
  const v = validateCard(JSON.stringify({ claims: [{ text: 'ok', cite: 'S1', quote: 'Plans start at $199 per month' }, { text: 'bad', cite: 'S1', quote: 'cheapest in the country' },
    { text: 'bad', cite: 'S9', quote: 'Plans start at $199 per month' }] }), snaps);
  assert.deepEqual([v.kept, v.dropped, v.doc.claims.length], [1, 2, 1]);
  assert.deepEqual(parseSuggestions(JSON.stringify({ suggestions: [{ name: 'A', website: 'https://a-co.com', reason: 'Sells after-hours answering to dentists in Nashville' },
    { name: 'B', website: 'https://b-co.com', reason: 'similar' }, { name: 'C', website: 'localhost', reason: 'Sells after-hours answering to dentists' },
    { name: 'Us', website: 'https://us.com', reason: 'Sells after-hours answering to dentists in Nashville' }] }), { exclude: ['us.com'] }).map((s) => s.domain), ['a-co.com']);
});

test('suggest: grounded search, each suggestion with its reason and the pages it used; nothing researched until confirmed', async () => {
  reply = (input) => {
    assert.equal(input.grounded, true);
    return JSON.stringify({ suggestions: [{ name: 'Rival Answering', website: 'https://rival-answering.com', reason: 'Sells 24/7 phone answering to dental offices in the Midwest' }] });
  };
  model.generate = (orig => async (input) => ({ ...(await orig(input)), sources: [{ uri: 'https://rival-answering.com/', title: 'Rival' }] }))(model.generate.bind(model));
  const r = await api.call('POST', `${api.W}/competitors/suggest`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const s = r.body.suggestions[0];
  assert.deepEqual([s.status, s.source, s.domain], ['suggested', 'suggested', 'rival-answering.com']);
  assert.match(s.reason, /dental offices/);
  assert.equal(r.body.sources[0].uri, 'https://rival-answering.com/');
  const blocked = await api.call('POST', `${api.W}/competitors/research`, { body: { ids: [s.id] } });
  assert.equal(blocked.status, 409, 'confirm before research spends credits');
  assert.equal((await api.call('POST', `${api.W}/competitors/${s.id}/status`, { body: { status: 'confirmed' } })).body.status, 'confirmed');
});

test('research: snapshots of the homepage and its pricing/about pages; every kept statement quotes its page; invented ones are dropped', async () => {
  reply = honestCard;
  const [c] = await api.q(`SELECT id FROM competitors WHERE domain = 'rival-answering.com'`);
  const r = await api.call('POST', `${api.W}/competitors/research`, { body: { ids: [c.id] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.results[0].outcome, r.body.results[0].version, r.body.results[0].dropped], ['ok', 1, 1]);
  const snaps = await api.q(`SELECT url FROM competitor_snapshots WHERE competitor_id = $1 ORDER BY url`, [c.id]);
  assert.deepEqual(snaps.map((x) => x.url), ['https://rival-answering.com/', 'https://rival-answering.com/about', 'https://rival-answering.com/pricing']);
  const cards = (await api.call('GET', `${api.W}/competitors/${c.id}/battlecards`)).body.items;
  const doc = cards[0].doc;
  assert.equal(doc.strengths.length, 0, 'the "award-winning" claim had no source');
  for (const sec of ['targets', 'claims', 'pricing', 'weaknesses', 'where_we_win', 'objection_handlers']) {
    for (const x of doc[sec]) assert.ok(x.snapshotId && x.url && x.quote, `${sec} statement carries its source`);
  }
  assert.ok(cards[0].sourceRefs.every((x) => /^[0-9a-f]{64}$/.test(x.sha)));
});

test('a re-run shows what changed; the gap map lines competitors up with their sources', async () => {
  const [c] = await api.q(`SELECT id FROM competitors WHERE domain = 'rival-answering.com'`);
  pricingNow = '<p>Starter plan: $249 per month for 200 calls.</p><p>Overage is billed per call.</p>';
  const r = await api.call('POST', `${api.W}/competitors/research`, { body: { ids: [c.id] } });
  assert.equal(r.body.results[0].version, 2);
  const cards = (await api.call('GET', `${api.W}/competitors/${c.id}/battlecards`)).body.items;
  assert.deepEqual(cards.map((x) => x.version), [2, 1]);
  assert.ok(cards[0].changes.pricing, 'the price change shows as a change');
  const g = (await api.call('GET', `${api.W}/competitors/gap-map`)).body;
  const row = g.rows.find((x) => x.competitorId === c.id);
  assert.equal(row.pricingPublic, true);
  assert.ok(g.whereWeWin.every((w) => w.quote && w.url));
  // Battlecards and snapshots are history: the app role can't rewrite or delete them (S8).
  const [m] = await api.q(`SELECT org_id, workspace_id FROM competitors WHERE id = $1`, [c.id]);
  for (const sql of [`UPDATE battlecards SET doc = '{}' WHERE competitor_id = $1`, `DELETE FROM battlecards WHERE competitor_id = $1`,
    `UPDATE competitor_snapshots SET text = 'x' WHERE competitor_id = $1`]) {
    const msg = await as(api.db, 'app_rw', { org: m.org_id, ws: [m.workspace_id] }, () => api.db.query(sql, [c.id])).then(() => null, (e) => e.message);
    assert.match(msg ?? 'allowed', /permission denied/, sql);
  }
});

test('money and roles: credits per competitor, refunded when a site is unreachable; build roles only; client viewers see nothing', async () => {
  const bal = async () => Number((await api.q(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'action'`, [api.demo.org]))[0].balance);
  const dead = (await api.call('POST', `${api.W}/competitors`, { body: { url: 'gone-away-co.com', name: 'Gone' } })).body;
  const b0 = await bal();
  const r = await api.call('POST', `${api.W}/competitors/research`, { body: { ids: [dead.id] } });
  assert.equal(r.body.results[0].outcome, 'site_unreachable');
  assert.equal(await bal(), b0, 'refunded');
  for (const who of ['riley@example.com', 'client@example.com']) {
    assert.equal((await api.call('POST', `${api.W}/competitors`, { as: who, body: { url: 'x-co.com' } })).status, 403, who);
  }
  assert.equal((await api.call('GET', `${api.W}/competitors`, { as: 'client@example.com' })).status, 403);
  assert.equal((await api.call('GET', `${api.W}/competitors/gap-map`, { as: 'riley@example.com' })).status, 200, 'reviewers read it');
  assert.equal((await api.call('POST', `${api.W}/competitors`, { body: { url: 'localhost' } })).status, 400);
});

test('a statement\'s numbers must be in its own quote: a real quote can\'t carry an invented price or term (#54 audit P2-1)', () => {
  const t = pageText(SITES['https://rival-answering.com/pricing']) + ' Simple pricing for every team.';
  const snaps = [{ ref: 'S1', id: 'a', url: 'u', text: t, sha: 'x' }];
  const v = validateCard(JSON.stringify({
    pricing: [
      { text: 'They charge $499 a month and lock you into a 2-year contract.', cite: 'S1', quote: 'Simple pricing for every team' },  // claude-local's repro
      { text: 'Starter is $199 a month for 200 calls', cite: 'S1', quote: 'Starter plan: $199 per month for 200 calls' },
      { text: 'Starter is $149 a month', cite: 'S1', quote: 'Starter plan: $199 per month for 200 calls' },
      { text: 'Overage costs extra', cite: 'S1', quote: 'Overage is billed per call' },
    ],
    objection_handlers: [
      { objection: 'Rival is cheaper', answer: 'Their overage runs 40% over plan.', cite: 'S1', quote: 'Overage is billed per call' },
      { objection: 'Rival is cheaper', answer: 'Their plan covers 200 calls, then bills each call.', cite: 'S1', quote: 'Starter plan: $199 per month for 200 calls' },
    ],
  }), snaps);
  assert.deepEqual(v.doc.pricing.map((x) => x.text), ['Starter is $199 a month for 200 calls', 'Overage costs extra']);
  assert.deepEqual(v.doc.objection_handlers.map((x) => x.answer), ['Their plan covers 200 calls, then bills each call.']);
  assert.deepEqual([v.kept, v.dropped], [3, 3]);
});

test('research claims its competitors: one another run holds is skipped and not charged; a stale claim is taken over (#54 audit P2-2)', async () => {
  reply = honestCard;
  const bal = async () => Number((await api.q(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'action'`, [api.demo.org]))[0].balance);
  const ledger = async (job) => (await api.q(`SELECT kind, delta::int AS d FROM credit_ledger WHERE ref_type = 'battlecard' AND ref_id = $1 ORDER BY id`, [job])).map((x) => [x.kind, x.d]);
  const a = (await api.call('POST', `${api.W}/competitors`, { body: { url: 'rival-answering.com' } })).body;
  const b = (await api.call('POST', `${api.W}/competitors`, { body: { url: 'gone-away-co.com', name: 'Gone' } })).body;
  // Another run holds `a` (its model call is in flight; the test harness serializes requests, so its claim stands in for it).
  await api.q(`UPDATE competitors SET research_job = gen_random_uuid(), research_at = now() WHERE id = $1`, [a.id]);
  const b0 = await bal();
  const only = await api.call('POST', `${api.W}/competitors/research`, { as: 'sam@example.com', body: { ids: [a.id] } });
  assert.deepEqual([only.status, only.body.error], [409, 'conflict'], JSON.stringify(only.body));
  assert.equal(await bal(), b0, 'nothing reserved');
  const both = await api.call('POST', `${api.W}/competitors/research`, { as: 'sam@example.com', body: { ids: [a.id, b.id] } });
  assert.equal(both.status, 201, JSON.stringify(both.body));
  assert.deepEqual(Object.fromEntries(both.body.results.map((x) => [x.competitorId, x.outcome])), { [a.id]: 'already_running', [b.id]: 'site_unreachable' });
  assert.equal(await bal(), b0, 'b reserved then refunded; a never charged');
  assert.deepEqual(await ledger(both.body.job), [['reserve', -2], ['release', 2]]);
  assert.equal((await api.q(`SELECT research_job FROM competitors WHERE id = $1`, [b.id]))[0].research_job, null, 'its own claim let go');
  assert.notEqual((await api.q(`SELECT research_job FROM competitors WHERE id = $1`, [a.id]))[0].research_job, null, 'the other run\'s claim untouched');
  // The other run crashed and never let go: past the lease, a new run takes it over, gets a card, and settles.
  await api.q(`UPDATE competitors SET research_at = now() - interval '16 minutes' WHERE id = $1`, [a.id]);
  const late = await api.call('POST', `${api.W}/competitors/research`, { as: 'sam@example.com', body: { ids: [a.id] } });
  assert.equal(late.body.results[0].outcome, 'ok', JSON.stringify(late.body));
  assert.deepEqual(await ledger(late.body.job), [['reserve', -2], ['settle', 0]]);
  assert.equal(await bal(), b0 - 2);
});

test('a research run that dies mid-way refunds what it didn\'t deliver, settles the rest and lets go of its claims (#54 audit P2-2)', async () => {
  reply = honestCard;
  const bal = async () => Number((await api.q(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'action'`, [api.demo.org]))[0].balance);
  const ids = [];
  for (const url of ['rival-answering.com', 'second-rival.com']) ids.push((await api.call('POST', `${api.W}/competitors`, { body: { url } })).body.id);
  for (const page of ['', 'pricing', 'about']) SITES[`https://second-rival.com/${page}`] = SITES[`https://rival-answering.com/${page}`];
  await api.q(`UPDATE competitors SET research_job = NULL, research_at = NULL WHERE id = ANY ($1::uuid[])`, [ids]);
  // The second card can't be written (a lost connection, a constraint): the request fails after the first was saved.
  await api.q(`CREATE FUNCTION p22_boom() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN IF NEW.competitor_id = '${ids[1]}' THEN RAISE EXCEPTION 'p22 boom'; END IF; RETURN NEW; END $f$`);
  await api.q(`CREATE TRIGGER p22_boom BEFORE INSERT ON battlecards FOR EACH ROW EXECUTE FUNCTION p22_boom()`);
  const b0 = await bal();
  try {
    const r = await api.call('POST', `${api.W}/competitors/research`, { as: 'sam@example.com', body: { ids } });
    assert.ok(r.status >= 400, JSON.stringify(r.body));
  } finally {
    await api.q(`DROP TRIGGER p22_boom ON battlecards`); await api.q(`DROP FUNCTION p22_boom()`); for (const page of ['', 'pricing', 'about']) delete SITES[`https://second-rival.com/${page}`];
  }
  assert.equal(await bal(), b0 - 2, 'one card delivered, one refunded');
  const job = (await api.q(`SELECT ref_id FROM credit_ledger WHERE ref_type = 'battlecard' AND kind = 'reserve' ORDER BY id DESC LIMIT 1`))[0].ref_id;
  assert.deepEqual((await api.q(`SELECT kind, delta::int AS d FROM credit_ledger WHERE ref_id = $1 ORDER BY id`, [job])).map((x) => [x.kind, x.d]),
    [['reserve', -4], ['release', 2], ['settle', 0]]);
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM competitors WHERE id = ANY ($1::uuid[]) AND research_job IS NOT NULL`, [ids]))[0].n, 0);
});

test('suggest: a search that came back settles its credit; one that failed gives it back', async () => {
  const kinds = async () => {
    const job = (await api.q(`SELECT ref_id FROM credit_ledger WHERE ref_type = 'competitor_suggest' ORDER BY id DESC LIMIT 1`))[0].ref_id;
    return (await api.q(`SELECT kind FROM credit_ledger WHERE ref_id = $1 ORDER BY id`, [job])).map((x) => x.kind);
  };
  reply = () => JSON.stringify({ suggestions: [] });
  assert.equal((await api.call('POST', `${api.W}/competitors/suggest`, { as: 'sam@example.com', body: {} })).status, 201);
  assert.deepEqual(await kinds(), ['reserve', 'settle']);
  reply = () => { throw new Error('vertex 500'); };
  assert.equal((await api.call('POST', `${api.W}/competitors/suggest`, { as: 'sam@example.com', body: {} })).status, 502);
  assert.deepEqual(await kinds(), ['reserve', 'release']);
});
