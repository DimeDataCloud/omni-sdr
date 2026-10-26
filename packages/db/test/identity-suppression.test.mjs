// 0020: an opt-out belongs to the person, not the address. These tests pin the canonical forms, the identity fill, the
// closure over email and profile links, the phone rules, the name hold, the guard and the sender hand-off check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused, one, q, send, approvedDraft } from './helpers.mjs';

const ctxOf = (t) => ({ org: t.org, ws: [t.ws] });

async function addContact(db, t, { name, email = null, phone = null, slug = null, status = 'valid' }) {
  return (await one(db,
    `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, phone, linkedin_slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [t.org, t.ws, name, email, email ? status : 'unknown', phone, slug])).id;
}
const suppressed = (db, id, channel = null) => one(db, `SELECT person_suppressed($1, $2) AS s`, [id, channel]).then((r) => r.s);
const optOut = (db, t, id, reason = 'manual') => as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, $2)`, [id, reason]));

test('canonical forms: phone digits, LinkedIn slugs, names', async () => {
  const db = await freshDb();
  const v = (sql) => one(db, sql).then((r) => r.v);
  assert.equal(await v(`SELECT canon_phone('+1 (615) 555-0100') AS v`), await v(`SELECT canon_phone('16155550100') AS v`));
  assert.equal(await v(`SELECT canon_phone('') AS v`), null);
  assert.equal(await v(`SELECT canon_linkedin_slug('https://www.linkedin.com/in/Jane-Doe/?utm=1#x') AS v`), 'in/jane-doe');
  assert.equal(await v(`SELECT canon_linkedin_slug('profile:in/jane-doe') AS v`), 'in/jane-doe');
  assert.match(await refused(db.query(`SELECT canon_linkedin_slug('in/a%2fb')`)), /refused/);
  assert.match(await refused(db.query(`SELECT canon_linkedin_slug('company/acme')`)), /not a person profile/);
  assert.equal(await v(`SELECT name_tokens('  Jane   Doe ') AS v`), 2);
  assert.equal(await v(`SELECT name_tokens('Pat') AS v`), 1);
});

test('a contact insert fills its identities; a phone-only contact gets only a phone identity', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const c = await addContact(db, t, { name: 'Jane Doe', email: 'jane@alpha.test', phone: '+1 615 555 0111', slug: 'https://linkedin.com/in/Jane-Doe' });
  assert.deepEqual((await q(db, `SELECT kind FROM contact_identities WHERE contact_id = $1 ORDER BY kind`, [c])).map((r) => r.kind), ['email', 'linkedin', 'phone']);
  const p = await addContact(db, t, { name: 'Phone Only', phone: '+1 615 555 0222' });
  assert.deepEqual((await q(db, `SELECT kind FROM contact_identities WHERE contact_id = $1`, [p])).map((r) => r.kind), ['phone']);
});

test('an opt-out on one address closes every contact linked by the same profile, and the guard refuses them', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Jane Doe', email: 'jane@work.test', slug: 'in/jane-doe' });
  const b = await addContact(db, t, { name: 'Jane D', email: 'jane@home.test', slug: 'in/jane-doe' });
  const other = await addContact(db, t, { name: 'Someone Else', email: 'else@work.test' });
  await optOut(db, t, a);
  assert.equal(await suppressed(db, a), true);
  assert.equal(await suppressed(db, b), true, 'the twin on the same profile is the same person');
  assert.equal(await suppressed(db, other), false);
  const live = await one(db, `SELECT count(*)::int AS n FROM enrollments WHERE contact_id = $1 AND state NOT IN ('stopped','converted','completed')`, [a]);
  assert.equal(live.n, 0);
});

test('send_guard refuses a suppressed person and still sends to an untouched one', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const d = await approvedDraft(db, t);
  await optOut(db, t, t.contact);
  assert.match((await refused(send(db, t, d))) ?? '', /contact suppressed/);
});

test('a shared phone line: the opted-out holder blocks every channel, the sharer only the phone ones', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Owner One', email: 'one@alpha.test', phone: '+1 615 555 0333' });
  const b = await addContact(db, t, { name: 'Desk Two', email: 'two@alpha.test', phone: '+1 615 555 0333' });
  await optOut(db, t, a);
  assert.equal(await suppressed(db, a, 'email'), true);
  assert.equal(await suppressed(db, b, 'email'), false, 'the sharer keeps their email');
  assert.equal(await suppressed(db, b, null), true, 'but a phone-aware check blocks the shared line');
});

