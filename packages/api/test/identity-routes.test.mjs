// 0020 routes: clearing a name hold and renaming an opted-out contact. Both need a written reason, are audited, and the
// database re-checks the role (admin or operator), so a reviewer is refused even if the route's action check were loosened.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

async function optedOutAndHeld(tag) {
  const ws = api.demo.workspaces[0];
  const [a] = await api.q(`INSERT INTO contacts (org_id, workspace_id, name, linkedin_slug) VALUES ($1, $2, $3, $4) RETURNING id`,
    [api.demo.org, ws, `Jane Doe${tag}`, `in/jane-doe-${tag}`]);
  await api.q(`SELECT _suppress_person($1, $2, 'manual', true)`, [a.id, api.demo.org]);
  const [b] = await api.q(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, $3, $4, 'valid') RETURNING id, hold_reason`,
    [api.demo.org, ws, `jane  doe${tag}`, `jd-${tag}@else.example`]);
  return { a: a.id, b: b.id, held: b.hold_reason };
}

test('clear-hold: reason of 10+ characters, operator or admin only, audited; the contact is then sendable', async () => {
  const { b, held } = await optedOutAndHeld('x1');
  assert.match(held, /^name_match:seed:/);
  const url = `${api.W}/contacts/${b}/clear-hold`;
  assert.equal((await api.call('POST', url, { as: 'sam@example.com', body: { reason: 'short' } })).status, 400);
  assert.equal((await api.call('POST', url, { as: 'riley@example.com', body: { reason: 'Verified a different person by phone' } })).status, 403);
  assert.equal((await api.call('POST', url, { as: 'sam@example.com', body: { reason: 'Verified a different person by phone' } })).status, 204);
  assert.equal((await api.q(`SELECT person_suppressed($1) AS s`, [b]))[0].s, false);
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'clear_hold' AND entity_id = $1`, [b]))[0].n, 1);
  // Clearing twice is refused: there is no active hold left.
  assert.notEqual((await api.call('POST', url, { as: 'sam@example.com', body: { reason: 'Verified a different person by phone' } })).status, 204);
});

test('rename: an opted-out contact cannot be renamed by a plain update, only through the audited route', async () => {
  const { a } = await optedOutAndHeld('x2');
  await api.q(`SELECT set_config('app.org_id', $1, false), set_config('app.workspace_ids', $2, false)`, [api.demo.org, api.demo.workspaces[0]]);
  await api.db.exec('SET ROLE app_rw');
  const direct = await api.db.query(`UPDATE contacts SET name = 'Someone Else' WHERE id = $1`, [a]).then(() => null, (e) => e.message);
  await api.db.exec('RESET ROLE');
  assert.match(direct ?? '', /opted out/);
  const url = `${api.W}/contacts/${a}/rename`;
  assert.equal((await api.call('POST', url, { as: 'riley@example.com', body: { name: 'Jane Q Doe', reason: 'Fixing a typo in the surname' } })).status, 403);
  assert.equal((await api.call('POST', url, { as: 'maya@example.com', body: { name: 'Jane Q Doe', reason: 'Fixing a typo in the surname' } })).status, 204);
  assert.equal((await api.q(`SELECT name FROM contacts WHERE id = $1`, [a]))[0].name, 'Jane Q Doe');
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'rename_opted_out' AND entity_id = $1`, [a]))[0].n, 1);
});
