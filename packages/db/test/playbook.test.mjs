// 0017: the playbook. Replies are the workspace's own words; a person decides each draft; whether it was edited is
// computed by the database, so the autonomy counter can't be talked up; website-form replies never count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused } from './helpers.mjs';

const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];

async function setup() {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  const asUser = (user, fn, t = a) => as(db, 'app_rw', { org: t.org, ws: [t.ws] }, async () => {
    await db.query(`SELECT set_config('app.user_id', $1, false)`, [user]);
    try { return await fn(); } finally { await db.query(`SELECT set_config('app.user_id', '', false)`); }
  });
  return { db, a, b, asUser };
}
const draft = (db, a, conv, user, body = 'Hi there.') => db.query(
  `INSERT INTO reply_drafts (org_id, workspace_id, conversation_id, category, body_proposed, created_by) VALUES ($1, $2, $3, 'question', $4, $5) RETURNING *`,
  [a.org, a.ws, conv, body, user]).then((r) => r.rows[0]);

test('a draft takes its channel and autonomy flag from the conversation; the app can set neither', async () => {
  const { db, a, asUser } = await setup();
  const form = (await one(db, `INSERT INTO conversations (org_id, workspace_id, channel, thread_key) VALUES ($1, $2, 'form', 'f1') RETURNING id`, [a.org, a.ws])).id;
  // The seed's pending draft holds the seed conversation; discard it first.
  await db.query(`UPDATE reply_drafts SET status = 'discarded', decided_by = $1, decided_at = now() WHERE org_id = $2`, [a.user, a.org]);
  const d = await asUser(a.user, () => draft(db, a, form, a.user));
  assert.deepEqual([d.channel, d.counts_for_autonomy, d.status], ['form', false, 'pending']);
  assert.match(await refused(asUser(a.user, () => db.query(
    `INSERT INTO reply_drafts (org_id, workspace_id, conversation_id, category, body_proposed, created_by, counts_for_autonomy) VALUES ($1, $2, $3, 'question', 'x', $4, true)`,
    [a.org, a.ws, a.conversation, a.user]))) ?? '', /permission denied/);
  const e = await asUser(a.user, () => draft(db, a, a.conversation, a.user));
  assert.deepEqual([e.channel, e.counts_for_autonomy], ['email', true]);
  assert.match(await refused(asUser(a.user, () => draft(db, a, a.conversation, a.user))) ?? '', /reply_drafts_one_pending|duplicate key/, 'one pending per conversation');
  await asUser(a.user, () => db.query(`UPDATE reply_drafts SET status = 'discarded', decided_by = $2, decided_at = now() WHERE id = $1`, [d.id, a.user]));
  const other = (await one(db, `SELECT id FROM users WHERE id <> $1 LIMIT 1`, [a.user])).id;
  assert.match(await refused(asUser(a.user, () => draft(db, a, form, other))) ?? '', /created_by must be the acting user/);
});

test('deciding: final, in your own name; edited is the database\'s comparison, not the app\'s say-so', async () => {
  const { db, a, asUser } = await setup();
  const [seed] = (await db.query(`SELECT * FROM reply_drafts WHERE org_id = $1`, [a.org])).rows;
  // Approve unchanged: edited = false.
  await asUser(a.user, () => db.query(`UPDATE reply_drafts SET status = 'approved', body_final = body_proposed, decided_by = $2, decided_at = now() WHERE id = $1`, [seed.id, a.user]));
  assert.equal((await one(db, `SELECT edited FROM reply_drafts WHERE id = $1`, [seed.id])).edited, false);
  assert.match(await refused(asUser(a.user, () => db.query(`UPDATE reply_drafts SET status = 'discarded', body_final = NULL, decided_by = $2 WHERE id = $1`, [seed.id, a.user]))) ?? '', /already approved/);
  // Approve with a change: edited = true, even if the app claims otherwise.
  const d = await asUser(a.user, () => draft(db, a, a.conversation, a.user, 'Proposal'));
  assert.match(await refused(asUser(a.user, () => db.query(`UPDATE reply_drafts SET edited = false WHERE id = $1`, [d.id]))) ?? '', /permission denied/);
  await asUser(a.user, () => db.query(`UPDATE reply_drafts SET status = 'approved', body_final = 'Proposal, reworded', decided_by = $2, decided_at = now() WHERE id = $1`, [d.id, a.user]));
  assert.equal((await one(db, `SELECT edited FROM reply_drafts WHERE id = $1`, [d.id])).edited, true);
  // Someone else's name is refused.
  const d2 = await asUser(a.user, () => draft(db, a, a.conversation, a.user));
  const other = (await one(db, `SELECT id FROM users WHERE id <> $1 LIMIT 1`, [a.user])).id;
  assert.match(await refused(asUser(a.user, () => db.query(`UPDATE reply_drafts SET status = 'discarded', decided_by = $2, decided_at = now() WHERE id = $1`, [d2.id, other]))) ?? '',
    /decided_by must be the acting user/);
  assert.match(await refused(db.query(`UPDATE reply_drafts SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`, [d2.id, a.user])) ?? '', /check constraint/,
    'an approval needs the final text');
});

test('the playbook is the workspace\'s own: tenants are walled; one live reply per name and category; questions 1-4', async () => {
  const { db, a, b, asUser } = await setup();
  assert.equal(await asUser(b.user, async () => Number((await one(db, `SELECT count(*) AS n FROM playbook_replies WHERE id = $1`, [a.playbook])).n), b), 0);
  assert.match(await refused(asUser(a.user, () => db.query(`INSERT INTO playbook_replies (org_id, workspace_id, category, name, body) VALUES ($1, $2, 'not_interested', 'POLITE CLOSE', 'x')`, [a.org, a.ws]))) ?? '',
    /duplicate key/);
  assert.match(await refused(db.query(`INSERT INTO playbook_replies (org_id, workspace_id, category, name, body) VALUES ($1, $2, 'unsubscribe', 'n', 'x')`, [a.org, a.ws])) ?? '', /check constraint/,
    'an opt-out is never answered from the playbook');
  assert.match(await refused(db.query(`INSERT INTO qualification_questions (org_id, workspace_id, position, key, question) VALUES ($1, $2, 5, 'size', 'How big?')`, [a.org, a.ws])) ?? '', /check constraint/);
  assert.match(await refused(db.query(`INSERT INTO qualification_questions (org_id, workspace_id, position, key, question) VALUES ($1, $2, 2, 'timing', 'Again?')`, [a.org, a.ws])) ?? '', /duplicate key/);
  await db.query(`UPDATE reply_drafts SET status = 'discarded', decided_by = $1, decided_at = now() WHERE org_id = $2`, [b.user, b.org]);
  assert.match(await refused(db.query(`INSERT INTO reply_drafts (org_id, workspace_id, conversation_id, category, body_proposed) VALUES ($1, $2, $3, 'question', 'x')`, [a.org, a.ws, b.conversation])) ?? '',
    /foreign key/, 'a draft can\'t point at another tenant\'s conversation');
});
