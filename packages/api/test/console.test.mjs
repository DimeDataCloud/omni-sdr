// Agents + chat, routines, capacity + holds, suppression, analytics (no opens), connectors, prospects.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { fakeModel, ModelError } from '../src/services/model.mjs';
import { sendDraft } from '../../sender/src/send.mjs';

let api;
let model;
before(async () => {
  model = fakeModel(({ messages }) => {
    if (messages.at(-1)?.text === 'fail please') throw new ModelError('boom');
    return `echo: ${messages.at(-1)?.text}`;
  });
  api = await startApi({ model });
});
after(async () => { await api.stop(); });

test('agents: list with last message, create, update, archive; build roles only', async () => {
  const list = (await api.call('GET', `${api.W}/agents`)).body.items;
  assert.equal(list.length, 6);
  assert.ok(list.find((a) => a.name === 'Chief of Staff').lastMessage.preview.startsWith('Three things'));
  const created = await api.call('POST', `${api.W}/agents`, { as: 'sam@example.com', body: {
    name: 'Talent Scout', station: 'talent_scout', badge: 'HR', modelTier: 'flash_lite', systemPrompt: 'Find recruiters.', contextSources: ['LinkedIn'] } });
  assert.equal(created.status, 201);
  assert.equal(created.body.modelTier, 'flash_lite');
  assert.equal((await api.call('POST', `${api.W}/agents`, { body: { name: 'x', badge: 'CEO' } })).status, 400);
  assert.equal((await api.call('POST', `${api.W}/agents`, { body: { name: 'x', modelTier: 'ultra' } })).status, 400);
  const upd = await api.call('PATCH', `${api.W}/agents/${created.body.id}`, { body: { autonomousMode: true, appearance: { color: '#A3FFB4' } } });
  assert.deepEqual([upd.status, upd.body.autonomousMode, upd.body.appearance.color], [200, true, '#A3FFB4']);
  assert.equal((await api.call('DELETE', `${api.W}/agents/${created.body.id}`, { as: 'riley@example.com' })).status, 403);
  const routine = await api.call('POST', `${api.W}/routines`, { body: { name: 'Scout sweep', category: 'sync', schedule: 'hourly', active: true, agentId: created.body.id } });
  assert.equal(routine.body.active, true);
  assert.equal((await api.call('DELETE', `${api.W}/agents/${created.body.id}`)).status, 204);
  const [rt] = await api.q(`SELECT active FROM routines WHERE id = $1`, [routine.body.id]);
  assert.equal(rt.active, false, 'archiving an agent switches its routines off');
  assert.ok(!(await api.call('GET', `${api.W}/agents`)).body.items.some((a) => a.id === created.body.id));
  // Another workspace's agents are invisible here.
  const other = (await api.call('GET', `${api.ws(1)}/agents`)).body.items;
  assert.equal(other.length, 1);
  assert.equal((await api.call('GET', `${api.W}/agents/${other[0].id}/messages`)).status, 404);
});

