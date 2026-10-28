// B-12: refusals are audited after the rollback, the Cloudflare REST adapter (mocked fetch, no network), and the
// unsubscribe line and postal address that every message must carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, approvedDraft, one, q } from '../../db/test/helpers.mjs';
import { sendDraft } from '../src/send.mjs';
import { composeEmail } from '../src/compose.mjs';
import { cloudflareAdapter } from '../src/adapters/cloudflare.mjs';

const URLS = { unsubscribeBase: 'https://u.omnisdr.com', replyDomain: 'reply.omnisdr.com' };
const POSTAL = '100 Example Street, Nashville, TN 37201';
const ACCOUNT = 'a'.repeat(32);

async function setup() {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await db.query(`UPDATE workspaces SET postal_address = $2 WHERE id = $1`, [t.ws, POSTAL]);
  await db.query('DELETE FROM org_send_counters'); await db.query('DELETE FROM send_counters');   // the seed sent one
  return { db, t, draft: await approvedDraft(db, t) };
}
const opts = (t, draft, adapter) => ({ orgId: t.org, workspaceId: t.ws, draftId: draft, mailboxId: t.mailbox, adapter, urls: URLS });
const fake = () => { const calls = []; return { calls, name: 'fake', async send(m) { calls.push(m); return { providerMessageId: 'x' }; } }; };
const audits = (db, t) => q(db, `SELECT actor, action, entity_type, entity_id FROM audit_log WHERE org_id = $1 AND action LIKE 'send_refused:%' ORDER BY id`, [t.org]);

test('an org at 200 is refused, never queued, never handed to the provider, and the refusal is audited', async () => {
  const { db, t, draft } = await setup();
  await db.query(`INSERT INTO org_send_counters (org_id, day, count) VALUES ($1, send_day(), 200)`, [t.org]);
  const adapter = fake();
  const r = await sendDraft(db, opts(t, draft, adapter));
  assert.equal(r.outcome, 'refused');
  assert.match(r.reason, /organization daily cap reached/);
  assert.equal(adapter.calls.length, 0);
  assert.equal((await q(db, `SELECT 1 FROM messages WHERE draft_id = $1`, [draft])).length, 0);
  assert.deepEqual(await audits(db, t), [{ actor: 'sender', action: 'send_refused:org_daily_cap', entity_type: 'draft', entity_id: draft }]);
});

test('a mailbox at its cap is refused with its own audit reason', async () => {
  const { db, t, draft } = await setup();
  await db.query(`UPDATE mailboxes SET daily_cap = 1 WHERE id = $1`, [t.mailbox]);
  await db.query(`INSERT INTO send_counters (org_id, mailbox_id, day, count) VALUES ($1, $2, send_day(), 1)`, [t.org, t.mailbox]);
  const r = await sendDraft(db, opts(t, draft, fake()));
  assert.match(r.reason, /mailbox daily cap reached/);
  assert.deepEqual((await audits(db, t)).map((a) => a.action), ['send_refused:mailbox_daily_cap']);
  assert.equal((await one(db, `SELECT count FROM org_send_counters WHERE org_id = $1`, [t.org]))?.count ?? 0, 0, 'no org unit kept');
});

test('an opted-out recipient is refused before the provider is called, and audited', async () => {
  const { db, t, draft } = await setup();
  await db.query(`SELECT _suppress_person($1, $2, 'unsubscribe', true)`, [t.contact, t.org]);
  const adapter = fake();
  const r = await sendDraft(db, opts(t, draft, adapter));
  assert.equal(r.outcome, 'refused');
  assert.match(r.reason, /contact suppressed/);
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual((await audits(db, t)).map((a) => a.action), ['send_refused:contact_suppressed']);
});

