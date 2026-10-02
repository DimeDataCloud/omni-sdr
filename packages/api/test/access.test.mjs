// Who can reach what: authentication, tenant isolation, the SPEC §7 role matrix over HTTP, sign-up,
// invites, mass assignment, CORS, error hygiene.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, tokenFor } from './helpers.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

test('no token, a bad token, or an expired token is 401; health is public', async () => {
  assert.equal((await api.call('GET', '/v1/me', { as: null })).status, 401);
  assert.equal((await api.call('GET', '/v1/me', { token: 'garbage' })).status, 401);
  assert.equal((await api.call('GET', '/v1/me', { token: tokenFor('maya@example.com', { exp: Math.floor(Date.now() / 1000) - 600 }) })).status, 401);
  assert.equal((await api.call('GET', '/healthz', { as: null })).status, 200);
  assert.deepEqual((await api.call('GET', '/v1/health', { as: null })).body, { ok: true }, 'the health path run.app doesn\'t swallow');
  assert.equal((await api.call('GET', '/v1/nope')).status, 404);
  assert.equal((await api.call('DELETE', '/v1/me')).status, 405);
});

test('/v1/me lists only the caller\'s orgs and the workspaces their membership covers', async () => {
  const maya = await api.call('GET', '/v1/me');
  assert.equal(maya.status, 200);
  assert.deepEqual(maya.body.orgs.map((o) => [o.name, o.role, o.workspaces.length]), [['Northside Growth', 'admin', 3]]);
  const client = await api.call('GET', '/v1/me', { as: 'client@example.com' });
  assert.deepEqual(client.body.orgs[0].workspaces.map((w) => w.id), [api.demo.workspaces[0]]);
  const stranger = await api.call('GET', '/v1/me', { as: 'stranger@example.com' });
  assert.deepEqual(stranger.body.orgs, []);
});

test('tenant isolation over HTTP: a stranger, a foreign org, a workspace outside the membership, junk ids', async () => {
  const paths = ['approvals', 'inbox', 'agents', 'contacts', 'analytics', 'settings', 'capacity'];
  for (const p of paths) {
    assert.equal((await api.call('GET', `${api.W}/${p}`, { as: 'stranger@example.com' })).status, 403, `stranger ${p}`);
  }
  // client@ is scoped to workspace 0 only
  assert.equal((await api.call('GET', `${api.ws(1)}/analytics`, { as: 'client@example.com' })).status, 403);
  // an org id that isn't theirs, with their own workspace id
  const fake = '00000000-0000-4000-8000-000000000000';
  assert.equal((await api.call('GET', `/v1/o/${fake}/w/${api.demo.workspaces[0]}/approvals`)).status, 403);
  assert.equal((await api.call('GET', `/v1/o/not-a-uuid/w/${api.demo.workspaces[0]}/approvals`)).status, 404);
  assert.equal((await api.call('POST', `${api.W}/approvals/not-a-uuid/approve`)).status, 404);
});

