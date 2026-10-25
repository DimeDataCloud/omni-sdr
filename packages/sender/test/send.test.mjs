import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freshDb, seedTenant, approvedDraft, as, one, q } from '../../db/test/helpers.mjs';
import { sendDraft } from '../src/send.mjs';
import { composeEmail } from '../src/compose.mjs';
import { gmailAdapter, SendError } from '../src/adapters/gmail.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const URLS = { unsubscribeBase: 'https://u.omnisdr.com', replyDomain: 'reply.omnisdr.com' };
const POSTAL = '100 Example Street, Nashville, TN 37201';

// A provider stand-in that records every call.
function fakeAdapter(behaviour = () => ({ providerMessageId: 'gm-1' })) {
  const calls = [];
  return { calls, name: 'fake', async send(m) { calls.push(m); return behaviour(m); } };
}
async function setup({ postal = POSTAL } = {}) {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  if (postal) await db.query(`UPDATE workspaces SET postal_address = $2 WHERE id = $1`, [t.ws, postal]);
  const draft = await approvedDraft(db, t);
  return { db, t, draft };
}
const opts = (t, draft, adapter) => ({ orgId: t.org, workspaceId: t.ws, draftId: draft, mailboxId: t.mailbox, adapter, urls: URLS });
const decodeBody = (raw) => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

