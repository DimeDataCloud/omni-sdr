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
  db.exec('PRAGMA foreign_keys = ON;' + readFileSync(new URL('../migrations/rep/0001_init.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/rep/0002_audit.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/rep/0003_stages.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/rep/0004_mix.sql', import.meta.url), 'utf8'));
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
  assert.equal(r.body.stage, 'results_call'); // shown as Demo booked
  const open = DB.db.prepare("SELECT kind, title FROM tasks WHERE account_id = ? AND status = 'open'").all(a.id);
  assert.deepEqual(open.map((t) => t.kind), ['demo']); // the no_answer follow-up was closed by this call
  assert.ok(DB.db.prepare("SELECT COUNT(*) n FROM audit WHERE entity = 'call'").get().n === 2);
  assert.equal((await call(DB, A, '/rep/api/calls', { method: 'POST', body: { accountId: a.id, outcome: 'callback_scheduled' } })).status, 400); // needs a time
  assert.equal((await call(DB, A, '/rep/api/calls', { method: 'POST', body: { accountId: a.id, outcome: 'made_up' } })).status, 400);
});

test('automation rules are idempotent: one open task per rule and account', async () => {
  const DB = setup(), a = await newAccount(DB, A), old = new Date(Date.now() - 6 * 864e5).toISOString();
  DB.db.prepare("UPDATE accounts SET last_touch_at = ?, updated_at = ? WHERE id = ?").run(old, old, a.id); // a new lead reached 6 days ago
  await call(DB, A, '/rep/api/today'); await call(DB, A, '/rep/api/today');
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM tasks WHERE auto_key = ? AND status = 'open'").get('stale-new:' + a.id).n, 1);
  const today = await j(await call(DB, A, '/rep/api/today'));
  assert.ok(today.body.tasks.some((t) => t.account_id === a.id));
});

test('reps cannot set onboarding or live; those are admin moves', async () => {
  const DB = setup(), a = await newAccount(DB, A);
  assert.equal((await call(DB, A, '/rep/api/accounts/' + a.id, { method: 'PATCH', body: { stage: 'live' } })).status, 403);
  assert.equal((await call(DB, A, '/rep/api/accounts/' + a.id, { method: 'PATCH', body: { stage: 'proposed' } })).status, 200);
});

test('deals: the pilot has a $499 floor the rep can price above, never below; Level 2 stays closed to reps', async () => {
  // Christian 2026-10-27: "$499 minimum pilot, allowance higher tiers". Replaces the earlier list-price-only rule.
  const DB = setup(), a = await newAccount(DB, A), b = await newAccount(DB, A, { business: 'Second' }), c = await newAccount(DB, A, { business: 'Third' });
  assert.equal((await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: a.id, level: 1, priceCents: 100 } })).status, 400); // under the floor
  assert.equal((await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: a.id, level: 1, priceCents: 49899 } })).status, 400);
  assert.equal((await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: a.id, level: 1, priceCents: 79900.5 } })).status, 400);
  assert.equal((await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: a.id, level: 1, priceCents: 500001 } })).status, 400); // typo guard
  assert.equal(DB.db.prepare('SELECT stage FROM accounts WHERE id = ?').get(a.id).stage, 'new'); // refused closes leave nothing behind
  const r = await j(await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: a.id, level: 1 } }));
  assert.equal(r.status, 200);
  const d = DB.db.prepare('SELECT price_cents, price_is_draft FROM deals WHERE id = ?').get(r.body.id);
  assert.equal(d.price_cents, 49900); assert.equal(d.price_is_draft, 1); // no price given: the floor
  assert.equal(DB.db.prepare('SELECT stage FROM accounts WHERE id = ?').get(a.id).stage, 'onboarding');
  assert.equal((await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: a.id, level: 1 } })).status, 409);
  assert.equal((await j(await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: c.id, level: 1, priceCents: 89900 } }))).status, 200);
  const list = (await j(await call(DB, A, '/rep/api/deals'))).body.deals;
  const floor = list.find((x) => x.price_cents === 49900), big = list.find((x) => x.price_cents === 89900);
  assert.equal(floor.allowanceCents, 17500); assert.equal(Math.round(floor.eachCents / 100), 151); // matches the confirmed $499 table
  assert.equal(big.allowanceCents, 33000); assert.equal(Math.round(big.eachCents / 100), 264); // Plus: $330 at $899, matches the confirmed table
  const { pilotSplit } = await import('../src/rep/content.js');
  assert.equal(pilotSplit(89800).allowanceCents, 31500); assert.equal(pilotSplit(150000).allowanceCents, 52500); // 35% below $899 and once it passes $330
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

