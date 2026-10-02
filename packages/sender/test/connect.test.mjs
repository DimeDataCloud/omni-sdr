// Gmail connect through the real API (routes/mailboxes.mjs) and the send job (jobs/send.mjs), with Google faked.
// Lives here, not in packages/api/test (claimed by claude-cloud on 2026-10-02), and uses that package's helpers read-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startApi } from '../../api/test/helpers.mjs';
import { runSend } from '../../api/src/jobs/send.mjs';
import { pglitePool } from '../../api/src/pool.mjs';
import { open } from '../src/credentials.mjs';
import { mintState, GMAIL_SEND } from '../src/google.mjs';

const KEY = randomBytes(32);
const GOOGLE = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'test-client-secret', stateSecret: 'test-state-secret', mailboxKey: KEY, redirectUri: 'https://suite.omnisdr.com/connect/google' };
const WED_10 = new Date('2026-10-07T15:00:00Z');
const idToken = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;

function fakeGoogle({ scope = `openid email ${GMAIL_SEND}`, email = 'owner@brightline.example', refreshError = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body;
    calls.push({ url: String(url), body });
    const json = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (String(url) === 'https://oauth2.googleapis.com/token' && body.grant_type === 'authorization_code') {
      return json(200, { access_token: 'at-1', refresh_token: `1//rt-${body.code}`, scope, id_token: idToken({ email, email_verified: true }) });
    }
    if (String(url) === 'https://oauth2.googleapis.com/token' && body.grant_type === 'refresh_token') {
      return refreshError ? json(400, { error: refreshError }) : json(200, { access_token: 'at-2', expires_in: 3599 });
    }
    if (String(url).startsWith('https://gmail.googleapis.com/')) return json(200, { id: `gm-${calls.length}` });
    return json(404, {});
  };
  return { calls, fetchImpl };
}

// A first touch in review whose enrollment is live and whose address is verified: what the send loop may pick.
const DUE = `SELECT d.id FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN contacts c ON c.id = e.contact_id
  WHERE d.workspace_id = $1 AND d.status = 'review' AND d.step = 0 AND c.email_status = 'valid'
    AND e.state NOT IN ('stopped', 'converted', 'completed', 'paused', 'snoozed') AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.draft_id = d.id)
  ORDER BY d.id LIMIT 1`;

async function api(g = fakeGoogle()) {
  const a = await startApi({ config: { google: GOOGLE, fetch: g.fetchImpl } });
  const me = await a.call('GET', '/v1/me');
  const maya = (await a.q(`SELECT id FROM users WHERE email = 'maya@example.com'`))[0].id;
  return { ...a, g, maya, me: me.body };
}

test('connect: start returns Google consent for gmail.send with PKCE and a signed state; reviewers cannot', async () => {
  const a = await api();
  try {
    const r = await a.call('POST', `${a.W}/mailboxes/google/start`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const u = new URL(r.body.url);
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(u.searchParams.get('scope'), `openid email ${GMAIL_SEND}`);
    assert.deepEqual([u.searchParams.get('code_challenge_method'), u.searchParams.get('access_type'), u.searchParams.get('redirect_uri')], ['S256', 'offline', GOOGLE.redirectUri]);
    assert.ok(u.searchParams.get('state').includes('.'));
    assert.equal((await a.call('POST', `${a.W}/mailboxes/google/start`, { as: 'riley@example.com' })).status, 403);
  } finally { await a.stop(); }
});

test('connect: finish stores a sealed token for the verified address; the API never returns it', async () => {
  const a = await api();
  try {
    const start = await a.call('POST', `${a.W}/mailboxes/google/start`);
    const state = new URL(start.body.url).searchParams.get('state');
    const r = await a.call('POST', `${a.W}/mailboxes/google/finish`, { body: { code: 'auth-code-123', state } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.address, r.body.connected, r.body.dailyCap], ['owner@brightline.example', true, 5]);
    const tokenCall = a.g.calls.find((c) => c.body?.grant_type === 'authorization_code');
    assert.match(tokenCall.body.code_verifier, /^[A-Za-z0-9_-]{43}$/, 'PKCE verifier sent server-side');
    const row = (await a.q(`SELECT org_id, workspace_id, mailbox_id, secret FROM mailbox_credentials WHERE mailbox_id = $1`, [r.body.id]))[0];
    assert.equal(open(KEY, { orgId: row.org_id, workspaceId: row.workspace_id, mailboxId: row.mailbox_id }, row.secret), '1//rt-auth-code-123');
    const list = await a.call('GET', `${a.W}/mailboxes`);
    assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(list.body).includes('rt-auth-code') && !JSON.stringify(list.body).includes(row.secret), 'no token or sealed value in the API');
    assert.equal(list.body.items.find((m) => m.id === r.body.id).connected, true);
  } finally { await a.stop(); }
});

