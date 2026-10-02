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
