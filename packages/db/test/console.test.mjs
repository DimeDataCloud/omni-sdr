// 0005_console: identity functions, the inbox's write path, append-only chat, meetings ending sequences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freshDb, seedTenant, as, refused, q, one } from './helpers.mjs';
import { withTenant, withoutTenant, withService } from '../src/context.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const ctxOf = (t) => ({ userId: t.user, orgId: t.org, workspaceId: t.ws });

test('ensure_user: creates once per IdP uid, follows the IdP email, rejects junk', async () => {
  const db = await freshDb();
  const first = await withoutTenant(db, {}, (tx) => tx.query(`SELECT ensure_user('uid-1', 'Maya@Example.test') AS id`));
  const again = await withoutTenant(db, {}, (tx) => tx.query(`SELECT ensure_user('uid-1', 'maya.new@example.test') AS id`));
  assert.equal(first.rows[0].id, again.rows[0].id);
  assert.equal((await one(db, `SELECT email FROM users WHERE idp_uid = 'uid-1'`)).email, 'maya.new@example.test');
  assert.match(await refused(withoutTenant(db, {}, (tx) => tx.query(`SELECT ensure_user('', 'x@y.test')`))), /uid and a valid email/);
  assert.match(await refused(withoutTenant(db, {}, (tx) => tx.query(`SELECT ensure_user('uid-2', 'not-an-email')`))), /uid and a valid email/);
  // The app role can't write users directly; only through the function.
  assert.match(await refused(as(db, 'app_rw', null, () => db.query(`INSERT INTO users (idp_uid, email) VALUES ('u', 'u@x.test')`))),
    /permission denied/);
});

test('my_memberships: only the acting user\'s orgs, and only the workspaces the membership covers', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [a.org])).id;
  const rows = await withoutTenant(db, { userId: a.user }, (tx) => tx.query(`SELECT * FROM my_memberships()`).then((r) => r.rows));
  assert.deepEqual(rows.map((r) => r.org_id).filter((o) => o !== a.org), [], 'another org leaked');
  assert.deepEqual(rows.map((r) => r.workspace_id).sort(), [a.ws, ws2].sort());
  // Narrow the membership to one workspace: the other disappears.
  await db.query(`UPDATE memberships SET workspace_ids = ARRAY[$2::uuid] WHERE org_id = $1`, [a.org, a.ws]);
  const narrowed = await withoutTenant(db, { userId: a.user }, (tx) => tx.query(`SELECT * FROM my_memberships()`).then((r) => r.rows));
  assert.deepEqual(narrowed.map((r) => r.workspace_id), [a.ws]);
  // No user: nothing.
  const anon = await withoutTenant(db, {}, (tx) => tx.query(`SELECT * FROM my_memberships()`).then((r) => r.rows));
  assert.equal(anon.length, 0);
  assert.ok(b.org);
});

test('inbox: only inbox_svc records replies; the app can mark handled but not rewrite the reply or its intent', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const ins = `INSERT INTO inbound_messages (org_id, workspace_id, channel, body, received_at) VALUES ($1, $2, 'email', 'hi', now())`;
  assert.match(await refused(withTenant(db, ctxOf(a), (tx) => tx.query(ins, [a.org, a.ws]))), /permission denied/);
  await withService(db, { orgId: a.org, workspaceId: a.ws, role: 'inbox_svc' }, (tx) => tx.query(ins, [a.org, a.ws]));
  assert.match(await refused(withTenant(db, ctxOf(a), (tx) =>
    tx.query(`UPDATE inbound_messages SET intent = 'meeting_request' WHERE id = $1`, [a.inbound]))), /permission denied/);
  assert.match(await refused(withTenant(db, ctxOf(a), (tx) =>
    tx.query(`UPDATE inbound_messages SET body = 'rewritten' WHERE id = $1`, [a.inbound]))), /permission denied/);
  await withTenant(db, ctxOf(a), (tx) =>
    tx.query(`UPDATE inbound_messages SET handled_at = now(), handled_by = $2 WHERE id = $1`, [a.inbound, a.user]));
  // handled_at and handled_by travel together.
  assert.match(await refused(withTenant(db, ctxOf(a), (tx) =>
    tx.query(`UPDATE inbound_messages SET handled_by = NULL WHERE id = $1`, [a.inbound]))), /check constraint/);
});