test('content carries the six-step path, How it works and the pricing guide, with a quote rule for every level', async () => {
  const DB = setup(), k = (await j(await call(DB, A, '/rep/api/content'))).body;
  assert.equal(k.path.length, 6);
  assert.equal(k.how.flow.length, 5); assert.ok(k.how.channels.every((c) => c.status)); // every channel carries an honest status
  assert.match(k.path[3].body, /\$499 plus tax/);
  for (const l of k.prices.levels) assert.ok(k.pricingGuide.quote.some((q) => q.level === l.level), 'quote rule for level ' + l.level);
  assert.doesNotMatch(JSON.stringify(k), /—/); // house style: no em dashes in rep copy
});

test('audit: saves only known keys, caps length, stays rep-scoped, and can mark the free check run', async () => {
  const DB = setup(), a = await newAccount(DB, A);
  const r = await j(await call(DB, A, `/rep/api/accounts/${a.id}`, { method: 'PATCH', body: { audit: { callResult: 'Voicemail after 6 rings, no callback', jobValue: '8500', evil: 'x' }, stage: 'results_call' } }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.account.audit, { callResult: 'Voicemail after 6 rings, no callback', jobValue: '8500' });
  assert.equal(r.body.account.stage, 'results_call');
  assert.equal((await call(DB, A, `/rep/api/accounts/${a.id}`, { method: 'PATCH', body: { audit: ['x'] } })).status, 400);
  assert.equal((await call(DB, A, `/rep/api/accounts/${a.id}`, { method: 'PATCH', body: { audit: { other: 'x'.repeat(1001) } } })).status, 400);
  assert.equal((await call(DB, B, `/rep/api/accounts/${a.id}`, { method: 'PATCH', body: { audit: { other: 'mine now' } } })).status, 404);
  const fresh = await newAccount(DB, A, { business: 'Blank Audit Co' });
  assert.deepEqual(fresh.audit, {});
});

test('content carries the rep toolkit: templates, discovery, qualifying, after the yes, glossary', async () => {
  const DB = setup(), { body: k } = await j(await call(DB, A, '/rep/api/content'));
  assert.ok(k.templates.length >= 5 && k.templates.every((t) => t.id && t.label && t.body && ['text', 'email', 'call'].includes(t.kind)));
  assert.ok(k.templates.every((t) => !/\{(?!business\}|name\}|rep\})[^}]*\}/.test(t.body)), 'only {business}, {name}, {rep} are auto-filled');
  assert.ok(k.discovery.questions.length >= 5 && k.qualify.red.length && k.qualify.green.length && k.qualify.niches.length);
  assert.ok(k.auditFields.some((f) => f.key === 'jobValue' && f.num) && k.auditFields.some((f) => f.key === 'missed' && f.num));
  assert.ok(k.afterYes.golive.length && k.glossary.length && k.daily.log.length && k.safety.line);
  const all = JSON.stringify(k);
  assert.doesNotMatch(all, /\u2014/, 'no em dashes');
  assert.doesNotMatch(all, /Omni SDR/, 'spelled OmniSDR');
  assert.doesNotMatch(all, /guarantee(d)? (results|bookings)/i);
});

