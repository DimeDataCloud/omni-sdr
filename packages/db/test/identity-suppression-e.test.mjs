// 0020, design tests 1, 2, 13: the gap scenarios, one sabotage per identity kind, and the property over every identity pair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, one, refused } from './helpers.mjs';

const ctxOf = (t) => ({ org: t.org, ws: [t.ws] });
const letters = (n) => String.fromCharCode(97 + (n % 26)) + String.fromCharCode(97 + (Math.floor(n / 26) % 26)) + String.fromCharCode(97 + (Math.floor(n / 676) % 26));
const suppressed = (db, id, channel = 'email') => one(db, `SELECT person_suppressed($1, $2) AS s`, [id, channel]).then((r) => r.s);
const optOut = (db, t, id) => as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, 'manual')`, [id]));
async function mk(db, t, ws, { name, email = null, phone = null, slug = null }) {
  return (await one(db,
    `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, phone, linkedin_slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [t.org, ws, name, email, email ? 'valid' : 'unknown', phone, slug])).id;
}

test('1: the three gap scenarios are refused: profile then email paste, profile opt-out then email import, raw-SQL attach', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  // Profile opt-out, then an email import with the same name.
  const a = await mk(db, t, t.ws, { name: 'Gina Gale', slug: 'in/gina-gale' });
  await optOut(db, t, a);
  assert.equal(await suppressed(db, await mk(db, t, t.ws, { name: 'Gina Gale', email: 'gina@x.test' })), true);
  // Profile pasted on a contact that already has an address, after the address-keyed person opted out.
  const e = await mk(db, t, t.ws, { name: 'Hal Hart', email: 'hal@x.test' });
  await optOut(db, t, e);
  const h2 = await mk(db, t, t.ws, { name: 'Hal H', email: 'hal2@x.test' });
  await db.query(`UPDATE contacts SET linkedin_slug = 'in/hal-hart' WHERE id = $1`, [e]);
  await db.query(`UPDATE contacts SET linkedin_slug = 'in/hal-hart' WHERE id = $1`, [h2]);
  assert.equal(await suppressed(db, h2), true, 'raw-SQL attach of the same profile');
});

test('2: sabotage per kind: with the identity row removed, the matching refusal goes red; with it, green', async () => {
  for (const kind of ['email', 'linkedin']) {
    for (const sabotage of [false, true]) {
      const db = await freshDb();
      const t = await seedTenant(db, 'alpha');
      const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [t.org])).id;
      const a = await mk(db, t, t.ws, { name: 'Ann Ames', email: 'ann@x.test', slug: 'in/ann-ames' });
      const b = await mk(db, t, ws2, kind === 'email' ? { name: 'Other One', email: 'ann@x.test' } : { name: 'Other One', email: 'o@x.test', slug: 'in/ann-ames' });
      if (sabotage) await db.query(`DELETE FROM contact_identities WHERE contact_id = $1 AND kind = $2`, [b, kind]);
      await optOut(db, t, a);
      // Raw email hits are checked by hash too, so only the profile case is purely identity-row driven.
      const expected = kind === 'email' ? true : !sabotage;
      assert.equal(await suppressed(db, b), expected, `${kind} sabotage=${sabotage}`);
    }
  }
  // Phone: the row decides which line a contact is on.
  for (const sabotage of [false, true]) {
    const db = await freshDb();
    const t = await seedTenant(db, 'alpha');
    const a = await mk(db, t, t.ws, { name: 'Ann Ames', email: 'ann@x.test', phone: '615-555-0170' });
    const b = await mk(db, t, t.ws, { name: 'Other One', email: 'o@x.test', phone: '(615) 555-0170' });
    // The raw column backs the identity row, so the line only opens when both are gone.
    if (sabotage) await db.query(`DELETE FROM contact_identities WHERE contact_id = $1 AND kind = 'phone'`, [b]);
    if (sabotage) await db.query(`UPDATE contacts SET phone = NULL WHERE id = $1`, [b]);
    await optOut(db, t, a);
    assert.equal(await suppressed(db, b, 'sms'), !sabotage, `phone sabotage=${sabotage}`);
  }
});

