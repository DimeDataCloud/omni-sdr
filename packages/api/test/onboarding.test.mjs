// Level E1 (0010): the composer's onboarding, one question at a time, every one skippable (acceptance step 2).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

// A brand-new owner: nothing answered yet.
async function newOwner(tag) {
  const as = `${tag}.${Date.now()}@onboard.example`;
  const r = await api.call('POST', '/v1/orgs', { as, body: { orgName: `Onboard ${tag}`, accountType: 'owner' } });
  assert.equal(r.status, 201);
  return { as, W: `/v1/o/${r.body.orgId}/w/${r.body.workspaceId}` };
}

test('a new workspace is asked one question at a time, in order; answering moves to the next', async () => {
  const o = await newOwner('order');
  let s = (await api.call('GET', `${o.W}/onboarding`, { as: o.as })).body;
  assert.equal(s.next.key, 'website');
  assert.equal(s.next.skippable, true);
  assert.equal(s.done, false);
  assert.equal(s.missing.length, 6);
  s = (await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key: 'website', value: 'Harbor-Dental.example/home' } })).body;
  assert.equal(s.profile.website, 'https://harbor-dental.example/home', 'normalised to https, lower-case host');
  assert.equal(s.next.key, 'offer');
  s = (await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key: 'offer', value: 'We answer after-hours calls for dental offices.' } })).body;
  assert.equal(s.next.key, 'voice');
  assert.deepEqual(s.answered, ['website', 'offer']);
});

test('everything can be skipped, nothing is required, and a skipped question can be revisited', async () => {
  const o = await newOwner('skip');
  let s;
  for (const key of ['website', 'offer', 'voice', 'postal_address', 'icp', 'connections']) {
    s = (await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key, skip: true } })).body;
  }
  assert.equal(s.done, true, 'the minimum required input is nothing');
  assert.equal(s.next, null);
  assert.equal(s.skipped.length, 6);
  assert.equal(s.missing.length, 6, 'skipped is still missing: generation will say so');
  s = (await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key: 'offer', revisit: true } })).body;
  assert.equal(s.next.key, 'offer');
});

test('answers are validated; the postal address goes to the workspace (admin only); ICP and mailbox are answered on their own screens', async () => {
  const o = await newOwner('valid');
  const bad = await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key: 'website', value: 'not a site' } });
  assert.equal(bad.status, 400);
  assert.equal((await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key: 'icp', value: 'dentists' } })).status, 400);
  assert.equal((await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key: 'offer' } })).status, 400, 'one of value/skip/revisit');
  assert.equal((await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key: 'offer', value: 'x', skip: true } })).status, 400);
  const s = (await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key: 'postal_address', value: '100 Main St, Nashville TN 37201' } })).body;
  assert.ok(s.answered.includes('postal_address'));
  assert.equal((await api.call('GET', `${o.W}/settings`, { as: o.as })).body.workspace.postalAddress, '100 Main St, Nashville TN 37201');
  // An operator can answer content questions but not the admin-only address.
  assert.equal((await api.call('POST', `${api.W}/onboarding`, { as: 'sam@example.com', body: { key: 'postal_address', value: '1 Elm St, Austin TX 78701' } })).status, 403);
  assert.equal((await api.call('POST', `${api.W}/onboarding`, { as: 'sam@example.com', body: { key: 'offer', value: 'Answering service for clinics.' } })).status, 200);
  for (const who of ['riley@example.com', 'client@example.com', 'stranger@example.com']) {
    assert.equal((await api.call('GET', `${api.W}/onboarding`, { as: who })).status, 403, who);
  }
});

test('another tenant\'s profile is out of reach', async () => {
  const a = await newOwner('iso-a');
  const b = await newOwner('iso-b');
  await api.call('POST', `${a.W}/onboarding`, { as: a.as, body: { key: 'offer', value: 'Secret offer of A' } });
  assert.equal((await api.call('GET', `${a.W}/onboarding`, { as: b.as })).status, 403);
  assert.equal((await api.call('POST', `${a.W}/onboarding`, { as: b.as, body: { key: 'offer', value: 'overwritten' } })).status, 403);
  assert.equal((await api.call('GET', `${a.W}/onboarding`, { as: a.as })).body.profile.offer, 'Secret offer of A');
});