test('role matrix over HTTP (SPEC §7), each cell against the real endpoint', async () => {
  const cells = [
    // [who, method, path, body, expected]
    ['riley@example.com', 'PATCH', 'settings', { name: 'x' }, 403],           // reviewer: no settings
    ['sam@example.com', 'PATCH', 'settings', { name: 'x' }, 403],             // operator: no settings
    ['client@example.com', 'GET', 'analytics', undefined, 200],               // client_viewer: reports
    ['client@example.com', 'GET', 'inbox', undefined, 403],                   // client_viewer: no inbox
    ['client@example.com', 'GET', 'contacts', undefined, 403],                // client_viewer: no leads
    ['riley@example.com', 'POST', 'agents', { name: 'x' }, 403],              // reviewer: no build
    ['riley@example.com', 'GET', 'inbox', undefined, 200],                    // reviewer: inbox read
    ['riley@example.com', 'POST', 'contacts', { contacts: [{ name: 'x' }] }, 403],
    ['sam@example.com', 'POST', 'contacts', { contacts: [{ name: 'Op Test', email: 'op@op-test.example' }] }, 201],
    ['sam@example.com', 'GET', 'members', undefined, 403],                    // operator: no members
    ['maya@example.com', 'GET', 'members', undefined, 200],
    ['sam@example.com', 'POST', 'invites', { email: 'x@y.example', role: 'admin' }, 403],
  ];
  for (const [who, method, path, body, want] of cells) {
    const r = await api.call(method, `${api.W}/${path}`, { as: who, body });
    assert.equal(r.status, want, `${who} ${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  }
});

test('client_viewer sees approvals only where the workspace toggle is on', async () => {
  assert.equal((await api.call('GET', `${api.W}/approvals`, { as: 'client@example.com' })).status, 200);   // seed: toggle on in ws 0
  await api.call('PATCH', `${api.W}/settings`, { body: { clientApprovalsEnabled: false } });
  assert.equal((await api.call('GET', `${api.W}/approvals`, { as: 'client@example.com' })).status, 403);
  await api.call('PATCH', `${api.W}/settings`, { body: { clientApprovalsEnabled: true } });
});

test('mass assignment is refused: unknown fields are 400, trust level and flags are not settable', async () => {
  for (const body of [{ trustLevel: 3 }, { trust_level: 3 }, { featureFlags: { level2: true } }, { name: 'ok', orgId: 'x' }]) {
    const r = await api.call('PATCH', `${api.W}/settings`, { body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  const agent = await api.call('POST', `${api.W}/agents`, { body: { name: 'Sneaky', orgId: api.demo.org } });
  assert.equal(agent.status, 400);
  const tl = await api.q(`SELECT trust_level FROM workspaces WHERE id = $1`, [api.demo.workspaces[0]]);
  assert.equal(tl[0].trust_level, 1);
});

test('settings: validated, admin-only, and written', async () => {
  assert.equal((await api.call('PATCH', `${api.W}/settings`, { body: { timezone: 'Mars/Olympus' } })).status, 400);
  assert.equal((await api.call('PATCH', `${api.W}/settings`, { body: { autoAdjustSources: ['draft_edits', 'telepathy'] } })).status, 400);
  assert.equal((await api.call('PATCH', `${api.W}/settings`, { body: {} })).status, 400);
  const ok = await api.call('PATCH', `${api.W}/settings`, { body: { timezone: 'America/New_York', autoAdjustSources: ['draft_edits'] } });
  assert.equal(ok.status, 200);
  const s = await api.call('GET', `${api.W}/settings`);
  assert.equal(s.body.workspace.timezone, 'America/New_York');
  assert.deepEqual(s.body.workspace.autoAdjustSources, ['draft_edits']);
  await api.call('PATCH', `${api.W}/settings`, { body: { timezone: 'America/Chicago' } });
});

test('sign-up: a new user creates an org and lands as its admin; owners get one workspace, agencies more', async () => {
  const who = 'founder@newco.example';
  const r = await api.call('POST', '/v1/orgs', { as: who, body: { orgName: 'NewCo', accountType: 'owner' } });
  assert.equal(r.status, 201);
  const me = await api.call('GET', '/v1/me', { as: who });
  assert.deepEqual(me.body.orgs.map((o) => [o.name, o.role, o.accountType]), [['NewCo', 'admin', 'owner']]);
  const extra = await api.call('POST', `/v1/o/${r.body.orgId}/workspaces`, { as: who, body: { name: 'Second' } });
  assert.equal(extra.status, 409);
  const agency = await api.call('POST', `/v1/o/${api.demo.org}/workspaces`, { body: { name: 'New client' } });
  assert.equal(agency.status, 201);
  // Someone else can't add a workspace to NewCo.
  assert.equal((await api.call('POST', `/v1/o/${r.body.orgId}/workspaces`, { body: { name: 'Hijack' } })).status, 403);
  assert.equal((await api.call('POST', '/v1/orgs', { as: who, body: { orgName: 'x', accountType: 'solo' } })).status, 400);
});

test('invites: link returned once, only the invited email can accept, single use', async () => {
  const inv = await api.call('POST', `${api.W}/invites`, { body: { email: 'newhire@example.com', role: 'operator' } });
  assert.equal(inv.status, 201);
  const token = inv.body.inviteUrl.split('/invite/')[1];
  assert.ok(token.length >= 40);
  const stored = await api.q(`SELECT token_hash FROM invites WHERE id = $1`, [inv.body.id]);
  assert.notEqual(stored[0].token_hash, token, 'only the hash is stored');
  assert.equal((await api.call('POST', '/v1/invites/accept', { as: 'someoneelse@example.com', body: { token } })).status, 403);
  assert.equal((await api.call('POST', '/v1/invites/accept', { as: 'newhire@example.com', body: { token } })).status, 200);
  assert.equal((await api.call('POST', '/v1/invites/accept', { as: 'newhire@example.com', body: { token } })).status, 403);
  const me = await api.call('GET', '/v1/me', { as: 'newhire@example.com' });
  assert.equal(me.body.orgs[0].role, 'operator');
  // Revoked invites can't be used.
  const inv2 = await api.call('POST', `${api.W}/invites`, { body: { email: 'late@example.com', role: 'reviewer' } });
  assert.equal((await api.call('DELETE', `${api.W}/invites/${inv2.body.id}`)).status, 204);
  const t2 = inv2.body.inviteUrl.split('/invite/')[1];
  assert.equal((await api.call('POST', '/v1/invites/accept', { as: 'late@example.com', body: { token: t2 } })).status, 403);
});

test('CORS: only listed origins are echoed; preflight answers them', async () => {
  const ok = await api.call('GET', '/healthz', { as: null, headers: { origin: 'https://console.example' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://console.example');
  const bad = await api.call('GET', '/healthz', { as: null, headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await api.call('OPTIONS', `${api.W}/approvals`, { as: null, headers: { origin: 'https://console.example' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
});

test('responses carry no-store and nosniff; JSON-only bodies; errors never leak SQL', async () => {
  const r = await api.call('GET', `${api.W}/approvals`);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const form = await api.call('POST', `${api.W}/agents`, { raw: 'name=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 415);
  const bad = await api.call('POST', `${api.W}/agents`, { raw: '{not json', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  // A foreign-key miss (enrolling into another workspace's campaign id) is a clean 404 with no SQL in it.
  const r2 = await api.call('POST', `${api.W}/drafts`, { body: { enrollmentId: '00000000-0000-4000-8000-000000000000', body: 'x' } });
  assert.equal(r2.status, 404);
  assert.doesNotMatch(r2.text, /INSERT|SELECT|constraint|drafts_/i);
  assert.ok(api.logs.every((l) => !/Bearer|eyJ/.test(JSON.stringify(l))), 'tokens must never be logged');
});

test('client_viewer: reports, analytics and meetings only; the team\'s working data is 403 (bug bounty #4, acceptance A3)', async () => {
  const c = { as: 'client@example.com' };
  for (const p of ['analytics', 'meetings']) assert.equal((await api.call('GET', `${api.W}/${p}`, c)).status, 200, p);
  for (const p of ['agents', 'routines', 'campaigns', 'connectors', 'capacity', 'credits']) {
    assert.equal((await api.call('GET', `${api.W}/${p}`, c)).status, 403, `client ${p}`);
  }
  const agents = (await api.call('GET', `${api.W}/agents`)).body.items;
  assert.ok(agents.length > 0, 'fixture: the demo has agents');
  assert.equal((await api.call('GET', `${api.W}/agents/${agents[0].id}/messages`, c)).status, 403, 'client agent chat');
  // The team still reads them: reviewer and operator.
  for (const who of ['riley@example.com', 'sam@example.com']) {
    for (const p of ['agents', 'routines', 'campaigns', 'connectors', 'capacity', 'credits']) {
      assert.equal((await api.call('GET', `${api.W}/${p}`, { as: who })).status, 200, `${who} ${p}`);
    }
  }
});

test('client_viewer settings: what the screens need, not the agency\'s plan, flags, Trust Dial or postal address', async () => {
  const s = (await api.call('GET', `${api.W}/settings`, { as: 'client@example.com' })).body;
  assert.deepEqual(Object.keys(s.workspace).sort(), ['clientApprovalsEnabled', 'id', 'name', 'timezone']);
  assert.deepEqual(Object.keys(s.org).sort(), ['accountType', 'id', 'name']);
  assert.equal(s.you.role, 'client_viewer');
  const admin = (await api.call('GET', `${api.W}/settings`)).body;
  for (const k of ['subscriptionStatus', 'trialEndsAt', 'featureFlags']) assert.ok(k in admin.org, `admin keeps org.${k}`);
  for (const k of ['trustLevel', 'postalAddress', 'autoAdjustEnabled']) assert.ok(k in admin.workspace, `admin keeps workspace.${k}`);
});

test('/v1/me: a client viewer doesn\'t see the agency\'s subscription status; the team does (#43 audit P3)', async () => {
  const client = (await api.call('GET', '/v1/me', { as: 'client@example.com' })).body.orgs.find((o) => o.id === api.demo.org);
  assert.equal(client.role, 'client_viewer');
  assert.ok(!('subscriptionStatus' in client));
  const admin = (await api.call('GET', '/v1/me')).body.orgs.find((o) => o.id === api.demo.org);
  assert.equal(typeof admin.subscriptionStatus, 'string');
});