test('compose refuses a message with no https unsubscribe link or no postal address, and carries both when present', () => {
  const m = { from: 'chris@get.omnisdr.com', to: 'pat@example.test', replyTo: 'r+abc@reply.omnisdr.com', subject: 'Hi', body: 'Hello.', postalAddress: POSTAL, unsubscribeUrl: 'https://u.omnisdr.com/u/tok' };
  assert.throws(() => composeEmail({ ...m, unsubscribeUrl: 'http://u.omnisdr.com/u/tok' }), /unsubscribe/i);
  assert.throws(() => composeEmail({ ...m, unsubscribeUrl: '' }), /unsubscribe/i);
  assert.throws(() => composeEmail({ ...m, postalAddress: '' }), /postal/i);
  assert.throws(() => composeEmail({ ...m, postalAddress: 'short' }), /postal/i);
  const { parts } = composeEmail(m);
  assert.ok(parts.text.includes(POSTAL) && parts.text.includes('https://u.omnisdr.com/u/tok'));
  assert.equal(parts.headers['List-Unsubscribe'], '<https://u.omnisdr.com/u/tok>');
  assert.equal(parts.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(parts.from.email, 'chris@get.omnisdr.com');
});

// ─── the Cloudflare REST adapter ─────────────────────────────────────────────────────────────────────────────────
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const parts = { from: { email: 'chris@get.omnisdr.com', name: 'Chris' }, to: 'pat@example.test', replyTo: 'r+t@reply.omnisdr.com', subject: 'Hi', text: 'Hello\n--\nx', headers: { 'List-Unsubscribe': '<https://u/x>' } };
const OK = { success: true, errors: [], result: { delivered: ['pat@example.test'], permanent_bounces: [], queued: [] } };
const send = (fetchImpl) => cloudflareAdapter({ fetch: fetchImpl, accountId: ACCOUNT, apiToken: async () => 'tok-name-only' }).send({ parts, messageId: 'm-1' });
const kind = (p) => p.then(() => 'sent', (e) => e.kind);

test('cloudflare adapter: one POST to the account send endpoint with the token, REST field names, and our own provider key', async () => {
  let seen;
  const r = await send(async (url, init) => { seen = { url, init }; return reply(200, OK)(); });
  assert.deepEqual(r, { providerMessageId: 'cf-rest:m-1' }, 'the REST response has no message id, so the key is ours');
  assert.equal(seen.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/email/sending/send`);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok-name-only');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body, { from: { address: 'chris@get.omnisdr.com', name: 'Chris' }, to: 'pat@example.test', reply_to: 'r+t@reply.omnisdr.com',
    subject: 'Hi', text: 'Hello\n--\nx', headers: { 'List-Unsubscribe': '<https://u/x>' } });
});

test('cloudflare adapter: errors are classified, a paused account is an auth error, and nothing retries', async () => {
  assert.equal(await kind(send(reply(401, { success: false, errors: [{ code: 10101 }] }))), 'auth');
  assert.equal(await kind(send(reply(403, { success: false, errors: [{ code: 10207 }] }))), 'auth');
  assert.equal(await kind(send(reply(429, { success: false, errors: [{ code: 10004 }] }))), 'transient');
  assert.equal(await kind(send(reply(500, null))), 'transient');
  assert.equal(await kind(send(reply(400, { success: false, errors: [{ code: 10001 }] }))), 'permanent');
  assert.equal(await kind(send(reply(200, { success: true, result: { delivered: [], permanent_bounces: ['pat@example.test'], queued: [] } }))), 'permanent');
  assert.equal(await kind(send(async () => { throw new Error('ECONNRESET'); })), 'transient');
  let calls = 0;
  await kind(send(async () => { calls++; return reply(500, null)(); }));
  assert.equal(calls, 1);
});

test('end to end with the mocked REST API: sent, recorded with our key, and the request carries the unsubscribe headers and footer', async () => {
  const { db, t, draft } = await setup();
  let body;
  const adapter = cloudflareAdapter({ fetch: async (u, init) => { body = JSON.parse(init.body); return reply(200, OK)(); }, accountId: ACCOUNT, apiToken: async () => 'tok' });
  const r = await sendDraft(db, opts(t, draft, adapter));
  assert.equal(r.outcome, 'sent', r.reason);
  assert.equal(r.providerMessageId, `cf-rest:${r.messageId}`);
  assert.match(body.headers['List-Unsubscribe'], /^<https:\/\/u\.omnisdr\.com\/u\/[\w-]+>$/);
  assert.equal(body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(body.text.includes(POSTAL) && /https:\/\/u\.omnisdr\.com\/u\//.test(body.text));
  assert.match(body.reply_to, /^r\+[0-9a-f]+@reply\.omnisdr\.com$/);
  assert.equal((await one(db, `SELECT count FROM org_send_counters WHERE org_id = $1`, [t.org])).count, 1);
});
