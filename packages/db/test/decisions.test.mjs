// 0006_decisions: the model pass on inbound replies can only add, once, and only through inbox_svc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, refused, one } from './helpers.mjs';
import { withTenant, withoutTenant, withService } from '../src/context.mjs';

const svc = (t) => ({ orgId: t.org, workspaceId: t.ws, role: 'inbox_svc' });
const decide = (db, t, sql, params) => withService(db, svc(t), (tx) => tx.query(sql, params));

test('inbox_svc records a decision once; a second write, or clearing it, is refused', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  await decide(db, a, `UPDATE inbound_messages SET decision = '{"stop":0.9}', decided_at = now() WHERE id = $1`, [a.inbound]);
  assert.match(await refused(decide(db, a, `UPDATE inbound_messages SET decision = '{"stop":0.1}' WHERE id = $1`, [a.inbound])), /already decided/);
  assert.match(await refused(decide(db, a, `UPDATE inbound_messages SET decision = NULL, decided_at = NULL WHERE id = $1`, [a.inbound])), /already decided/);
  // decision and decided_at travel together.
  const b = await seedTenant(db, 'bravo');
  assert.match(await refused(decide(db, b, `UPDATE inbound_messages SET decision = '{}' WHERE id = $1`, [b.inbound])), /check constraint/);
  assert.match(await refused(decide(db, b, `UPDATE inbound_messages SET decision = '[1]', decided_at = now() WHERE id = $1`, [b.inbound])), /check constraint/);
});

test('an SLA can be added but never moved or cleared, by any role', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  await decide(db, a, `UPDATE inbound_messages SET sla_due_at = now() + interval '2 hours' WHERE id = $1`, [a.inbound]);
  assert.match(await refused(decide(db, a, `UPDATE inbound_messages SET sla_due_at = NULL WHERE id = $1`, [a.inbound])), /only be added/);
  assert.match(await refused(decide(db, a, `UPDATE inbound_messages SET sla_due_at = sla_due_at + interval '1 day' WHERE id = $1`, [a.inbound])), /only be added/);
  // Even the table owner, outside any app role, hits the trigger.
  assert.match(await refused(db.query(`UPDATE inbound_messages SET sla_due_at = NULL WHERE id = $1`, [a.inbound])), /only be added/);
});

test('the app role cannot write a decision or an SLA; inbox_svc cannot touch the rest of the row', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const ctx = { userId: a.user, orgId: a.org, workspaceId: a.ws };
  assert.match(await refused(withTenant(db, ctx, (tx) =>
    tx.query(`UPDATE inbound_messages SET decision = '{}', decided_at = now() WHERE id = $1`, [a.inbound]))), /permission denied/);
  assert.match(await refused(withTenant(db, ctx, (tx) =>
    tx.query(`UPDATE inbound_messages SET sla_due_at = now() WHERE id = $1`, [a.inbound]))), /permission denied/);
  assert.match(await refused(decide(db, a, `UPDATE inbound_messages SET intent = 'meeting_request' WHERE id = $1`, [a.inbound])), /permission denied/);
  assert.match(await refused(decide(db, a, `UPDATE inbound_messages SET body = 'x' WHERE id = $1`, [a.inbound])), /permission denied/);
});

test('inbox_undecided: ids only, across tenants, undecided only, inbox_svc only', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  const list = () => withoutTenant(db, { role: 'inbox_svc' }, (tx) => tx.query(`SELECT * FROM inbox_undecided(10)`).then((r) => r.rows));
  const before = await list();
  assert.deepEqual(before.map((r) => r.id).sort(), [a.inbound, b.inbound].sort());
  assert.deepEqual(Object.keys(before[0]).sort(), ['id', 'org_id', 'workspace_id']);
  await decide(db, a, `UPDATE inbound_messages SET decision = '{}', decided_at = now() WHERE id = $1`, [a.inbound]);
  assert.deepEqual((await list()).map((r) => r.id), [b.inbound]);
  assert.match(await refused(withoutTenant(db, { role: 'app_rw' }, (tx) => tx.query(`SELECT * FROM inbox_undecided(10)`))), /permission denied/);
  // Bounded whatever the caller asks for.
  assert.ok((await one(db, `SELECT count(*)::int AS n FROM inbox_undecided(-5)`)).n <= 1);
});
