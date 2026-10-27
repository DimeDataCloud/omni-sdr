// Rep portal API: auth fail-closed, rep scoping, CSRF, call rules, idempotent automation, deal pricing, CSV.
// Runs handleRep against a D1 stand-in over node:sqlite with the real migration. The Access JWT check itself is covered
// in rep-access.test.mjs; here identity comes from the localhost dev path, and its production refusal is tested.
// Run: node --test tests/rep-api.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

register('./text-loader.mjs', import.meta.url);
const { handleRep } = await import('../src/rep/index.js');

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;' + readFileSync(new URL('../migrations/rep/0001_init.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => (db.prepare(sql).run(...args), { success: true }),
    _exec: () => ({ results: db.prepare(sql).all(...args) }),
  });
  return {
    db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => { db.exec('BEGIN'); try { const out = list.map((s) => s._exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}

const A = 'rep-a@example.test', B = 'rep-b@example.test', BOSS = 'boss@example.test';
function setup() {
  const DB = d1(), t = new Date().toISOString();
  for (const [e, n, r] of [[A, 'Rep A', 'rep'], [B, 'Rep B', 'rep']]) DB.db.prepare('INSERT INTO reps (email, name, role, active, created_at) VALUES (?, ?, ?, 1, ?)').run(e, n, r, t);
  return DB;
}
// as(email) signs requests in through the localhost dev path.
const call = (DB, email, path, { method = 'GET', body, headers = {}, host = 'http://localhost:8787', env = {} } = {}) =>
  handleRep(new Request(host + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-rep': '1' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }),
    { REP_DB: DB, REP_DEV_EMAIL: email, ...env });
const j = async (r) => ({ status: r.status, body: await r.json() });
const newAccount = async (DB, who, extra = {}) => (await j(await call(DB, who, '/rep/api/accounts', { method: 'POST', body: { business: 'Ridge Roofing', niche: 'Roofer', phone: '615-555-0100', ...extra } }))).body.account;

test('fails closed: no Access config, no dev path off localhost, unknown email, no database', async () => {
  const DB = setup();
  const r1 = await handleRep(new Request('https://demo.omnisdr.com/rep/api/me'), { REP_DB: DB });
  assert.equal(r1.status, 401);
  const r2 = await handleRep(new Request('https://demo.omnisdr.com/rep/api/me'), { REP_DB: DB, REP_DEV_EMAIL: A }); // dev email set in prod by mistake
  assert.equal(r2.status, 401);
  const r3 = await handleRep(new Request('https://demo.omnisdr.com/rep'), { REP_DB: DB });
  assert.equal(r3.status, 401); assert.match(r3.headers.get('content-type'), /text\/html/); assert.doesNotMatch(await r3.text(), /__CSS__|Call Room/);
  assert.equal((await call(DB, 'stranger@example.test', '/rep/api/me')).status, 403);
  assert.equal((await handleRep(new Request('http://localhost/rep/api/me'), { REP_DEV_EMAIL: A })).status, 503);
});

test('a turned-off rep is refused', async () => {
  const DB = setup(); DB.db.prepare('UPDATE reps SET active = 0 WHERE email = ?').run(B);
  assert.equal((await call(DB, B, '/rep/api/me')).status, 403);
});

test('owner bootstrap: REP_ADMIN_EMAIL becomes admin on first sign-in, and only that email', async () => {
  const DB = setup();
  const r = await j(await call(DB, BOSS, '/rep/api/me', { env: { REP_ADMIN_EMAIL: 'Boss@Example.test' } }));
  assert.equal(r.status, 200); assert.equal(r.body.role, 'admin');
  assert.equal((await call(DB, 'other@example.test', '/rep/api/me', { env: { REP_ADMIN_EMAIL: BOSS } })).status, 403);
});

test('writes need the x-rep header and a same-origin Origin', async () => {
  const DB = setup();
  assert.equal((await call(DB, A, '/rep/api/accounts', { method: 'POST', body: { business: 'X' }, headers: { 'x-rep': '' } })).status, 403);
  assert.equal((await call(DB, A, '/rep/api/accounts', { method: 'POST', body: { business: 'X' }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(DB, A, '/rep/api/accounts', { method: 'POST', body: { business: 'X' }, headers: { origin: 'http://localhost:8787' } })).status, 200);
});

test('a rep sees only their own accounts; other ids read as not found', async () => {
  const DB = setup(), mine = await newAccount(DB, A), theirs = await newAccount(DB, B, { business: 'Other Co' });
  const list = (await j(await call(DB, A, '/rep/api/accounts'))).body.accounts;
  assert.deepEqual(list.map((a) => a.id), [mine.id]);
  assert.equal((await call(DB, A, '/rep/api/accounts/' + theirs.id)).status, 404);
  assert.equal((await call(DB, A, '/rep/api/accounts/' + theirs.id, { method: 'PATCH', body: { notes: 'x' } })).status, 404);
  assert.equal((await call(DB, A, '/rep/api/calls', { method: 'POST', body: { accountId: theirs.id, outcome: 'no_answer' } })).status, 404);
  DB.db.prepare("INSERT INTO reps (email, name, role, active, created_at) VALUES (?, 'Boss', 'admin', 1, '2026-01-01')").run(BOSS);
  assert.equal((await j(await call(DB, BOSS, '/rep/api/accounts'))).body.accounts.length, 2);
});

test('logging a call moves the stage, closes open follow-ups and books the next task, all audited', async () => {
  const DB = setup(), a = await newAccount(DB, A);
  await call(DB, A, '/rep/api/calls', { method: 'POST', body: { accountId: a.id, outcome: 'no_answer' } });
  const r = await j(await call(DB, A, '/rep/api/calls', { method: 'POST', body: { accountId: a.id, outcome: 'interested', note: 'Owner wants the check' } }));
  assert.equal(r.body.stage, 'contacted');
  const open = DB.db.prepare("SELECT kind, title FROM tasks WHERE account_id = ? AND status = 'open'").all(a.id);
  assert.deepEqual(open.map((t) => t.kind), ['demo']); // the no_answer follow-up was closed by this call
  assert.ok(DB.db.prepare("SELECT COUNT(*) n FROM audit WHERE entity = 'call'").get().n === 2);
  assert.equal((await call(DB, A, '/rep/api/calls', { method: 'POST', body: { accountId: a.id, outcome: 'callback_scheduled' } })).status, 400); // needs a time
  assert.equal((await call(DB, A, '/rep/api/calls', { method: 'POST', body: { accountId: a.id, outcome: 'made_up' } })).status, 400);
});

test('automation rules are idempotent: one open task per rule and account', async () => {
  const DB = setup(), a = await newAccount(DB, A), old = new Date(Date.now() - 6 * 864e5).toISOString();
  DB.db.prepare("UPDATE accounts SET stage = 'contacted', last_touch_at = ?, updated_at = ? WHERE id = ?").run(old, old, a.id);
  await call(DB, A, '/rep/api/today'); await call(DB, A, '/rep/api/today');
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM tasks WHERE auto_key = ? AND status = 'open'").get('stale-contacted:' + a.id).n, 1);
  const today = await j(await call(DB, A, '/rep/api/today'));
  assert.ok(today.body.tasks.some((t) => t.account_id === a.id));
});

test('reps cannot set onboarding or live; those are admin moves', async () => {
  const DB = setup(), a = await newAccount(DB, A);
  assert.equal((await call(DB, A, '/rep/api/accounts/' + a.id, { method: 'PATCH', body: { stage: 'live' } })).status, 403);
  assert.equal((await call(DB, A, '/rep/api/accounts/' + a.id, { method: 'PATCH', body: { stage: 'proposed' } })).status, 200);
});

test('deals: a rep closes Level 1 at the list price only, never sets a price, and cannot close Level 2', async () => {
  const DB = setup(), a = await newAccount(DB, A), b = await newAccount(DB, A, { business: 'Second' });
  const r = await j(await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: a.id, level: 1, priceCents: 100 } }));
  assert.equal(r.status, 200);
  const d = DB.db.prepare('SELECT price_cents, price_is_draft FROM deals WHERE id = ?').get(r.body.id);
  assert.equal(d.price_cents, 49900); assert.equal(d.price_is_draft, 1); // the rep's 100 was ignored
  assert.equal(DB.db.prepare('SELECT stage FROM accounts WHERE id = ?').get(a.id).stage, 'signed');
  assert.equal((await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: a.id, level: 1 } })).status, 409);
  assert.equal((await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: b.id, level: 2, priceCents: 50000 } })).status, 403);
  assert.equal((await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: b.id, level: 0 } })).status, 400);
});

