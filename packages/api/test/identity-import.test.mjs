// 0020: the contacts import takes an optional profile link and says which saved rows are held, without failing the batch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

const imp = (contacts) => api.call('POST', `${api.W}/contacts`, { body: { contacts } });

test('import: a profile link is stored canonical; company pages and bad links are refused with the row index', async () => {
  const ok = await imp([{ name: 'Una Vale', email: 'una@imp.example', linkedinUrl: 'https://www.linkedin.com/in/Una-Vale/' }]);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await api.q(`SELECT linkedin_slug FROM contacts WHERE id = $1`, [ok.body.created[0].id]))[0].linkedin_slug, 'in/una-vale');
  for (const url of ['https://www.linkedin.com/company/acme', 'https://evil.example/in/una', 'not a url']) {
    const bad = await imp([{ name: 'X', email: `bad${Math.abs(url.length)}@imp.example`, linkedinUrl: url }]);
    assert.deepEqual([bad.status, bad.body.details?.field], [400, 'contacts.0.linkedinUrl'], url);
  }
});

test('import: a row that matches an opted-out person is refused, not stored, and reported under held; the rest of the batch goes on', async () => {
  const ws = api.demo.workspaces[0];
  const [a] = await api.q(`INSERT INTO contacts (org_id, workspace_id, name, linkedin_slug) VALUES ($1, $2, 'Wen Xu', 'in/wen-xu') RETURNING id`, [api.demo.org, ws]);
  await api.q(`SELECT _suppress_person($1, $2, 'manual', true)`, [a.id, api.demo.org]);
  const r = await imp([
    { name: 'Fine Person', email: 'fine@imp.example' },
    { name: 'wen  XU', email: 'wen@imp.example' },                                                        // same name, no profile
    { name: 'Not Wen', email: 'wen2@imp.example', linkedinUrl: 'https://linkedin.com/in/wen-xu' },       // shares the profile
    { name: 'Wen Xu', email: 'wen3@imp.example', linkedinUrl: 'https://linkedin.com/in/made-up-link' },  // made-up link, same name
  ]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.created.map((c) => c.index), [0]);
  assert.deepEqual(r.body.held.map((h) => h.index), [1, 2, 3]);
  const stored = await api.q(`SELECT email FROM contacts WHERE email LIKE '%@imp.example' AND email IN ('fine@imp.example','wen@imp.example','wen2@imp.example','wen3@imp.example') ORDER BY email`);
  assert.deepEqual(stored.map((x) => x.email), ['fine@imp.example'], 'a held row is never stored, sendable or not');
});

test('import: a duplicate address that carries the opted-out profile keeps the link and is suppressed (ADV P2-2)', async () => {
  const ws = api.demo.workspaces[0];
  const [p] = await api.q(`INSERT INTO contacts (org_id, workspace_id, name, linkedin_slug) VALUES ($1, $2, 'Zed Moon', 'in/zed-moon') RETURNING id`, [api.demo.org, ws]);
  await api.q(`SELECT _suppress_person($1, $2, 'manual', true)`, [p.id, api.demo.org]);
  const [e] = await api.q(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'Z M', 'zed@imp.example', 'unknown') RETURNING id`, [api.demo.org, ws]);
  assert.equal((await api.q(`SELECT person_suppressed($1) AS s`, [e.id]))[0].s, false, 'unlinked before the import');
  const r = await imp([{ name: 'Z M', email: 'zed@imp.example', linkedinUrl: 'https://www.linkedin.com/in/zed-moon' }]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.skipped.map((x) => x.index), [0]);
  assert.deepEqual(r.body.held.map((x) => x.index), [0]);
  assert.equal((await api.q(`SELECT person_suppressed($1) AS s`, [e.id]))[0].s, true, 'the profile link joined it to the person');
});