test('a profile-only opt-out freezes a name seed; a later contact with that name is held until an audited clear', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Jane Doe', slug: 'in/jane-doe' });
  await optOut(db, t, a);
  const b = await addContact(db, t, { name: 'jane  DOE', email: 'jd@else.test' });
  assert.equal(await suppressed(db, b), true);
  assert.match((await one(db, `SELECT hold_reason FROM contacts WHERE id = $1`, [b])).hold_reason, /^name_match:seed:/);
  assert.match((await refused(as(db, 'app_rw', ctxOf(t), () => db.query(`SELECT clear_name_hold($1, 'short')`, [b])))) ?? '', /10 characters/);
  await as(db, 'app_rw', { ...ctxOf(t), user: t.user }, async () => {
    await db.query(`SELECT set_config('app.user_id', $1, false)`, [t.user]);
    await db.query(`SELECT clear_name_hold($1, 'Verified: different person, confirmed by phone')`, [b]);
  });
  assert.equal(await suppressed(db, b), false);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM audit_log WHERE action = 'clear_hold' AND entity_id = $1`, [b])).n, 1);
});

test('message_handoff_ok: true for a clean message, false once the person opts out, false for another org', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const u = await seedTenant(db, 'beta');
  const ok = (ctx, id) => as(db, 'sender_svc', ctx, () => one(db, `SELECT message_handoff_ok($1) AS ok`, [id])).then((r) => r.ok);
  assert.equal(await ok(ctxOf(t), t.message), true);
  assert.equal(await ok(ctxOf(u), t.message), false, 'another org cannot place the message');
  await optOut(db, t, t.contact);
  assert.equal(await ok(ctxOf(t), t.message), false);
});

test('the salt is immutable, the org lock is not available to tenants', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Jane Doe', slug: 'in/jane-doe' });
  await optOut(db, t, a);
  assert.match((await refused(db.query(`UPDATE org_salts SET salt = 'x'`))) ?? '', /immutable/);
  assert.match((await refused(db.query(`DELETE FROM org_salts WHERE org_id = $1`, [t.org]))) ?? '', /immutable/);
  assert.match((await refused(as(db, 'app_rw', ctxOf(t), () => db.query(`SELECT pg_advisory_xact_lock(1)`)))) ?? '', /permission denied/);
});

// Fold-ins T1-T3 and the privilege pins.
test('T1: a phone-only person (no address, no profile) leaves no name seed', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const p = await addContact(db, t, { name: 'Phone Person', phone: '+1 615 555 0444' });
  const before = (await one(db, `SELECT count(*)::int AS n FROM optout_name_seeds`)).n;
  await optOut(db, t, p);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM optout_name_seeds`)).n, before);
  assert.equal(await suppressed(db, p), true);
});

test('T2: the salt goes with its org (the FK cascade) although org_salts is immutable', async () => {
  const db = await freshDb();
  // A bare org: the schema has no cascade from orgs to workspaces, so only an org without workspaces can be deleted at all.
  const org = (await one(db, `INSERT INTO orgs (name) VALUES ('bare') RETURNING id`)).id;
  await db.query(`SELECT name_seed_hash($1, 'Jane Doe', true)`, [org]);
  await db.query(`INSERT INTO optout_name_seeds (org_id, name_hash, seed_value_hash) VALUES ($1, 'a', 'b')`, [org]);
  assert.match((await refused(db.query(`DELETE FROM org_salts WHERE org_id = $1`, [org]))) ?? '', /immutable/);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [org]);
  for (const tbl of ['org_salts', 'optout_name_seeds']) {
    assert.equal((await one(db, `SELECT count(*)::int AS n FROM ${tbl} WHERE org_id = $1`, [org])).n, 0, tbl);
  }
});

test('T3: contacts grants are narrowed (no client writes hold_*), contact_opted_out is for app_rw only', async () => {
  const db = await freshDb();
  const priv = async (role, col, p) => (await one(db, `SELECT has_column_privilege($1, 'public.contacts', $2, $3) AS ok`, [role, col, p])).ok;
  for (const role of ['app_rw', 'ops', 'gate_svc', 'sender_svc', 'inbox_svc']) {
    for (const col of ['hold_reason', 'hold_cleared_by', 'hold_cleared_at', 'hold_clear_reason']) {
      assert.equal(await priv(role, col, 'UPDATE'), false, `${role} UPDATE ${col}`);
      assert.equal(await priv(role, col, 'INSERT'), false, `${role} INSERT ${col}`);
    }
  }
  assert.equal(await priv('app_rw', 'name', 'UPDATE'), true);
  assert.equal(await priv('app_rw', 'linkedin_slug', 'INSERT'), true);
  assert.equal(await priv('rename_owner', 'name', 'UPDATE'), true);
  const x = (role) => one(db, `SELECT has_function_privilege($1, 'contact_opted_out(uuid)', 'EXECUTE') AS ok`, [role]).then((r) => r.ok);
  assert.equal(await x('app_rw'), true);
  assert.equal(await x('sender_svc'), false);
  assert.equal(await x('gate_svc'), false);
});

