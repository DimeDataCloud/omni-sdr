// 0020, design tests 3-7, 11, 12, 18, 20, 24, 29, 30: formats, closure shapes, tenant walls, channel guard, writers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused, one, q } from './helpers.mjs';

const ctxOf = (t) => ({ org: t.org, ws: [t.ws] });
async function addContact(db, t, { name, email = null, phone = null, slug = null, ws = t.ws }) {
  return (await one(db,
    `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, phone, linkedin_slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [t.org, ws, name, email, email ? 'valid' : 'unknown', phone, slug])).id;
}
const suppressed = (db, id, channel = null) => one(db, `SELECT person_suppressed($1, $2) AS s`, [id, channel]).then((r) => r.s);
const optOut = (db, t, id, reason = 'manual') => as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, $2)`, [id, reason]));
const live = (db, c) => one(db, `SELECT count(*)::int AS n FROM enrollments WHERE contact_id = $1 AND state NOT IN ('stopped','converted','completed')`, [c]).then((r) => r.n);

test('3: phone format variants all collide; +44 does not collide with a US number; an unparseable phone keeps the raw-hash check', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Owner One', email: 'a@alpha.test', phone: '(615) 555-0199' });
  const variants = ['+1 615 555 0199', '6155550199', '1-615-555-0199'];
  const others = [];
  for (const [i, p] of variants.entries()) others.push(await addContact(db, t, { name: `Other ${i} X`, email: `o${i}@alpha.test`, phone: p }));
  const uk = await addContact(db, t, { name: 'Brit Person', email: 'uk@alpha.test', phone: '+44 6155550199' });
  const odd1 = await addContact(db, t, { name: 'Odd One', email: 'odd1@alpha.test', phone: 'ext-5' });
  const odd2 = await addContact(db, t, { name: 'Odd Two', email: 'odd2@alpha.test', phone: 'ext-5' });
  await optOut(db, t, a);
  for (const o of others) assert.equal(await suppressed(db, o), true, 'same line, any format');
  assert.equal(await suppressed(db, uk), false, 'a +44 number is another line');
  await optOut(db, t, odd1);
  assert.equal(await suppressed(db, odd2), true, 'raw-hash check still holds for an unparseable phone');
});

test('4/11: closure runs in both orders, bridges two people, ends on a chain of 200, and a repeat changes nothing', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  // Identity first, suppression later (bridge): A and B are linked only through C.
  const a = await addContact(db, t, { name: 'Alice A', email: 'a@x.test', slug: 'in/alice-a' });
  const b = await addContact(db, t, { name: 'Bobby B', email: 'b@x.test', slug: 'in/bobby-b' });
  const c = await addContact(db, t, { name: 'Carol C', email: 'a@y.test', slug: 'in/bobby-b' });
  await db.query(`INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
                  SELECT org_id, workspace_id, $2, 'email', value_hash, 'contact' FROM contact_identities WHERE contact_id = $1 AND kind = 'email'`, [a, c]);
  await optOut(db, t, a);
  for (const x of [a, b, c]) assert.equal(await suppressed(db, x), true);
  const n1 = (await one(db, `SELECT (SELECT count(*) FROM suppression)::int AS s, (SELECT count(*) FROM suppression_origins)::int AS o`));
  await optOut(db, t, a);
  assert.deepEqual(await one(db, `SELECT (SELECT count(*) FROM suppression)::int AS s, (SELECT count(*) FROM suppression_origins)::int AS o`), n1, 'idempotent');

  // A chain of 200 people, each linked to the next by a shared profile hash: one opt-out closes all and terminates.
  const ids = [];
  for (let i = 0; i < 200; i++) ids.push(await addContact(db, t, { name: `Chain ${i} Link`, email: `chain${i}@x.test` }));
  for (let i = 0; i < 199; i++) {
    await db.query(`INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
                    SELECT $1, $2, x, 'linkedin', value_hash('linkedin:in/chain-' || $5::text), 'paste' FROM unnest(ARRAY[$3::uuid, $4::uuid]) x`, [t.org, t.ws, ids[i], ids[i + 1], i]);
  }
  await optOut(db, t, ids[0]);
  assert.equal(await suppressed(db, ids[199]), true, 'the far end of the chain is the same person');
});

