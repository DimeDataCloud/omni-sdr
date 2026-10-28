// Inbound webhooks (0014, SDR-PIVOT P5): create/list/revoke behind `connections`; the public intake records a form
// submission as an inbound message with the same triage as an email reply, and never tells a caller which hooks exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';

async function withHook() {
  const api = await startApi();
  const r = await api.call('POST', `${api.W}/hooks`, { body: { name: 'Website form' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const post = (body, { token = r.body.token, id = r.body.id, raw } = {}) =>
    api.call('POST', `/v1/hooks/${id}`, { as: null, token, body, raw });
  return { api, hook: r.body, post };
}

test('hooks: created with a one-time token; listed without it; reviewers cannot manage them', async () => {
  const { api, hook } = await withHook();
  try {
    assert.match(hook.token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(hook.url, new RegExp(`/v1/hooks/${hook.id}$`));
    const list = await api.call('GET', `${api.W}/hooks`);
    assert.equal(list.status, 200);
    assert.ok(list.body.items.some((h) => h.id === hook.id));
    assert.ok(!JSON.stringify(list.body).includes(hook.token), 'the token is never listed');
    assert.equal((await api.call('POST', `${api.W}/hooks`, { as: 'riley@example.com', body: { name: 'x' } })).status, 403);
    assert.equal((await api.call('GET', `${api.W}/hooks`, { as: 'riley@example.com' })).status, 403);
    const [{ n }] = await api.q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'create' AND entity_type = 'inbound_hook' AND entity_id = $1`, [hook.id]);
    assert.equal(n, 1);
  } finally { await api.stop(); }
});

test('hooks: a submission becomes a contact + an inbound form message, triaged like a reply', async () => {
  const { api, hook, post } = await withHook();
  try {
    const r = await post({ message: "Let's set up a call. Tuesday at 2pm works for me.", email: 'New.Lead@Clinic.example', name: 'Jo Lead', page: '/pricing' });
    assert.deepEqual([r.status, r.body], [202, { received: true }]);
    const [m] = await api.q(`SELECT i.channel, i.intent, i.from_address, i.subject, i.sla_due_at, c.email, c.name, c.workspace_id
      FROM inbound_messages i JOIN contacts c ON c.id = i.contact_id WHERE i.channel = 'form'`);
    assert.deepEqual([m.channel, m.intent, m.from_address, m.subject, m.email, m.name], ['form', 'meeting_request', 'new.lead@clinic.example', 'Form: /pricing', 'new.lead@clinic.example', 'Jo Lead']);
    assert.ok(m.sla_due_at, 'a meeting ask starts the SLA');
    const [{ ws }] = await api.q(`SELECT workspace_id AS ws FROM inbound_hooks WHERE id = $1`, [hook.id]);
    assert.equal(m.workspace_id, ws);
    const [{ k }] = await api.q(`SELECT count(*)::int AS k FROM notifications WHERE kind = 'sla_meeting'`);
    assert.ok(k >= 1);
    // The same person again: one contact, two messages.
    assert.equal((await post({ message: 'Also, do you work with Square?', email: 'new.lead@clinic.example' })).status, 202);
    const [{ c }] = await api.q(`SELECT count(*)::int AS c FROM contacts WHERE email = 'new.lead@clinic.example'`);
    assert.equal(c, 1);
  } finally { await api.stop(); }
});

test('hooks: an opt-out suppresses the address; a repeated externalId is recorded once', async () => {
  const { api, post } = await withHook();
  try {
    assert.equal((await post({ message: 'Please stop contacting me. Remove me from your list.', email: 'gone@lead.example', externalId: 'form-1' })).status, 202);
    assert.equal((await post({ message: 'Please stop contacting me. Remove me from your list.', email: 'gone@lead.example', externalId: 'form-1' })).status, 200);
    const [{ n }] = await api.q(`SELECT count(*)::int AS n FROM inbound_messages WHERE external_id = 'form-1'`);
    assert.equal(n, 1);
    const [{ s }] = await api.q(`SELECT count(*)::int AS s FROM suppression WHERE value_hash = value_hash('gone@lead.example') AND reason = 'form_unsubscribe'`);
    assert.equal(s, 1);
  } finally { await api.stop(); }
});

test('hooks: wrong token, unknown id, revoked hook and no token all answer the same 404; bad bodies are refused', async () => {
  const { api, hook, post } = await withHook();
  try {
    const answers = [
      await post({ message: 'hi' }, { token: 'A'.repeat(43) }),
      await post({ message: 'hi' }, { id: '00000000-0000-4000-8000-000000000000' }),
      await post({ message: 'hi' }, { token: null }),
      await post({ message: 'hi' }, { id: 'not-a-uuid' }),
    ];
    assert.equal((await api.call('DELETE', `${api.W}/hooks/${hook.id}`)).status, 204);
    answers.push(await post({ message: 'hi' }));
    // Identical but for the per-request id.
    const shape = (a) => JSON.stringify({ status: a.status, ...a.body, requestId: undefined });
    assert.equal(new Set(answers.map(shape)).size, 1, answers.map(shape).join(' | '));
    assert.equal(answers[0].status, 404);
    const [{ n }] = await api.q(`SELECT count(*)::int AS n FROM inbound_messages WHERE channel = 'form'`);
    assert.equal(n, 0);
  } finally { await api.stop(); }
  const b = await withHook();
  try {
    assert.equal((await b.post({ email: 'x@y.example' })).status, 400, 'message is required');
    assert.equal((await b.post(undefined, { raw: 'not json' })).status, 400);
    assert.equal((await b.post({ message: 'x'.repeat(5001) })).status, 400);
  } finally { await b.api.stop(); }
});

test('hooks: past the daily cap a submission is recorded and rules-triaged but never queued for the model (#85 audit P2b)', async () => {
  const { api, hook } = await withHook();
  try {
    const { ingestForm } = await import('../src/services/inbox.mjs');
    const { createHash } = await import('node:crypto');
    const ref = { id: hook.id, tokenHash: createHash('sha256').update(hook.token, 'utf8').digest('hex') };
    const at = new Date();
    for (let i = 0; i < 3; i++) assert.equal((await ingestForm(api.db, ref, { body: `hi ${i}`, receivedAt: at }, { dailyCap: 2 })).outcome, 'recorded');
    const rows = await api.q(`SELECT decided_at, decision FROM inbound_messages WHERE channel = 'form' ORDER BY created_at`);
    assert.deepEqual(rows.map((r) => Boolean(r.decided_at)), [false, false, true]);
    assert.equal(rows[2].decision.skipped, 'form_daily_cap');
    // Two concurrent retries with one externalId: one row, and the second answers duplicate, not a 500.
    const both = await Promise.all([0, 1].map(() => ingestForm(api.db, ref, { body: 'retry', externalId: 'ext-7', receivedAt: at }, { dailyCap: 100 })));
    assert.deepEqual(both.map((o) => o.outcome).sort(), ['duplicate', 'recorded']);
    const [{ n }] = await api.q(`SELECT count(*)::int AS n FROM inbound_messages WHERE external_id = 'ext-7'`);
    assert.equal(n, 1);
  } finally { await api.stop(); }
});
