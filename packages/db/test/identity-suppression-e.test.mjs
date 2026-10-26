// 0020, design tests 1, 2, 13: the gap scenarios, one sabotage per identity kind, and the property over every identity pair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, one } from './helpers.mjs';

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
