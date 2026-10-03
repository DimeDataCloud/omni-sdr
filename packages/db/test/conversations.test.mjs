// 0015: conversations, handoffs and the closer role. In the database a closer sees only the conversations, handoffs
// and inbound messages handed to them; the other tenant tables are closed to them by can() in the API (no route).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused } from './helpers.mjs';

const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];

async function setup() {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  const mkUser = async (email, role, ws = null) => {
    const id = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ($1, $1) RETURNING id`, [email])).id;
    await db.query(`INSERT INTO memberships (org_id, user_id, role, workspace_ids) VALUES ($1, $2, $3, $4)`, [a.org, id, role, ws]);
    return id;
  };
  const closer = await mkUser('closer@alpha.test', 'closer');
  const other = await mkUser('other-closer@alpha.test', 'closer');
  const reviewer = await mkUser('reviewer@alpha.test', 'reviewer');
  // Two more conversations in A: one handed to `closer`, one still open.
  const mine = (await one(db, `INSERT INTO conversations (org_id, workspace_id, channel, thread_key, state, closer_id)
    VALUES ($1, $2, 'instagram_dm', 'ig:thread-1', 'handed_off', $3) RETURNING id`, [a.org, a.ws, closer])).id;
  const open = (await one(db, `INSERT INTO conversations (org_id, workspace_id, channel, thread_key) VALUES ($1, $2, 'chat', 'chat:42') RETURNING id`, [a.org, a.ws])).id;
  for (const [conv, body] of [[mine, 'how much is it?'], [open, 'hi there']]) {
    await db.query(`INSERT INTO inbound_messages (org_id, workspace_id, channel, body, received_at, conversation_id) VALUES ($1, $2, 'instagram_dm', $3, now(), $4)`,
      [a.org, a.ws, body, conv]);
  }
  await db.query(`INSERT INTO handoffs (org_id, workspace_id, conversation_id, closer_id, reason, summary) VALUES ($1, $2, $3, $4, 'qualified', 'Ready')`,
    [a.org, a.ws, mine, closer]);
  const asUser = (user, fn) => as(db, 'app_rw', { org: a.org, ws: [a.ws] }, async () => {
    await db.query(`SELECT set_config('app.user_id', $1, false)`, [user]);
    try { return await fn(); } finally { await db.query(`SELECT set_config('app.user_id', '', false)`); }
  });
  return { db, a, b, closer, other, reviewer, mine, open, asUser };
}

test('a closer sees only the conversations, handoffs and messages handed to them; everyone else in the workspace sees all', async () => {
  const { db, a, closer, other, reviewer, mine, asUser } = await setup();
  const count = (user, t) => asUser(user, async () => Number((await one(db, `SELECT count(*) AS n FROM ${t}`)).n));
  assert.deepEqual(await asUser(closer, async () => (await db.query(`SELECT id FROM conversations`)).rows.map((r) => r.id)), [mine]);
  assert.equal(await count(closer, 'handoffs'), 1);
  assert.deepEqual(await asUser(closer, async () => (await db.query(`SELECT body FROM inbound_messages`)).rows.map((r) => r.body)), ['how much is it?']);
  assert.equal(await count(other, 'conversations'), 0, 'a closer with nothing handed to them sees nothing');
  assert.equal(await count(other, 'inbound_messages'), 0);
  // The seed's admin and a reviewer see the whole workspace: 3 conversations (seed + 2), 3 inbound messages.
  assert.equal(await count(a.user, 'conversations'), 3);
  assert.equal(await count(reviewer, 'conversations'), 3);
  assert.equal(await count(reviewer, 'inbound_messages'), 3);
  // A closer can't hand a conversation to themself by writing closer_id on one they can't see.
  await asUser(other, () => db.query(`UPDATE conversations SET closer_id = $1, state = 'handed_off' WHERE id = $2`, [other, mine]));
  assert.equal((await one(db, `SELECT closer_id FROM conversations WHERE id = $1`, [mine])).closer_id, closer);
});

test('handoffs: only to a closer, operator or admin of the workspace; in your own name; one open at a time', async () => {
  const { db, a, b, closer, reviewer, open, asUser } = await setup();
  const insert = (user, closerId, conv = open) => asUser(user, () => db.query(
    `INSERT INTO handoffs (org_id, workspace_id, conversation_id, closer_id, reason, summary, created_by) VALUES ($1, $2, $3, $4, 'qualified', 'Ready', $5)`,
    [a.org, a.ws, conv, closerId, user]));
  assert.match(await refused(insert(a.user, reviewer)) ?? '', /not a closer, operator or admin/);
  assert.match(await refused(insert(a.user, b.user)) ?? '', /not a closer, operator or admin/, 'a user from another org');
  assert.match(await refused(asUser(a.user, () => db.query(
    `INSERT INTO handoffs (org_id, workspace_id, conversation_id, closer_id, reason, summary, created_by) VALUES ($1, $2, $3, $4, 'qualified', 'Ready', $5)`,
    [a.org, a.ws, open, closer, closer]))) ?? '', /created_by must be the acting user/);
  await insert(a.user, closer);
  assert.match(await refused(insert(a.user, closer)) ?? '', /handoffs_one_open|duplicate key/, 'one open handoff per conversation');
  // Closing it frees the conversation for a new handoff.
  await db.query(`UPDATE handoffs SET outcome = 'won', outcome_at = now() WHERE conversation_id = $1`, [open]);
  await insert(a.user, closer);
  // The app can't rewrite a handoff's substance.
  assert.match(await refused(asUser(a.user, () => db.query(`UPDATE handoffs SET summary = 'edited'`))) ?? '', /permission denied/);
  assert.match(await refused(asUser(a.user, () => db.query(`UPDATE handoffs SET closer_id = $1`, [a.user]))) ?? '', /permission denied/);
});

test('channels and threads: the new channels are accepted, one conversation per thread, and handed_off needs a closer', async () => {
  const { db, a } = await setup();
  for (const ch of ['instagram_comment', 'instagram_dm', 'facebook_comment', 'messenger', 'chat', 'linkedin', 'form', 'email']) {
    await db.query(`INSERT INTO conversations (org_id, workspace_id, channel, thread_key) VALUES ($1, $2, $3, $4)`, [a.org, a.ws, ch, `t-${ch}`]);
  }
  assert.match(await refused(db.query(`INSERT INTO conversations (org_id, workspace_id, channel, thread_key) VALUES ($1, $2, 'chat', 't-chat')`, [a.org, a.ws])) ?? '', /duplicate key/);
  assert.match(await refused(db.query(`INSERT INTO conversations (org_id, workspace_id, channel, thread_key) VALUES ($1, $2, 'tiktok', 't')`, [a.org, a.ws])) ?? '', /check constraint/);
  assert.match(await refused(db.query(`INSERT INTO conversations (org_id, workspace_id, channel, thread_key, state) VALUES ($1, $2, 'chat', 'h', 'handed_off')`, [a.org, a.ws])) ?? '', /check constraint/);
  await db.query(`INSERT INTO inbound_messages (org_id, workspace_id, channel, body, received_at) VALUES ($1, $2, 'facebook_comment', 'nice ad', now())`, [a.org, a.ws]);
});

test('the inbox services still read inbound messages through the closer policy (no grant on conversations needed)', async () => {
  const { db, a } = await setup();
  const n = await as(db, 'inbox_svc', { org: a.org, ws: [a.ws] }, async () => Number((await one(db, `SELECT count(*) AS n FROM inbound_messages`)).n));
  assert.equal(n, 3);
  const und = await as(db, 'inbox_svc', null, async () => (await db.query(`SELECT * FROM inbox_undecided(10)`)).rows.length);
  assert.ok(und >= 3, 'the cross-tenant job function still lists undecided replies');
});

test('the catalog: every RLS table with an org_id carries the closer policy, so a table added later can\'t be missed', async () => {
  const { db } = await setup();
  const missing = (await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
      AND c.relname <> 'workspaces'
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'closer_scope' AND p.permissive = 'RESTRICTIVE')
    ORDER BY 1`)).rows.map((r) => r.relname);
  assert.deepEqual(missing, [], 'add a closer_scope policy to each of these');
});

