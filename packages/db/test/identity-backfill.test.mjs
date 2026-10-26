// 0020 design tests 8, 33, 34, 42, 44, 50: the backfill, run on a database populated at 0019, then migrated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/migrate.mjs';
import { one, q, refused } from './helpers.mjs';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

async function legacyDb() {
  const dir = await mkdtemp(join(tmpdir(), 'mig19-'));
  for (const f of (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql') && n < '0020').sort()) {
    await copyFile(new URL(f, MIGRATIONS), join(dir, f));
  }
  const db = new PGlite();
  await migrate(db, dir);
  return db;
}

async function legacyTenant(db, label) {
  const org = (await one(db, `INSERT INTO orgs (name) VALUES ($1) RETURNING id`, [label])).id;
  const ws = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, $2) RETURNING id`, [org, `${label}-ws`])).id;
  const icp = (await one(db, `INSERT INTO icps (org_id, workspace_id, data) VALUES ($1, $2, '{}') RETURNING id`, [org, ws])).id;
  const campaign = (await one(db, `INSERT INTO campaigns (org_id, workspace_id, name, icp_id, status) VALUES ($1, $2, 'c1', $3, 'active') RETURNING id`, [org, ws, icp])).id;
  return { org, ws, campaign };
}
async function contact(db, t, { name, email = null, phone = null }) {
  const id = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, phone) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [t.org, t.ws, name, email, email ? 'valid' : 'unknown', phone])).id;
  return id;
}
const enroll = (db, t, c, stop = null) => db.query(
  `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id, state, stop_reason) VALUES ($1, $2, $3, $4, $5, $6)`,
  [t.org, t.ws, t.campaign, c, stop ? 'stopped' : 'waiting', stop]);
const suppressed = (db, id, ch = null) => one(db, `SELECT person_suppressed($1, $2) AS s`, [id, ch]).then((r) => r.s);
const live = (db, c) => one(db, `SELECT count(*)::int AS n FROM enrollments WHERE contact_id = $1 AND state NOT IN ('stopped','converted','completed')`, [c]).then((r) => r.n);

test('8/33/34/44/50: a populated pre-0020 database is backfilled: identities, phone re-hash, profile and form opt-outs, closure, origin-less legacy STOPs', async () => {
  const db = await legacyDb();
  const a = await legacyTenant(db, 'alpha');
  const b = await legacyTenant(db, 'beta');

  // 33: a profile-only opt-out as ingestPasted wrote it: a conversation on the profile thread and an unsubscribe message.
  const profile = await contact(db, a, { name: 'Maria Lopez' });
  const conv = (await one(db, `INSERT INTO conversations (org_id, workspace_id, contact_id, channel, thread_key) VALUES ($1, $2, $3, 'linkedin', 'profile:in/Maria-Lopez') RETURNING id`, [a.org, a.ws, profile])).id;
  await db.query(`INSERT INTO inbound_messages (org_id, workspace_id, contact_id, channel, body, received_at, intent, conversation_id) VALUES ($1, $2, $3, 'linkedin', 'please stop', now(), 'unsubscribe', $4)`, [a.org, a.ws, profile, conv]);
  // 34: an email twin joined to the same profile by a second conversation; a form opt-out contact; a stop_reason twin.
  const twin = await contact(db, a, { name: 'M Lopez', email: 'ml@alpha.test' });
  await db.query(`INSERT INTO conversations (org_id, workspace_id, contact_id, channel, thread_key) VALUES ($1, $2, $3, 'linkedin', 'profile:in/maria-lopez')`, [a.org, a.ws, twin]);
  await enroll(db, a, twin);
  const form = await contact(db, a, { name: 'Form Person', email: 'form@alpha.test' });
  await db.query(`INSERT INTO inbound_messages (org_id, workspace_id, contact_id, channel, body, received_at, intent) VALUES ($1, $2, $3, 'form', 'unsubscribe me', now(), 'unsubscribe')`, [a.org, a.ws, form]);
  const formTwin = await contact(db, a, { name: 'Other Name', email: 'FORM@alpha.test' });
  await enroll(db, a, formTwin);
  const stopped = await contact(db, a, { name: 'Stop Reason', email: 'sr@alpha.test' });
  await enroll(db, a, stopped, 'linkedin:unsubscribe');
  // Phone: a legacy raw-format STOP; a holder in another format; one in another org with the same digits.
  const owner = await contact(db, a, { name: 'Line Owner', email: 'owner@alpha.test', phone: '615.555.0142' });
  const mate = await contact(db, a, { name: 'Desk Mate', email: 'mate@alpha.test', phone: '(615) 555-0142' });
  const foreign = await contact(db, b, { name: 'Elsewhere', email: 'e@beta.test', phone: '615-555-0142' });
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash('615.555.0142'), 'phone', 'sms_stop')`, [a.org]);
  // The same slug in another org.
  const bProfile = await contact(db, b, { name: 'Maria Lopez' });
  await db.query(`INSERT INTO conversations (org_id, workspace_id, contact_id, channel, thread_key) VALUES ($1, $2, $3, 'linkedin', 'profile:in/maria-lopez')`, [b.org, b.ws, bProfile]);

  await migrate(db);

  // Identities exist for every contact value, canonical.
  assert.ok((await one(db, `SELECT count(*)::int AS n FROM contact_identities WHERE contact_id = $1 AND kind = 'linkedin'`, [profile])).n === 1);
  assert.ok((await one(db, `SELECT count(*)::int AS n FROM contact_identities WHERE contact_id = $1 AND kind = 'phone' AND value_hash = value_hash('+16155550142')`, [mate])).n === 1);
  // 33/34: the opt-out becomes real and spreads to the email twin through the shared profile.
  assert.equal(await suppressed(db, profile), true);
  assert.equal(await suppressed(db, twin), true);
  assert.equal(await live(db, twin), 0, '8: the twin enrollment was stopped');
  assert.equal(await suppressed(db, bProfile), false, 'another org untouched');
  // The form opt-out and the stop_reason opt-out become address suppressions; the case-variant twin follows.
  assert.equal(await suppressed(db, form), true);
  assert.equal(await suppressed(db, formTwin), true);
  assert.equal(await live(db, formTwin), 0);
  assert.equal(await suppressed(db, stopped), true);
  // 44/50: the legacy phone STOP gains the canonical hash with no origin: it blocks every channel for everyone on the line.
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM suppression_origins WHERE value_hash = value_hash('+16155550142')`)).n, 0);
  for (const c of [owner, mate]) for (const ch of ['sms', 'email']) assert.equal(await suppressed(db, c, ch), true, `${ch}`);
  assert.equal(await suppressed(db, foreign, 'sms'), false, 'the same digits in another org are another line');
  // The helper is gone.
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname = '_backfill_0020'`)).n, 0);
});