test('CSV: export neutralises formulas; import is all or nothing', async () => {
  const DB = setup(); await newAccount(DB, A, { business: '=HYPERLINK("http://x")', notes: 'a, "quoted" note' });
  const csv = await (await call(DB, A, '/rep/api/export.csv')).text();
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/); assert.match(csv, /"a, ""quoted"" note"/);
  const bad = await j(await call(DB, A, '/rep/api/import', { method: 'POST', body: { csv: 'business,phone\nGood Co,615-555-0101\n,615-555-0102\n' } }));
  assert.equal(bad.body.imported, 0); assert.equal(bad.body.errors[0].row, 3);
  const ok = await j(await call(DB, A, '/rep/api/import', { method: 'POST', body: { csv: 'Business,Phone,Contact Name\r\n"Hill, Plumbing",615-555-0103,Dana\r\nGood Co,615-555-0101,\r\n' } }));
  assert.equal(ok.body.imported, 2);
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM contacts c JOIN accounts a ON a.id = c.account_id WHERE a.business = 'Hill, Plumbing'").get().n, 1);
});

test('team admin is admin-only, and an admin cannot lock themself out', async () => {
  const DB = setup();
  assert.equal((await call(DB, A, '/rep/api/reps')).status, 403);
  DB.db.prepare("INSERT INTO reps (email, name, role, active, created_at) VALUES (?, 'Boss', 'admin', 1, '2026-01-01')").run(BOSS);
  assert.equal((await call(DB, BOSS, '/rep/api/reps', { method: 'POST', body: { email: 'New@Example.test', name: 'New' } })).status, 200);
  assert.equal((await call(DB, BOSS, '/rep/api/reps/' + encodeURIComponent(BOSS), { method: 'PATCH', body: { active: false } })).status, 400);
  assert.equal((await call(DB, BOSS, '/rep/api/reps/' + encodeURIComponent(A), { method: 'PATCH', body: { active: false } })).status, 200);
  assert.equal((await call(DB, A, '/rep/api/me')).status, 403);
});

test('the page ships with its own nonce CSP and no unfilled placeholders', async () => {
  const DB = setup(), r = await call(DB, A, '/rep');
  assert.equal(r.status, 200);
  const html = await r.text(), csp = r.headers.get('content-security-policy');
  assert.doesNotMatch(html, /__(NONCE|CSS|LOGO)__/);
  const nonce = csp.match(/'nonce-([^']+)'/)[1];
  assert.ok(html.includes(`nonce="${nonce}"`)); assert.match(csp, /frame-ancestors 'none'/); assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});