test('inbox_resolve_reply: maps a reply token to ids across tenants, for inbox_svc only', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const token = 'reply-token-alpha';
  await db.query(`UPDATE messages SET reply_token_hash = $2 WHERE id = $1`, [a.message, sha(token)]);
  const hit = await withoutTenant(db, { role: 'inbox_svc' }, (tx) =>
    tx.query(`SELECT * FROM inbox_resolve_reply($1)`, [sha(token)]).then((r) => r.rows));
  assert.deepEqual(hit, [{ org_id: a.org, workspace_id: a.ws, message_id: a.message, contact_id: a.contact }]);
  for (const bad of [sha('unknown'), 'not-a-hash', '']) {
    const miss = await withoutTenant(db, { role: 'inbox_svc' }, (tx) =>
      tx.query(`SELECT * FROM inbox_resolve_reply($1)`, [bad]).then((r) => r.rows));
    assert.equal(miss.length, 0, `resolved ${JSON.stringify(bad)}`);
  }
  assert.match(await refused(withoutTenant(db, {}, (tx) => tx.query(`SELECT * FROM inbox_resolve_reply($1)`, [sha(token)]))),
    /permission denied/);
});

test('chat history is append-only for the app role', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  for (const sql of [`UPDATE agent_messages SET body = 'edited'`, `DELETE FROM agent_messages`]) {
    assert.match(await refused(withTenant(db, ctxOf(a), (tx) => tx.query(sql))), /permission denied/, sql);
  }
  // An agent message has no human author; a user message must name one.
  assert.match(await refused(withTenant(db, ctxOf(a), (tx) => tx.query(
    `INSERT INTO agent_messages (org_id, workspace_id, agent_id, sender, body) VALUES ($1, $2, $3, 'user', 'x')`,
    [a.org, a.ws, a.agent]))), /check constraint/);
});

test('routines: tenants toggle active; only ops sets the kill switch', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const id = (await one(db, `SELECT id FROM routines WHERE org_id = $1`, [a.org])).id;
  await withTenant(db, ctxOf(a), (tx) => tx.query(`UPDATE routines SET active = true WHERE id = $1`, [id]));
  assert.match(await refused(withTenant(db, ctxOf(a), (tx) =>
    tx.query(`UPDATE routines SET paused_reason = NULL WHERE id = $1`, [id]))), /permission denied/);
});

test('a booked meeting ends that contact\'s live enrollments in the workspace, and nothing else', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  const before = await q(db, `SELECT org_id, state FROM enrollments ORDER BY org_id`);
  assert.ok(before.every((e) => e.state === 'waiting'), 'seed must start with live enrollments');
  await withTenant(db, ctxOf(a), (tx) => tx.query(
    `INSERT INTO meetings (org_id, workspace_id, contact_id, provider, starts_at, ends_at, created_by)
     VALUES ($1, $2, $3, 'native', now() + interval '2 days', now() + interval '2 days 30 minutes', $4)`,
    [a.org, a.ws, a.contact, a.user]));
  assert.deepEqual(await one(db, `SELECT state, stop_reason FROM enrollments WHERE id = $1`, [a.enrollment]),
    { state: 'converted', stop_reason: 'meeting_booked' });
  assert.equal((await one(db, `SELECT state FROM enrollments WHERE id = $1`, [b.enrollment])).state, 'waiting');
  // A meeting link must be https.
  assert.match(await refused(withTenant(db, ctxOf(a), (tx) => tx.query(
    `INSERT INTO meetings (org_id, workspace_id, provider, starts_at, ends_at, meet_url)
     VALUES ($1, $2, 'native', now(), now() + interval '1 hour', 'javascript:alert(1)')`, [a.org, a.ws]))), /check constraint/);
});