test('chat: the model gets the house rules, the agent\'s role and the history; both messages are stored', async () => {
  const agent = (await api.call('GET', `${api.W}/agents`)).body.items.find((a) => a.name === 'Chief of Staff');
  const r = await api.call('POST', `${api.W}/agents/${agent.id}/messages`, { body: { body: 'What is blocked?' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.reply.body, 'echo: What is blocked?');
  assert.equal(r.body.reply.meta.tier, 'flash');
  const call = model.calls.at(-1);
  assert.match(call.system, /cannot send, publish, schedule, or contact anyone/);
  assert.match(call.system, /Keeps the whole pipeline in view/);
  assert.deepEqual(call.messages.slice(-3).map((x) => x.role), ['user', 'model', 'user']);
  const hist = (await api.call('GET', `${api.W}/agents/${agent.id}/messages`)).body.items;
  assert.deepEqual(hist.slice(-2).map((x) => x.sender), ['user', 'agent']);
  // Tier override is validated.
  assert.equal((await api.call('POST', `${api.W}/agents/${agent.id}/messages`, { body: { body: 'x', modelTier: 'gpt' } })).status, 400);
  // Reviewers read but can't run jobs: refused before anything is stored or the model is called.
  const calls = model.calls.length;
  const stored = (await api.q(`SELECT count(*)::int AS n FROM agent_messages WHERE agent_id = $1`, [agent.id]))[0].n;
  assert.equal((await api.call('POST', `${api.W}/agents/${agent.id}/messages`, { as: 'riley@example.com', body: { body: 'hi' } })).status, 403);
  assert.equal(model.calls.length, calls, 'the model must not run for a refused request');
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM agent_messages WHERE agent_id = $1`, [agent.id]))[0].n, stored);
});

test('chat: a model failure is a 502 and the person\'s message is kept', async () => {
  const agent = (await api.call('GET', `${api.W}/agents`)).body.items[0];
  const before = (await api.q(`SELECT count(*)::int AS n FROM agent_messages WHERE agent_id = $1`, [agent.id]))[0].n;
  const r = await api.call('POST', `${api.W}/agents/${agent.id}/messages`, { body: { body: 'fail please' } });
  assert.equal(r.status, 502);
  assert.equal(r.body.details.userMessage.body, 'fail please');
  const after = (await api.q(`SELECT count(*)::int AS n FROM agent_messages WHERE agent_id = $1`, [agent.id]))[0].n;
  assert.equal(after, before + 1);
});

test('routines: list, create, toggle; the ops kill switch shows and can\'t be cleared here', async () => {
  const list = (await api.call('GET', `${api.W}/routines`)).body.items;
  assert.equal(list.filter((x) => x.name !== 'Scout sweep').length, 4, 'the 4 seeded routines (the agents test adds one)');
  const r = await api.call('POST', `${api.W}/routines`, { body: { name: 'Friday recap', category: 'briefing', schedule: 'fridays 16:00' } });
  assert.deepEqual([r.status, r.body.active], [201, false]);
  assert.equal((await api.call('PATCH', `${api.W}/routines/${r.body.id}`, { body: { active: true } })).body.active, true);
  await api.q(`UPDATE routines SET paused_reason = 'ops: investigating' WHERE id = $1`, [r.body.id]);
  const shown = (await api.call('GET', `${api.W}/routines`)).body.items.find((x) => x.id === r.body.id);
  assert.equal(shown.pausedByOps, true);
  assert.equal((await api.call('PATCH', `${api.W}/routines/${r.body.id}`, { body: { pausedReason: null } })).status, 400);
});

test('capacity and holds: set by an operator, cleared only by an admin, scoped to this workspace', async () => {
  const cap = (await api.call('GET', `${api.W}/capacity`)).body;
  assert.deepEqual(cap.today, { cap: 40, used: 3, remaining: 37 });
  const campaign = (await api.call('GET', `${api.W}/campaigns`)).body.items[0];
  const set = await api.call('POST', `${api.W}/holds`, { as: 'sam@example.com', body: { scopeType: 'campaign', scopeId: campaign.id, reason: 'pause for review' } });
  assert.equal(set.status, 201);
  assert.ok((await api.call('GET', `${api.W}/capacity`)).body.holds.some((h) => h.scopeId === campaign.id));
  assert.equal((await api.call('DELETE', `${api.W}/holds/campaign/${campaign.id}`, { as: 'sam@example.com' })).status, 403);
  // A campaign id from another workspace can't be held or cleared from here.
  const otherCampaign = (await api.q(`INSERT INTO campaigns (org_id, workspace_id, name) VALUES ($1, $2, 'ws1 campaign') RETURNING id`,
    [api.demo.org, api.demo.workspaces[1]]))[0].id;
  assert.equal((await api.call('POST', `${api.W}/holds`, { body: { scopeType: 'campaign', scopeId: otherCampaign, reason: 'x' } })).status, 404);
  await api.q(`INSERT INTO holds (org_id, scope_type, scope_id, reason, set_by) VALUES ($1, 'campaign', $2, 'other ws', 'test')`, [api.demo.org, otherCampaign]);
  assert.equal((await api.call('DELETE', `${api.W}/holds/campaign/${otherCampaign}`)).status, 404);
  assert.ok(!(await api.call('GET', `${api.W}/capacity`)).body.holds.some((h) => h.scopeId === otherCampaign));
  assert.equal((await api.call('DELETE', `${api.W}/holds/campaign/${campaign.id}`)).status, 204);
  // Holding the whole workspace flags it.
  await api.call('POST', `${api.W}/holds`, { body: { scopeType: 'workspace', reason: 'kill switch' } });
  assert.equal((await api.call('GET', `${api.W}/capacity`)).body.workspaceOnHold, true);
  await api.call('DELETE', `${api.W}/holds/workspace/${api.demo.workspaces[0]}`);
});

test('manual suppression stores only a hash and blocks the next send', async () => {
  const r = await api.call('POST', `${api.W}/suppression`, { as: 'sam@example.com', body: { email: 'Tom@MapleGrove-Dental.example', reason: 'asked by phone' } });
  assert.equal(r.status, 201);
  const rows = await api.q(`SELECT value_hash, reason FROM suppression WHERE scope_org_id = $1 AND value_hash = value_hash('tom@maplegrove-dental.example')`, [api.demo.org]);
  assert.equal(rows.length, 1);
  assert.doesNotMatch(JSON.stringify(rows), /maplegrove/i);
  // The next send to that address is refused by send_guard, even though the draft is approved.
  const [d] = await api.q(`SELECT d.id FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN contacts c ON c.id = e.contact_id
    WHERE c.email = 'tom@maplegrove-dental.example' AND d.step = 0`);
  assert.equal((await api.call('POST', `${api.W}/approvals/${d.id}/approve`)).status, 200);
  let called = false;
  const out = await sendDraft(api.db, { orgId: api.demo.org, workspaceId: api.demo.workspaces[0], draftId: d.id, mailboxId: api.demo.mailbox,
    adapter: { async send() { called = true; return { providerMessageId: 'x' }; } }, urls: { unsubscribeBase: 'https://app.test', replyDomain: 'reply.omnisdr.com' } });
  assert.deepEqual([out.outcome, called], ['refused', false]);
  assert.match(out.reason, /suppressed/);
});

test('analytics: real counts, null rates when nothing was sent, and no open rate anywhere', async () => {
  const r = await api.call('GET', `${api.W}/analytics?days=7`);
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.sent, 3);
  assert.equal(r.body.totals.replies, 3);
  assert.equal(r.body.daily.length, 7);
  assert.doesNotMatch(r.text, /open/i, 'no open tracking (SPEC §5 S14)');
  const empty = await api.call('GET', `${api.ws(2)}/analytics`);
  assert.equal(empty.body.rates.replyRate, null);
  assert.equal((await api.call('GET', `${api.W}/analytics?days=365`)).status, 400);
});

test('connectors: status comes from what exists, later modules say so', async () => {
  const items = (await api.call('GET', `${api.W}/connectors`)).body.items;
  const status = Object.fromEntries(items.map((c) => [c.id, c.status]));
  assert.equal(status.gmail, 'connected');
  assert.equal(status.shopify, 'not_connected');
  assert.equal(status.sms, 'activates_later');
  assert.deepEqual(items.find((c) => c.id === 'gmail').scopes.map((s) => s.scope), ['https://www.googleapis.com/auth/gmail.send']);
  assert.equal((await api.call('GET', `${api.ws(2)}/connectors`)).body.items.find((c) => c.id === 'gmail').status, 'not_connected');
});

test('prospects: import runs the free checks and skips duplicates; ICP edits make a new version', async () => {
  const r = await api.call('POST', `${api.W}/contacts`, { body: { contacts: [
    { name: 'A', email: 'good@clinic.example', company: 'Clinic' }, { name: 'B', email: 'not an email' },
    { name: 'C', email: 'x@mailinator.com' }, { name: 'D', email: 'info@clinic.example' }, { name: 'Dup', email: 'lena@brightline-dental.example' }] } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.created.map((c) => c.emailStatus), ['unknown', 'invalid', 'invalid', 'unknown']);
  assert.equal(r.body.created[3].role, true);
  assert.equal(r.body.skipped.length, 1);
  assert.ok(r.body.created.every((c) => c.emailStatus !== 'valid'), 'free checks never mark an address valid');
  const icp = (await api.call('GET', `${api.W}/icps`)).body.items[0];
  const v2 = await api.call('POST', `${api.W}/icps`, { body: { name: icp.name, data: { ...icp.data, region: 'Tennessee' }, lineageId: icp.lineageId } });
  assert.equal(v2.body.version, 2);
  const [v1] = await api.q(`SELECT data FROM icps WHERE id = $1`, [icp.id]);
  assert.equal(v1.data.region, 'Middle Tennessee', 'v1 is untouched');
  assert.equal((await api.call('GET', `${api.W}/icps`)).body.items[0].version, 2);
  const camp = await api.call('POST', `${api.W}/campaigns`, { body: { name: 'Pinned', icpId: icp.id } });
  const enr = await api.call('POST', `${api.W}/campaigns/${camp.body.id}/enrollments`, { body: { contactIds: [r.body.created[0].id, r.body.created[0].id] } });
  assert.equal(enr.body.enrolled.length, 1);
});
