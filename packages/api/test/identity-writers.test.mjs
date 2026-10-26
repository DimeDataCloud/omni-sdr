// 0020 design test 25: every opt-out writer reaches the whole person, and each call is pinned in the source so removing
// it turns a test red. The reply, model and form paths also keep their existing address tests (inbox.test, hooks.test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApi } from './helpers.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

const suppressed = async (id, channel = 'email') => (await api.q(`SELECT person_suppressed($1, $2) AS s`, [id, channel]))[0].s;
const twinOnProfile = async (slug, email) => (await api.q(
  `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, linkedin_slug) VALUES ($1, $2, 'Twin Person', $3, 'unknown', $4) RETURNING id`,
  [api.demo.org, api.demo.workspaces[0], email, slug]))[0].id;

test('paste: a LinkedIn opt-out with only a profile closes the person, and a later email on the same profile is refused', async () => {
  const r = await api.call('POST', `${api.W}/conversations/paste`, { as: 'sam@example.com',
    body: { name: 'Quinn Reyes', profileUrl: 'https://www.linkedin.com/in/quinn-reyes', body: 'Please remove me from your list.' } });
  assert.equal(r.body.intent, 'unsubscribe');
  const [{ contact_id: contact }] = await api.q(`SELECT contact_id FROM inbound_messages WHERE id = $1`, [r.body.id]);
  assert.equal(await suppressed(contact), true);
  const twin = await twinOnProfile('in/quinn-reyes', 'quinn@work.example');
  assert.equal(await suppressed(twin), true, 'same profile, another address');
  // The same name arriving later with an address and no profile is held, not silently sendable.
  const [late] = await api.q(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'quinn  REYES', 'qr@else.example', 'unknown') RETURNING id`,
    [api.demo.org, api.demo.workspaces[0]]);
  assert.equal(await suppressed(late.id), true);
});

test('form hook: an opt-out reaches an identity-linked twin; the hook created a contact to key it on', async () => {
  const hook = (await api.call('POST', `${api.W}/hooks`, { body: { name: 'Writers form' } })).body;
  const res = await api.call('POST', `/v1/hooks/${hook.id}`, { as: null, token: hook.token,
    body: { message: 'Please stop contacting me. Remove me from your list.', email: 'formgone@lead.example', name: 'Fern Fowler', externalId: 'writers-1' } });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  const [c] = await api.q(`SELECT id FROM contacts WHERE email = 'formgone@lead.example'`);
  assert.equal(await suppressed(c.id), true);
  // Link a second contact to the same address identity, as an import into another workspace would.
  const [ws2] = await api.q(`INSERT INTO workspaces (org_id, name) VALUES ($1, 'writers-second') RETURNING id`, [api.demo.org]);
  const [twin] = await api.q(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'Fern F', 'formgone@lead.example', 'unknown') RETURNING id`, [api.demo.org, ws2.id]);
  assert.equal(await suppressed(twin.id), true);
});

test('manual suppression route: no call to the new function, so trigger A alone carries the person', async () => {
  const [a] = await api.q(`INSERT INTO contacts (org_id, workspace_id, name, email, email_status, linkedin_slug) VALUES ($1, $2, 'Manual One', 'manual1@lead.example', 'unknown', 'in/manual-one') RETURNING id`,
    [api.demo.org, api.demo.workspaces[0]]);
  const twin = await twinOnProfile('in/manual-one', 'manual1-work@lead.example');
  assert.equal(await suppressed(twin), false);
  const r = await api.call('POST', `${api.W}/suppression`, { body: { email: 'manual1@lead.example' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await suppressed(a.id), true);
  assert.equal(await suppressed(twin), true, 'the profile twin followed');
});

test('each opt-out writer calls the person-level function; the bounce path does not spread', () => {
  const inbox = readFileSync(new URL('../src/services/inbox.mjs', import.meta.url), 'utf8');
  for (const reason of ['reply_unsubscribe', 'reply_unsubscribe_model', 'form_unsubscribe', 'linkedin_unsubscribe']) {
    assert.ok(inbox.includes(`suppress_person($1, '${reason}')`), reason);
  }
  assert.ok(/record_identity\(\$1, \$2, 'paste'\)/.test(inbox));
  const at = inbox.indexOf("VALUES ($1, value_hash($2), 'email', 'bounce')");
  assert.ok(at > 0);
  assert.equal(inbox.slice(at - 120, at + 300).includes('suppress_person'), false, 'a bounce is a plain row, not a person-level opt-out');
  const ops = readFileSync(new URL('../src/routes/ops.mjs', import.meta.url), 'utf8');
  assert.equal(ops.slice(ops.indexOf('/suppression`'), ops.indexOf('/suppression`') + 600).includes('suppress_person'), false, 'the manual route stays a plain insert');
});