test('13: property over identity pairs: B is refused on email iff B shares an email or profile, or the name hold applies', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [t.org])).id;
  let n = 0, cases = 0;
  for (let am = 1; am < 8; am++) {
    const A = { email: !!(am & 1), phone: !!(am & 2), slug: !!(am & 4) };
    for (let bm = 0; bm < 16; bm++) {
      const S = { email: !!(bm & 1), phone: !!(bm & 2), slug: !!(bm & 4), name: !!(bm & 8) };
      n++;
      const tag = letters(n);
      const nameA = `Ann${tag} Alpha${tag}`;
      const a = await mk(db, t, t.ws, {
        name: nameA, email: A.email ? `a${n}@x.test` : null,
        phone: A.phone ? `615555${String(1000 + (n % 8000)).padStart(4, '0')}` : null, slug: A.slug ? `in/ann-${tag}` : null,
      });
      const b = await mk(db, t, ws2, {
        name: S.name ? nameA : `Bea${tag} Beta${tag}`,
        email: S.email && A.email ? `a${n}@x.test` : `b${n}@x.test`,
        phone: S.phone && A.phone ? `615555${String(1000 + (n % 8000)).padStart(4, '0')}` : null,
        slug: S.slug && A.slug ? `in/ann-${tag}` : null,
      });
      await optOut(db, t, a);
      const sharesEmail = S.email && A.email;
      const sharesSlug = S.slug && A.slug;
      const held = S.name && A.slug && !A.email;
      const expected = sharesEmail || sharesSlug || held;
      assert.equal(await suppressed(db, b, 'email'), expected, `n=${n} tag=${tag} A=${JSON.stringify(A)} B=${JSON.stringify(S)}`);
      cases++;
    }
  }
  assert.equal(cases, 112);
});

// 23: the real send_guard trigger, as sender_svc under forced RLS, for a person suppressed only through a shared profile.
async function guardScenario(sabotage) {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const ctx = ctxOf(t);
  const a = await mk(db, t, t.ws, { name: 'Pia Page', slug: 'in/pia-page' });
  await db.query(`UPDATE contacts SET email = NULL, email_status = 'unknown', phone = NULL, linkedin_slug = 'in/pia-page' WHERE id = $1`, [t.contact]);
  if (sabotage) await db.query(sabotage);
  await optOut(db, t, a);
  const draft = await as(db, 'app_rw', ctx, async () => (await one(db,
    `INSERT INTO drafts (org_id, workspace_id, enrollment_id, channel, subject, body) VALUES ($1, $2, $3, 'email', 'Quick note', 'Your booking page has no online scheduling.') RETURNING id`,
    [t.org, t.ws, t.enrollment])).id);
  await as(db, 'gate_svc', ctx, () => db.query(`UPDATE drafts SET gate_passed = true, gate_body_sha = draft_sha(subject, body), gate_version = 'v1', gated_at = now(), status = 'review' WHERE id = $1`, [draft]));
  await as(db, 'app_rw', ctx, () => db.query(`UPDATE drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [draft, t.user]));
  try {
    await as(db, 'sender_svc', ctx, () => db.query(`INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email')`, [t.org, t.ws, draft, t.mailbox]));
    return null;
  } catch (err) { return err.message; }
}

test('23: send_guard refuses a profile-only-suppressed person; red when the guard_owner or identity_owner policy is removed', async () => {
  assert.match((await guardScenario(null)) ?? '', /contact suppressed/);
  // guard_read matters whenever the caller sets no tenant context (the tenant policy admits the guard otherwise).
  for (const drop of [false, true]) {
    const db = await freshDb();
    const t = await seedTenant(db, 'alpha');
    const a = await mk(db, t, t.ws, { name: 'Pia Page', slug: 'in/pia-page' });
    await db.query(`UPDATE contacts SET email = NULL, email_status = 'unknown', phone = NULL, linkedin_slug = 'in/pia-page' WHERE id = $1`, [t.contact]);
    if (drop) await db.query(`DROP POLICY guard_read ON contact_identities`);
    await optOut(db, t, a);
    assert.equal(await suppressed(db, t.contact), !drop, `guard_read dropped=${drop}`);
  }
  // Without identity_all the definer functions cannot write identities at all, so the scenario cannot even be built.
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await db.query(`DROP POLICY identity_all ON contact_identities`);
  assert.match((await refused(mk(db, t, t.ws, { name: 'Pia Page', slug: 'in/pia-page' }))) ?? '', /row-level security/);
});

test('28: a same-name import carrying a made-up profile is held; one sharing the opted-out profile is suppressed by identity', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await mk(db, t, t.ws, { name: 'Rhea Rowe', slug: 'in/rhea-rowe' });
  await optOut(db, t, a);
  const made = await mk(db, t, t.ws, { name: 'Rhea Rowe', email: 'r1@x.test', slug: 'in/someone-invented' });
  assert.equal(await suppressed(db, made), true);
  assert.match((await one(db, `SELECT hold_reason FROM contacts WHERE id = $1`, [made])).hold_reason, /^name_match:seed:/);
  const same = await mk(db, t, t.ws, { name: 'Other Name', email: 'r2@x.test', slug: 'in/rhea-rowe' });
  assert.equal(await suppressed(db, same), true);
  assert.equal((await one(db, `SELECT hold_reason FROM contacts WHERE id = $1`, [same])).hold_reason, null, 'identity, not a hold');
});

