// S2L-2c: POST /v1/hooks/:id now records the message AND its lead event in one transaction (ingestFormLead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';

async function withHook() {
  const api = await startApi();
  const r = await api.call('POST', `${api.W}/hooks`, { body: { name: 'Website form' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const post = (body, { token = r.body.token, id = r.body.id } = {}) => api.call('POST', `/v1/hooks/${id}`, { as: null, token, body });
  return { api, hook: r.body, post };
}

test('hooks: a submission through the route is one message and one web_form lead event sharing one external id', async () => {
  const { api, post } = await withHook();
  try {
    const res = await post({ message: 'Can you quote a deck rebuild?', email: 'dana@lead.example', name: 'Dana', page: '/decks', externalId: 'site-77' });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    const m = await api.q(`SELECT external_id FROM inbound_messages WHERE channel = 'form' AND external_id = 'site-77'`);
    const l = await api.q(`SELECT source, channel, consent_basis, external_id, payload FROM lead_events WHERE external_id = 'site-77'`);
    assert.equal(m.length, 1);
    assert.deepEqual(l.map((x) => [x.source, x.channel, x.consent_basis, x.payload]), [['web_form', 'form', 'express_form', { page: '/decks' }]]);
    assert.equal((await post({ message: 'Can you quote a deck rebuild?', email: 'dana@lead.example', externalId: 'site-77' })).status, 200, 'a retry is a duplicate');
    assert.equal((await api.q(`SELECT 1 FROM lead_events WHERE external_id = 'site-77'`)).length, 1);
  } finally { await api.stop(); }
});

test('hooks: a client id that looks like an address is stored hashed in both rows; nothing identifying is stored', async () => {
  const { api, post } = await withHook();
  try {
    assert.equal((await post({ message: 'hello there', email: 'e@lead.example', externalId: 'pat@lead.example' })).status, 202);
    const l = await api.q(`SELECT external_id FROM lead_events WHERE external_id LIKE 'h:%'`);
    assert.equal(l.length, 1);
    assert.equal((await api.q(`SELECT 1 FROM inbound_messages WHERE external_id = $1`, [l[0].external_id])).length, 1);
    assert.equal((await api.q(`SELECT 1 FROM inbound_messages WHERE channel = 'form' AND external_id LIKE '%@%'`)).length, 0);
  } finally { await api.stop(); }
});

test('hooks: wrong token and unknown hook still answer 404 and write no lead event', async () => {
  const { api, post } = await withHook();
  try {
    const before = (await api.q(`SELECT count(*)::int AS n FROM lead_events`))[0].n;
    assert.equal((await post({ message: 'x' }, { token: 'A'.repeat(43) })).status, 404);
    assert.equal((await post({ message: 'x' }, { id: '00000000-0000-4000-8000-000000000000' })).status, 404);
    assert.equal((await api.q(`SELECT count(*)::int AS n FROM lead_events`))[0].n, before);
  } finally { await api.stop(); }
});

// Halo's P3-4 ruling: express_form stays, and a lead whose address was only typed into a form is approval-mode only. Nothing
// auto-sends today; this pins that a web-form lead cannot reach auto-send: the playbook reports it off, and the database refuses
// to count a form reply toward autonomy (the counter that would earn it).
test('hooks: a typed-address lead cannot reach auto-send: autonomy is off and a form reply never counts toward it', async () => {
  const { api, post } = await withHook();
  try {
    assert.equal((await post({ message: 'Do you do kitchens? Quote me please.', email: 'typed@lead.example', externalId: 'typed-1' })).status, 202);
    const pb = await api.call('GET', `${api.W}/playbook`);
    assert.equal(pb.body.autonomy.autoSend, false);
    assert.ok(pb.body.autonomy.categories.every((c) => c.eligible === false), 'no category is eligible for auto-send');
    assert.equal((await api.q(`SELECT 1 FROM reply_drafts d JOIN inbound_messages i ON i.id = d.inbound_message_id
                                WHERE i.external_id = 'typed-1' AND d.counts_for_autonomy`)).length, 0, 'a form reply is never countable');
    const def = (await api.q(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'reply_drafts'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%counts_for_autonomy%'`)).map((r) => r.d).join(' ');
    assert.match(def, /channel <> 'form'/, 'the CHECK that keeps form replies out of the autonomy counter is still there');
  } finally { await api.stop(); }
});
