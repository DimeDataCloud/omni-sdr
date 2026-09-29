import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, q, one } from './helpers.mjs';

// Which column names a row's tenant, per table. Derived from the catalog, not hand-listed.
async function tenantTables(db) {
  const rows = await q(db, `
    SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
              AND a.attname IN ('org_id', 'scope_org_id') LIMIT 1) AS col
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`);
  return rows.map((r) => ({ ...r, col: r.t === 'orgs' ? 'id' : r.col }));
}

test('every tenant-scoped table has RLS enabled and forced (mechanical rule)', async () => {
  const db = await freshDb();
  const tables = await tenantTables(db);
  const scoped = tables.filter((t) => t.col);
  const unscoped = tables.filter((t) => !t.col).map((t) => t.t);
  console.log(`  tenant-scoped tables: ${scoped.length}; unscoped (global by design): ${unscoped.join(', ')}`);
  assert.ok(scoped.length >= 15, `expected at least 15 tenant tables, found ${scoped.length}`);
  for (const t of scoped) {
    assert.ok(t.rls, `${t.t}: RLS not enabled`);
    assert.ok(t.forced, `${t.t}: RLS not forced`);
  }
  // A new global table must be a deliberate decision, so the list is pinned.
  assert.deepEqual(unscoped.sort(), ['schema_migrations', 'users']);
});

test('RLS matrix: tenant A sees 0 of tenant B rows in every table, and its own rows', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  await db.exec(`CREATE ROLE rls_probe NOLOGIN; GRANT USAGE ON SCHEMA public TO rls_probe;
                 GRANT SELECT ON ALL TABLES IN SCHEMA public TO rls_probe;
                 GRANT EXECUTE ON FUNCTION app_org(), app_ws() TO rls_probe;`);
  const scoped = (await tenantTables(db)).filter((t) => t.col);

  let checked = 0;
  for (const { t, col } of scoped) {
    // Denominator: B must actually have rows here, or "sees 0" proves nothing.
    const bRows = Number((await one(db, `SELECT count(*) AS n FROM ${t} WHERE ${col} = $1`, [b.org])).n);
    assert.ok(bRows >= 1, `${t}: seed left tenant B with no rows; the check would be vacuous`);
    const seen = await as(db, 'rls_probe', { org: a.org, ws: [a.ws] }, () =>
      one(db, `SELECT count(*) FILTER (WHERE ${col} = $1) AS foreign, count(*) FILTER (WHERE ${col} = $2) AS own FROM ${t}`,
        [b.org, a.org]));
    assert.equal(Number(seen.foreign), 0, `${t}: tenant A can see ${seen.foreign} of tenant B's rows`);
    assert.ok(Number(seen.own) >= 1, `${t}: tenant A cannot see its own rows`);
    checked++;
  }
  console.log(`  RLS matrix: ${checked} of ${scoped.length} tables checked, each with foreign rows present, 0 visible`);
  assert.equal(checked, scoped.length);
});

test('no request context means no rows (fail closed)', async () => {
  const db = await freshDb();
  await seedTenant(db, 'alpha');
  const scoped = (await tenantTables(db)).filter((t) => t.col);
  await db.exec(`CREATE ROLE rls_probe NOLOGIN; GRANT USAGE ON SCHEMA public TO rls_probe;
                 GRANT SELECT ON ALL TABLES IN SCHEMA public TO rls_probe;
                 GRANT EXECUTE ON FUNCTION app_org(), app_ws() TO rls_probe;`);
  for (const { t } of scoped) {
    const n = await as(db, 'rls_probe', null, () => one(db, `SELECT count(*) AS n FROM ${t}`));
    assert.equal(Number(n.n), 0, `${t}: rows visible with no tenant context`);
  }
});

test('a tenant cannot write a row into another tenant', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  let msg = null;
  try {
    await as(db, 'app_rw', { org: a.org, ws: [a.ws] }, () =>
      db.query(`INSERT INTO contacts (org_id, workspace_id, email) VALUES ($1, $2, 'x@y.test')`, [b.org, b.ws]));
  } catch (err) { msg = err.message; }
  assert.match(msg ?? '', /row-level security/);
});
