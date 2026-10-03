// SDR pivot P7: a LinkedIn message pasted in by a person. Omni never reads or sends on LinkedIn; the pasted message is
// triaged and threaded like any reply, and the answer is copied back by hand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { normalizeLinkedIn } from '../src/services/inbox.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

test('profile links: linkedin.com/in or /company only, normalized', () => {
  assert.equal(normalizeLinkedIn('https://www.linkedin.com/in/Jo-Rivera-123/?trk=x'), 'in/jo-rivera-123');
  assert.equal(normalizeLinkedIn('https://uk.linkedin.com/in/jo'), 'in/jo');
  for (const bad of ['http://linkedin.com/in/jo', 'https://linkedin.com.evil.example/in/jo', 'https://evil.example/linkedin.com/in/jo', 'javascript:alert(1)']) {
    assert.equal(normalizeLinkedIn(bad), null, bad);
  }
});

test('a pasted message: triaged, threaded per profile, in the inbox; only people who answer replies can paste', async () => {
  const body = { name: 'Jo Rivera', profileUrl: 'https://www.linkedin.com/in/jo-rivera/', body: 'Thanks for connecting. Could we set up a call next week?' };
  const r1 = await api.call('POST', `${api.W}/conversations/paste`, { as: 'sam@example.com', body });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.intent, 'meeting_request');
  assert.ok(r1.body.slaDueAt, 'a meeting ask starts the SLA');
  const r2 = await api.call('POST', `${api.W}/conversations/paste`, { as: 'sam@example.com',
    body: { ...body, profileUrl: 'https://linkedin.com/in/JO-RIVERA', body: 'Also, what does it cost?' } });
  assert.equal(r2.body.conversationId, r1.body.conversationId, 'same profile, same thread');
  const [conv] = await api.q(`SELECT channel, thread_key FROM conversations WHERE id = $1`, [r1.body.conversationId]);
  assert.deepEqual([conv.channel, conv.thread_key], ['linkedin', 'profile:in/jo-rivera']);
  const inbox = await api.call('GET', `${api.W}/inbox`, { as: 'sam@example.com' });
  assert.ok(inbox.body.items.some((i) => i.id === r1.body.id && i.channel === 'linkedin'));
  const audits = await api.q(`SELECT a.actor, u.email FROM audit_log a JOIN users u ON u.id::text = a.actor::text WHERE a.action = 'paste_linkedin' AND a.entity_id = $1`, [r1.body.id]);
  assert.deepEqual(audits.map((x) => x.email), ['sam@example.com'], 'one audit row, naming who pasted it');
  for (const who of ['riley@example.com', 'client@example.com']) {
    assert.equal((await api.call('POST', `${api.W}/conversations/paste`, { as: who, body })).status, 403, who);
  }
  const bad = await api.call('POST', `${api.W}/conversations/paste`, { as: 'sam@example.com', body: { ...body, profileUrl: 'https://evil.example/in/jo' } });
  assert.deepEqual([bad.status, bad.body.details?.field], [400, 'profileUrl']);
});

test('an opt-out pasted with an address suppresses it; a pasted message gets a playbook draft like any other', async () => {
  const r = await api.call('POST', `${api.W}/conversations/paste`, { as: 'sam@example.com',
    body: { name: 'Pat Doe', email: 'Pat@Clinic.example', body: 'Please remove me from your list.' } });
  assert.equal(r.body.intent, 'unsubscribe');
  const [{ n }] = await api.q(`SELECT count(*)::int AS n FROM suppression WHERE value_hash = value_hash('pat@clinic.example')`);
  assert.equal(n, 1);
  await api.call('POST', `${api.W}/playbook/replies`, { body: { category: 'question', name: 'Price', body: 'Hi {first_name}, it is a flat monthly fee.' } });
  const q = await api.call('POST', `${api.W}/conversations/paste`, { as: 'sam@example.com', body: { name: 'Kim Lee', profileUrl: 'https://www.linkedin.com/in/kimlee', body: 'How much is it?' } });
  const d = await api.call('POST', `${api.W}/conversations/${q.body.conversationId}/reply-draft`, { as: 'sam@example.com' });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.deepEqual([d.body.channel, d.body.countsForAutonomy], ['linkedin', true]);
});

test('without a profile or address, a name is not a person: each paste is its own thread and contact (#91 audit P3-1)', async () => {
  const paste = (body) => api.call('POST', `${api.W}/conversations/paste`, { as: 'sam@example.com', body: { name: 'John Smith', body } });
  const a = await paste('hi, interested');
  const b = await paste('unrelated: can you call me?');
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.notEqual(a.body.conversationId, b.body.conversationId, 'two John Smiths, two threads');
  const rows = await api.q(`SELECT thread_key, contact_id FROM conversations WHERE id = ANY ($1)`, [[a.body.conversationId, b.body.conversationId]]);
  assert.ok(rows.every((r) => /^paste:/.test(r.thread_key)));
  assert.notEqual(rows[0].contact_id, rows[1].contact_id);
});

test('the message and its audit row are one transaction: if the audit write fails, nothing is recorded (#91 audit P3-2)', async () => {
  const before = (await api.q(`SELECT count(*)::int AS n FROM inbound_messages WHERE channel = 'linkedin'`))[0].n;
  // Make the audit insert fail inside the service transaction.
  await api.q(`CREATE FUNCTION test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action = 'paste_linkedin' THEN RAISE EXCEPTION 'audit down'; END IF; RETURN NEW; END $$`);
  await api.q(`CREATE TRIGGER test_audit_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_audit_fail()`);
  try {
    const r = await api.call('POST', `${api.W}/conversations/paste`, { as: 'sam@example.com',
      body: { name: 'Ana Ruiz', profileUrl: 'https://www.linkedin.com/in/ana-ruiz', body: 'Is this still available?' } });
    assert.notEqual(r.status, 201, 'the paste fails as a whole');
    assert.equal((await api.q(`SELECT count(*)::int AS n FROM inbound_messages WHERE channel = 'linkedin'`))[0].n, before, 'no message without its audit row');
    assert.equal((await api.q(`SELECT count(*)::int AS n FROM conversations WHERE thread_key = 'profile:in/ana-ruiz'`))[0].n, 0);
  } finally {
    await api.q(`DROP TRIGGER test_audit_fail ON audit_log`);
    await api.q(`DROP FUNCTION test_audit_fail()`);
  }
});
