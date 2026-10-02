// Production migrations (docs/claude/DB-ROLLOUT.md, step 6). Run it as a one-off job with the OWNER login, after a
// backup. Nothing here is run by an agent against prod: that is a deploy (rails §3.1) and needs Christian's go.
//
//   DATABASE_URL=<owner login> node packages/db/src/migrate-cli.mjs               dry run: lists what would run
//   DATABASE_URL=<owner login> node packages/db/src/migrate-cli.mjs --apply       applies, one run at a time
//   DATABASE_URL=<owner login> node packages/db/src/migrate-cli.mjs --check-login=omni_api
//                                                       the API login holds exactly the four service roles (§3)
//
// The connection string is never printed: it carries the password.
import { pathToFileURL } from 'node:url';
import { migrate, pending } from './migrate.mjs';

const LOCK = 74062110; // pg_advisory_lock key: a second runner waits instead of racing the first
/** The API's login must be a member of these and nothing else (docs/claude/API.md, "Database login"). */
export const API_ROLES = ['app_rw', 'gate_svc', 'inbox_svc', 'sender_svc'];

/** Dry run by default; with apply, runs every pending file, each in its own transaction, under an advisory lock. */
export async function run(db, { apply = false, dir } = {}) {
  const before = await pending(db, dir);
  if (!apply) return { applied: [], pending: before.names, total: before.total };
  await db.query('SELECT pg_advisory_lock($1)', [LOCK]);
  // Postgres 16+: a non-superuser owner (Cloud SQL has no superuser) no longer becomes a member of the roles it
  // creates, so 0001's `ALTER ... OWNER TO guard_owner` failed with "must be able to SET ROLE" (found 2026-10-02 on
  // postgres:16 as a CREATEROLE login). This session setting grants the creator SET (not INHERIT) on each role it creates. A no-op
  // for a superuser; Postgres 15 and older don't have it, and don't need it.
  if (await db.query(`SELECT 1 FROM pg_settings WHERE name = 'createrole_self_grant'`).then((r) => r.rows.length)) {
    await db.exec(`SET createrole_self_grant = 'set'`);
  }
  try {
    const { ran, total } = await migrate(db, dir); // re-reads what is applied, now under the lock
    return { applied: ran, pending: [], total };
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK]);
  }
}

/** What is wrong with a login meant for the API: [] when it holds exactly API_ROLES and no special powers. */
export async function checkLogin(db, login) {
  const r = (await db.query(`SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
      ARRAY(SELECT b.rolname::text FROM pg_roles b WHERE b.oid <> r.oid AND pg_has_role(r.oid, b.oid, 'MEMBER') ORDER BY 1) AS member_of,
      (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns
    FROM pg_roles r WHERE r.rolname = $1`, [login])).rows[0];
  if (!r) return [`no role named ${login}`];
  const problems = [];
  if (!r.rolcanlogin) problems.push('cannot log in');
  for (const k of ['rolsuper', 'rolbypassrls', 'rolcreaterole', 'rolcreatedb']) if (r[k]) problems.push(`has ${k.slice(3)}`);
  const member = r.member_of;
  const extra = member.filter((m) => !API_ROLES.includes(m));
  const missing = API_ROLES.filter((m) => !member.includes(m));
  if (extra.length) problems.push(`member of ${extra.join(', ')}, which it must not be`);
  if (missing.length) problems.push(`not a member of ${missing.join(', ')}`);
  if (r.owns) problems.push(`owns ${r.owns} relation(s)`);
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(2); }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, application_name: 'omni-migrate' });
  const db = { query: (sql, params) => client.query(sql, params), exec: (sql) => client.query(sql) };
  try {
    await client.connect();
    const login = args.find((a) => a.startsWith('--check-login='))?.split('=')[1];
    if (login) {
      const problems = await checkLogin(db, login);
      console.log(problems.length ? `FAIL  ${login}: ${problems.join('; ')}` : `PASS  ${login}: member of ${API_ROLES.join(', ')} only`);
      process.exitCode = problems.length ? 1 : 0;
      return;
    }
    const apply = args.includes('--apply');
    const res = await run(db, { apply });
    if (!apply) console.log(`dry run: ${res.pending.length} of ${res.total} to apply${res.pending.length ? `: ${res.pending.join(', ')}` : ''}. Add --apply after a backup.`);
    else console.log(`applied ${res.applied.length} of ${res.total}${res.applied.length ? `: ${res.applied.join(', ')}` : ' (nothing pending)'}`);
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
