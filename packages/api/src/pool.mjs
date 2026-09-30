// A request borrows ONE connection for its whole life: withTenant's BEGIN, SET LOCAL and queries must share it.
// Both pools expose acquire() -> { client, release }. client has query(sql, params) (and exec for migrate).

// PGlite is a single in-process connection: requests take turns (dev server and tests).
export function pglitePool(db) {
  let tail = Promise.resolve();
  return {
    kind: 'pglite',
    async acquire() {
      let release;
      const turn = new Promise((r) => { release = r; });
      const prev = tail;
      tail = prev.then(() => turn);
      await prev;
      return { client: db, release: () => release() };
    },
    async end() { await db.close?.(); },
  };
}

// Production: node-postgres against Cloud SQL. The login role must be a member of app_rw, gate_svc,
// sender_svc and inbox_svc and nothing else (docs/claude/API.md, "Database login").
export async function pgPool({ connectionString, max = 10 }) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 30000, application_name: 'omni-api' });
  return {
    kind: 'pg',
    async acquire() {
      const c = await pool.connect();
      const client = { query: (sql, params) => c.query(sql, params), exec: (sql) => c.query(sql) };
      let done = false;
      return {
        client,
        // A connection that errored mid-transaction is destroyed rather than returned dirty.
        release: (err) => { if (!done) { done = true; c.release(err instanceof Error ? err : undefined); } },
      };
    },
    async end() { await pool.end(); },
  };
}

export async function withClient(pool, fn) {
  const { client, release } = await pool.acquire();
  try {
    const out = await fn(client);
    release();
    return out;
  } catch (err) {
    release(err);
    throw err;
  }
}