test('a client cannot insert a pre-cleared or pre-held contact: hold columns are not insertable and the trigger overwrites', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  assert.match((await refused(as(db, 'app_rw', ctxOf(t), () => db.query(
    `INSERT INTO contacts (org_id, workspace_id, name, hold_cleared_at) VALUES ($1, $2, 'Jane Doe', now())`, [t.org, t.ws])))) ?? '', /permission denied/);
});

test('bounce rows do not spread to the person, a manual row on a linked address does', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  // a and b share a profile. d shares it too and is the one whose address bounces, so a and b start unsuppressed: the final
  // assertion can only pass if the manual row itself reached a through the closure (it fails without suppression_close_person).
  const a = await addContact(db, t, { name: 'Jane Doe', email: 'jane@work.test', slug: 'in/jane-doe' });
  const b = await addContact(db, t, { name: 'Jane D', email: 'jane@home.test', slug: 'in/jane-doe' });
  const d = await addContact(db, t, { name: 'Jane Dee', email: 'jane@old.test', slug: 'in/jane-doe' });
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash('jane@old.test'), 'email', 'bounce')`, [t.org]);
  assert.equal(await suppressed(db, d), true, 'the bounced address itself is blocked');
  assert.equal(await suppressed(db, b), false, 'a bounce is about one address');
  assert.equal(await suppressed(db, a), false, 'a bounce does not reach the others on the profile');
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash('jane@home.test'), 'email', 'manual')`, [t.org]);
  assert.equal(await suppressed(db, a), true, 'the manual row on the linked address reaches the whole person');
});

test('a manual row on a profile (linkedin kind) reaches a contact that only shares an address with the profile holder (trigger A, second pin)', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [t.org])).id;
  // holder has the profile and an address; sib is in another workspace with the same address and no profile. The profile hash is
  // not one of sib's own identities, so only the closure over the shared address can reach it.
  const holder = await addContact(db, t, { name: 'Lee Ng', email: 'lee@work.test', slug: 'in/lee-ng' });
  const sib = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'L Ng', 'lee@work.test', 'unknown') RETURNING id`, [t.org, ws2])).id;
  assert.equal(await suppressed(db, holder), false);
  assert.equal(await suppressed(db, sib), false);
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, linkedin_hash('in/lee-ng'), 'linkedin', 'manual')`, [t.org]);
  assert.equal(await suppressed(db, holder), true);
  assert.equal(await suppressed(db, sib), true, 'the same address in another workspace is the same person');
});

test('a global (all-orgs) suppression row blocks the address but does not close the person', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Jane Doe', email: 'jane@work.test', slug: 'in/jane-doe' });
  const b = await addContact(db, t, { name: 'Jane D', email: 'jane@home.test', slug: 'in/jane-doe' });
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES (NULL, value_hash('jane@work.test'), 'email', 'complaint')`);
  assert.equal(await suppressed(db, a), true);
  assert.equal(await suppressed(db, b), false);
});

test('a suppressed address added to an existing contact later closes the person (trigger B)', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await optOut(db, t, t.contact);
  const n = await addContact(db, t, { name: 'New Person', email: 'new@alpha.test' });
  assert.equal(await suppressed(db, n), false);
  await db.query(`UPDATE contacts SET linkedin_slug = 'in/pat-linked' WHERE id = $1`, [t.contact]);
  await db.query(`UPDATE contacts SET linkedin_slug = 'in/pat-linked' WHERE id = $1`, [n]);
  assert.equal(await suppressed(db, n), true, 'the shared profile joins them');
});

test('no application role can read the salts or the name seeds (the tenant policy on them is inert without a grant)', async () => {
  const db = await freshDb();
  for (const role of ['app_rw', 'gate_svc', 'sender_svc', 'inbox_svc']) {
    for (const tbl of ['org_salts', 'optout_name_seeds']) {
      assert.equal((await one(db, `SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [role, tbl])).ok, false, `${role} ${tbl}`);
    }
  }
});