test('withoutTenant: refuses unknown roles and malformed user ids; sees no tenant rows', async () => {
  const db = await freshDb();
  await seedTenant(db, 'alpha');
  assert.match(await refused(withoutTenant(db, { role: 'ops' }, async () => {})), /not a service role/);
  assert.match(await refused(withoutTenant(db, { userId: 'nope' }, async () => {})), /not a uuid/);
  const n = await withoutTenant(db, {}, (tx) => tx.query(`SELECT count(*)::int AS n FROM contacts`).then((r) => r.rows[0].n));
  assert.equal(n, 0);
});

test('create_workspace: org-wide admins of agencies only; an owner account keeps one workspace', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');                       // seeded as an owner account with one workspace
  const call = (userId, org, name = 'Client B') =>
    withoutTenant(db, { userId }, (tx) => tx.query(`SELECT create_workspace($1, $2) AS id`, [org, name]).then((r) => r.rows[0].id));
  assert.match(await refused(call(a.user, a.org)), /owner account has one workspace/);
  await db.query(`UPDATE orgs SET account_type = 'agency' WHERE id = $1`, [a.org]);
  const id = await call(a.user, a.org);
  assert.equal((await one(db, `SELECT org_id FROM workspaces WHERE id = $1`, [id])).org_id, a.org);
  // An admin narrowed to one workspace, an operator, and a stranger are all refused.
  await db.query(`UPDATE memberships SET workspace_ids = ARRAY[$2::uuid] WHERE org_id = $1`, [a.org, a.ws]);
  assert.match(await refused(call(a.user, a.org)), /org-wide admin only/);
  await db.query(`UPDATE memberships SET workspace_ids = NULL, role = 'operator' WHERE org_id = $1`, [a.org]);
  assert.match(await refused(call(a.user, a.org)), /org-wide admin only/);
  const b = await seedTenant(db, 'bravo');
  assert.match(await refused(call(b.user, a.org)), /org-wide admin only/);
  assert.match(await refused(call(null, a.org)), /org-wide admin only/);
});

test('gate findings are cleared with the gate pass when the text changes', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const id = (await one(db, `SELECT id FROM drafts WHERE org_id = $1 AND status = 'approved' LIMIT 1`, [a.org])).id;
  await as(db, 'gate_svc', { org: a.org, ws: [a.ws] }, () =>
    db.query(`UPDATE drafts SET gate_findings = '[{"code":"x"}]' WHERE id = $1`, [id]));
  assert.match(await refused(withTenant(db, ctxOf(a), (tx) =>
    tx.query(`UPDATE drafts SET gate_findings = '[]' WHERE id = $1`, [id]))), /permission denied/);
  await withTenant(db, ctxOf(a), (tx) => tx.query(`UPDATE drafts SET body = body || ' Edited.' WHERE id = $1`, [id]));
  assert.deepEqual(await one(db, `SELECT gate_findings, status, gate_passed FROM drafts WHERE id = $1`, [id]),
    { gate_findings: null, status: 'gating', gate_passed: false });
});

test('booking converts an enrollment a reply stopped, but never one an unsubscribe stopped', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const book = () => withTenant(db, ctxOf(a), (tx) => tx.query(
    `INSERT INTO meetings (org_id, workspace_id, contact_id, provider, starts_at, ends_at)
     VALUES ($1, $2, $3, 'native', now() + interval '1 day', now() + interval '1 day 30 minutes')`, [a.org, a.ws, a.contact]));
  await db.query(`UPDATE enrollments SET state = 'stopped', stop_reason = 'unsubscribe' WHERE id = $1`, [a.enrollment]);
  await book();
  assert.deepEqual(await one(db, `SELECT state, stop_reason FROM enrollments WHERE id = $1`, [a.enrollment]),
    { state: 'stopped', stop_reason: 'unsubscribe' });
  await db.query(`UPDATE enrollments SET state = 'stopped', stop_reason = 'reply:meeting_request' WHERE id = $1`, [a.enrollment]);
  await book();
  assert.equal((await one(db, `SELECT state FROM enrollments WHERE id = $1`, [a.enrollment])).state, 'converted');
});
