// SDR pivot P1 (0015): replies thread into conversations; a qualified one is handed to a closer, who sees only their
// handoffs and can accept them and record the outcome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { sendDraft } from '../../sender/src/send.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

const convOf = async (inboundId) => (await api.q(`SELECT conversation_id FROM inbound_messages WHERE id = $1`, [inboundId]))[0].conversation_id;

async function sentTo(email) {
  const [d] = await api.q(`SELECT d.id, d.status FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN contacts c ON c.id = e.contact_id
    WHERE c.email = $1 AND d.step = 0 AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.draft_id = d.id)`, [email]);
  if (d.status === 'review') assert.equal((await api.call('POST', `${api.W}/approvals/${d.id}/approve`)).status, 200);
  let raw = '';
  const out = await sendDraft(api.db, { orgId: api.demo.org, workspaceId: api.demo.workspaces[0], draftId: d.id, mailboxId: api.demo.mailbox,
    adapter: { async send(m) { raw = m.raw; return { providerMessageId: 'test' }; } },
    urls: { unsubscribeBase: 'https://app.test', replyDomain: 'reply.omnisdr.com' } });
  assert.equal(out.outcome, 'sent', out.reason);
  return { to: /^Reply-To: (.+)$/mi.exec(raw)[1].trim() };
}