test('42: the backfill aborts naming the number of legacy profile thread keys that cannot be canonicalised', async () => {
  const db = await legacyDb();
  const a = await legacyTenant(db, 'alpha');
  for (const [i, key] of ['profile:in/bad%2fkey', 'profile:in/x', 'profile:in/fine-one'].entries()) {
    const c = await contact(db, a, { name: `Person ${i}` });
    await db.query(`INSERT INTO conversations (org_id, workspace_id, contact_id, channel, thread_key) VALUES ($1, $2, $3, 'linkedin', $4)`, [a.org, a.ws, c, key]);
  }
  assert.match((await refused(migrate(db))) ?? '', /2 linkedin profile thread key/);
});

// The same backfill the way prod runs it: a non-superuser owner, FORCE ROW LEVEL SECURITY binding every table, so the
// backfill reaches inbound_messages only through its definer's identity_all policy.
test('8 (prod shape): the backfill works for a non-superuser migrator on forced-RLS tables, and rename_owner works at runtime', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mig19-'));
  for (const f of (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql') && n < '0020').sort()) await copyFile(new URL(f, MIGRATIONS), join(dir, f));
  const db = new PGlite();
  await db.exec(`CREATE ROLE omni_owner LOGIN CREATEROLE; ALTER SCHEMA public OWNER TO omni_owner;
    SET SESSION AUTHORIZATION omni_owner; SET createrole_self_grant = 'set';`);
  await migrate(db, dir);
  const ctx = (org, ws) => db.query(`SELECT set_config('app.org_id', $1, false), set_config('app.workspace_ids', $2, false)`, [org, ws]);
  const org = (await one(db, `SELECT gen_random_uuid() AS id`)).id;
  const ws = (await one(db, `SELECT gen_random_uuid() AS id`)).id;
  await ctx(org, ws);
  await db.query(`INSERT INTO orgs (id, name) VALUES ($1, 'alpha')`, [org]);
  await db.query(`INSERT INTO workspaces (id, org_id, name) VALUES ($1, $2, 'w')`, [ws, org]);
  const mk = async (name, email) => (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [org, ws, name, email, 'unknown'])).id;
  const form = await mk('Form Person', 'form@alpha.test');
  const twin = await mk('Form Twin', 'FORM@alpha.test');
  const user = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ('u-1', 'u@alpha.test') RETURNING id`)).id;
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')`, [org, user]);
  await db.query(`INSERT INTO inbound_messages (org_id, workspace_id, contact_id, channel, body, received_at, intent) VALUES ($1, $2, $3, 'form', 'unsubscribe me', now(), 'unsubscribe')`, [org, ws, form]);

  await migrate(db);

  await ctx(org, ws);
  await db.exec('SET ROLE app_rw');
  assert.equal(await suppressed(db, form), true, 'the form opt-out was read through the definer policy');
  assert.equal(await suppressed(db, twin), true);
  await db.exec('RESET ROLE');
  await db.exec('SET ROLE app_rw');
  // rename_owner at runtime: an opted-out contact is renamed only through the audited function.
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [user]);
  assert.match((await refused(db.query(`UPDATE contacts SET name = 'Renamed Person' WHERE id = $1`, [form]))) ?? '', /opted out/);
  await db.query(`SELECT rename_opted_out_contact($1, 'Renamed Person', 'Legal name change confirmed')`, [form]);
  assert.equal((await one(db, `SELECT name FROM contacts WHERE id = $1`, [form])).name, 'Renamed Person');
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM audit_log WHERE action = 'rename_opted_out'`)).n, 1);
});
