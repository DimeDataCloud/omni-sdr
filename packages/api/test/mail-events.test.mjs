// B-12: Cloudflare Email Sending events (forwarded by a Queue consumer) → /internal/mail-events. Fixtures have the
// exact shape of the documented queue event; nothing here touches the network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { sendDraft } from '../../sender/src/send.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

const EMAIL = 'tom@maplegrove-dental.example';

// Approve the contact's first touch and send it through the real sender with a capture adapter, so there is a
// real sent message to correlate. Returns the provider key the way the Cloudflare adapter makes it.
async function sentTo(email, key) {
  const [d] = await api.q(`SELECT d.id, d.status FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN contacts c ON c.id = e.contact_id
    WHERE c.email = $1 AND d.step = 0 AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.draft_id = d.id)`, [email]);
  if (d.status === 'review') assert.equal((await api.call('POST', `${api.W}/approvals/${d.id}/approve`)).status, 200);
  const out = await sendDraft(api.db, { orgId: api.demo.org, workspaceId: api.demo.workspaces[0], draftId: d.id, mailboxId: api.demo.mailbox,
    adapter: { async send() { return { providerMessageId: key }; } },
    urls: { unsubscribeBase: 'https://app.test', replyDomain: 'reply.omnisdr.com' } });
  assert.equal(out.outcome, 'sent', out.reason);
}

const event = (suffix, payload) => ({
  type: `cf.email.sending.message.${suffix}`,
  source: { type: 'email.sending', zoneId: 'z'.repeat(32), domain: 'get.omnisdr.com' },
  payload: { messageId: 'cf-rest:fixture', recipient: EMAIL, terminal: false, delivery: { status: 'delivered', smtpStatusCode: 250 }, ...payload },
});
const suppressed = async () => (await api.q(`SELECT reason FROM suppression WHERE scope_org_id = $1 AND value_hash = value_hash($2)`, [api.demo.org, EMAIL])).map((r) => r.reason);

test('signature rules: 401 on a bad secret, a stale timestamp, no signature, or a session token', async () => {
  const e = event('bounced', { terminal: true });
  assert.equal((await api.signedMailEvent(e, { secret: 'wrong' })).status, 401);
  assert.equal((await api.signedMailEvent(e, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
  assert.equal((await api.call('POST', '/internal/mail-events', { as: null, body: e })).status, 401);
  assert.equal((await api.call('POST', '/internal/mail-events', { body: e })).status, 401);
  assert.deepEqual(await suppressed(), []);
});

test('only the documented event shape is accepted', async () => {
  for (const bad of [
    event('opened', {}), event('bounced', {}).type && { ...event('bounced', {}), type: 'cf.email.routing.message.bounced' },
    { ...event('bounced', {}), source: { type: 'email.routing' } },
    { ...event('bounced', {}), extra: 1 },
    { ...event('bounced', {}), payload: { messageId: 'x' } },
    { ...event('bounced', {}), payload: { messageId: 'x', recipient: EMAIL, terminal: 'yes' } },
  ]) assert.equal((await api.signedMailEvent(bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  assert.deepEqual(await suppressed(), []);
});

test('deferred, delivered and a soft (non-terminal) bounce never suppress; a hard bounce suppresses the address once; a repeat is a duplicate', async () => {
  await sentTo(EMAIL, 'cf-rest:m-hard');
  for (const e of [event('deferred', { messageId: 'cf-rest:m-hard' }), event('delivered', { messageId: 'cf-rest:m-hard' }),
    event('bounced', { messageId: 'cf-rest:m-hard', terminal: false })]) {
    const r = await api.signedMailEvent(e);
    assert.deepEqual([r.status, r.body.outcome], [200, 'recorded']);
  }
  assert.deepEqual(await suppressed(), []);
  const hard = event('bounced', { messageId: 'cf-rest:m-hard', terminal: true });
  assert.deepEqual((await api.signedMailEvent(hard)).body, { outcome: 'recorded' });
  assert.deepEqual(await suppressed(), ['bounce']);
  assert.deepEqual((await api.signedMailEvent(hard)).body, { outcome: 'duplicate' });
  assert.deepEqual(await suppressed(), ['bounce'], 'idempotent: messageId + type');
});

test('an event for a message we never sent is acknowledged and changes nothing', async () => {
  const r = await api.signedMailEvent(event('complained', { messageId: 'cf-rest:nobody', recipient: 'ghost@nowhere.example' }));
  assert.deepEqual([r.status, r.body], [200, { outcome: 'unknown_message' }]);
});
