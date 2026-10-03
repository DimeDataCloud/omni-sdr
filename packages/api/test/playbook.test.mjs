// SDR pivot P3 (0017): playbook replies per category, filled from what we know; a qualification question asked along
// the way; a person approves, edits or discards each draft; the autonomy counter counts unedited approvals.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

async function formConversation(email, message, name = 'Jo Rivera') {
  const h = await api.call('POST', `${api.W}/hooks`, { body: { name: `Site ${email}` } });
  assert.equal((await api.call('POST', `/v1/hooks/${h.body.id}`, { as: null, token: h.body.token, body: { message, email, name } })).status, 202);
  return (await api.q(`SELECT conversation_id FROM inbound_messages WHERE from_address = $1`, [email]))[0].conversation_id;
}

test('the playbook: fields are checked when written; reviewers read it, only builders change it; questions in order', async () => {
  const bad = await api.call('POST', `${api.W}/playbook/replies`, { body: { category: 'question', name: 'Typo', body: 'Hi {firstname}' } });
  assert.deepEqual([bad.status, bad.body.details?.field], [400, 'body']);
  assert.equal((await api.call('POST', `${api.W}/playbook/replies`, { body: { category: 'unsubscribe', name: 'x', body: 'x' } })).status, 400, 'opt-outs are never answered');
  const ok = await api.call('POST', `${api.W}/playbook/replies`, { body: { category: 'question',
    name: 'Pricing', body: 'Hi {first_name}, thanks for asking. Pricing starts at a flat monthly fee; happy to walk you through it.', asksNextQuestion: true } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await api.call('POST', `${api.W}/playbook/replies`, { body: { category: 'question', name: 'pricing', body: 'x' } })).status, 409);
  await api.call('POST', `${api.W}/playbook/replies`, { body: { category: 'meeting_request', name: 'Book', body: 'Great, {first_name}. Pick a time here: {booking_link}' } });
  const qs = await api.call('PUT', `${api.W}/playbook/questions`, { body: { questions: [
    { key: 'timing', question: 'When are you hoping to get started?' }, { key: 'decision_maker', question: 'Who else is involved in the decision?' }] } });
  assert.equal(qs.status, 200, JSON.stringify(qs.body));
  const pb = await api.call('GET', `${api.W}/playbook`, { as: 'riley@example.com' });
  assert.equal(pb.status, 200);
  assert.deepEqual(pb.body.questions.map((q) => q.key), ['timing', 'decision_maker']);
  assert.equal(pb.body.autonomy.autoSend, false);
  assert.equal((await api.call('POST', `${api.W}/playbook/replies`, { as: 'riley@example.com', body: { category: 'question', name: 'r', body: 'x' } })).status, 403);
});

test('a draft: filled, the next question appended, approve unchanged or edited; asked questions are not asked again', async () => {
  const conv = await formConversation('jo@clinic.example', 'How much does this cost per month?');
  const d = await api.call('POST', `${api.W}/conversations/${conv}/reply-draft`, { as: 'sam@example.com' });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal(d.body.bodyProposed, 'Hi Jo, thanks for asking. Pricing starts at a flat monthly fee; happy to walk you through it.\n\nWhen are you hoping to get started?');
  assert.deepEqual([d.body.channel, d.body.countsForAutonomy, d.body.questionKey], ['form', false, 'timing']);
  assert.equal((await api.call('POST', `${api.W}/reply-drafts/${d.body.id}/approve`, { as: 'riley@example.com' })).status, 403, 'a reviewer reads, does not answer');
  const ap = await api.call('POST', `${api.W}/reply-drafts/${d.body.id}/approve`, { as: 'sam@example.com', body: { body: `${d.body.bodyProposed} Talk soon.` } });
  assert.deepEqual([ap.status, ap.body.status, ap.body.edited], [200, 'approved', true]);
  assert.equal((await api.call('POST', `${api.W}/reply-drafts/${d.body.id}/approve`, { as: 'sam@example.com' })).status, 409);
  const [ev] = await api.q(`SELECT payload FROM outbox WHERE topic = 'reply.approved' AND key = $1`, [d.body.id]);
  assert.ok(ev, 'queued for the send step');
  // Next draft asks the next question.
  const d2 = await api.call('POST', `${api.W}/conversations/${conv}/reply-draft`, { as: 'sam@example.com' });
  assert.match(d2.body.bodyProposed, /Who else is involved in the decision\?$/);
  // A meeting ask: {booking_link} needs the acting person's link; without it the draft is refused, not sent with a gap.
  const conv2 = await formConversation('kim@studio.example', 'Can we set up a call next week?', 'Kim Lee');
  const miss = await api.call('POST', `${api.W}/conversations/${conv2}/reply-draft`, { as: 'sam@example.com' });
  assert.deepEqual([miss.status, miss.body.details?.missing], [409, ['booking_link']]);
  await api.call('PUT', `${api.W}/me/booking-link`, { as: 'sam@example.com', body: { url: 'https://cal.example/sam' } });
  const ok = await api.call('POST', `${api.W}/conversations/${conv2}/reply-draft`, { as: 'sam@example.com' });
  assert.equal(ok.body.bodyProposed, 'Great, Kim. Pick a time here: https://cal.example/sam');
  const dis = await api.call('POST', `${api.W}/reply-drafts/${ok.body.id}/discard`, { as: 'sam@example.com' });
  assert.equal(dis.body.status, 'discarded');
});

test('autonomy: only countable decisions, last 50 per category; never auto-send; a closed conversation gets no draft', async () => {
  // An email conversation (counts) with three decisions: two unedited, one edited.
  const [seed] = await api.q(`SELECT c.id FROM conversations c WHERE c.channel = 'email' LIMIT 1`);
  let conv = seed?.id;
  if (!conv) {
    const [i] = await api.q(`SELECT org_id, workspace_id, contact_id FROM inbound_messages WHERE channel = 'email' AND contact_id IS NOT NULL LIMIT 1`);
    conv = (await api.q(`INSERT INTO conversations (org_id, workspace_id, contact_id, channel, thread_key, category) VALUES ($1, $2, $3, 'email', $4, 'question') RETURNING id`,
      [i.org_id, i.workspace_id, i.contact_id, `contact:${i.contact_id}`]))[0].id;
  }
  await api.q(`UPDATE conversations SET category = 'question', state = 'open' WHERE id = $1`, [conv]);
  for (const edit of [false, false, true]) {
    const d = await api.call('POST', `${api.W}/conversations/${conv}/reply-draft`, { as: 'sam@example.com' });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    await api.call('POST', `${api.W}/reply-drafts/${d.body.id}/approve`, { as: 'sam@example.com', body: edit ? { body: 'Changed.' } : {} });
  }
  const pb = await api.call('GET', `${api.W}/playbook`);
  const q = pb.body.autonomy.categories.find((c) => c.category === 'question');
  assert.deepEqual([q.decided, q.unedited, q.edited, q.eligible], [3, 2, 1, false], 'the form draft above never counts');
  // A closed conversation gets no draft (nor does a handed-off one: the closer owns it then).
  await api.q(`UPDATE conversations SET state = 'closed' WHERE id = $1`, [conv]);
  assert.equal((await api.call('POST', `${api.W}/conversations/${conv}/reply-draft`, { as: 'sam@example.com' })).status, 409);
});