test('a closer reads nothing else of the tenant: every org table, row by row; their contact\'s thread only', async () => {
  const { db, a, closer, other, asUser } = await setup();
  const tables = (await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id') ORDER BY 1`)).rows.map((r) => r.relname);
  // Expected for a closer with nothing handed to them: their own membership and the workspace rows; nothing else.
  const allowed = { memberships: 1, workspaces: 1 };
  for (const t of tables) {
    // A table app_rw has no grant on reads as nothing.
    const n = await asUser(other, async () => Number((await db.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n))
      .catch((e) => { if (/permission denied/.test(e.message)) return 0; throw e; });
    assert.equal(n, allowed[t] ?? 0, `${t} as a closer with nothing handed to them`);
  }
  // Hand the seed contact's conversation to `closer`: now its contact, enrollment, draft and sent message are visible.
  await db.query(`UPDATE handoffs SET outcome = 'reassigned', outcome_at = now() WHERE conversation_id = $1`, [a.conversation]);
  await db.query(`INSERT INTO handoffs (org_id, workspace_id, conversation_id, closer_id, reason, summary) VALUES ($1, $2, $3, $4, 'qualified', 'x')`,
    [a.org, a.ws, a.conversation, closer]);
  await db.query(`UPDATE conversations SET closer_id = $2 WHERE id = $1`, [a.conversation, closer]);
  const seen = async (t) => asUser(closer, async () => Number((await db.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n));
  assert.equal(await seen('contacts'), 1);
  assert.ok(await seen('enrollments') >= 1);
  assert.ok(await seen('drafts') >= 1);
  assert.equal(await seen('messages'), 1, 'the email sent to that contact');
  for (const t of ['campaigns', 'evidence', 'mailboxes', 'audit_log', 'meetings', 'notifications', 'icps']) assert.equal(await seen(t), 0, t);
  // A closer's own audit row still writes (accepting a handoff records one).
  await asUser(closer, () => db.query(`INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES ($1, $2, 'handoff_accept', 'handoff', $3)`,
    [a.org, closer, a.conversation]));
});

test('closer_id follows the open handoff: no bare reassignment; reassign = close as reassigned, hand off again', async () => {
  const { db, a, closer, other, open, asUser } = await setup();
  assert.match(await refused(asUser(a.user, () => db.query(`UPDATE conversations SET closer_id = $1 WHERE id = $2`, [closer, open]))) ?? '', /follows the open handoff/);
  await asUser(a.user, () => db.query(`INSERT INTO handoffs (org_id, workspace_id, conversation_id, closer_id, reason, summary, created_by) VALUES ($1, $2, $3, $4, 'qualified', 'x', $5)`,
    [a.org, a.ws, open, closer, a.user]));
  await asUser(a.user, () => db.query(`UPDATE conversations SET closer_id = $1, state = 'handed_off' WHERE id = $2`, [closer, open]));
  assert.match(await refused(asUser(a.user, () => db.query(`UPDATE conversations SET closer_id = $1 WHERE id = $2`, [other, open]))) ?? '', /follows the open handoff/);
  await asUser(a.user, () => db.query(`UPDATE handoffs SET outcome = 'reassigned', outcome_at = now() WHERE conversation_id = $1 AND outcome IS NULL`, [open]));
  await asUser(a.user, () => db.query(`INSERT INTO handoffs (org_id, workspace_id, conversation_id, closer_id, reason, summary, created_by) VALUES ($1, $2, $3, $4, 'qualified', 'y', $5)`,
    [a.org, a.ws, open, other, a.user]));
  await asUser(a.user, () => db.query(`UPDATE conversations SET closer_id = $1 WHERE id = $2`, [other, open]));
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM handoffs WHERE conversation_id = $1`, [open])).n, 2, 'the record shows both');
});
