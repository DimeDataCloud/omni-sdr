import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { run, checkLogin, API_ROLES } from '../src/migrate-cli.mjs';
import { pending } from '../src/migrate.mjs';

test('dry run lists every migration and applies nothing', async () => {
  const db = new PGlite();
  const res = await run(db);
  assert.ok(res.total >= 6);
  assert.equal(res.pending.length, res.total);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, 0);
  assert.equal((await db.query(`SELECT to_regclass('public.orgs') AS t`)).rows[0].t, null);
});

test('apply runs each file once; a second apply is a no-op', async () => {
  const db = new PGlite();
  const first = await run(db, { apply: true });
  assert.equal(first.applied.length, first.total);
  assert.deepEqual((await run(db, { apply: true })).applied, []);
  assert.deepEqual((await pending(db)).names, []);
});

test('a failing file is rolled back alone, named, and leaves the session usable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mig-'));
  await writeFile(join(dir, '0001_ok.sql'), 'CREATE TABLE ok_t (id int);');
  await writeFile(join(dir, '0002_bad.sql'), 'CREATE TABLE half_t (id int);\nSELECT no_such_function();');
  await writeFile(join(dir, '0003_later.sql'), 'CREATE TABLE later_t (id int);');
  const db = new PGlite();
  await assert.rejects(run(db, { apply: true, dir }), /0002_bad\.sql: .*no_such_function/);
  const names = (await db.query('SELECT name FROM schema_migrations ORDER BY 1')).rows.map((r) => r.name);
  assert.deepEqual(names, ['0001_ok.sql']);
  assert.equal((await db.query(`SELECT to_regclass('public.half_t') AS t`)).rows[0].t, null, 'nothing of the failed file stays');
  assert.equal((await db.query(`SELECT to_regclass('public.later_t') AS t`)).rows[0].t, null, 'later files do not run');
  assert.deepEqual((await pending(db, dir)).names, ['0002_bad.sql', '0003_later.sql']);
});

test('the API login check passes only for exactly the four service roles', async () => {
  const db = new PGlite();
  await run(db, { apply: true });
  await db.exec(`CREATE ROLE omni_api LOGIN; GRANT ${API_ROLES.join(', ')} TO omni_api;`);
  assert.deepEqual(await checkLogin(db, 'omni_api'), []);

  await db.exec('GRANT ops TO omni_api');
  assert.match((await checkLogin(db, 'omni_api')).join('; '), /member of ops/);
  await db.exec('REVOKE ops FROM omni_api; REVOKE inbox_svc FROM omni_api');
  assert.match((await checkLogin(db, 'omni_api')).join('; '), /not a member of inbox_svc/);
  await db.exec('GRANT inbox_svc TO omni_api; ALTER ROLE omni_api BYPASSRLS');
  assert.match((await checkLogin(db, 'omni_api')).join('; '), /has bypassrls/);
  await db.exec('ALTER ROLE omni_api NOBYPASSRLS; CREATE TABLE owned_t (id int); ALTER TABLE owned_t OWNER TO omni_api');
  assert.match((await checkLogin(db, 'omni_api')).join('; '), /owns 1 relation/);
  assert.match((await checkLogin(db, 'nobody')).join(), /no role named nobody/);
});