test('5: suppression crosses workspaces inside one org and never crosses orgs', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const u = await seedTenant(db, 'beta');
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [t.org])).id;
  const a = await addContact(db, t, { name: 'Jane Doe', email: 'jane@x.test' });
  const same = await addContact(db, t, { name: 'Jane D', email: 'jane@x.test', ws: ws2 });
  const foreign = await addContact(db, u, { name: 'Jane Doe', email: 'jane@x.test' });
  await optOut(db, t, a);
  assert.equal(await suppressed(db, same), true);
  assert.equal(await suppressed(db, foreign), false, 'another org is untouched');
});

test('6: a reply to a person who opted out on another identity is not drafted (app_contact_suppressed)', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Jane Doe', email: 'jane@x.test', slug: 'in/jane-doe' });
  const b = await addContact(db, t, { name: 'Jane D', email: 'other@x.test', slug: 'in/jane-doe' });
  const ask = (id, org = t) => as(db, 'app_rw', ctxOf(org), () => one(db, `SELECT app_contact_suppressed($1) AS s`, [id])).then((r) => r.s);
  assert.equal(await ask(b), false);
  await optOut(db, t, a);
  assert.equal(await ask(b), true);
  const u = await seedTenant(db, 'beta');
  assert.equal(await ask(b, u), false, 'another org learns nothing');
});

for (const channel of ['sms', 'linkedin_assist']) {
  test(`7: send_guard refuses ${channel} for a suppressed person as suppressed, and an unsuppressed one as before (no send path)`, async () => {
    const db = await freshDb();
    const t = await seedTenant(db, 'alpha');
    const ctx = ctxOf(t);
    const mk = async () => {
      const id = await as(db, 'app_rw', ctx, async () => (await one(db,
        `INSERT INTO drafts (org_id, workspace_id, enrollment_id, channel, subject, body) VALUES ($1, $2, $3, $4, 'Quick note', 'Your booking page has no online scheduling.') RETURNING id`,
        [t.org, t.ws, t.enrollment, channel])).id);
      await as(db, 'gate_svc', ctx, () => db.query(`UPDATE drafts SET gate_passed = true, gate_body_sha = draft_sha(subject, body), gate_version = 'v1', gated_at = now(), status = 'review' WHERE id = $1`, [id]));
      await as(db, 'app_rw', ctx, () => db.query(`UPDATE drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, t.user]));
      return id;
    };
    const go = (d) => as(db, 'sender_svc', ctx, () => db.query(`INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, $5)`, [t.org, t.ws, d, t.mailbox, channel]));
    assert.match((await refused(go(await mk()))) ?? '', /has no send path/);
    await optOut(db, t, t.contact);
    assert.match((await refused(go(await mk()))) ?? '', /contact suppressed/);
  });
}

test('12: the name hold is absent for a one-token name and for a contact sharing the opted-out identity, and is never re-set after a clear', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Jane Doe', slug: 'in/jane-doe' });
  await optOut(db, t, a);
  const one1 = await addContact(db, t, { name: 'Jane', email: 'j@x.test' });
  assert.equal(await suppressed(db, one1), false, 'a one-token name is never held');
  const sameProfile = await addContact(db, t, { name: 'Jane Doe', email: 'jd@x.test', slug: 'in/jane-doe' });
  const hold = (await one(db, `SELECT hold_reason FROM contacts WHERE id = $1`, [sameProfile])).hold_reason;
  assert.equal(hold, null, 'sharing the identity is suppression by identity, not a name hold');
  assert.equal(await suppressed(db, sameProfile), true);
  const twin = await addContact(db, t, { name: 'jane doe', email: 'twin@x.test' });
  assert.equal(await suppressed(db, twin), true);
  // The first ordinary clear: set cleared columns as the definer would, then rename away and back: not re-set.
  await db.query(`UPDATE contacts SET hold_cleared_at = now(), hold_cleared_by = $2, hold_clear_reason = 'checked by hand' WHERE id = $1`, [twin, t.user]);
  await db.query(`UPDATE contacts SET name = 'Someone Else' WHERE id = $1`, [twin]);
  await db.query(`UPDATE contacts SET name = 'Jane Doe' WHERE id = $1`, [twin]);
  assert.equal(await suppressed(db, twin), false, 'a cleared hold stays cleared');
});

test('18: a profile that joins an existing contact to an opted-out person suppresses its address and stops its enrollments', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Jane Doe', email: 'jane@x.test', slug: 'in/jane-doe' });
  await optOut(db, t, a);
  const b = await addContact(db, t, { name: 'Other Name', email: 'b@x.test' });
  await db.query(`INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id) VALUES ($1, $2, $3, $4)`, [t.org, t.ws, t.campaign, b]);
  assert.equal(await live(db, b), 1);
  await db.query(`UPDATE contacts SET linkedin_slug = 'in/jane-doe' WHERE id = $1`, [b]);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM suppression WHERE value_hash = value_hash('b@x.test')`)).n, 1);
  assert.equal(await live(db, b), 0);
});

