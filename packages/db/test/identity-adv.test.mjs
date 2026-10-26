// 0020 adversarial-review fixes (ADV-B5b-686112c and -9337d69): N-1 one lock mode for every writer, P2-4 unsubscribe with a cleared
// address, P3-1 / N-5 org check on person_suppressed / contact_opted_out, P3-2 hand-off takes the global lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb, seedTenant, as, one, q } from './helpers.mjs';

const ctxOf = (t) => ({ org: t.org, ws: [t.ws] });
const MIG = readFileSync(new URL('../migrations/0020_identity_suppression.sql', import.meta.url), 'utf8');
const body = (name) => { const at = MIG.indexOf(`CREATE FUNCTION ${name}(`); return MIG.slice(at, MIG.indexOf('END $$;', at)); };
// pg_locks lists an advisory key as two halves; put it back together so a test can ask about a named key.
const held = (db) => q(db, `SELECT mode, ((classid::bigint << 32) | objid::bigint) AS key FROM pg_locks WHERE locktype = 'advisory' AND granted`);
const orgKey = async (db, org) => String((await one(db, `SELECT org_lock_key($1) AS k`, [org])).k);
const modesOn = async (db, key) => (await held(db)).filter((l) => String(l.key) === key).map((l) => l.mode);

test('P2-1 / N-1: every writer takes the org key EXCLUSIVE and nothing upgrades; the name hold locks before it reads a seed', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  // Source: no writer takes the key shared (a shared lock upgraded to exclusive in one transaction is a deadlock between two
  // such transactions), and the hold locks before it computes the name hash, so the first seed of an org is covered too.
  const hold = body('contacts_name_hold');
  assert.ok(hold.includes('pg_advisory_xact_lock(org_lock_key(NEW.org_id))'));
  assert.equal(/lock_shared/.test(hold), false, 'name hold must not take the org key shared');
  assert.ok(hold.indexOf('pg_advisory_xact_lock(') < hold.indexOf('name_seed_hash('), 'locked before the hash and the seed read');
  assert.ok(hold.indexOf('pg_advisory_xact_lock(') < hold.indexOf('FROM optout_name_seeds'));
  const sup = body('_suppress_person');
  assert.ok(sup.indexOf('pg_advisory_xact_lock(org_lock_key(p_org))') > 0);
  assert.equal(/lock_shared/.test(sup), false);
  assert.ok(sup.indexOf('pg_advisory_xact_lock(') < sup.indexOf('INSERT INTO optout_name_seeds'), 'exclusive lock before the seed write');
  assert.ok(sup.indexOf('pg_advisory_xact_lock(') < sup.indexOf('UPDATE contacts k SET hold_reason'), 'exclusive lock before the order-2 hold');
  assert.equal(/lock_shared/.test(body('suppression_org_lock')), false);
  const key = await orgKey(db, t.org);

  // Runtime. One transaction does what ingestPasted does: create the contact (even as ON CONFLICT DO NOTHING), then opt out.
  // The key is held exclusive after the insert, and still only exclusive after the opt-out: no shared mode ever appears for it.
  await db.query('BEGIN');
  try {
    assert.deepEqual(await modesOn(db, key), []);
    await db.query(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'Lock Probe', 'lp@x.test', 'unknown')
                    ON CONFLICT (workspace_id, email) DO NOTHING`, [t.org, t.ws]);
    assert.deepEqual(await modesOn(db, key), ['ExclusiveLock'], 'exclusive straight from the insert, in an org with no seed yet');
    await as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, 'manual')`, [t.contact]));
    assert.deepEqual(await modesOn(db, key), ['ExclusiveLock'], 'the opt-out reuses it; no shared lock was ever taken to upgrade');
  } finally { await db.query('ROLLBACK'); }

  // A one-token name cannot be a seed or match one, so it does not queue behind an opt-out.
  await db.query('BEGIN');
  try {
    await db.query(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'Cher', 'cher@x.test', 'unknown')`, [t.org, t.ws]);
    assert.deepEqual(await modesOn(db, key), []);
  } finally { await db.query('ROLLBACK'); }

  // The reverse order (opt out first, then create) is the same single mode.
  await db.query('BEGIN');
  try {
    await as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, 'manual')`, [t.contact]));
    await db.query(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'Second Probe', 'sp@x.test', 'unknown')`, [t.org, t.ws]);
    assert.deepEqual(await modesOn(db, key), ['ExclusiveLock']);
  } finally { await db.query('ROLLBACK'); }
  // NOTE: PGlite has one connection, so two concurrent transactions cannot be run here. What deadlocked was a lock REQUEST that
  // upgraded a held shared lock; the assertions above pin that no transaction ever holds this key in two modes.
});

test('P2-4: a recipient click suppresses the person even when the contact address was cleared after the token was mailed', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [t.org])).id;
  await db.query(`UPDATE contacts SET linkedin_slug = 'in/pat-token' WHERE id = $1`, [t.contact]);
  const twin = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, linkedin_slug) VALUES ($1, $2, 'Other Face', 'twin@x.test', 'unknown', 'in/pat-token') RETURNING id`, [t.org, ws2])).id;
  await db.query(`UPDATE contacts SET email = NULL WHERE id = $1`, [t.contact]);
  const ok = (await one(db, `SELECT unsubscribe('unsub-alpha') AS ok`)).ok;
  assert.equal(ok, true);
  assert.equal((await one(db, `SELECT person_suppressed($1, 'email') AS s`, [twin])).s, true, 'the recorded profile identity was suppressed and spread');
  assert.equal((await one(db, `SELECT person_suppressed($1, 'email') AS s`, [t.contact])).s, true);
  // An unknown token answers false rather than claiming a suppression it did not make.
  assert.equal((await one(db, `SELECT unsubscribe('no-such-token') AS ok`)).ok, false);
});