test('stages: New, Demo booked, Proposed, Onboarding, Live, Lost; 0003 moves old rows and retired codes are refused', async () => {
  // Christian 2026-10-27. 'results_call' is the stored code for Demo booked.
  const { body: k } = await j(await call(setup(), A, '/rep/api/content'));
  assert.deepEqual(k.stages, ['new', 'results_call', 'proposed', 'onboarding', 'live', 'lost']);
  const db = new DatabaseSync(':memory:'), t = new Date().toISOString();
  db.exec(readFileSync(new URL('../migrations/rep/0001_init.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/rep/0002_audit.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO reps (email, name, role, active, created_at) VALUES ('x@example.test', 'X', 'rep', 1, ?)").run(t);
  const ins = db.prepare("INSERT INTO accounts (id, owner_email, business, stage, created_at, updated_at) VALUES (?, 'x@example.test', ?, ?, ?, ?)");
  for (const s of ['new', 'contacted', 'audit_run', 'results_call', 'proposed', 'signed', 'onboarding', 'live', 'lost']) ins.run(s, s, s, t, t);
  db.exec(readFileSync(new URL('../migrations/rep/0003_stages.sql', import.meta.url), 'utf8'));
  const after = Object.fromEntries(db.prepare('SELECT id, stage FROM accounts').all().map((r) => [r.id, r.stage]));
  assert.deepEqual(after, { new: 'new', contacted: 'new', audit_run: 'results_call', results_call: 'results_call', proposed: 'proposed', signed: 'onboarding', onboarding: 'onboarding', live: 'live', lost: 'lost' });
  const DB = setup(), a = await newAccount(DB, A);
  for (const old of ['contacted', 'audit_run', 'signed']) assert.equal((await call(DB, A, '/rep/api/accounts/' + a.id, { method: 'PATCH', body: { stage: old } })).status, 400);
});

test('assign: the admin hands leads to a rep; open tasks follow; each rep sees only their own; reps cannot assign', async () => {
  // Christian 2026-10-27: share leads with specific reps, each rep gets their own view and data.
  const DB = setup(); DB.db.prepare("INSERT INTO reps (email, name, role, active, created_at) VALUES (?, 'Boss', 'admin', 1, '2026-01-01')").run(BOSS);
  const x = await newAccount(DB, BOSS, { business: 'Pool One' }), y = await newAccount(DB, BOSS, { business: 'Pool Two' }), z = await newAccount(DB, BOSS, { business: 'Pool Three' });
  await call(DB, BOSS, '/rep/api/calls', { method: 'POST', body: { accountId: x.id, outcome: 'no_answer' } }); // an open follow-up on x
  // reps cannot assign, not even to themselves
  assert.equal((await call(DB, A, '/rep/api/assign', { method: 'POST', body: { accountIds: [x.id], owner: A } })).status, 403);
  // all or nothing: one unknown id moves nothing
  assert.equal((await call(DB, BOSS, '/rep/api/assign', { method: 'POST', body: { accountIds: [x.id, 'nope'], owner: A } })).status, 404);
  assert.equal(DB.db.prepare('SELECT owner_email FROM accounts WHERE id = ?').get(x.id).owner_email, BOSS);
  // inactive or unknown reps are refused
  DB.db.prepare('UPDATE reps SET active = 0 WHERE email = ?').run(B);
  assert.equal((await call(DB, BOSS, '/rep/api/assign', { method: 'POST', body: { accountIds: [x.id], owner: B } })).status, 400);
  assert.equal((await call(DB, BOSS, '/rep/api/assign', { method: 'POST', body: { accountIds: [x.id], owner: 'stranger@example.test' } })).status, 400);
  DB.db.prepare('UPDATE reps SET active = 1 WHERE email = ?').run(B);
  const r = await j(await call(DB, BOSS, '/rep/api/assign', { method: 'POST', body: { accountIds: [x.id, y.id], owner: A } }));
  assert.equal(r.status, 200); assert.equal(r.body.assigned, 2);
  await call(DB, BOSS, '/rep/api/assign', { method: 'POST', body: { accountIds: [z.id], owner: B } });
  assert.equal(DB.db.prepare("SELECT rep_email FROM tasks WHERE account_id = ? AND status = 'open'").get(x.id).rep_email, A); // the follow-up moved
  assert.equal(DB.db.prepare('SELECT rep_email FROM calls WHERE account_id = ?').get(x.id).rep_email, BOSS); // history stays credited
  const names = async (who, q = '') => (await j(await call(DB, who, '/rep/api/accounts' + q))).body.accounts.map((a) => a.business).sort();
  assert.deepEqual(await names(A), ['Pool One', 'Pool Two']);
  assert.deepEqual(await names(B), ['Pool Three']);
  assert.deepEqual(await names(A, '?owner=' + encodeURIComponent(B)), ['Pool One', 'Pool Two']); // a rep cannot use the Viewing switch
  assert.equal((await call(DB, B, `/rep/api/accounts/${x.id}`)).status, 404);
  assert.deepEqual(await names(BOSS, '?owner=' + encodeURIComponent(B)), ['Pool Three']); // the admin views one rep
  assert.equal((await names(BOSS)).length, 3);
  const today = (await j(await call(DB, BOSS, '/rep/api/tasks?owner=' + encodeURIComponent(A)))).body.tasks;
  assert.ok(today.length && today.every((t) => t.rep_email === A));
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'assign'").get().n, 3);
  // the Team screen numbers
  const team = (await j(await call(DB, BOSS, '/rep/api/reps'))).body.reps;
  assert.equal(team.find((t) => t.email === A).stats.leads, 2); assert.equal(team.find((t) => t.email === B).stats.leads, 1);
});

test('import: the admin can give a whole file to one rep; a rep import is always their own', async () => {
  const DB = setup(); DB.db.prepare("INSERT INTO reps (email, name, role, active, created_at) VALUES (?, 'Boss', 'admin', 1, '2026-01-01')").run(BOSS);
  const csv = 'business,phone\nLake Roofing,615-555-0111\nHill Remodel,615-555-0112\n';
  assert.equal((await j(await call(DB, BOSS, '/rep/api/import', { method: 'POST', body: { csv, owner: B } }))).body.imported, 2);
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM accounts WHERE owner_email = ?').get(B).n, 2);
  assert.equal((await j(await call(DB, A, '/rep/api/import', { method: 'POST', body: { csv, owner: B } }))).body.imported, 2);
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM accounts WHERE owner_email = ?').get(A).n, 2); // owner ignored for reps
});

test('lead dashboard: facets, pool and category filters, bulk category and archive (reps: own rows, category only)', async () => {
  // Christian 2026-10-27: an easier lead dashboard for seeing, categorizing and assigning leads.
  const DB = setup(); DB.db.prepare("INSERT INTO reps (email, name, role, active, created_at) VALUES (?, 'Boss', 'admin', 1, '2026-01-01')").run(BOSS);
  const p1 = await newAccount(DB, BOSS, { business: 'Gen One', niche: 'Generator dealer', state: 'TN' });
  const p2 = await newAccount(DB, BOSS, { business: 'Gen Two', niche: 'Generator dealer', state: 'KY' });
  const p3 = await newAccount(DB, BOSS, { business: 'No Cat', niche: '' });
  const mine = await newAccount(DB, A, { business: 'Rep Owned', niche: 'Remodeler' });
  // A rep gets exact counts over their own rows only, never the pool or other reps' leads.
  const rf = (await j(await call(DB, A, '/rep/api/leads/facets'))).body;
  assert.equal(rf.total, 1); assert.equal(rf.pool, 0); assert.deepEqual(rf.niche, [{ key: 'Remodeler', n: 1 }]); assert.deepEqual(rf.owner, [{ key: A, n: 1 }]);
  // A rep can re-categorize their own account, but not archive, and not an account that is not theirs (404, same as any probe).
  assert.equal((await call(DB, A, '/rep/api/bulk', { method: 'POST', body: { accountIds: [mine.id], archived: true } })).status, 403);
  assert.equal((await call(DB, A, '/rep/api/bulk', { method: 'POST', body: { accountIds: [mine.id, p1.id], niche: 'Hack' } })).status, 404);
  assert.equal(DB.db.prepare('SELECT niche FROM accounts WHERE id = ?').get(p1.id).niche, 'Generator dealer');
  assert.equal(DB.db.prepare('SELECT niche FROM accounts WHERE id = ?').get(mine.id).niche, 'Remodeler');
  assert.equal((await j(await call(DB, A, '/rep/api/bulk', { method: 'POST', body: { accountIds: [mine.id], niche: 'Roofer' } }))).body.updated, 1);
  assert.equal(DB.db.prepare('SELECT niche FROM accounts WHERE id = ?').get(mine.id).niche, 'Roofer');
  await call(DB, A, '/rep/api/bulk', { method: 'POST', body: { accountIds: [mine.id], niche: 'Remodeler' } }); // put it back for the admin checks below
  // archived list and unarchive already work for a rep through /accounts?archived=1 and PATCH
  assert.equal((await call(DB, A, `/rep/api/accounts/${mine.id}`, { method: 'PATCH', body: { archived: true } })).status, 200);
  assert.deepEqual((await j(await call(DB, A, '/rep/api/accounts?archived=1'))).body.accounts.map((a) => a.business), ['Rep Owned']);
  assert.deepEqual((await j(await call(DB, BOSS, '/rep/api/accounts?archived=1'))).body.accounts.map((a) => a.business), ['Rep Owned']);
  assert.equal((await call(DB, A, `/rep/api/accounts/${mine.id}`, { method: 'PATCH', body: { archived: false } })).status, 200);
  const fx = (await j(await call(DB, BOSS, '/rep/api/leads/facets'))).body;
  assert.equal(fx.total, 4); assert.equal(fx.pool, 3);
  assert.equal(fx.niche.find((r) => r.key === 'Generator dealer').n, 2);
  const names = async (q) => (await j(await call(DB, BOSS, '/rep/api/accounts?' + q))).body.accounts.map((a) => a.business).sort();
  assert.deepEqual(await names('pool=1'), ['Gen One', 'Gen Two', 'No Cat']);
  assert.deepEqual(await names('niche=' + encodeURIComponent('Generator dealer') + '&state=TN'), ['Gen One']);
  assert.deepEqual(await names('niche=(none)'), ['No Cat']);
  assert.deepEqual((await j(await call(DB, A, '/rep/api/accounts?pool=1'))).body.accounts.map((a) => a.business), ['Rep Owned']); // pool is ignored for reps
  // bulk: all or nothing, then category and archive
  assert.equal((await call(DB, BOSS, '/rep/api/bulk', { method: 'POST', body: { accountIds: [p3.id, 'nope'], niche: 'Remodeler' } })).status, 404);
  assert.equal(DB.db.prepare('SELECT niche FROM accounts WHERE id = ?').get(p3.id).niche, '');
  assert.equal((await call(DB, BOSS, '/rep/api/bulk', { method: 'POST', body: { accountIds: [p3.id] } })).status, 400);
  assert.equal((await j(await call(DB, BOSS, '/rep/api/bulk', { method: 'POST', body: { accountIds: [p3.id, p1.id], niche: 'Remodeler' } }))).body.updated, 2);
  assert.deepEqual(await names('niche=Remodeler'), ['Gen One', 'No Cat', 'Rep Owned']);
  await call(DB, BOSS, '/rep/api/bulk', { method: 'POST', body: { accountIds: [p2.id], archived: true } });
  assert.equal((await j(await call(DB, BOSS, '/rep/api/leads/facets'))).body.total, 3);
  assert.equal(DB.db.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'bulk'").get().n, 5); // 3 admin writes + 2 rep category writes; refused calls write nothing
});

test('mix slider: at every step of every pilot size, price, allowance and pay are unchanged, and the mix round-trips through D1', async () => {
  const DB = setup(), { pilotSplit } = await import('../src/rep/content.js'), { mixSteps } = await import('../src/rep/mix.js');
  let closes = 0;
  for (const price of [49900, 89900, 120000]) {
    const steps = (await j(await call(DB, A, '/rep/api/mix?priceCents=' + price))).body;
    assert.equal(steps.allowanceCents, pilotSplit(price).allowanceCents);
    assert.deepEqual(steps.steps, mixSteps(steps.allowanceCents).steps); // the route is the module, not a second copy
    // Baseline: closed with no slider touch. Everything the slider must not move is read back from this one.
    const base = await newAccount(DB, A, { business: 'Base ' + price });
    const b = await j(await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: base.id, level: 1, priceCents: price } }));
    assert.equal(b.status, 200);
    const baseRow = DB.db.prepare('SELECT price_cents, price_is_draft, level FROM deals WHERE id = ?').get(b.body.id);
    const baseMix = JSON.parse(DB.db.prepare('SELECT mix FROM deals WHERE id = ?').get(b.body.id).mix);
    assert.equal(baseMix.position, steps.defaultPosition); // untouched slider saves the default
    if (price === 49900) assert.deepEqual([baseMix.minutes, baseMix.texts, baseMix.threads], [300, 3000, 1000]);
    if (price === 89900) assert.deepEqual([baseMix.minutes, baseMix.texts, baseMix.threads], [600, 6000, 2000]);
    const baseline = (await j(await call(DB, A, '/rep/api/deals'))).body.deals.find((x) => x.id === b.body.id);
    for (const s of steps.steps) {
      const acc = await newAccount(DB, A, { business: `Mix ${price} p${s.p}` });
      const r = await j(await call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: acc.id, level: 1, priceCents: price, mixPosition: s.p } }));
      assert.equal(r.status, 200, `p${s.p}`); closes++;
      const row = DB.db.prepare('SELECT price_cents, price_is_draft, level, mix FROM deals WHERE id = ?').get(r.body.id);
      assert.deepEqual({ ...row, mix: undefined }, { ...baseRow, mix: undefined }); // price and flags equal the baseline
      assert.deepEqual(JSON.parse(row.mix), { position: s.p, minutes: s.minutes, texts: s.texts, threads: s.threads, plan: steps.plan }); // round trip
      const au = JSON.parse(DB.db.prepare("SELECT after FROM audit WHERE action = 'create' AND entity = 'deal' AND entity_id = ?").get(r.body.id).after);
      assert.deepEqual(au.mix, JSON.parse(row.mix)); assert.equal(au.price_cents, price); // the audit trail carries the mix
    }
    const list = (await j(await call(DB, A, '/rep/api/deals'))).body.deals;
    for (const d of list.filter((x) => x.price_cents === price)) {
      assert.equal(d.allowanceCents, baseline.allowanceCents); assert.equal(d.eachCents, baseline.eachCents); // allowance and pay never move
      assert.ok(d.mix && Number.isInteger(d.mix.minutes));
    }
  }
  assert.ok(closes > 200, 'swept ' + closes + ' closes');
});

