// The waitlist function against a fake D1 that runs the real migration in node:sqlite. No Cloudflare access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequestPost } from './waitlist.ts';

const MIGRATION = readFileSync(new URL('../../migrations/0001_waitlist.sql', import.meta.url), 'utf8');

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION);
  return {
    raw: db,
    prepare: (sql) => ({
      bind: (...args) => ({ first: async () => db.prepare(sql).get(...args) ?? null }),
    }),
  };
}

const post = (body, env, raw) =>
  onRequestPost({ request: new Request('https://omnisdr.com/api/waitlist', { method: 'POST', body: raw ?? JSON.stringify(body) }), env });
const ok = { name: '  Ada Lovelace ', email: ' Ada@Example.COM ' };
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('a valid signup is saved with a lowercased email and answers 200 with an access code and the hardening headers', async () => {
  const DB = fakeD1();
  const res = await post({ ...ok, accountType: 'agency', company: ' Acme ', phone: '555', location: 'TX' }, { WAITLIST_DB: DB });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.match(body.accessCode, /^OMNI-VIP-[A-Z0-9]{6}$/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const rows = DB.raw.prepare('SELECT * FROM waitlist').all();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].email, rows[0].name, rows[0].account_type, rows[0].company, rows[0].phone, rows[0].location, rows[0].access_code],
    ['ada@example.com', 'Ada Lovelace', 'agency', 'Acme', '555', 'TX', body.accessCode]);
});

test('account type defaults to owner and optional fields are stored as null', async () => {
  const DB = fakeD1();
  await post({ ...ok, accountType: 'something-else' }, { WAITLIST_DB: DB });
  const r = DB.raw.prepare('SELECT * FROM waitlist').get();
  assert.deepEqual([r.account_type, r.company, r.phone, r.location], ['owner', null, null, null]);
});

test('a duplicate email (any case) is idempotent: still 200, one row, the first access code comes back', async () => {
  const DB = fakeD1();
  const first = await (await post(ok, { WAITLIST_DB: DB })).json();
  const again = await post({ name: 'Other Name', email: 'ADA@example.com' }, { WAITLIST_DB: DB });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).accessCode, first.accessCode);
  const rows = DB.raw.prepare('SELECT name FROM waitlist').all();
  assert.deepEqual(rows.map((x) => x.name), ['Ada Lovelace']);
});

test('validation: a missing or blank name, and a missing or malformed email, are 400 and write nothing', async () => {
  const DB = fakeD1();
  for (const [body, error] of [
    [{ email: 'a@b.co' }, 'Name is required'],
    [{ name: '   ', email: 'a@b.co' }, 'Name is required'],
    [{ name: 5, email: 'a@b.co' }, 'Name is required'],
    [{ name: 'A' }, 'A valid email address is required'],
    [{ name: 'A', email: 'nope' }, 'A valid email address is required'],
    [{ name: 'A', email: 7 }, 'A valid email address is required'],
  ]) {
    const res = await post(body, { WAITLIST_DB: DB });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await res.json()).error, error);
  }
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM waitlist').get().n, 0);
});

test('a body that is not JSON is a 500 Internal Error', async () => {
  const res = await post(null, { WAITLIST_DB: fakeD1() }, 'not json');
  assert.deepEqual([res.status, (await res.json()).error], [500, 'Internal Error']);
});

test('D1 failure: a rejected write is 502 "could not save", never a success', async () => {
  const broken = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1_ERROR: boom'); } }) }) };
  const res = await quiet(() => post(ok, { WAITLIST_DB: broken }));
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /could not save/);
  assert.equal(body.success, undefined);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('D1 failure: a missing binding, a throw in prepare, and an empty result are all 502', async () => {
  const cases = [
    {},
    { WAITLIST_DB: { prepare: () => { throw new Error('no such table'); } } },
    { WAITLIST_DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } },
    { WAITLIST_DB: { prepare: () => ({ bind: () => ({ first: async () => ({}) }) }) } },
  ];
  for (const env of cases) assert.equal((await quiet(() => post(ok, env))).status, 502);
});

test('D1 failure: a table that was never migrated is 502', async () => {
  const DB = fakeD1();
  DB.raw.exec('DROP TABLE waitlist');
  assert.equal((await quiet(() => post(ok, { WAITLIST_DB: DB }))).status, 502);
});

test('there is no GET handler: the module only exports onRequestPost', async () => {
  const mod = await import('./waitlist.ts');
  assert.deepEqual(Object.keys(mod), ['onRequestPost']);
});
