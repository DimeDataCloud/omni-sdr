// 0016: the closer's side of a handoff. An accept-by time that escalates once; a booking link only its own member can
// set; and a closer sees no workspace notifications.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused } from './helpers.mjs';

const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];

async function setup() {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  const closer = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ('c', 'closer@alpha.test') RETURNING id`)).id;
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'closer')`, [a.org, closer]);
  const asUser = (user, fn, t = a) => as(db, 'app_rw', { org: t.org, ws: [t.ws] }, async () => {
    await db.query(`SELECT set_config('app.user_id', $1, false)`, [user]);
    try { return await fn(); } finally { await db.query(`SELECT set_config('app.user_id', '', false)`); }
  });
  return { db, a, b, closer, asUser };
}

test('booking link: a member sets and clears their own, https only; nobody can write anyone else\'s', async () => {
  const { db, a, b, closer, asUser } = await setup();
  const set = (user, url, org = a.org) => asUser(user, async () => (await one(db, `SELECT app_set_booking_url($1, $2) AS ok`, [org, url])).ok);
  assert.equal(await set(closer, 'https://cal.example/closer'), true);
  assert.equal((await one(db, `SELECT booking_url FROM memberships WHERE user_id = $1`, [closer])).booking_url, 'https://cal.example/closer');
  assert.equal((await one(db, `SELECT booking_url FROM memberships WHERE user_id = $1`, [a.user])).booking_url, null, 'only the caller\'s row');
  assert.equal(await set(closer, 'https://cal.example/x', b.org), false, 'not a member of that org: nothing changes');
  assert.match(await refused(set(closer, 'http://cal.example/plain')) ?? '', /check constraint/);
  assert.match(await refused(set(closer, 'javascript:alert(1)')) ?? '', /check constraint/);
  assert.match(await refused(set(closer, 'https://cal.example/"><script>')) ?? '', /check constraint/);
  assert.equal(await set(closer, null), true);
  assert.equal((await one(db, `SELECT booking_url FROM memberships WHERE user_id = $1`, [closer])).booking_url, null);
  // The app can't write the column directly, for anyone.
  assert.match(await refused(asUser(a.user, () => db.query(`UPDATE memberships SET booking_url = 'https://evil.example/' WHERE user_id = $1`, [closer]))) ?? '',
    /permission denied/);
  // With no acting user the function does nothing.
  assert.equal(await as(db, 'app_rw', { org: a.org, ws: [a.ws] }, async () => (await one(db, `SELECT app_set_booking_url($1, 'https://x.example/') AS ok`, [a.org])).ok), false);
});

test('overdue handoffs: listed once each, across tenants; accepted, closed or not-yet-due ones never', async () => {
  const { db, a, b, closer } = await setup();
  const conv = async (t, key) => (await one(db, `INSERT INTO conversations (org_id, workspace_id, channel, thread_key) VALUES ($1, $2, 'chat', $3) RETURNING id`, [t.org, t.ws, key])).id;
  const hand = async (t, c, user, due, extra = '') => (await one(db, `INSERT INTO handoffs (org_id, workspace_id, conversation_id, closer_id, reason, summary, due_at, created_at${extra ? ', accepted_at' : ''})
    VALUES ($1, $2, $3, $4, 'qualified', 's', $5, now() - interval '3 hours'${extra ? ', now()' : ''}) RETURNING id`, [t.org, t.ws, c, user, due])).id;
  const late = await hand(a, await conv(a, 'k1'), closer, new Date(Date.now() - 60000));
  await hand(a, await conv(a, 'k2'), closer, new Date(Date.now() - 60000), 'accepted');
  await hand(a, await conv(a, 'k3'), closer, new Date(Date.now() + 3600000));
  const lateB = await hand(b, await conv(b, 'k4'), b.user, new Date(Date.now() - 120000));
  const overdue = () => as(db, 'inbox_svc', null, async () => (await db.query(`SELECT * FROM inbox_handoffs_overdue(now(), 100)`)).rows);
  assert.deepEqual((await overdue()).map((r) => r.handoff_id), [lateB, late], 'oldest due first; the seed handoffs are not due yet');
  // Escalated: an in-app alert about the handoff, written in its tenant as inbox_svc. Then it is never listed again.
  await as(db, 'inbox_svc', { org: a.org, ws: [a.ws] }, () => db.query(
    `INSERT INTO notifications (org_id, workspace_id, handoff_id, kind, channel, due_at) VALUES ($1, $2, $3, 'handoff_overdue', 'in_app', now())`, [a.org, a.ws, late]));
  assert.deepEqual((await overdue()).map((r) => r.handoff_id), [lateB]);
  assert.match(await refused(as(db, 'inbox_svc', { org: a.org, ws: [a.ws] }, () => db.query(
    `INSERT INTO notifications (org_id, workspace_id, handoff_id, kind, channel, due_at) VALUES ($1, $2, $3, 'handoff_overdue', 'in_app', now())`, [a.org, a.ws, late]))) ?? '',
  /duplicate key/, 'once per handoff and channel');
  // Only the job's role may call the finder.
  assert.match(await refused(as(db, 'app_rw', { org: a.org, ws: [a.ws] }, () => db.query(`SELECT * FROM inbox_handoffs_overdue(now(), 10)`))) ?? '', /permission denied/);
  // A handoff alert can't point at another tenant's handoff.
  assert.match(await refused(as(db, 'inbox_svc', { org: a.org, ws: [a.ws] }, () => db.query(
    `INSERT INTO notifications (org_id, workspace_id, handoff_id, kind, channel, due_at) VALUES ($1, $2, $3, 'handoff_overdue', 'email', now())`, [a.org, a.ws, lateB]))) ?? '',
  /foreign key/);
});

test('notifications: exactly one subject, the kind matches it; a closer sees none of the workspace\'s', async () => {
  const { db, a, closer, asUser } = await setup();
  const h = (await one(db, `SELECT id FROM handoffs WHERE org_id = $1`, [a.org])).id;
  assert.match(await refused(db.query(`INSERT INTO notifications (org_id, workspace_id, inbound_message_id, handoff_id, kind, channel, due_at)
    VALUES ($1, $2, $3, $4, 'handoff_overdue', 'in_app', now())`, [a.org, a.ws, a.inbound, h])) ?? '', /check constraint/);
  assert.match(await refused(db.query(`INSERT INTO notifications (org_id, workspace_id, handoff_id, kind, channel, due_at)
    VALUES ($1, $2, $3, 'sla_meeting', 'in_app', now())`, [a.org, a.ws, h])) ?? '', /check constraint/);
  assert.match(await refused(db.query(`INSERT INTO notifications (org_id, workspace_id, kind, channel, due_at)
    VALUES ($1, $2, 'sla_meeting', 'in_app', now())`, [a.org, a.ws])) ?? '', /check constraint/);
  await db.query(`INSERT INTO notifications (org_id, workspace_id, handoff_id, kind, channel, due_at) VALUES ($1, $2, $3, 'handoff_overdue', 'in_app', now())`, [a.org, a.ws, h]);
  const count = (user) => asUser(user, async () => Number((await one(db, `SELECT count(*) AS n FROM notifications`)).n));
  assert.equal(await count(a.user), 2, 'the admin: the seed SLA alert and the overdue handoff');
  assert.equal(await count(closer), 0);
  // The SLA job still reads through the new policy.
  const due = await as(db, 'inbox_svc', null, async () => (await db.query(`SELECT * FROM inbox_sla_due(now() + interval '1 day', 10)`)).rows);
  assert.ok(Array.isArray(due));
});
