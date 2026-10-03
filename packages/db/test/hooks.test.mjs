// 0014: inbound webhooks. The token hash is never readable by the app, a hook resolves only with its own live token,
// and inbox_svc may add a contact only inside the hook's workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freshDb, seedTenant, as, refused } from './helpers.mjs';

const hash = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

test('hooks: app_rw creates, lists and revokes; never reads the token hash; tenants are walled', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha'); const b = await seedTenant(db, 'beta');
  const inA = (sql, p) => as(db, 'app_rw', { org: a.org, ws: [a.ws] }, () => db.query(sql, p));
  const id = (await inA(`INSERT INTO inbound_hooks (org_id, workspace_id, name, token_hash) VALUES ($1, $2, 'Chat', $3) RETURNING id`, [a.org, a.ws, hash('t1')])).rows[0].id;
  assert.equal((await inA(`SELECT count(*)::int AS n FROM inbound_hooks`)).rows[0].n, 2, 'the seed hook + this one');
  assert.match(await refused(inA(`SELECT token_hash FROM inbound_hooks`)) ?? '', /permission denied/);
  assert.match(await refused(inA(`UPDATE inbound_hooks SET name = 'x' WHERE id = $1`, [id])) ?? '', /permission denied/);
  assert.equal((await as(db, 'app_rw', { org: b.org, ws: [b.ws] }, () => db.query(`SELECT count(*)::int AS n FROM inbound_hooks WHERE id = $1`, [id]))).rows[0].n, 0);
  assert.match(await refused(as(db, 'app_rw', { org: b.org, ws: [b.ws] }, () => db.query(
    `INSERT INTO inbound_hooks (org_id, workspace_id, name, token_hash) VALUES ($1, $2, 'x', $3)`, [a.org, a.ws, hash('t2')]))) ?? '', /row-level security/);
  await inA(`UPDATE inbound_hooks SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
});

test('inbox_resolve_hook: only a live hook with its own token answers; only inbox_svc may call it', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha'); await seedTenant(db, 'beta');
  const hook = (await db.query(`SELECT id FROM inbound_hooks WHERE org_id = $1`, [a.org])).rows[0].id;
  const resolve = (id, tok) => as(db, 'inbox_svc', null, () => db.query(`SELECT * FROM inbox_resolve_hook($1, $2)`, [id, tok])).then((r) => r.rows);
  assert.deepEqual((await resolve(hook, hash('hook-token-alpha'))).map((r) => [r.org_id, r.workspace_id, r.kind]), [[a.org, a.ws, 'form']]);
  assert.deepEqual(await resolve(hook, hash('hook-token-beta')), [], "another hook's token");
  assert.deepEqual(await resolve(hook, 'not-a-hash'), []);
  await db.query(`UPDATE inbound_hooks SET revoked_at = now() WHERE id = $1`, [hook]);
  assert.deepEqual(await resolve(hook, hash('hook-token-alpha')), [], 'revoked');
  for (const role of ['app_rw', 'sender_svc']) {
    const r = await refused(as(db, role, { org: a.org, ws: [a.ws] }, () => db.query(`SELECT * FROM inbox_resolve_hook($1, $2)`, [hook, hash('hook-token-alpha')])));
    assert.match(r ?? 'ran', /permission denied/, role);
  }
});

test('inbox_svc adds a contact for a new submitter only inside the scoped workspace', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha'); const b = await seedTenant(db, 'beta');
  await as(db, 'inbox_svc', { org: a.org, ws: [a.ws] }, () => db.query(
    `INSERT INTO contacts (org_id, workspace_id, name, email) VALUES ($1, $2, 'New Lead', 'new@lead.example') ON CONFLICT (workspace_id, email) DO NOTHING`, [a.org, a.ws]));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM contacts WHERE email = 'new@lead.example'`)).rows[0].n, 1);
  assert.match(await refused(as(db, 'inbox_svc', { org: a.org, ws: [a.ws] }, () => db.query(
    `INSERT INTO contacts (org_id, workspace_id, email) VALUES ($1, $2, 'x@lead.example')`, [b.org, b.ws]))) ?? '', /row-level security/);
  assert.match(await refused(as(db, 'inbox_svc', { org: a.org, ws: [a.ws] }, () => db.query(
    `INSERT INTO contacts (org_id, workspace_id, email, email_status) VALUES ($1, $2, 'y@lead.example', 'valid')`, [a.org, a.ws]))) ?? '', /permission denied/);
});
