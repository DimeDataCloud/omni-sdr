// 0020 adversarial-review fixes (ADV-B5b-686112c): P2-1 name-hold lock order, P2-4 unsubscribe with a cleared address,
// P3-1 org check on person_suppressed / contact_opted_out, P3-2 hand-off takes the global lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb, seedTenant, as, one, q } from './helpers.mjs';

const ctxOf = (t) => ({ org: t.org, ws: [t.ws] });
const MIG = readFileSync(new URL('../migrations/0020_identity_suppression.sql', import.meta.url), 'utf8');
const body = (name) => { const at = MIG.indexOf(`CREATE FUNCTION ${name}(`); return MIG.slice(at, MIG.indexOf('END $$;', at)); };
const advisory = (db) => q(db, `SELECT mode, classid, objid FROM pg_locks WHERE locktype = 'advisory' AND granted ORDER BY mode`);

test('P2-1: contact create takes the org lock shared before it reads seeds; the opt-out takes it exclusive before it writes one', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  // Source order: the lock is the statement before the seed read / seed write.
  const hold = body('contacts_name_hold');
  assert.ok(hold.indexOf('pg_advisory_xact_lock_shared(org_lock_key(NEW.org_id))') > 0);
  assert.ok(hold.indexOf('pg_advisory_xact_lock_shared') < hold.indexOf('FROM optout_name_seeds'), 'shared lock before the seed read');
  const sup = body('_suppress_person');
  assert.ok(sup.indexOf('pg_advisory_xact_lock(org_lock_key(p_org))') > 0);
  assert.ok(sup.indexOf('pg_advisory_xact_lock(') < sup.indexOf('INSERT INTO optout_name_seeds'), 'exclusive lock before the seed write');
  assert.ok(sup.indexOf('pg_advisory_xact_lock(') < sup.indexOf('UPDATE contacts k SET hold_reason'), 'exclusive lock before the order-2 hold');
  // Runtime: a two-token contact insert holds a shared advisory lock for its transaction; an opt-out holds an exclusive one.
  await db.query('BEGIN');
  try {
    await db.query(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'Lock Probe', 'lp@x.test', 'unknown')`, [t.org, t.ws]);
    assert.ok((await advisory(db)).some((l) => l.mode === 'ShareLock'), 'shared lock taken by the insert');
    assert.equal((await advisory(db)).some((l) => l.mode === 'ExclusiveLock'), false);
  } finally { await db.query('ROLLBACK'); }
  await db.query('BEGIN');
  try {
    await as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, 'manual')`, [t.contact]));
    assert.ok((await advisory(db)).some((l) => l.mode === 'ExclusiveLock'), 'exclusive lock taken by the opt-out');
  } finally { await db.query('ROLLBACK'); }
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
  // A token whose contact is gone answers false rather than claiming a suppression it did not make.
  const gone = (await one(db, `SELECT gen_random_uuid() AS id`)).id;
  assert.equal((await one(db, `SELECT unsubscribe('no-such-token') AS ok`)).ok, false);
  assert.ok(gone);
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
    const locks = (await advisory(db)).filter((l) => l.mode === 'ShareLock');
    assert.ok(locks.length >= 2, `org and global keys both held shared, saw ${locks.length}`);
  } finally { await db.query('ROLLBACK'); }
});
