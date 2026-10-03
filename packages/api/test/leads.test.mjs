// Level F (0012): "Find 50 Nashville dental practices" → leads with evidence from their own sites and a fit score
// (acceptance step 5; Station 11). Places search is a fake here; the real adapter ships off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { fakePlaces, googlePlaces } from '../src/services/places.mjs';
import { fitScore } from '../src/services/fit.mjs';
import { emailOn, companyFrom } from '../src/services/leads.mjs';

// 30 businesses: every 7th has no website, the 5th site is down, and the search's own names are never what we store.
const PLACES = Array.from({ length: 30 }, (_, i) => ({
  placeId: `place_${String(i).padStart(4, '0')}_abcdef`, name: `PLACES-NAME-${i}`, address: `${100 + i} Main St, Nashville, TN`,
  website: i % 7 === 6 ? null : `https://www.dent-${i}.example/?utm_source=maps`,
}));
const site = (i) => `<html><head><title>Dent ${i} Family Dental | Nashville</title></head><body><h1>Gentle dental care in Nashville</h1>`
  + `<a href="mailto:office@dent-${i}.example">Email us</a>${i % 2 ? '' : `<a href="mailto:dr.lee@dent-${i}.example">Dr. Lee</a>`}`
  + `<a href="mailto:someone@gmail.com">x</a><a href="https://calendly.com/dent-${i}">Book online</a></body></html>`;
const fetched = [];
const fetchPage = async (url) => {
  fetched.push(url);
  const i = Number(/dent-(\d+)\.example/.exec(url)?.[1]);
  if (Number.isNaN(i) || i === 4) throw new Error('unreachable');
  return { url, status: 200, body: site(i) };
};
const places = fakePlaces(PLACES);
let api;
before(async () => { api = await startApi({ config: { places, fetchPage } }); });
after(async () => { await api.stop(); });