test('20: the writers are fenced: _suppress_person has no tenant caller, cross-org calls write nothing, hostile slugs are refused', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const u = await seedTenant(db, 'beta');
  const foreign = await addContact(db, u, { name: 'Zed Zed', email: 'z@x.test' });
  assert.match((await refused(as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT _suppress_person($1, $2, 'x', true)`, [t.contact, t.org])))) ?? '', /permission denied/);
  const before = (await one(db, `SELECT count(*)::int AS n FROM suppression`)).n;
  assert.match((await refused(optOut(db, t, foreign))) ?? '', /not in this workspace/);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM suppression`)).n, before);
  const rec = (slug, c = t.contact) => refused(as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT record_identity($1, $2, 'paste')`, [c, slug])));
  assert.match((await rec('in/ok-slug', foreign)) ?? '', /not in this workspace/);
  for (const bad of ['in/a', 'in/UPPER', 'company/acme', 'in/a/b', 'in/x%2fy', "in/'; drop", '', 'https://linkedin.com/in/jane']) {
    assert.match((await rec(bad)) ?? '', /refused/, bad);
  }
  assert.equal(await rec('in/fine-slug'), null);
});

test('24: deleting a contact removes its identities and keeps the suppression rows', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'Jane Doe', email: 'gone@x.test', slug: 'in/jane-gone' });
  await optOut(db, t, a);
  await db.query(`DELETE FROM contacts WHERE id = $1`, [a]);
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM contact_identities WHERE contact_id = $1`, [a])).n, 0);
  assert.ok((await one(db, `SELECT count(*)::int AS n FROM suppression WHERE value_hash = value_hash('gone@x.test')`)).n >= 1);
});

test('29: LinkedIn slug vectors collapse to one hash; reserved escapes are refused', async () => {
  const db = await freshDb();
  const h = (s) => one(db, `SELECT linkedin_hash($1) AS h`, [s]).then((r) => r.h);
  const base = await h('in/john-doe');
  for (const v of ['in/john%2ddoe', 'in/john%2Ddoe', 'in/john%252ddoe', 'IN/John-Doe', 'https://www.linkedin.com/in/john-doe/', 'https://uk.linkedin.com/in/john-doe?x=1#y', 'profile:in/john-doe']) {
    assert.equal(await h(v), base, v);
  }
  assert.equal((await one(db, `SELECT canon_linkedin_slug('in/%41bc') AS s`)).s, 'in/abc');
  for (const bad of ['in/a%00b', 'in/a%2fb', 'in/a%3fb', 'in/a%23b']) assert.match((await refused(db.query(`SELECT canon_linkedin_slug($1)`, [bad]))) ?? '', /refused/, bad);
});

test('30: email: case and whitespace collide; plus-addressing, gmail dots and trailing dots are pinned as distinct (stated residual)', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await addContact(db, t, { name: 'John X', email: 'john@x.com' });
  await optOut(db, t, a);
  const same = await addContact(db, t, { name: 'John Y', email: 'John@X.com ' });
  assert.equal(await suppressed(db, same), true);
  for (const [i, e] of ['john+tag@x.com', 'jo.hn@x.com', 'john@x.com.'].entries()) {
    const c = await addContact(db, t, { name: `Variant ${i}`, email: e });
    assert.equal(await suppressed(db, c), false, e);
  }
});
