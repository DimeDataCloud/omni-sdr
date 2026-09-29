// Applies migrations/*.sql in filename order, once each, recorded in schema_migrations.
// Works with any client exposing exec(sql) + query(sql, params): PGlite in tests, pg in prod.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${name}');\nCOMMIT;`);
    ran.push(name);
  }
  return { total: files.length, ran };
}