const dataBal = async () => Number((await api.q(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'data'`, [api.demo.org]))[0]?.balance ?? 0);
const ledger = async (job) => (await api.q(`SELECT kind, delta::int AS d FROM credit_ledger WHERE ref_type = 'lead_find' AND ref_id = $1 ORDER BY id`, [job])).map((x) => [x.kind, x.d]);

test('pure: the fit score is deterministic and judges only what the lead shows; a site\'s own address, named inbox first', () => {
  const icp = { id: 'i', version: 2, data: { traits: [{ kind: 'industry', value: 'Dental practices' }, { kind: 'region', value: 'Nashville area' },
    { kind: 'title', value: 'Owner' }, { kind: 'size', value: '5-20 staff' }, { kind: 'industry', value: 'Veterinary clinics', weak: true }] } };
  const lead = { company: 'Dent 1 Family Dental', text: 'Gentle dental care', place: '101 Main St, Nashville, TN' };
  const a = fitScore(icp, lead);
  assert.deepEqual(a, fitScore(icp, lead), 'same lead, same ICP version, same score');
  // industry (1) + region (1) matched, veterinary (weak, 0.5) missed; title and size can't be judged so don't count.
  assert.equal(a.score, Math.round(100 * 2 / 2.5));
  assert.deepEqual(a.fit.matched, ['industry: Dental practices', 'region: Nashville area']);
  assert.deepEqual(a.fit.missed, ['industry: Veterinary clinics']);
  assert.equal(fitScore(null, lead).score, null, 'no ICP, no score');
  assert.equal(fitScore(icp, { company: 'Acme Plumbing', text: 'Pipes', place: 'Denver, CO' }).score, 0);
  assert.deepEqual(emailOn(site(2), 'dent-2.example'), { email: 'dr.lee@dent-2.example', status: 'unknown', role: false });
  assert.deepEqual(emailOn(site(1), 'dent-1.example'), { email: 'office@dent-1.example', status: 'unknown', role: true });
  assert.equal(emailOn('<a href="mailto:a@other.example">', 'dent-1.example'), null, 'another domain is not this business');
  assert.equal(companyFrom('Dent 1 Family Dental | Nashville', 'dent-1.example'), 'Dent 1 Family Dental');
  assert.equal(companyFrom('', 'dent-1.example'), 'dent-1.example');
});

test('find: new businesses with a site become leads with evidence, an address and a fit score; only the place id is kept from the search', async () => {
  const icp = await api.call('POST', `${api.W}/icps`, { body: { name: 'Nashville dental', data: { summary: 's',
    traits: [{ kind: 'industry', value: 'Dental practices', rows: [1, 2] }, { kind: 'region', value: 'Nashville area', rows: [1, 2] }] } } });
  assert.equal(icp.status, 201, JSON.stringify(icp.body));
  const est = (await api.call('GET', `${api.W}/leads/find/estimate?limit=25`)).body;
  assert.deepEqual([est.credits.data, est.available], [2, true]);
  const b0 = await dataBal();
  const r = await api.call('POST', `${api.W}/leads/find`, { body: { query: 'dental practices in Nashville', limit: 25 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // 25 picked from the first 29 results (4 of them have no site), over 2 pages.
  assert.equal(r.body.leads.length, 25);
  assert.equal(r.body.skipped.noWebsite, 4);
  assert.deepEqual([r.body.credits.data, await dataBal()], [2, b0 - 2]);
  assert.deepEqual(await ledger(r.body.job), [['reserve', -2], ['settle', 0]]);
  for (const l of r.body.leads) {
    assert.ok(l.evidenceId || l.evidence === 'no_evidence_found', JSON.stringify(l));
    assert.equal(l.fitScore, l.evidenceId ? 100 : 50, 'industry from the site, region from the place');
  }
  const down = r.body.leads.find((l) => l.website.includes('dent-4.'));
  assert.deepEqual([down.evidence, down.email], ['no_evidence_found', null]);
  const rows = await api.q(`SELECT company, email, email_status, website, place_id, fit FROM contacts WHERE place_id IS NOT NULL ORDER BY place_id`);
  assert.equal(rows.length, 25);
  assert.ok(rows.every((x) => !JSON.stringify(x).includes('PLACES-NAME') && !JSON.stringify(x).includes('Main St')), 'nothing else from the search is stored');
  assert.ok(rows.every((x) => !x.website.includes('utm_')), 'the site is fetched clean');
  assert.equal(rows.find((x) => x.place_id.startsWith('place_0002')).email, 'dr.lee@dent-2.example');
  assert.equal(rows.find((x) => x.place_id.startsWith('place_0001')).company, 'Dent 1 Family Dental');
  assert.ok(rows.every((x) => x.email === null || x.email.endsWith('.example')), 'never a free-mail address from the page');
  const ev = await api.q(`SELECT e.facts FROM evidence e JOIN contacts c ON c.id = e.contact_id WHERE c.place_id = $1`, [PLACES[2].placeId]);
  assert.equal(ev[0].facts.booking.online, true);
});

test('finding again adds no duplicates; a smaller run costs one page', async () => {
  const before = (await api.q(`SELECT count(*)::int AS n FROM contacts WHERE place_id IS NOT NULL`))[0].n;
  const r = await api.call('POST', `${api.W}/leads/find`, { body: { query: 'dental practices in Nashville', limit: 5 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.leads.length, 0, 'the first page holds only businesses already found');
  assert.ok(r.body.skipped.alreadyLeads >= 16);
  assert.equal(r.body.credits.data, 1);
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM contacts WHERE place_id IS NOT NULL`))[0].n, before);
});

test('money and roles: a failed search refunds everything; short balance refuses up front; build roles only; off answers 503', async () => {
  const failing = await startApi({ config: { places: fakePlaces(PLACES, { fail: new Error('places 500') }), fetchPage } });
  try {
    const b0 = Number((await failing.q(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'data'`, [failing.demo.org]))[0].balance);
    const r = await failing.call('POST', `${failing.W}/leads/find`, { body: { query: 'dentists', limit: 50 } });
    assert.deepEqual([r.status, r.body.error], [502, 'search_failed']);
    const job = (await failing.q(`SELECT ref_id FROM credit_ledger WHERE ref_type = 'lead_find' ORDER BY id DESC LIMIT 1`))[0].ref_id;
    assert.deepEqual((await failing.q(`SELECT kind, delta::int AS d FROM credit_ledger WHERE ref_id = $1 ORDER BY id`, [job])).map((x) => [x.kind, x.d]), [['reserve', -3], ['release', 3]]);
    assert.equal(Number((await failing.q(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'data'`, [failing.demo.org]))[0].balance), b0);
  } finally { await failing.stop(); }
  await api.q(`UPDATE credit_balances SET balance = 0 WHERE org_id = $1 AND meter = 'data'`, [api.demo.org]);
  const short = await api.call('POST', `${api.W}/leads/find`, { as: 'sam@example.com', body: { query: 'dentists', limit: 10 } });
  assert.deepEqual([short.status, short.body.error], [402, 'insufficient_credits']);
  await api.q(`UPDATE credit_balances SET balance = 100 WHERE org_id = $1 AND meter = 'data'`, [api.demo.org]);
  for (const who of ['riley@example.com', 'client@example.com']) {
    assert.equal((await api.call('POST', `${api.W}/leads/find`, { as: who, body: { query: 'dentists' } })).status, 403, who);
  }
  const off = await startApi();
  try {
    const r = await off.call('POST', `${off.W}/leads/find`, { body: { query: 'dentists' } });
    assert.deepEqual([r.status, r.body.error], [503, 'places_off']);
    assert.equal((await off.call('GET', `${off.W}/leads/find/estimate`)).body.available, false);
  } finally { await off.stop(); }
});

