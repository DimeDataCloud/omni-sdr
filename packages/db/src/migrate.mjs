// Applies migrations/*.sql in filename order, once each, recorded in schema_migrations.
// Works with any client exposing exec(sql) + query(sql, params): PGlite in tests, pg in prod.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Migration files not yet recorded in schema_migrations, in the order they would run. */
export async function pending(db, dir = MIGRATIONS_DIR) {
  // Read-only: a dry run against prod must not write, so a missing bookkeeping table means nothing is applied yet.
  const exists = (await db.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS e`)).rows[0].e;
  const applied = new Set(exists ? (await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name) : []);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return { total: files.length, names: files.filter((f) => !applied.has(f)) };
}

export async function migrate(db, dir = MIGRATIONS_DIR) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = await readFile(join(dir, name), 'utf8');
    try {
      await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${name}');\nCOMMIT;`);
    } catch (e) {
      // A failed statement leaves the explicit transaction open and aborted: close it, so nothing of this file stays.
      await db.exec('ROLLBACK').catch(() => {});
      e.message = `${name}: ${e.message}`;
      throw e;
    }
    ran.push(name);
  }
  return { total: files.length, ran };
}
