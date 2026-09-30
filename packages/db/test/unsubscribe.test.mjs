import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { freshDb, seedTenant, as, one, q, refused, approvedDraft, send } from './helpers.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
// The sender issues one token per message, as sender_svc.
async function issueToken(db, t, contactId = t.contact) {
  const token = randomBytes(24).toString('base64url');
  await as(db, 'sender_svc', { org: t.org, ws: [t.ws] }, () => db.query(
    `INSERT INTO unsubscribe_tokens (token_hash, org_id, workspace_id, contact_id) VALUES ($1, $2, $3, $4)`,
    [sha(token), t.org, t.ws, contactId]));
  return token;
}
// The public route: no session, app_rw, no tenant context.
const clickUnsubscribe = (db, token) => as(db, 'app_rw', null, async () =>
  (await one(db, `SELECT unsubscribe($1) AS ok`, [token])).ok);

test('unsubscribe: suppression is written in the click transaction and the next send is refused', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const token = await issueToken(db, t);
  assert.equal(await clickUnsubscribe(db, token), true);
  const s = await q(db, `SELECT reason FROM suppression WHERE scope_org_id = $1 AND value_hash = value_hash($2)`, [t.org, 'pat@alpha.test']);
  assert.equal(s.length, 1);
  assert.equal((await one(db, `SELECT state, stop_reason FROM enrollments WHERE id = $1`, [t.enrollment])).stop_reason, 'unsubscribe');
  const d = await approvedDraft(db, t);
  assert.match(await refused(send(db, t, d)) ?? '', /suppressed/);
  assert.equal((await q(db, `SELECT 1 FROM audit_log WHERE org_id = $1 AND action = 'unsubscribe'`, [t.org])).length, 1);
});

test('unsubscribe: stops every live enrollment for that address across the org, and only that org', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  // The same person as a contact in a second workspace of org A, and in org B.
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'ws2') RETURNING id`, [a.org])).id;
  const c2 = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'Pat', 'PAT@alpha.test', 'valid') RETURNING id`, [a.org, ws2])).id;
  const camp2 = (await one(db, `INSERT INTO campaigns (org_id, workspace_id, name, status) VALUES ($1, $2, 'c2', 'active') RETURNING id`, [a.org, ws2])).id;
  const e2 = (await one(db, `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id) VALUES ($1, $2, $3, $4) RETURNING id`, [a.org, ws2, camp2, c2])).id;
  const cb = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'Pat', 'pat@alpha.test', 'valid') RETURNING id`, [b.org, b.ws])).id;
  const eb = (await one(db, `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id) VALUES ($1, $2, $3, $4) RETURNING id`, [b.org, b.ws, b.campaign, cb])).id;

  await clickUnsubscribe(db, await issueToken(db, a));
  assert.equal((await one(db, `SELECT state FROM enrollments WHERE id = $1`, [e2])).state, 'stopped', 'other workspace, same org: stopped');
  assert.equal((await one(db, `SELECT state FROM enrollments WHERE id = $1`, [eb])).state, 'waiting', 'other org: untouched');
  assert.equal((await q(db, `SELECT 1 FROM suppression WHERE scope_org_id = $1 AND value_hash = value_hash('pat@alpha.test')`, [b.org])).length, 0);
});

test('unsubscribe: reuse is harmless, unknown tokens write nothing, and old tokens still work (≥30 days)', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const token = await issueToken(db, t);
  await db.query(`UPDATE unsubscribe_tokens SET created_at = now() - interval '400 days' WHERE token_hash = $1`, [sha(token)]);
  assert.equal(await clickUnsubscribe(db, token), true, 'a year-old token still unsubscribes');
  assert.equal(await clickUnsubscribe(db, token), true, 'second click');
  assert.equal((await q(db, `SELECT 1 FROM suppression WHERE scope_org_id = $1 AND value_hash = value_hash('pat@alpha.test')`, [t.org])).length, 1);
  const before = (await q(db, `SELECT 1 FROM suppression`)).length;
  assert.equal(await clickUnsubscribe(db, 'not-a-real-token'), false);
  assert.equal((await q(db, `SELECT 1 FROM suppression`)).length, before);
});

test('unsubscribe tokens: only the sender issues them; the app role can neither mint nor read them', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const ctx = { org: t.org, ws: [t.ws] };
  assert.match(await refused(as(db, 'app_rw', ctx, () => db.query(
    `INSERT INTO unsubscribe_tokens (token_hash, org_id, workspace_id, contact_id) VALUES ($1, $2, $3, $4)`,
    [sha('x'), t.org, t.ws, t.contact]))) ?? '', /permission denied/);
  assert.match(await refused(as(db, 'app_rw', ctx, () => db.query(`SELECT * FROM unsubscribe_tokens`))) ?? '', /permission denied/);
  assert.match(await refused(as(db, 'sender_svc', ctx, () => db.query(
    `UPDATE unsubscribe_tokens SET used_at = now()`))) ?? '', /permission denied/);
});