test('the real adapter: the key goes only in its header, only the fields we use are asked for', async () => {
  let seen;
  const g = googlePlaces({ key: 'k-test-not-real', fetchImpl: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({
    places: [{ id: 'ChIJabc123xyz', displayName: { text: 'A' }, websiteUri: 'https://a.example/', formattedAddress: 'Nashville' }], nextPageToken: 't2' })); } });
  const out = await g.search({ query: 'dentists in Nashville' });
  assert.deepEqual(out, { places: [{ placeId: 'ChIJabc123xyz', name: 'A', website: 'https://a.example/', address: 'Nashville' }], next: 't2' });
  assert.equal(seen.url, 'https://places.googleapis.com/v1/places:searchText');
  assert.ok(!seen.url.includes('k-test') && !seen.init.body.includes('k-test'));
  assert.equal(seen.init.headers['x-goog-api-key'], 'k-test-not-real');
  assert.match(seen.init.headers['x-goog-fieldmask'], /^places\.id,places\.displayName,places\.websiteUri,places\.formattedAddress,nextPageToken$/);
});

test('#58 audit: a place id outside the rule is skipped, not a lost batch; the site kept is an origin; an unknown icpId is a 404 before any spend', async () => {
  const long = `https://long-0.example/${'a'.repeat(400)}?q=${'b'.repeat(50)}`;
  const list = [{ placeId: 'good_place_0001', website: 'https://www.dent-1.example/', address: 'Nashville' },
    { placeId: 'bad.id', website: 'https://www.dent-2.example/', address: 'Nashville' },
    { placeId: 'good_place_0003', website: 'https://www.dent-3.example/', address: 'Nashville' },
    { placeId: 'good_place_0004', website: 'https://long-0.example/', address: 'Nashville' }];
  const fetchLong = async (url) => (url.includes('long-0') ? { url: long, status: 200, body: '<title>Long Co</title>' } : fetchPage(url));
  const local = await startApi({ config: { places: fakePlaces(list), fetchPage: fetchLong } });
  try {
    const bal = async () => Number((await local.q(`SELECT balance FROM credit_balances WHERE org_id = $1 AND meter = 'data'`, [local.demo.org]))[0].balance);
    // An ICP from the other workspace: not visible here, so a 404, and nothing reserved.
    const other = (await local.call('POST', `${local.ws(1)}/icps`, { body: { name: 'Elsewhere', data: { traits: [] } } })).body;
    const b0 = await bal();
    const nope = await local.call('POST', `${local.W}/leads/find`, { body: { query: 'dentists', limit: 4, icpId: other.id } });
    assert.deepEqual([nope.status, await bal()], [404, b0]);
    const r = await local.call('POST', `${local.W}/leads/find`, { body: { query: 'dentists', limit: 4 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.skipped.badPlace, 1);
    assert.equal(r.body.leads.length, 3, 'the good rows are kept');
    const longLead = r.body.leads.find((l) => l.company === 'Long Co');
    assert.equal(longLead.website, 'https://long-0.example/');
    assert.deepEqual((await local.q(`SELECT website FROM contacts WHERE place_id = 'good_place_0004'`))[0], { website: 'https://long-0.example/' });
  } finally { await local.stop(); }
});
