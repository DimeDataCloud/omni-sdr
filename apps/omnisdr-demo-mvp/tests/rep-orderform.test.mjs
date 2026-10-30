// Guided deal flow: Order Forms (numbering, prefill, the package priced from config, required fields, filing, the invoice
// hand-off) and the client fill-in link (token, expiry, revoke, honeypot, allow-list, rate limits). Same D1 stand-in as
// rep-api.test.mjs, over node:sqlite with every migration. Fake data only (.example and .test addresses).
// Run: node --test tests/rep-orderform.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

register('./text-loader.mjs', import.meta.url);
const { handleRep } = await import('../src/rep/index.js');
const { handleClient, LIMITS } = await import('../src/rep/client.js');
const O = await import('../src/rep/orderform.js');
const M = await import('../src/rep/mix.js');

function d1() {
  const db = new DatabaseSync(':memory:'), dir = new URL('../migrations/rep/', import.meta.url);
  db.exec('PRAGMA foreign_keys = ON;' + readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => (db.prepare(sql).run(...args), { success: true }),
    _exec: () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec('BEGIN'); try { const out = list.map((s) => s._exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

const A = 'rep-a@example.test', B = 'rep-b@example.test', BOSS = 'boss@example.test';
function setup() {
  const DB = d1(), t = new Date().toISOString();
  for (const [e, n, r] of [[A, 'Rep A', 'rep'], [B, 'Rep B', 'rep'], [BOSS, 'Boss', 'admin']]) DB.db.prepare('INSERT INTO reps (email, name, role, active, created_at) VALUES (?, ?, ?, 1, ?)').run(e, n, r, t);
  return DB;
}
const HOST = 'http://localhost:8787';
const call = (DB, email, path, { method = 'GET', body, headers = {} } = {}) =>
  handleRep(new Request(HOST + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-rep': '1' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), { REP_DB: DB, REP_DEV_EMAIL: email });
const pub = (DB, path, { method = 'GET', body, headers = {}, ip = '203.0.113.7' } = {}) =>
  handleClient(new Request(HOST + path, { method, headers: { 'cf-connecting-ip': ip, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), { REP_DB: DB });
const j = async (r) => ({ status: r.status, body: await r.json() });
const api = async (DB, who, path, opts) => j(await call(DB, who, '/rep/api' + path, opts));

// A fake account like the Pilot sample (Sample Dental LLC, NJ), owned by `who`.
async function account(DB, who) {
  const r = await api(DB, who, '/accounts', { method: 'POST', body: { business: 'Sample Dental LLC', phone: '555-010-0100', email: 'billing@sampledental.example', address: '100 Example Street', city: 'Newark', state: 'NJ', zip: '07102', contact: { name: 'Pat Sample' } } });
  return r.body.account;
}
const FILLED = {
  client: { legalName: 'Sample Dental LLC', address: '100 Example Street', city: 'Newark', state: 'NJ', zip: '07102', signerName: 'Pat Sample', signerTitle: 'Owner', billingEmail: 'billing@sampledental.example' },
  term: { paymentMethod: 'card', initialTerm: 'The Pilot Period', renewal: 'Month to month' },
  signing: { signedAt: '2026-10-29', filedLocation: 'Joe folder, OmniSDR-Records' },
};

test('Order Form numbers run in order with no gaps, a draft resumes, and a voided number is never reused', async () => {
  const DB = setup(), a1 = await account(DB, A), a2 = await account(DB, A);
  const f1 = (await api(DB, A, `/accounts/${a1.id}/order-forms`, { method: 'POST' })).body;
  assert.equal(f1.form.label, 'OF-0001'); assert.equal(f1.resumed, false);
  assert.equal((await api(DB, A, `/accounts/${a1.id}/order-forms`, { method: 'POST' })).body.form.id, f1.form.id); // resumes
  assert.equal((await api(DB, A, `/accounts/${a2.id}/order-forms`, { method: 'POST' })).body.form.label, 'OF-0002');
  assert.equal((await api(DB, A, `/order-forms/${f1.form.id}/void`, { method: 'POST' })).body.form.status, 'void');
  assert.equal((await api(DB, A, `/accounts/${a1.id}/order-forms`, { method: 'POST' })).body.form.label, 'OF-0003');
  assert.deepEqual(DB.db.prepare('SELECT number FROM order_forms ORDER BY number').all().map((r) => r.number), [1, 2, 3]);
});

test('a new Order Form starts from what the account already holds', async () => {
  const DB = setup(), a = await account(DB, A), d = (await api(DB, A, `/accounts/${a.id}/order-forms`, { method: 'POST' })).body.form.data;
  assert.equal(d.client.legalName, 'Sample Dental LLC'); assert.equal(d.client.billingEmail, 'billing@sampledental.example');
  assert.equal(d.client.state, 'NJ'); assert.equal(d.client.signerName, 'Pat Sample'); assert.equal(d.services.numbers, '555-010-0100');
  assert.equal(d.package.plan, 'Pilot'); assert.equal(d.package.priceCents, 49900);
});

test('the package is priced from config: a rep quotes the Pilot only and never a discount; an admin may do both', async () => {
  const DB = setup(), a = await account(DB, A), id = (await api(DB, A, `/accounts/${a.id}/order-forms`, { method: 'POST' })).body.form.id;
  const pkg = (who, p) => api(DB, who, `/order-forms/${id}`, { method: 'PATCH', body: { package: p } });
  const pilot = await pkg(A, { plan: 'Pilot', priceCents: 49900 });
  assert.equal(pilot.status, 200); assert.equal(pilot.body.form.data.package.allowanceCents, 17500);
  assert.deepEqual([pilot.body.form.data.package.minutes, pilot.body.form.data.package.texts, pilot.body.form.data.package.threads], [300, 3000, 1000]);
  assert.equal((await pkg(A, { plan: 'Pilot', priceCents: 49900, mixPosition: 100 })).body.form.data.package.minutes, 580);
  assert.equal((await pkg(A, { plan: 'Pilot', priceCents: 49800 })).status, 400);
  assert.equal((await pkg(A, { plan: 'Pilot', priceCents: 49900, mixPosition: 101 })).status, 400);
  // Refused for a rep, allowed for an admin.
  assert.equal((await pkg(A, { plan: 'Standard', priceCents: 49900 })).status, 403);
  assert.equal((await pkg(A, { plan: 'Pilot', priceCents: 49900, discount: '10% off' })).status, 403);
  assert.equal((await pkg(A, { plan: 'Agency', priceCents: 99900 })).status, 403);
  const std = await pkg(BOSS, { plan: 'Standard', priceCents: 49900, mixPosition: 100 });
  assert.equal(std.status, 200); assert.deepEqual([std.body.form.data.package.minutes, std.body.form.data.package.texts], [580, 0]);
  assert.equal((await pkg(BOSS, { plan: 'Pilot', priceCents: 49900, buildFee: 'none' })).status, 200);
});

test('a rep reaches only their own Order Forms; an admin reaches all', async () => {
  const DB = setup(), a = await account(DB, A), id = (await api(DB, A, `/accounts/${a.id}/order-forms`, { method: 'POST' })).body.form.id;
  for (const [path, method, body] of [[`/order-forms/${id}`, 'GET'], [`/order-forms/${id}`, 'PATCH', { client: { legalName: 'X' } }], [`/order-forms/${id}/link`, 'POST'], [`/order-forms/${id}/file`, 'POST'], [`/accounts/${a.id}/order-forms`, 'POST']])
    assert.equal((await call(DB, B, '/rep/api' + path, { method, body })).status, 404, `${method} ${path}`);
  assert.equal((await api(DB, BOSS, `/order-forms/${id}`)).status, 200);
});

test('filing needs every required field, Agency is ACH only, and a filed form is locked and feeds omni-invoice', async () => {
  const DB = setup(), a = await account(DB, A), id = (await api(DB, A, `/accounts/${a.id}/order-forms`, { method: 'POST' })).body.form.id;
  const early = await api(DB, A, `/order-forms/${id}/file`, { method: 'POST' });
  assert.equal(early.status, 422); assert.ok(early.body.missing.includes('Payment method')); assert.ok(early.body.missing.includes('Signing date'));
  assert.equal((await api(DB, A, `/order-forms/${id}/invoice.json`)).status, 409);
  assert.equal((await api(DB, A, `/order-forms/${id}`, { method: 'PATCH', body: { client: { ...FILLED.client, state: 'New Jersey' } } })).status, 400); // two letters
  assert.equal((await api(DB, A, `/order-forms/${id}`, { method: 'PATCH', body: FILLED })).status, 200);
  // An admin's Agency form with card is still missing its ACH.
  const agency = await api(DB, BOSS, `/order-forms/${id}`, { method: 'PATCH', body: { package: { plan: 'Agency', priceCents: 99900 } } });
  assert.ok(agency.body.missing.some((m) => /ACH only/.test(m)));
  await api(DB, BOSS, `/order-forms/${id}`, { method: 'PATCH', body: { package: { plan: 'Pilot', priceCents: 49900 } } });
  const filed = await api(DB, A, `/order-forms/${id}/file`, { method: 'POST' });
  assert.equal(filed.status, 200); assert.equal(filed.body.form.status, 'filed');
  assert.equal((await api(DB, A, `/order-forms/${id}`, { method: 'PATCH', body: { client: { legalName: 'Changed' } } })).status, 409);
  const rec = await call(DB, A, `/rep/api/order-forms/${id}/invoice.json`);
  assert.match(rec.headers.get('content-disposition'), /OF-0001-for-invoicing\.json/);
  const r = await rec.json();
  assert.deepEqual({ ...r }, { clientName: 'Sample Dental LLC', customerEmail: 'billing@sampledental.example', plan: 'Pilot', orderFormDate: '2026-10-29', isSigned: true,
    state: 'NJ', paymentMethod: 'card', orderFormNumber: 'OF-0001', addressLine1: '100 Example Street', city: 'Newark', postalCode: '07102',
    voiceMinutes: 300, texts: 3000, aiThreads: 1000, usageMix: 'default', term: 'The Pilot Period, Month to month', memo: '' });
  // Off the slider's default, the export says adjusted, so omni-invoice reads the mix as the form's own numbers.
  const pk = O.cleanPackage({ plan: 'Pilot', priceCents: 75000 }, false), other = M.mixSteps(pk.allowanceCents).steps.find((x) => x.p !== pk.mixPosition).p;
  assert.equal(O.invoiceRecord({ number: 2, data: { package: pk } }).usageMix, 'default');
  assert.equal(O.invoiceRecord({ number: 2, data: { package: O.cleanPackage({ plan: 'Pilot', priceCents: 75000, mixPosition: other }, false) } }).usageMix, 'adjusted');
  // A filed form is an admin's to void.
  assert.equal((await api(DB, A, `/order-forms/${id}/void`, { method: 'POST' })).status, 403);
  assert.equal((await api(DB, BOSS, `/order-forms/${id}/void`, { method: 'POST' })).body.form.status, 'void');
});

async function linked(DB) {
  const a = await account(DB, A), id = (await api(DB, A, `/accounts/${a.id}/order-forms`, { method: 'POST' })).body.form.id;
  const l = await api(DB, A, `/order-forms/${id}/link`, { method: 'POST' });
  assert.equal(l.status, 200); assert.match(l.body.url, /^http:\/\/localhost:8787\/of\/[A-Za-z0-9_-]{43}$/);
  return { a, id, token: l.body.url.split('/of/')[1] };
}

test('the client link shows one Order Form and nothing else, and keeps no token in the database', async () => {
  const DB = setup(), { id, token } = await linked(DB);
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM client_links WHERE token_hash = ?').get(token).n, 0); // only the hash is stored
  const page = await pub(DB, '/of/' + token);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  for (const h of ['cache-control', 'x-robots-tag', 'referrer-policy']) assert.ok(page.headers.get(h), h);
  assert.match(await page.text(), /omnisdr\.com\/privacy/);
  const r = await j(await pub(DB, '/of/api/' + token));
  assert.equal(r.status, 200); assert.equal(r.body.number, 'OF-0001');
  const mix = O.cleanPackage({ plan: 'Pilot' }, false);
  assert.deepEqual(r.body.package, { plan: 'Pilot', priceCents: 49900, minutes: mix.minutes, texts: mix.texts, threads: mix.threads });
  assert.ok(mix.minutes > 0 && mix.texts > 0);
  const text = JSON.stringify(r.body);
  for (const secret of [A, 'Rep A', 'owner_email', 'allowanceCents', 'notes', id]) assert.ok(!text.includes(secret), `leaks ${secret}`);
  assert.equal(r.body.values.client.legalName, 'Sample Dental LLC');
});

test('a wrong, malformed, expired or turned-off link reads as not found', async () => {
  const DB = setup(), { id, token } = await linked(DB);
  for (const bad of ['/of/api/' + 'A'.repeat(43), '/of/api/short', '/of/api/../../rep', '/of/' + 'x'.repeat(10)]) assert.equal((await pub(DB, bad)).status, 404, bad);
  DB.db.prepare('UPDATE client_links SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
  assert.equal((await pub(DB, '/of/api/' + token)).status, 404);
  const fresh = (await api(DB, A, `/order-forms/${id}/link`, { method: 'POST' })).body.url.split('/of/')[1];
  assert.equal((await pub(DB, '/of/api/' + fresh)).status, 200);
  const newer = (await api(DB, A, `/order-forms/${id}/link`, { method: 'POST' })).body.url.split('/of/')[1];
  assert.equal((await pub(DB, '/of/api/' + fresh)).status, 404); // a new link replaces the old
  assert.equal((await api(DB, A, `/order-forms/${id}/link`, { method: 'DELETE' })).status, 200);
  assert.equal((await pub(DB, '/of/api/' + newer)).status, 404);
});

test('client answers: allow-listed, honeypot dropped, held for the rep, then accepted into the form and onboarding', async () => {
  const DB = setup(), { a, id, token } = await linked(DB);
  const send = (body, opts = {}) => pub(DB, '/of/api/' + token, { method: 'POST', body, ...opts });
  assert.equal((await send({ client: { legalName: 'Bot' }, website: 'http://spam.example' })).status, 200);
  assert.equal(DB.db.prepare('SELECT submitted_at FROM client_links').get().submitted_at, null); // the honeypot answer was dropped
  assert.equal((await send({ client: {} }, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await send({ client: { state: 'New Jersey' } })).status, 400);
  const ok = await send({ client: { legalName: 'Sample Dental LLC', entityType: 'Limited liability company', secret: 'x' }, term: { paymentMethod: 'card' },
    package: { plan: 'Plus', priceCents: 1 }, onboarding: { hours: 'Mon to Fri, 8 to 5', nope: 'x' } });
  assert.equal(ok.status, 200);
  let rep = (await api(DB, A, `/order-forms/${id}`)).body;
  assert.equal(rep.form.status, 'client_review'); assert.equal(rep.clientAnswers.data.client.entityType, 'Limited liability company');
  assert.equal(rep.clientAnswers.data.client.secret, undefined); assert.equal(rep.clientAnswers.data.package, undefined);
  assert.equal(rep.clientAnswers.data.onboarding.nope, undefined);
  assert.equal((await api(DB, B, `/order-forms/${id}/client`, { method: 'POST', body: { action: 'accept' } })).status, 404); // not B's
  const acc = await api(DB, A, `/order-forms/${id}/client`, { method: 'POST', body: { action: 'accept' } });
  assert.equal(acc.status, 200); assert.equal(acc.body.form.status, 'draft');
  assert.equal(acc.body.form.data.client.entityType, 'Limited liability company'); assert.equal(acc.body.form.data.package.plan, 'Pilot'); // the package never moves
  assert.equal(acc.body.form.data.term.paymentMethod, 'card');
  const ob = (await api(DB, A, `/accounts/${a.id}`)).body.account.onboarding;
  assert.equal(ob.hours, 'Mon to Fri, 8 to 5');
  rep = (await api(DB, A, `/order-forms/${id}`)).body; assert.equal(rep.clientAnswers, null);
  // A second answer can be set aside instead.
  await send({ client: { tradingName: 'Sample Smiles' } });
  assert.equal((await api(DB, A, `/order-forms/${id}/client`, { method: 'POST', body: { action: 'reject' } })).body.form.status, 'draft');
  assert.notEqual((await api(DB, A, `/order-forms/${id}`)).body.form.data.client.tradingName, 'Sample Smiles');
});

test('rate limits: per visitor per day and per link', async () => {
  const DB = setup(), { token } = await linked(DB);
  for (let i = 0; i < LIMITS.linkPosts; i++) assert.equal((await pub(DB, '/of/api/' + token, { method: 'POST', body: { client: { tradingName: 'T' + i } }, ip: '198.51.100.' + i })).status, 200);
  assert.equal((await pub(DB, '/of/api/' + token, { method: 'POST', body: { client: {} }, ip: '198.51.100.250' })).status, 429);
  DB.db.prepare('UPDATE public_hits SET n = ?').run(LIMITS.ipPerDay);
  assert.equal((await pub(DB, '/of/api/' + token, { ip: '198.51.100.1' })).status, 429);
  assert.equal((await pub(DB, '/of/api/' + token, { ip: '192.0.2.99' })).status, 200); // another visitor is not held back
});

test('a filed or voided form closes its link', async () => {
  const DB = setup(), { id, token } = await linked(DB);
  await api(DB, A, `/order-forms/${id}`, { method: 'PATCH', body: FILLED });
  assert.equal((await api(DB, A, `/order-forms/${id}/file`, { method: 'POST' })).status, 200);
  assert.equal((await pub(DB, '/of/api/' + token)).status, 404);
  assert.equal((await api(DB, A, `/order-forms/${id}/link`, { method: 'POST' })).status, 409);
});

test('stage moves to Onboarding and Live stay admin only', async () => {
  const DB = setup(), a = await account(DB, A);
  assert.equal((await api(DB, A, `/accounts/${a.id}`, { method: 'PATCH', body: { stage: 'onboarding' } })).status, 403);
  assert.equal((await api(DB, A, `/accounts/${a.id}`, { method: 'PATCH', body: { stage: 'live' } })).status, 403);
  assert.equal((await api(DB, BOSS, `/accounts/${a.id}`, { method: 'PATCH', body: { stage: 'onboarding' } })).status, 200);
});