test('generation says what it was written without, and uses what it was told', async () => {
  const o = await newOwner('gen');
  const camp = (await api.call('POST', `${o.W}/campaigns`, { as: o.as, body: { name: 'First' } })).body;
  const est = (await api.call('GET', `${o.W}/campaigns/${camp.id}/generate/estimate`, { as: o.as })).body;
  assert.deepEqual(est.missingContext.map((x) => x.key), ['offer', 'website', 'voice']);
  await api.call('POST', `${o.W}/onboarding`, { as: o.as, body: { key: 'offer', value: 'We answer after-hours calls for dental offices.' } });
  const est2 = (await api.call('GET', `${o.W}/campaigns/${camp.id}/generate/estimate`, { as: o.as })).body;
  assert.deepEqual(est2.missingContext.map((x) => x.key), ['website', 'voice']);
  // A lead with a fact, then a press: the stated offer reaches the model inside the offer block.
  const c = (await api.call('POST', `${o.W}/contacts`, { as: o.as, body: { contacts: [{ name: 'Lena', email: 'lena@brightline-gen.example' }] } })).body.created[0];
  const [ws] = o.W.split('/').slice(-1);
  const [{ org_id: org }] = await api.q(`SELECT org_id FROM workspaces WHERE id = $1`, [ws]);
  await api.q(`INSERT INTO evidence (org_id, workspace_id, contact_id, type, source_uri, fetched_at, snapshot_sha, facts, expires_at)
    VALUES ($1, $2, $3, 'website', 'https://x.example/', now(), 'abc', '{"contact": {"text": "Your homepage has a contact form."}}', now() + interval '30 days')`, [org, ws, c.id]);
  await api.q(`INSERT INTO credit_balances (org_id, meter, balance) VALUES ($1, 'action', 10) ON CONFLICT (org_id, meter) DO UPDATE SET balance = 10`, [org]);
  await api.call('POST', `${o.W}/campaigns/${camp.id}/enrollments`, { as: o.as, body: { contactIds: [c.id] } });
  const before = api.model.calls.length;
  const run = await api.call('POST', `${o.W}/campaigns/${camp.id}/generate`, { as: o.as, body: { steps: 1 } });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  assert.deepEqual(run.body.missingContext.map((x) => x.key), ['website', 'voice']);
  assert.equal(api.model.calls.length, before + 1);
  assert.match(api.model.calls.at(-1).messages[0].text, /<offer>[\s\S]*We answer after-hours calls for dental offices/);
});

test('connections is answered only by a mailbox with a live credential, not a bare mailbox row (#50 audit P3)', async () => {
  const o = await newOwner('conn');
  const ws = o.W.split('/').at(-1);
  const [{ org_id: org }] = await api.q(`SELECT org_id FROM workspaces WHERE id = $1`, [ws]);
  const [mb] = await api.q(`INSERT INTO mailboxes (org_id, workspace_id, provider, address, daily_cap) VALUES ($1, $2, 'gmail', 'me@conn.example', 5) RETURNING id`, [org, ws]);
  let s = (await api.call('GET', `${o.W}/onboarding`, { as: o.as })).body;
  assert.ok(!s.answered.includes('connections'), 'a mailbox row without a credential is not connected');
  await api.q(`INSERT INTO mailbox_credentials (org_id, workspace_id, mailbox_id, provider, secret, scopes) VALUES ($1, $2, $3, 'gmail', $4, ARRAY['https://www.googleapis.com/auth/gmail.send'])`,
    [org, ws, mb.id, `v1.${'A'.repeat(16)}.${'B'.repeat(30)}`]);
  s = (await api.call('GET', `${o.W}/onboarding`, { as: o.as })).body;
  assert.ok(s.answered.includes('connections'));
  await api.q(`UPDATE mailbox_credentials SET revoked_at = now() WHERE mailbox_id = $1`, [mb.id]);
  assert.ok(!(await api.call('GET', `${o.W}/onboarding`, { as: o.as })).body.answered.includes('connections'), 'revoked is not connected');
});