// A closer: a user whose only membership in the org is the closer role.
async function closer(email) {
  assert.equal((await api.call('GET', '/v1/me', { as: email })).status, 200);
  const [u] = await api.q(`SELECT id FROM users WHERE email = $1`, [email]);
  await api.q(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'closer') ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'closer'`,
    [api.demo.org, u.id]);
  return u.id;
}

let thread; let conversationId; let handoffId; let closerId;

test('replies thread into one conversation per contact; the queue and the thread show both sides', async () => {
  const email = 'tom@maplegrove-dental.example';
  await api.q(`UPDATE enrollments SET state = 'waiting', stop_reason = NULL WHERE contact_id = (SELECT id FROM contacts WHERE email = $1)`, [email]);
  thread = await sentTo(email);
  const r1 = await api.signedInbound({ ...thread, from: email, subject: 'Re: hi', body: 'How much does it cost?', receivedAt: new Date(Date.now() + 1000).toISOString(), externalId: '<c1@x>' });
  const r2 = await api.signedInbound({ ...thread, from: email, subject: 'Re: hi', body: 'Can we schedule a call next week?', receivedAt: new Date(Date.now() + 2000).toISOString(), externalId: '<c2@x>' });
  assert.equal(r1.body.outcome, 'recorded');
  assert.ok(await convOf(r1.body.id));
  assert.equal(await convOf(r1.body.id), await convOf(r2.body.id), 'one thread per contact');
  conversationId = await convOf(r2.body.id);

  const q = await api.call('GET', `${api.W}/conversations?state=open`);
  assert.equal(q.status, 200);
  const row = q.body.items.find((x) => x.id === conversationId);
  assert.deepEqual([row.channel, row.category, row.contactEmail, row.lastMessage], ['email', 'meeting_request', email, 'Can we schedule a call next week?']);

  const c = await api.call('GET', `${api.W}/conversations/${conversationId}`);
  assert.deepEqual(c.body.messages.map((m) => m.direction), ['out', 'in', 'in'], 'the sent email, then both replies, oldest first');
  assert.equal(c.body.messages[1].body, 'How much does it cost?');
});

test('an opt-out closes the conversation; nothing else a reply says changes its state', async () => {
  const email = 'aisha@crescent-ortho.example';
  await api.q(`UPDATE enrollments SET state = 'waiting', stop_reason = NULL WHERE contact_id = (SELECT id FROM contacts WHERE email = $1)`, [email]);
  const t = await sentTo(email);
  const r = await api.signedInbound({ ...t, from: email, body: 'Please unsubscribe me.', receivedAt: new Date().toISOString(), externalId: '<u1@x>' });
  const [conv] = await api.q(`SELECT state, category FROM conversations WHERE id = $1`, [await convOf(r.body.id)]);
  assert.deepEqual([conv.state, conv.category], ['closed', 'unsubscribe']);
});

test('handoff: an operator passes it to a closer; the closer sees only that, accepts it and records the outcome', async () => {
  closerId = await closer('cole.closer@example.com');
  const bad = await api.call('POST', `${api.W}/conversations/${conversationId}/handoff`, { as: 'sam@example.com',
    body: { closerId: api.demo.users?.['riley@example.com'] ?? (await api.q(`SELECT id FROM users WHERE email = 'riley@example.com'`))[0].id, reason: 'qualified', summary: 'x' } });
  assert.deepEqual([bad.status, bad.body.details?.field], [400, 'closerId'], 'a reviewer can\'t take handoffs');
  const h = await api.call('POST', `${api.W}/conversations/${conversationId}/handoff`, { as: 'sam@example.com',
    body: { closerId, reason: 'meeting_request', summary: 'Owner, wants a call next week about pricing.', answers: { timing: 'next week', decisionMaker: 'yes' } } });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  handoffId = h.body.id;
  assert.equal((await api.call('POST', `${api.W}/conversations/${conversationId}/handoff`, { as: 'sam@example.com',
    body: { closerId, reason: 'qualified', summary: 'again' } })).status, 409, 'one open handoff at a time');
  const [conv] = await api.q(`SELECT state, closer_id FROM conversations WHERE id = $1`, [conversationId]);
  assert.deepEqual([conv.state, conv.closer_id], ['handed_off', closerId]);

  // The closer: their handoff and its thread; nothing else.
  const mine = await api.call('GET', `${api.W}/handoffs`, { as: 'cole.closer@example.com' });
  assert.deepEqual(mine.body.items.map((x) => x.id), [handoffId]);
  const one = await api.call('GET', `${api.W}/handoffs/${handoffId}`, { as: 'cole.closer@example.com' });
  assert.equal(one.body.conversation.messages.length, 3);
  assert.deepEqual(one.body.answers, { timing: 'next week', decisionMaker: 'yes' });
  for (const path of ['conversations', `conversations/${conversationId}`, 'inbox', 'approvals', 'contacts', 'analytics?days=30', 'agents']) {
    assert.equal((await api.call('GET', `${api.W}/${path}`, { as: 'cole.closer@example.com' })).status, 403, path);
  }
  assert.equal((await api.call('POST', `${api.W}/handoffs/${handoffId}/accept`, { as: 'sam@example.com' })).status, 403, 'only the closer accepts');
  const acc = await api.call('POST', `${api.W}/handoffs/${handoffId}/accept`, { as: 'cole.closer@example.com' });
  assert.ok(acc.body.acceptedAt);
  const done = await api.call('POST', `${api.W}/handoffs/${handoffId}/outcome`, { as: 'cole.closer@example.com', body: { outcome: 'won' } });
  assert.equal(done.body.outcome, 'won');
  assert.equal((await api.q(`SELECT state FROM conversations WHERE id = $1`, [conversationId]))[0].state, 'closed');
  assert.equal((await api.call('POST', `${api.W}/handoffs/${handoffId}/outcome`, { as: 'cole.closer@example.com', body: { outcome: 'lost' } })).status, 409);
});

test('a second closer sees none of it, even by id; reviewers and client viewers can\'t hand off', async () => {
  await closer('dee.closer@example.com');
  assert.deepEqual((await api.call('GET', `${api.W}/handoffs?open=false`, { as: 'dee.closer@example.com' })).body.items, []);
  assert.equal((await api.call('GET', `${api.W}/handoffs/${handoffId}`, { as: 'dee.closer@example.com' })).status, 404, 'RLS hides another closer\'s handoff');
  for (const who of ['riley@example.com', 'client@example.com', 'dee.closer@example.com']) {
    assert.equal((await api.call('POST', `${api.W}/conversations/${conversationId}/handoff`, { as: who,
      body: { closerId, reason: 'qualified', summary: 'x' } })).status, 403, who);
  }
  const all = await api.call('GET', `${api.W}/handoffs?open=false`, { as: 'maya@example.com' });
  assert.ok(all.body.items.some((x) => x.id === handoffId), 'an admin sees the workspace\'s handoffs');
});

test('form submissions thread too: one conversation per address on the form channel; an anonymous one stands alone', async () => {
  const h = await api.call('POST', `${api.W}/hooks`, { body: { name: 'Site' } });
  assert.equal(h.status, 201);
  const post = (body) => api.call('POST', `/v1/hooks/${h.body.id}`, { as: null, token: h.body.token, body });
  for (const message of ['Do you take new patients?', 'Also, are you open Saturdays?']) {
    assert.equal((await post({ message, email: 'pat@form.example' })).status, 202);
  }
  assert.equal((await post({ message: 'hi, call me' })).status, 202);
  const rows = await api.q(`SELECT i.conversation_id, c.channel, c.thread_key FROM inbound_messages i JOIN conversations c ON c.id = i.conversation_id
    WHERE i.channel = 'form' ORDER BY i.received_at`);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].conversation_id, rows[1].conversation_id, 'same address, same thread');
  assert.notEqual(rows[2].conversation_id, rows[0].conversation_id);
  assert.match(rows[2].thread_key, /^submission:/);
  const q = await api.call('GET', `${api.W}/conversations?channel=form`);
  assert.equal(q.body.items.length, 2);
});
