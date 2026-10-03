// SDR pivot P4 (0016): the closer's side. A draft card to start from, an accept-by time that escalates to the workspace
// once, and each member's own booking link on the closer's card.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { escalateHandoffs } from '../src/services/conversations.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

async function closer(email) {
  assert.equal((await api.call('GET', '/v1/me', { as: email })).status, 200);
  const [u] = await api.q(`SELECT id FROM users WHERE email = $1`, [email]);
  await api.q(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'closer') ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'closer'`, [api.demo.org, u.id]);
  return u.id;
}

// A conversation from the website form: the shortest way to get one.
async function formConversation(email, message) {
  const h = await api.call('POST', `${api.W}/hooks`, { body: { name: `Site ${email}` } });
  assert.equal((await api.call('POST', `/v1/hooks/${h.body.id}`, { as: null, token: h.body.token, body: { message, email, name: 'Jo Rivera' } })).status, 202);
  return (await api.q(`SELECT conversation_id FROM inbound_messages WHERE from_address = $1`, [email]))[0].conversation_id;
}

let convId; let closerId; let handoffId;

test('the draft card: who, where, what they asked, their words; and only people who can take it', async () => {
  closerId = await closer('cole.closer@example.com');
  convId = await formConversation('jo@clinic.example', 'Can we book a call this week to talk pricing?');
  const d = await api.call('GET', `${api.W}/conversations/${convId}/handoff-draft`, { as: 'sam@example.com' });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.reason, 'meeting_request');
  assert.match(d.body.summary, /^Jo Rivera asked for a meeting via the website form; 1 message from them so far\. Last message: "Can we book a call/);
  const emails = d.body.closers.map((c) => c.email);
  assert.equal(emails[0], 'cole.closer@example.com', 'closers first');
  assert.ok(!emails.includes('riley@example.com'), 'a reviewer can\'t take handoffs');
  assert.equal((await api.call('GET', `${api.W}/conversations/${convId}/handoff-draft`, { as: 'cole.closer@example.com' })).status, 403);
});

test('booking link: the closer sets their own (https only); it shows on their card', async () => {
  const bad = await api.call('PUT', `${api.W}/me/booking-link`, { as: 'cole.closer@example.com', body: { url: 'http://cal.example/cole' } });
  assert.deepEqual([bad.status, bad.body.details?.field], [400, 'url']);
  const ok = await api.call('PUT', `${api.W}/me/booking-link`, { as: 'cole.closer@example.com', body: { url: 'https://cal.example/cole' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await api.call('GET', `${api.W}/me/booking-link`, { as: 'cole.closer@example.com' })).body.url, 'https://cal.example/cole');
  assert.equal((await api.call('GET', `${api.W}/me/booking-link`)).body.url, null, 'the admin\'s own is untouched');
  assert.equal((await api.call('PUT', `${api.W}/me/booking-link`, { as: 'riley@example.com', body: { url: 'https://x.example/' } })).status, 403);

  const h = await api.call('POST', `${api.W}/conversations/${convId}/handoff`, { as: 'sam@example.com',
    body: { closerId, reason: 'meeting_request', summary: 'Jo wants a pricing call this week.', answers: { timing: 'this week' } } });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  handoffId = h.body.id;
  assert.ok(new Date(h.body.dueAt) > new Date(), 'an accept-by time in the future');
  const [ev] = await api.q(`SELECT payload FROM outbox WHERE topic = 'notify.handoff' AND key = $1`, [`${handoffId}:new`]);
  assert.equal(ev.payload.closer_id ?? JSON.parse(ev.payload).closer_id, closerId);

  const card = await api.call('GET', `${api.W}/handoffs/${handoffId}`, { as: 'cole.closer@example.com' });
  assert.equal(card.status, 200);
  assert.deepEqual([card.body.bookingUrl, card.body.contact.email, card.body.contact.name, card.body.overdue],
    ['https://cal.example/cole', 'jo@clinic.example', 'Jo Rivera', false]);
  assert.equal(card.body.conversation.messages.length, 1);
});

test('overdue: one alert to the workspace, once; the closer\'s list shows it first; accepting stops it', async () => {
  // A second, older handoff that is already late.
  const conv2 = await formConversation('kim@studio.example', 'Ready to sign up, who do I talk to?');
  const h2 = await api.call('POST', `${api.W}/conversations/${conv2}/handoff`, { as: 'sam@example.com', body: { closerId, reason: 'qualified', summary: 'Kim is ready.' } });
  assert.equal(h2.status, 201);
  await api.q(`UPDATE handoffs SET created_at = now() - interval '2 days', due_at = now() - interval '1 hour' WHERE id = $1`, [h2.body.id]);

  assert.equal(await escalateHandoffs(api.db), 1);
  assert.equal(await escalateHandoffs(api.db), 0, 'once');
  const bell = await api.call('GET', `${api.W}/notifications`);
  const alert = bell.body.items.find((n) => n.handoffId === h2.body.id);
  assert.deepEqual([alert?.kind, alert?.contactName], ['handoff_overdue', 'Jo Rivera']);
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM outbox WHERE topic = 'notify.handoff' AND key = $1`, [`${h2.body.id}:overdue`]))[0].n, 1);
  assert.equal((await api.call('GET', `${api.W}/notifications`, { as: 'cole.closer@example.com' })).status, 403, 'a closer has no workspace bell');

  const mine = await api.call('GET', `${api.W}/handoffs`, { as: 'cole.closer@example.com' });
  assert.deepEqual(mine.body.items.map((x) => [x.id, x.overdue]), [[h2.body.id, true], [handoffId, false]]);
  assert.equal((await api.call('POST', `${api.W}/handoffs/${h2.body.id}/accept`, { as: 'cole.closer@example.com' })).status, 200);
  const after = await api.call('GET', `${api.W}/handoffs`, { as: 'cole.closer@example.com' });
  assert.deepEqual(after.body.items.map((x) => [x.id, x.overdue]), [[handoffId, false], [h2.body.id, false]], 'unaccepted first');
});
