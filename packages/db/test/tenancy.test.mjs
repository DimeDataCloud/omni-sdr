import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused, one, q } from './helpers.mjs';

// Foreign-key checks run without RLS, so a single-column FK lets tenant A point at tenant B's row.
// Mechanical rule, derived from the catalog: every FK between two tenant tables carries org_id.
test('every FK between tenant tables includes org_id (mechanical rule)', async () => {
  const db = await freshDb();
  const fks = await q(db, `
    SELECT con.conname, src.relname AS src, dst.relname AS dst,
           ARRAY(SELECT a.attname::text FROM unnest(con.conkey) k JOIN pg_attribute a
                 ON a.attrelid = con.conrelid AND a.attnum = k) AS cols
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class dst ON dst.oid = con.confrelid
    WHERE con.contype = 'f'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attname = 'org_id')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attname = 'org_id')`);
  console.log(`  tenant-to-tenant FKs checked: ${fks.length}`);
  assert.ok(fks.length >= 12, `expected at least 12 tenant-to-tenant FKs, found ${fks.length}`);
  const bad = fks.filter((f) => !f.cols.includes('org_id')).map((f) => `${f.src}.${f.conname} -> ${f.dst}`);
  assert.deepEqual(bad, [], `FKs that can cross tenants: ${bad.join(', ')}`);
});

test('a tenant cannot reference another tenant\'s rows through an FK', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  const bIcp = (await one(db, `SELECT id FROM icps WHERE org_id = $1`, [b.org])).id;
  const ctx = { org: a.org, ws: [a.ws] };
  const cases = [
    ['campaign pins B\'s ICP', `INSERT INTO campaigns (org_id, workspace_id, name, icp_id) VALUES ($1, $2, 'x', $3)`, [a.org, a.ws, bIcp]],
    ['enrollment of B\'s contact', `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id) VALUES ($1, $2, $3, $4)`, [a.org, a.ws, a.campaign, b.contact]],
    ['enrollment in B\'s campaign', `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id) VALUES ($1, $2, $3, $4)`, [a.org, a.ws, b.campaign, a.contact]],
    ['evidence on B\'s contact', `INSERT INTO evidence (org_id, workspace_id, contact_id, type, source_uri, fetched_at, snapshot_sha, expires_at)
       VALUES ($1, $2, $3, 't', 'https://x.test', now(), 's', now() + interval '1 day')`, [a.org, a.ws, b.contact]],
    ['draft on B\'s enrollment', `INSERT INTO drafts (org_id, workspace_id, enrollment_id, channel, body) VALUES ($1, $2, $3, 'email', 'x')`, [a.org, a.ws, b.enrollment]],
  ];
  for (const [label, sql, params] of cases) {
    const msg = await refused(as(db, 'app_rw', ctx, () => db.query(sql, params)));
    assert.match(msg ?? 'ACCEPTED', /foreign key/, `${label} was accepted`);
  }
  console.log(`  cross-tenant references refused: ${cases.length} of ${cases.length}`);
});

test('ICP versions are immutable: the app inserts a new version, never edits one', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const ctx = { org: t.org, ws: [t.ws] };
  const v1 = await one(db, `SELECT id, lineage_id FROM icps WHERE org_id = $1`, [t.org]);
  assert.match(await refused(as(db, 'app_rw', ctx, () =>
    db.query(`UPDATE icps SET data = '{"x":1}' WHERE id = $1`, [v1.id]))) ?? '', /permission denied/);
  // Even a role with full table rights cannot rewrite a pinned version.
  assert.match(await refused(as(db, 'ops', null, () =>
    db.query(`UPDATE icps SET data = '{"x":1}' WHERE id = $1`, [v1.id]))) ?? '', /immutable/);
  await as(db, 'app_rw', ctx, () => db.query(
    `INSERT INTO icps (org_id, workspace_id, lineage_id, version, data) VALUES ($1, $2, $3, 2, '{"x":1}')`,
    [t.org, t.ws, v1.lineage_id]));
  assert.match(await refused(as(db, 'app_rw', ctx, () => db.query(
    `INSERT INTO icps (org_id, workspace_id, lineage_id, version) VALUES ($1, $2, $3, 2)`,
    [t.org, t.ws, v1.lineage_id]))) ?? '', /duplicate key/);
  await as(db, 'app_rw', ctx, () => db.query(`UPDATE icps SET archived_at = now() WHERE id = $1`, [v1.id]));
});

test('workspace settings: Auto-adjust sources are bounded; a custom domain maps to one workspace', async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  assert.match(await refused(db.query(
    `UPDATE workspaces SET auto_adjust_sources = ARRAY['booked_meetings', 'guardrails'] WHERE id = $1`, [a.ws])) ?? '',
    /check constraint/);
  await db.query(`UPDATE workspaces SET custom_domain = 'reports.agency.test' WHERE id = $1`, [a.ws]);
  assert.match(await refused(db.query(
    `UPDATE workspaces SET custom_domain = 'Reports.Agency.test' WHERE id = $1`, [b.ws])) ?? '', /duplicate key/);
  // Tenant-controlled settings are not writable by the app role yet: Station 21/22 add column grants.
  assert.match(await refused(as(db, 'app_rw', { org: a.org, ws: [a.ws] }, () =>
    db.query(`UPDATE workspaces SET trust_level = 2 WHERE id = $1`, [a.ws]))) ?? '', /permission denied/);
  assert.match(await refused(as(db, 'app_rw', { org: a.org, ws: [a.ws] }, () =>
    db.query(`UPDATE orgs SET feature_flags = '{"media_video":true}' WHERE id = $1`, [a.org]))) ?? '', /permission denied/);
});
