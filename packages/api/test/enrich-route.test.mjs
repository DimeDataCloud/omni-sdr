// POST …/contacts/{id}/enrich: the website enricher (packages/enrich) through the API. The fetch is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { FetchRefused } from '../../enrich/src/fetch.mjs';
import { checkDraft } from '../../gate/src/check.mjs';

const PAGE = '<title>Brightline Dental</title><script src="https://booking.nexhealth.com/w.js"></script><a href="tel:+16155550100">Call</a>';

async function withContact(fetchPage, email = 'lena@brightline-dental.com') {
  const fetched = [];
  const api = await startApi({ config: { fetchPage: async (url) => { fetched.push(url); return fetchPage(url); } } });
  const c = await api.call('POST', `${api.W}/contacts`, { body: { contacts: [{ name: 'Lena', email, company: 'Brightline' }] } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const [{ id }] = await api.q(`SELECT id FROM contacts WHERE email = $1`, [email]);
  return { api, id, fetched };
}

test('enrich: the homepage becomes evidence a first touch can cite; it shows on the contact', async () => {
  const { api, id, fetched } = await withContact(async (url) => ({ url, status: 200, body: PAGE }));
  try {
    const r = await api.call('POST', `${api.W}/contacts/${id}/enrich`);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.enriched, r.body.url, r.body.facts.booking.vendor], [true, 'https://brightline-dental.com/', 'NexHealth']);
    assert.deepEqual(fetched, ['https://brightline-dental.com/']);
    const detail = await api.call('GET', `${api.W}/contacts/${id}`);
    const ev = detail.body.evidence.find((e) => e.id === r.body.evidenceId);
    assert.ok(ev, 'listed on the contact');
    const sentence = ev.facts.booking.text;
    const draft = { step: 0, subject: 'Booking', body: `Hi Lena,\n\n${sentence} Worth a look?`, claims: [{ text: sentence, evidence_id: ev.id, fact_key: 'booking.text' }] };
    const evidence = new Map([[ev.id, { ...ev, contact_id: id, expires_at: ev.expiresAt }]]);
    assert.equal(checkDraft(draft, { contactId: id, evidence, now: new Date(), competitors: [] }).passed, true);
    const [{ n }] = await api.q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'enrich' AND entity_id = $1`, [id]);
    assert.equal(n, 1, 'audited');
  } finally { await api.stop(); }
});

test('enrich: free mail fetches nothing; a refused or failing site says only "unreachable"', async () => {
  const gm = await withContact(async () => { throw new Error('must not fetch'); }, 'lena@gmail.com');
  try {
    const r = await gm.api.call('POST', `${gm.api.W}/contacts/${gm.id}/enrich`);
    assert.deepEqual([r.status, r.body.enriched, r.body.reason, gm.fetched.length], [200, false, 'no_business_domain', 0]);
  } finally { await gm.api.stop(); }
  for (const fail of [async () => { throw new FetchRefused('internal.example.com resolves to a non-public address'); },
    async (url) => ({ url, status: 503, body: '' })]) {
    const x = await withContact(fail);
    try {
      const r = await x.api.call('POST', `${x.api.W}/contacts/${x.id}/enrich`);
      assert.deepEqual([r.status, r.body.enriched, r.body.reason], [200, false, 'site_unreachable']);
      assert.doesNotMatch(JSON.stringify(r.body), /non-public|internal|503/, 'no network detail leaks to the caller');
      assert.equal((await x.api.q(`SELECT count(*)::int AS n FROM evidence WHERE contact_id = $1`, [x.id]))[0].n, 0);
    } finally { await x.api.stop(); }
  }
});

test('enrich: builders only; another workspace\'s contact is 404 and never fetched; rate-limited per org', async () => {
  const { api, id, fetched } = await withContact(async (url) => ({ url, status: 200, body: PAGE }));
  try {
    assert.equal((await api.call('POST', `${api.W}/contacts/${id}/enrich`, { as: 'riley@example.com' })).status, 403, 'reviewer');
    assert.equal((await api.call('POST', `${api.W}/contacts/${id}/enrich`, { as: 'client@example.com' })).status, 403, 'client viewer');
    const other = `/v1/o/${api.demo.org}/w/${api.demo.workspaces[1]}/contacts/${id}/enrich`;
    assert.equal((await api.call('POST', other)).status, 404, 'contact not in that workspace');
    assert.equal(fetched.length, 0, 'nothing fetched for any refused call');
    let limited = 0;
    for (let i = 0; i < 35; i++) if ((await api.call('POST', `${api.W}/contacts/${id}/enrich`)).status === 429) limited++;
    assert.equal(limited, 5, '30 a minute per org');
    assert.equal(fetched.length, 30);
  } finally { await api.stop(); }
});