test('P3-1: person_suppressed and contact_opted_out answer false for another org\'s contact; the owner org still gets its answer', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'beta');
  await as(db, 'inbox_svc', ctxOf(a), () => db.query(`SELECT suppress_person($1, 'manual')`, [a.contact]));
  const ask = (t, fn, ...args) => as(db, 'app_rw', ctxOf(t), () => one(db, `SELECT ${fn} AS s`, args)).then((r) => r.s);
  assert.equal(await ask(a, 'person_suppressed($1)', a.contact), true);
  assert.equal(await ask(b, 'person_suppressed($1)', a.contact), false, 'a foreign contact id is not an oracle');
  assert.equal(await ask(a, 'contact_opted_out($1)', a.contact), true);
  assert.equal(await ask(b, 'contact_opted_out($1)', a.contact), false);
});

test('P3-2: the sender hand-off takes the global lock as well as the org lock', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  await db.query('BEGIN');
  try {
    assert.equal(await as(db, 'sender_svc', ctxOf(t), () => one(db, `SELECT message_handoff_ok($1) AS ok`, [t.message])).then((r) => r.ok), true);
    assert.deepEqual(await modesOn(db, await orgKey(db, t.org)), ['ShareLock'], 'org key shared');
    assert.deepEqual(await modesOn(db, String((await one(db, `SELECT org_lock_key(NULL) AS k`)).k)), ['ShareLock'], 'global key shared');
  } finally { await db.query('ROLLBACK'); }
});

test('N-5: with no tenant context a tenant role learns nothing; a definer chain and the migrator still get the real answer', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  await as(db, 'inbox_svc', ctxOf(a), () => db.query(`SELECT suppress_person($1, 'manual')`, [a.contact]));
  const ask = (role, ctx, fn) => as(db, role, ctx, () => one(db, `SELECT ${fn} AS s`, [a.contact])).then((r) => r.s);
  // app_rw with the context cleared (the oracle the review described): false, not the foreign answer.
  assert.equal(await ask('app_rw', null, 'person_suppressed($1)'), false);
  assert.equal(await ask('app_rw', null, 'contact_opted_out($1)'), false);
  // With its own context it still gets the answer.
  assert.equal(await ask('app_rw', ctxOf(a), 'person_suppressed($1)'), true);
  assert.equal(await ask('app_rw', ctxOf(a), 'contact_opted_out($1)'), true);
  // No SET ROLE (the migrator, a definer chain): unfiltered, as the backfill relies on.
  assert.equal((await one(db, `SELECT person_suppressed($1) AS s`, [a.contact])).s, true);
  assert.equal((await one(db, `SELECT contact_opted_out($1) AS s`, [a.contact])).s, true);
  // The guard and the hand-off use the unfiltered core, so they do not depend on the caller's context.
  assert.equal((await one(db, `SELECT _person_suppressed($1, 'email') AS s`, [a.contact])).s, true);
  // ops has no tenant context either, and the rename block (which runs as the caller) must keep working for it.
  assert.equal(await ask('ops', null, 'contact_opted_out($1)'), true);
});