test('send: an approved draft goes out once, with footer, one-click unsubscribe and a routable Reply-To', async () => {
  const { db, t, draft } = await setup();
  const adapter = fakeAdapter();
  const r = await sendDraft(db, opts(t, draft, adapter));
  assert.equal(r.outcome, 'sent', r.reason);
  assert.equal(adapter.calls.length, 1);
  const raw = adapter.calls[0].raw;
  assert.match(raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  const unsub = raw.match(/^List-Unsubscribe: <https:\/\/u\.omnisdr\.com\/u\/([\w-]+)>$/m)[1];
  const reply = raw.match(/^Reply-To: r\+([\w-]+)@reply\.omnisdr\.com$/m)[1];
  const body = decodeBody(raw);
  assert.ok(body.includes(POSTAL), 'footer carries the customer postal address');
  assert.ok(body.includes(`https://u.omnisdr.com/u/${unsub}`), 'footer carries the unsubscribe link');

  const m = await one(db, `SELECT state, provider_message_id, reply_token_hash FROM messages WHERE id = $1`, [r.messageId]);
  assert.deepEqual([m.state, m.provider_message_id, m.reply_token_hash], ['sent', 'gm-1', sha(reply)]);
  assert.equal((await q(db, `SELECT 1 FROM outbox WHERE topic = 'message.sent' AND key = $1`, [r.messageId])).length, 1);
  // The token in the email really unsubscribes (0003).
  const ok = await as(db, 'app_rw', null, async () => (await one(db, `SELECT unsubscribe($1) AS ok`, [unsub])).ok);
  assert.equal(ok, true);
  // Exactly once: a second call never reaches the provider.
  const again = await sendDraft(db, opts(t, draft, adapter));
  assert.equal(again.outcome, 'already_claimed');
  assert.equal(adapter.calls.length, 1);
});

test('send: no postal address means no send and no claimed row', async () => {
  const { db, t, draft } = await setup({ postal: null });
  const adapter = fakeAdapter();
  const r = await sendDraft(db, opts(t, draft, adapter));
  assert.equal(r.outcome, 'refused');
  assert.match(r.reason, /postal address/);
  assert.equal(adapter.calls.length, 0);
  assert.equal((await q(db, `SELECT 1 FROM messages WHERE draft_id = $1`, [draft])).length, 0);
});

test('send: a guard refusal (hold) reaches no provider and leaves no token or message behind', async () => {
  const { db, t, draft } = await setup();
  await db.query(`INSERT INTO holds (org_id, scope_type, scope_id, reason, set_by) VALUES ($1, 'workspace', $2, 'test', 'test')`, [t.org, t.ws]);
  const tokensBefore = (await q(db, `SELECT 1 FROM unsubscribe_tokens`)).length;
  const adapter = fakeAdapter();
  const r = await sendDraft(db, opts(t, draft, adapter));
  assert.equal(r.outcome, 'refused');
  assert.match(r.reason, /on hold/);
  assert.equal(adapter.calls.length, 0);
  assert.equal((await q(db, `SELECT 1 FROM messages WHERE draft_id = $1`, [draft])).length, 0);
  assert.equal((await q(db, `SELECT 1 FROM unsubscribe_tokens`)).length, tokensBefore);
});

test('send: a provider failure is recorded, not retried', async () => {
  const { db, t, draft } = await setup();
  const adapter = fakeAdapter(() => { throw new SendError('permanent', 'gmail 400'); });
  const r = await sendDraft(db, opts(t, draft, adapter));
  assert.equal(r.outcome, 'failed');
  const m = await one(db, `SELECT state, error FROM messages WHERE id = $1`, [r.messageId]);
  assert.deepEqual([m.state, m.error], ['failed', 'permanent: gmail 400']);
  assert.equal((await sendDraft(db, opts(t, draft, adapter))).outcome, 'already_claimed');
  assert.equal(adapter.calls.length, 1);
});

test('compose: header injection, missing postal address, non-https links and images are refused', () => {
  const base = { from: 'a@x.test', to: 'b@y.test', replyTo: 'r+t@reply.omnisdr.com', subject: 'Hi', body: 'Hello.',
    postalAddress: POSTAL, unsubscribeUrl: 'https://u.omnisdr.com/u/t' };
  assert.throws(() => composeEmail({ ...base, subject: 'Hi\r\nBcc: victim@z.test' }), /header injection/);
  assert.throws(() => composeEmail({ ...base, to: 'b@y.test\nBcc: v@z.test' }), /header injection/);
  assert.throws(() => composeEmail({ ...base, postalAddress: '' }), /postal address/);
  assert.throws(() => composeEmail({ ...base, unsubscribeUrl: 'http://u.omnisdr.com/u/t' }), /https/);
  assert.throws(() => composeEmail({ ...base, body: 'Hi <img src="https://t.test/p.gif">' }), /images/);
  const { raw } = composeEmail({ ...base, subject: 'Café idea' });
  assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
  assert.doesNotMatch(raw, /Content-Type: text\/html/);
});

test('gmail adapter: sends raw as base64url with the bearer token; maps status codes to error kinds', async () => {
  const seen = [];
  const mk = (status, body = {}) => gmailAdapter({
    accessToken: async () => 'tok',
    fetch: async (url, init) => { seen.push({ url, init }); return { ok: status < 300, status, json: async () => body }; },
  });
  const r = await mk(200, { id: 'gm-9' }).send({ raw: 'From: a@x.test\r\n\r\nhi', mailbox: {} });
  assert.equal(r.providerMessageId, 'gm-9');
  assert.equal(seen[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(Buffer.from(JSON.parse(seen[0].init.body).raw, 'base64url').toString(), 'From: a@x.test\r\n\r\nhi');
  for (const [status, kind] of [[401, 'auth'], [403, 'auth'], [429, 'transient'], [503, 'transient'], [400, 'permanent']]) {
    const err = await mk(status).send({ raw: 'x', mailbox: {} }).then(() => null, (e) => e);
    assert.equal(err?.kind, kind, `status ${status}`);
  }
});

test('ops_unknown_outcomes: a claim that never got recorded surfaces after 15 minutes; recorded sends never do', async () => {
  const { db, t, draft } = await setup();
  const r = await sendDraft(db, opts(t, draft, fakeAdapter()));
  const d2 = await approvedDraft(db, t);
  // Simulate a crash after the claim: insert the row the way the claim step does, then never record it.
  await as(db, 'sender_svc', { org: t.org, ws: [t.ws] }, () => db.query(
    `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email')`,
    [t.org, t.ws, d2, t.mailbox]));
  await db.query(`UPDATE messages SET claimed_at = now() - interval '20 minutes' WHERE draft_id = ANY ($1::uuid[])`, [[draft, d2]]);
  const rows = await as(db, 'ops', null, () => q(db, `SELECT draft_id FROM ops_unknown_outcomes`));
  assert.deepEqual(rows.map((x) => x.draft_id), [d2]);
  assert.equal(r.outcome, 'sent');
  // And the stuck draft can't be sent again by the normal path.
  assert.equal((await sendDraft(db, opts(t, d2, fakeAdapter()))).outcome, 'already_claimed');
});

// 0020: the sender's last look. An opt-out that commits after the claim must stop the provider call; the message is
// marked failed with the reason, and the adapter is never reached.
test('send: an opt-out that lands between the claim and the hand-off stops the send (suppressed_check)', async () => {
  const { db, t, draft } = await setup();
  const adapter = fakeAdapter();
  let commits = 0;
  const client = {
    async query(sql, params) {
      const r = await db.query(sql, params);
      if (sql === 'COMMIT' && ++commits === 1) {
        await db.query(`SELECT set_config('app.org_id', $1, false), set_config('app.workspace_ids', $2, false)`, [t.org, t.ws]);
        await db.exec('SET ROLE inbox_svc');
        try { await db.query(`SELECT suppress_person($1, 'manual')`, [t.contact]); } finally { await db.exec('RESET ROLE'); }
        await db.query(`SELECT set_config('app.org_id', '', false), set_config('app.workspace_ids', '', false)`);
      }
      return r;
    },
  };
  const r = await sendDraft(client, opts(t, draft, adapter));
  assert.equal(r.outcome, 'failed');
  assert.equal(r.reason, 'suppressed_check');
  assert.equal(adapter.calls.length, 0);
  const m = await one(db, `SELECT state, error FROM messages WHERE id = $1`, [r.messageId]);
  assert.deepEqual([m.state, m.error], ['failed', 'suppressed_check']);
});