test('mix slider: bad positions are refused and leave nothing behind; level 2 takes no mix; /mix guards the price', async () => {
  const DB = setup(), a = await newAccount(DB, A), post = (body) => call(DB, A, '/rep/api/deals', { method: 'POST', body: { accountId: a.id, ...body } });
  const m = (await j(await call(DB, A, '/rep/api/mix?priceCents=49900'))).body;
  for (const bad of [m.lo - 1, m.hi + 1, -1, 101, 50.5, '51', true]) assert.equal((await post({ level: 1, mixPosition: bad })).status, 400, String(bad));
  assert.equal((await post({ level: 2, priceCents: 50000, mixPosition: 51 })).status, 403); // a rep still cannot close Level 2
  assert.equal((await call(DB, BOSS, '/rep/api/deals', { method: 'POST', env: { REP_ADMIN_EMAIL: BOSS }, body: { accountId: a.id, level: 2, priceCents: 50000, mixPosition: 51 } })).status, 400);
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM deals').get().n, 0);
  assert.equal(DB.db.prepare('SELECT stage FROM accounts WHERE id = ?').get(a.id).stage, 'new');
  for (const q of ['', '?priceCents=49899', '?priceCents=500001', '?priceCents=abc', '?priceCents=79900.5']) assert.equal((await call(DB, A, '/rep/api/mix' + q)).status, 400, q);
  assert.equal((await call(DB, 'nobody@example.test', '/rep/api/mix?priceCents=49900')).status, 403); // same sign-in rules as every route
  assert.equal((await post({ level: 1, priceCents: 49900, mixPosition: m.lo })).status, 200);
  const d = DB.db.prepare('SELECT mix FROM deals').get(); assert.equal(JSON.parse(d.mix).minutes, 0); // the all-texts end saves with no minutes
  assert.equal([m.lo, m.hi].join(), '0,100');
});