test('57: an upsert that sets the name of an opted-out contact is refused; a contact that is not opted out renames normally', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const a = await mk(db, t, t.ws, { name: 'Sol Sage', slug: 'in/sol-sage', email: 'sol@x.test' });
  const b = await mk(db, t, t.ws, { name: 'Tess Tide', email: 'tess@x.test' });
  await optOut(db, t, a);
  const upsert = (email, name) => as(db, 'app_rw', ctxOf(t), () => db.query(
    `INSERT INTO contacts (org_id, workspace_id, name, email) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, email) DO UPDATE SET name = EXCLUDED.name`, [t.org, t.ws, name, email]));
  assert.match((await refused(upsert('sol@x.test', 'Solomon Sage'))) ?? '', /opted out/);
  await upsert('tess@x.test', 'Theresa Tide');
  assert.equal((await one(db, `SELECT name FROM contacts WHERE id = $1`, [b])).name, 'Theresa Tide');
});

test('26/27: through the real send_guard, a shared-line holder still gets an email; the opted-out holder gets nothing; the channel-less reply-draft check is conservative', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const ctx = ctxOf(t);
  // The seed makes t.contact the origin of a placeholder phone row; a person who is an origin anywhere is never exempt, so clear it.
  await db.query(`DELETE FROM suppression_origins WHERE value_hash = $1`, [`origin-alpha`]);
  // t.contact holds +16155550100. A is a stranger on the same office line who texts STOP.
  const a = await mk(db, t, t.ws, { name: 'Line Mate', email: 'mate@x.test', phone: '(615) 555-0100' });
  await optOut(db, t, a);
  const approved = async () => {
    const id = await as(db, 'app_rw', ctx, async () => (await one(db,
      `INSERT INTO drafts (org_id, workspace_id, enrollment_id, channel, subject, body) VALUES ($1, $2, $3, 'email', 'Quick note', 'Your booking page has no online scheduling.') RETURNING id`,
      [t.org, t.ws, t.enrollment])).id);
    await as(db, 'gate_svc', ctx, () => db.query(`UPDATE drafts SET gate_passed = true, gate_body_sha = draft_sha(subject, body), gate_version = 'v1', gated_at = now(), status = 'review' WHERE id = $1`, [id]));
    await as(db, 'app_rw', ctx, () => db.query(`UPDATE drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, t.user]));
    return id;
  };
  const go = (d) => as(db, 'sender_svc', ctx, () => db.query(`INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email')`, [t.org, t.ws, d, t.mailbox]));
  assert.equal(await refused(go(await approved())), null, 'a different person on the line is emailed');
  assert.equal(await suppressed(db, t.contact, 'sms'), true);
  const ask = (id) => as(db, 'app_rw', ctx, () => one(db, `SELECT app_contact_suppressed($1) AS s`, [id])).then((r) => r.s);
  assert.equal(await ask(t.contact), true, 'the reply-draft check has no channel, so it takes the conservative answer for a shared line');
  assert.equal(await ask(a), true);
  // Control: when the opt-out cannot be attributed, the other holder is refused on every channel.
  await db.query(`DELETE FROM suppression_origins`);
  assert.equal(await suppressed(db, t.contact, 'email'), true);
});
