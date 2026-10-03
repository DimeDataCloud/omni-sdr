// The one-off test send (api/src/jobs/send-test.mjs): from a connected mailbox to that same mailbox, never anyone else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startApi } from '../../api/test/helpers.mjs';
import { runSendTest, selfMessage } from '../../api/src/jobs/send-test.mjs';
import { pglitePool } from '../../api/src/pool.mjs';
import { GMAIL_SEND } from '../src/google.mjs';

const GOOGLE = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'test-client-secret', stateSecret: 'test-state-secret', mailboxKey: randomBytes(32), redirectUri: 'https://suite.omnisdr.com/connect/google' };
const idToken = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;

function fakeGoogle() {
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body;
    const json = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (String(url) === 'https://oauth2.googleapis.com/token' && body.grant_type === 'authorization_code') {
      return json(200, { access_token: 'at-1', refresh_token: `1//rt-${body.code}`, scope: `openid email ${GMAIL_SEND}`, id_token: idToken({ email: 'owner@brightline.example', email_verified: true }) });
    }
    if (String(url) === 'https://oauth2.googleapis.com/token' && body.grant_type === 'refresh_token') return json(200, { access_token: 'at-2', expires_in: 3599 });
    if (String(url) === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      sent.push(Buffer.from(JSON.parse(body).raw, 'base64url').toString('utf8'));
      return json(200, { id: `gm-${sent.length}` });
    }
    return json(404, {});
  };
  return { sent, fetchImpl };
}

test('send-test: one message, from the connected mailbox to itself; the id is logged, the address never is', async () => {
  const g = fakeGoogle();
  const a = await startApi({ config: { google: GOOGLE, fetch: g.fetchImpl } });
  try {
    const state = new URL((await a.call('POST', `${a.W}/mailboxes/google/start`)).body.url).searchParams.get('state');
    const mb = (await a.call('POST', `${a.W}/mailboxes/google/finish`, { body: { code: 'auth-code-1', state } })).body;
    const ws = a.demo.workspaces[0];
    const org = (await a.q(`SELECT org_id FROM workspaces WHERE id = $1`, [ws]))[0].org_id;
    const env = { OMNI_TEST_ORG: org, OMNI_TEST_WS: ws, OMNI_TEST_MAILBOX: mb.id };
    const logs = [];
    const msgs = async () => (await a.q(`SELECT count(*)::int AS n FROM messages`))[0].n;
    const before = await msgs();
    assert.equal(await runSendTest(env, { pool: pglitePool(a.db), google: GOOGLE, fetchImpl: g.fetchImpl, log: (e) => logs.push(e) }), 0);
    assert.equal(g.sent.length, 1);
    const head = g.sent[0].split('\r\n\r\n')[0];
    assert.match(head, /^From: owner@brightline\.example$/m);
    assert.match(head, /^To: owner@brightline\.example$/m);
    assert.equal(head.match(/^(To|Cc|Bcc):/gim).length, 1, 'exactly one recipient header');
    assert.deepEqual(logs, [{ job: 'send-test', sent: true, providerMessageId: 'gm-1' }]);
    assert.doesNotMatch(JSON.stringify(logs), /brightline/);
    assert.equal(await msgs(), before, "no message rows: it is not a campaign send");
    // Another workspace's ids can't reach this mailbox (RLS), so nothing is sent.
    const other = (await a.q(`SELECT id FROM workspaces WHERE id <> $1 LIMIT 1`, [ws]))[0]?.id;
    if (other) assert.equal(await runSendTest({ ...env, OMNI_TEST_WS: other }, { pool: pglitePool(a.db), google: GOOGLE, fetchImpl: g.fetchImpl, log: () => {} }), 2);
    assert.equal(g.sent.length, 1);
  } finally { await a.stop(); }
});

test('send-test: bad config exits 2 before anything; a header-unsafe address is refused', async () => {
  assert.equal(await runSendTest({ DATABASE_URL: 'x', OMNI_TEST_ORG: 'nope' }, { google: GOOGLE, log: () => {} }), 2);
  assert.equal(await runSendTest({ DATABASE_URL: 'x' }, { google: null, log: () => {} }), 2);
  for (const bad of ['a@b.example\r\nBcc: x@evil.example', 'a@b.example, x@evil.example', 'Name <a@b.example>']) assert.throws(() => selfMessage(bad), /plain address/);
  assert.match(selfMessage('a@b.example'), /^To: a@b\.example\r$/m);
});