test('rep isolation: a rep never sees another rep by id, by ?owner=, by admin route, or in the history of a handed-over lead', async () => {
  const DB = setup(), env = { REP_ADMIN_EMAIL: BOSS };
  await call(DB, BOSS, '/rep/api/me', { env }); // bootstrap the admin
  const api = (who, p, o = {}) => call(DB, who, '/rep/api' + p, { ...o, env });
  const a = await newAccount(DB, A);
  await j(await api(A, `/accounts/${a.id}/notes`, { method: 'POST', body: { body: 'first touch' } }));
  await j(await api(A, '/calls', { method: 'POST', body: { accountId: a.id, outcome: 'no_answer' } }));
  const task = (await j(await api(A, '/tasks', { method: 'POST', body: { accountId: a.id, title: 'Ring back', dueAt: new Date(Date.now() + 864e5).toISOString() } }))).body.id;
  const contact = (await j(await api(A, `/accounts/${a.id}/contacts`, { method: 'POST', body: { name: 'Owner Ann' } }))).body.id;

  // B probing A's rows by id: 404, never 403, and nothing changes.
  for (const [m, p, body] of [['GET', `/accounts/${a.id}`], ['PATCH', `/accounts/${a.id}`, { notes: 'x' }], ['POST', `/accounts/${a.id}/notes`, { body: 'x' }],
    ['POST', `/accounts/${a.id}/contacts`, { name: 'x' }], ['DELETE', `/contacts/${contact}`], ['PATCH', `/tasks/${task}`, { status: 'done' }],
    ['POST', '/calls', { accountId: a.id, outcome: 'no_answer' }], ['POST', '/deals', { accountId: a.id, level: 1 }], ['POST', '/tasks', { accountId: a.id, title: 'x', dueAt: new Date(Date.now() + 864e5).toISOString() }]])
    assert.equal((await api(B, p, { method: m, body })).status, 404, `${m} ${p}`);
  // B's lists are empty, and ?owner= means nothing to a rep.
  for (const p of ['/accounts', `/accounts?owner=${A}`, `/tasks?owner=${A}`, `/deals?owner=${A}`, `/today?owner=${A}`, `/queue?owner=${A}`]) {
    const r = await j(await api(B, p)); assert.equal(r.status, 200, p); assert.doesNotMatch(JSON.stringify(r.body), /Ridge Roofing|Ring back|rep-a@/, p);
  }
  assert.doesNotMatch(await (await api(B, `/export.csv?owner=${A}`)).text(), /Ridge Roofing|rep-a@/);
  // Admin-only routes refuse a rep outright, so no rep list, counts or pay reach one.
  for (const [m, p, body] of [['GET', '/reps'], ['POST', '/assign', { accountIds: [a.id], owner: B }], ['POST', '/bulk', { accountIds: [a.id], archived: true }]])
    assert.equal((await api(B, p, { method: m, body })).status, 403, `${m} ${p}`);
  // Facets are rep-scoped, not admin-only: B sees counts over B's own rows, none of A's.
  assert.doesNotMatch(JSON.stringify((await j(await api(B, '/leads/facets'))).body), /Ridge|rep-a@/);
  assert.equal((await api(A, `/accounts/${a.id}`)).status, 200); // and none of that touched A
  assert.equal((await j(await api(A, `/accounts/${a.id}`))).body.tasks.some((t) => t.id === task), true);

  // The boss hands the lead to B. B gets the lead, but not A's email or name anywhere in its history.
  assert.equal((await api(BOSS, '/assign', { method: 'POST', body: { accountIds: [a.id], owner: B } })).status, 200);
  await api(BOSS, '/assign', { method: 'POST', body: { accountIds: [a.id], owner: A } });
  await api(BOSS, '/assign', { method: 'POST', body: { accountIds: [a.id], owner: B } });
  const d = await j(await api(B, `/accounts/${a.id}`));
  assert.equal(d.status, 200); assert.ok(d.body.activities.length >= 3 && d.body.calls.length === 1);
  const seen = JSON.stringify(d.body);
  assert.doesNotMatch(seen, /rep-a@example\.test|boss@example\.test|Rep A/i);
  assert.match(seen, /Assigned to you/); // B's own hand-over still reads
  // The admin still sees who did what.
  assert.match(JSON.stringify((await j(await api(BOSS, `/accounts/${a.id}`))).body), /rep-a@example\.test/);
});
