// Station 26: the SPEC §1 acceptance story as an executable script (G6). Pilots start when every step passes in
// prod (DECISIONS 2026-09-29). Until then it is the MVP's progress meter: each step is PASS, FAIL or NOT BUILT,
// and NOT BUILT names what is missing, so "how far from the MVP" is a count, not an opinion.
//
//   node e2e/acceptance.mjs                     against the local API dev server (dev:<email> tokens), :8787
//   OMNI_API=http://127.0.0.1:8787 node e2e/acceptance.mjs
//
// Exit 1 on any FAIL. NOT BUILT doesn't fail the run: it is the list of work left.
// Every identity is new per run (a random suffix), so runs never collide with each other or the demo seed.
// Prod mode (real ID tokens for tenant #0) comes with the sender: it needs real sends and replies.
import { randomBytes } from 'node:crypto';

const API = (process.env.OMNI_API ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const RUN = randomBytes(3).toString('hex');
const who = (name) => `${name}.${RUN}@acceptance.example`;
const results = [];

async function call(as, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { authorization: `Bearer dev:${as}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body: out };
}
const ok = (r, want, what) => { if (r.status !== want) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`); return r.body; };

async function step(id, title, fn) {
  try {
    const note = await fn();
    results.push({ id, title, state: note?.notBuilt ? 'NOT BUILT' : 'PASS', note: note?.notBuilt ?? note?.partial ?? '' });
  } catch (e) {
    results.push({ id, title, state: 'FAIL', note: e.message });
  }
}
const notBuilt = (what) => ({ notBuilt: what });
const partial = (what) => ({ partial: `partial: ${what}` });

// ── Maya: owner ─────────────────────────────────────────────────────────────────────────────────
const maya = who('maya');
const M = {};
const T = () => `/v1/o/${M.org}/w/${M.ws}`;

await step('M1', 'Signs up as Owner; 7-day trial', async () => {
  const r = ok(await call(maya, 'POST', '/v1/orgs', { orgName: `Maya Dental ${RUN}`, accountType: 'owner' }), 201, 'sign-up');
  Object.assign(M, { org: r.orgId, ws: r.workspaceId });
  const me = ok(await call(maya, 'GET', '/v1/me'), 200, 'me');
  const o = me.orgs.find((x) => x.id === M.org);
  if (o?.accountType !== 'owner' || o.subscriptionStatus !== 'trialing' || o.role !== 'admin') throw new Error(`org ${JSON.stringify(o)}`);
  return partial('Stripe Checkout (card-required trial) not wired');
});
await step('M2', 'Composer asks one question at a time; every question skippable', async () => notBuilt('composer + proactive onboarding (sprint 2)'));
await step('M3', 'ICP v1 → v2; the campaign stays pinned to v1', async () => {
  const v1 = ok(await call(maya, 'POST', `${T()}/icps`, { name: 'Dental practices', data: { region: 'Nashville' } }), 201, 'icp v1');
  const c = ok(await call(maya, 'POST', `${T()}/campaigns`, { name: 'Q4 dental', icpId: v1.id }), 201, 'campaign');
  const v2 = ok(await call(maya, 'POST', `${T()}/icps`, { name: 'Dental practices', data: { region: 'Nashville', size: '3+ chairs' }, lineageId: v1.lineageId }), 201, 'icp v2');
  if (v2.version !== 2 || v2.lineageId !== v1.lineageId) throw new Error(`v2 ${JSON.stringify(v2)}`);
  const camps = ok(await call(maya, 'GET', `${T()}/campaigns`), 200, 'campaigns').items;
  if (camps.find((x) => x.id === c.id)?.icpId !== v1.id) throw new Error('campaign moved off v1');
  M.campaign = c.id;
  return partial('CSV of past clients + chat → ICP with citations (sprint 3)');
});
await step('M4', 'Competitors: battlecards and a gap map', async () => notBuilt('competitor research with grounding (sprint 4)'));
await step('M5', 'Leads with free checks on every email', async () => {
  const r = ok(await call(maya, 'POST', `${T()}/contacts`, { contacts: [
    { name: 'Lena Ortiz', email: `lena.${RUN}@brightline-dental.example`, company: 'Brightline Family Dental' },
    { name: 'Front desk', email: `info@harbor-${RUN}.example`, company: 'Harbor Pediatric' },
    { name: 'Bad', email: 'not-an-email' },
  ] }), 201, 'import');
  M.contacts = r.created.map((x) => x.id);
  if (r.created.length !== 3) throw new Error(`created ${r.created.length}, skipped ${JSON.stringify(r.skipped)}`);
  if (r.created.some((x) => x.emailStatus === 'valid')) throw new Error('a free check marked an address valid');
  if (r.created[2].emailStatus !== 'invalid') throw new Error(`a malformed address is ${r.created[2].emailStatus}`);
  if (!r.created.some((x) => x.role)) throw new Error('role address not flagged');
  return partial('"find 50 Nashville dental practices", enrichment/evidence and vendor verification (sprint 4)');
});
await step('M6', 'Campaign: a 3-step sequence, gated before review', async () => {
  const e = ok(await call(maya, 'POST', `${T()}/campaigns/${M.campaign}/enrollments`, { contactIds: M.contacts }), 201, 'enroll');
  if (e.enrolled.length !== M.contacts.length) throw new Error(`enrolled ${e.enrolled.length}`);
  M.enrollment = e.enrolled[0].id;
  const blocked = ok(await call(maya, 'POST', `${T()}/drafts`, { enrollmentId: M.enrollment, subject: 'Booking', body: 'Your site has 47 five-star reviews and no online booking.',
    claims: [{ text: '47 five-star reviews', evidence_id: '00000000-0000-4000-8000-000000000000', fact_key: 'reviews' }] }), 201, 'unsourced draft');
  if (blocked.gate !== 'blocked') throw new Error(`a claim without evidence was ${blocked.gate}`);
  const first = ok(await call(maya, 'POST', `${T()}/drafts`, { enrollmentId: M.enrollment, subject: 'Quick question',
    body: 'Hi Lena, would a 15-minute call next week about patient booking be useful?' }), 201, 'first touch');
  if (first.gate !== 'blocked' || !first.findings.some((f) => f.code === 'no_evidence')) throw new Error(`a first touch with no fact was ${first.gate}`);
  const d = ok(await call(maya, 'POST', `${T()}/drafts`, { enrollmentId: M.enrollment, step: 1, subject: 'Re: Quick question',
    body: 'Hi Lena, just bringing this back to the top of your inbox. Is next week any better?' }), 201, 'follow-up');
  M.draft = d.id; M.draftGate = d.gate;
  return notBuilt('no first touch can pass the gate: it must cite evidence, and only the enricher writes evidence (sprint 4); generation (sprint 5)');
});
await step('M7', 'Approvals: edit re-gates, approve; sends from her Gmail under window, ramp and cap', async () => {
  if (!M.draft) throw new Error('no draft from M6');
  if (M.draftGate !== 'passed') throw new Error(`the step-1 follow-up was ${M.draftGate}`);
  const ed = ok(await call(maya, 'PATCH', `${T()}/approvals/${M.draft}`, { body: 'Hi Lena, would a short call next week about online booking help?' }), 200, 'edit');
  if (ed.gate !== 'passed' || ed.item.status !== 'review') throw new Error(`edit → ${ed.gate}/${ed.item.status}`);
  ok(await call(maya, 'POST', `${T()}/approvals/${M.draft}/approve`), 200, 'approve');
  const a = ok(await call(maya, 'GET', `${T()}/approvals/${M.draft}`), 200, 'card');
  if (a.status !== 'approved') throw new Error(`status ${a.status}`);
  return notBuilt('the send: Gmail connect + send job (PR #36 part 1 of 2); approval itself passes');
});
await step('M8', 'Inbound: reply via reply.omnisdr.com → classified → SLA → booked → sequence stops', async () =>
  notBuilt('end to end needs a real send; the reply path itself is live (email-worker → /internal/inbound, verified 2026-10-02)'));
await step('M9', 'Follow-up: steps 2–3 go out; out-of-office snoozes; no-show gets a reschedule draft', async () => notBuilt('follow-up sends (PR #36), OOO snooze, no-show draft'));
await step('M10', 'Analytics: sends, replies, meetings, rate by step; no open rate', async () => {
  const a = ok(await call(maya, 'GET', `${T()}/analytics?days=30`), 200, 'analytics');
  for (const k of ['sent', 'replies', 'positive', 'meetings']) if (typeof a.totals?.[k] !== 'number') throw new Error(`totals.${k}`);
  if (JSON.stringify(a).match(/open/i)) throw new Error('an open-rate field exists');
  if (a.rates.replyRate !== null) throw new Error('reply rate must be null with nothing sent, not 0');
  const cr = ok(await call(maya, 'GET', `${T()}/credits`), 200, 'credits');
  if (!cr.balances) throw new Error('credits');
});
await step('M11', 'Reports and export: PDF + Doc, leads to CSV/Sheets, meetings to the CRM', async () => notBuilt('reports, exports, CRM push (sprint 9)'));

// ── Northside Growth: agency ───────────────────────────────────────────────────────────────────
const admin = who('northside-admin'); const op = who('sam'); const rev = who('riley'); const client = who('client');
const N = {};
await step('A1', 'Agency signs up and creates client workspaces; an owner account cannot', async () => {
  const r = ok(await call(admin, 'POST', '/v1/orgs', { orgName: `Northside ${RUN}`, accountType: 'agency', workspaceName: 'Brightline' }), 201, 'sign-up');
  Object.assign(N, { org: r.orgId, ws: r.workspaceId });
  N.ws2 = ok(await call(admin, 'POST', `/v1/o/${N.org}/workspaces`, { name: 'Harbor Legal' }), 201, 'second workspace').workspaceId;
  const refused = await call(maya, 'POST', `/v1/o/${M.org}/workspaces`, { name: 'nope' });
  if (refused.status !== 409) throw new Error(`owner add-workspace → ${refused.status}`);
});
const NT = () => `/v1/o/${N.org}/w/${N.ws}`;
await step('A2', 'Invites staff as operator and reviewer, and a client as client_viewer; only the invited email can accept', async () => {
  const tokens = {};
  for (const [email, role] of [[op, 'operator'], [rev, 'reviewer'], [client, 'client_viewer']]) {
    const inv = ok(await call(admin, 'POST', `${NT()}/invites`, { email, role, ...(role === 'client_viewer' ? { workspaceIds: [N.ws] } : {}) }), 201, `invite ${role}`);
    tokens[role] = inv.inviteUrl.split('/').pop();
  }
  const wrong = await call(who('stranger'), 'POST', '/v1/invites/accept', { token: tokens.operator });
  if (wrong.status !== 403) throw new Error(`stranger accepted → ${wrong.status}`);
  for (const [email, role] of [[op, 'operator'], [rev, 'reviewer'], [client, 'client_viewer']]) ok(await call(email, 'POST', '/v1/invites/accept', { token: tokens[role] }), 200, `accept ${role}`);
  const reuse = await call(op, 'POST', '/v1/invites/accept', { token: tokens.operator });
  if (reuse.status !== 403) throw new Error(`reused invite → ${reuse.status}`);
  const cme = ok(await call(client, 'GET', '/v1/me'), 200, 'client me');
  const co = cme.orgs.find((x) => x.id === N.org);
  if (co?.role !== 'client_viewer' || co.workspaces.length !== 1) throw new Error(`client sees ${JSON.stringify(co?.workspaces)}`);
});
await step('A3', 'The client sees analytics; approves only when the admin turns the toggle on', async () => {
  ok(await call(client, 'GET', `${NT()}/analytics?days=30`), 200, 'client analytics');
  const before = await call(client, 'GET', `${NT()}/approvals`);
  if (before.status !== 403) throw new Error(`client approvals with toggle off → ${before.status}`);
  ok(await call(admin, 'PATCH', `${NT()}/settings`, { clientApprovalsEnabled: true }), 200, 'toggle on');
  ok(await call(client, 'GET', `${NT()}/approvals`), 200, 'client approvals with toggle on');
  const other = await call(client, 'GET', `/v1/o/${N.org}/w/${N.ws2}/analytics?days=30`);
  if (other.status !== 403 && other.status !== 404) throw new Error(`client reached another client's workspace → ${other.status}`);
  const staffOnly = await call(client, 'GET', `${NT()}/agents`);
  if (staffOnly.status === 200) return partial('client_viewer can still read agents/routines/campaigns (bug bounty #4, defaulted to restrict; not built yet)');
});
await step('A4', 'Reports carry the agency brand on the agency domain (white-label)', async () => notBuilt('white-label + custom domains (sprint 9)'));

// ── Report ─────────────────────────────────────────────────────────────────────────────────────
const n = (s) => results.filter((r) => r.state === s).length;
for (const r of results) console.log(`${r.state.padEnd(9)} ${r.id.padEnd(3)} ${r.title}${r.note ? `\n            ${r.note}` : ''}`);
console.log(`\n${n('PASS')} pass · ${n('FAIL')} fail · ${n('NOT BUILT')} not built · of ${results.length} steps (run ${RUN}, ${API})`);
process.exitCode = n('FAIL') ? 1 : 0;