test('connect: a state minted for someone else, another workspace, expired or tampered is refused before the code is spent', async () => {
  const a = await api();
  try {
    const org = a.demo.org; const ws = a.demo.workspaces[0];
    const sam = (await a.q(`SELECT id FROM users WHERE email = 'sam@example.com'`))[0]?.id ?? '00000000-0000-4000-8000-000000000001';
    const cases = [
      [mintState(GOOGLE.stateSecret, { orgId: org, workspaceId: ws, userId: sam }), 'wrong_user'],
      [mintState(GOOGLE.stateSecret, { orgId: org, workspaceId: a.demo.workspaces[1], userId: a.maya }), 'wrong_user'],
      [mintState(GOOGLE.stateSecret, { orgId: org, workspaceId: ws, userId: a.maya, now: Date.now() - 11 * 60000 }), 'expired_state'],
      [mintState('another-secret', { orgId: org, workspaceId: ws, userId: a.maya }), 'bad_state'],
    ];
    for (const [state, code] of cases) {
      const r = await a.call('POST', `${a.W}/mailboxes/google/finish`, { body: { code: 'auth-code-xyz', state } });
      assert.deepEqual([r.status, r.body.error], [403, code]);
    }
    assert.equal(a.g.calls.length, 0, 'Google was never called');
  } finally { await a.stop(); }
});

test('connect: more than send, or no send, is refused and nothing is stored', async () => {
  for (const [scope, code] of [[`openid email ${GMAIL_SEND} https://www.googleapis.com/auth/gmail.readonly`, 'scope_extra'], ['openid email', 'scope_missing']]) {
    const a = await api(fakeGoogle({ scope }));
    try {
      const state = new URL((await a.call('POST', `${a.W}/mailboxes/google/start`)).body.url).searchParams.get('state');
      const r = await a.call('POST', `${a.W}/mailboxes/google/finish`, { body: { code: 'auth-code-123', state } });
      assert.deepEqual([r.status, r.body.details?.code], [400, code]);
      assert.equal((await a.q(`SELECT count(*)::int AS n FROM mailbox_credentials`))[0].n, 0);
    } finally { await a.stop(); }
  }
});

test('send job: a revoked grant pauses the mailbox without spending the draft; reconnecting sends it; disconnect stops it', async () => {
  const a = await api();
  const connectOnce = async (code) => {
    const state = new URL((await a.call('POST', `${a.W}/mailboxes/google/start`)).body.url).searchParams.get('state');
    const r = await a.call('POST', `${a.W}/mailboxes/google/finish`, { body: { code, state } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  try {
    const mb = await connectOnce('auth-code-123');
    const pick = (await a.q(DUE, [a.demo.workspaces[0]]))[0];
    assert.ok(pick, 'a due first touch in the demo review queue');
    assert.equal((await a.call('POST', `${a.W}/approvals/${pick.id}/approve`)).status, 200);
    const env = { OMNI_UNSUBSCRIBE_BASE: 'https://api.example.test' };
    const pool = pglitePool(a.db);
    const run = (fetchImpl, logs = []) => runSend(env, { pool, google: GOOGLE, fetchImpl, now: () => WED_10, pause: async () => {}, log: (e) => logs.push(e) });

    // 1. Google refuses the grant: the mailbox pauses for reconnect and the draft is not claimed.
    assert.equal(await run(fakeGoogle({ refreshError: 'invalid_grant' }).fetchImpl), 0);
    assert.equal((await a.q(`SELECT paused_reason FROM mailboxes WHERE id = $1`, [mb.id]))[0].paused_reason, 'reconnect');
    assert.equal((await a.q(`SELECT count(*)::int AS n FROM messages WHERE draft_id = $1`, [pick.id]))[0].n, 0, 'nothing claimed');

    // 2. Reconnect (the same address: the update path) and the same draft goes, with the new token.
    const again = await connectOnce('auth-code-456');
    assert.equal(again.id, mb.id, 'same mailbox');
    assert.equal((await a.q(`SELECT paused_reason FROM mailboxes WHERE id = $1`, [mb.id]))[0].paused_reason, null);
    const logs = [];
    assert.equal(await run(a.g.fetchImpl, logs), 0);
    assert.equal((await a.q(`SELECT state FROM messages WHERE draft_id = $1`, [pick.id]))[0]?.state, 'sent', JSON.stringify(logs));
    assert.ok(a.g.calls.some((c) => c.body?.grant_type === 'refresh_token' && c.body.refresh_token === '1//rt-auth-code-456'), 'the reconnected token');
    assert.ok(a.g.calls.some((c) => c.url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')));
    assert.ok(!JSON.stringify(logs).includes('@'), 'logs carry no addresses');

    // 3. Disconnect: revoked + paused.
    assert.equal((await a.call('DELETE', `${a.W}/mailboxes/${mb.id}`)).status, 204);
    const after = (await a.q(`SELECT mb.paused_reason, cr.revoked_at FROM mailboxes mb JOIN mailbox_credentials cr ON cr.mailbox_id = mb.id WHERE mb.id = $1`, [mb.id]))[0];
    assert.equal(after.paused_reason, 'disconnected');
    assert.ok(after.revoked_at);
  } finally { await a.stop(); }
});

test('send job: refuses to run without the unsubscribe base or Google config', async () => {
  const logs = [];
  assert.equal(await runSend({ DATABASE_URL: 'x' }, { google: GOOGLE, log: (e) => logs.push(e) }), 2);
  assert.equal(await runSend({ DATABASE_URL: 'x', OMNI_UNSUBSCRIBE_BASE: 'https://a' }, { google: null, log: (e) => logs.push(e) }), 2);
  assert.match(JSON.stringify(logs), /OMNI_UNSUBSCRIBE_BASE/);
});
