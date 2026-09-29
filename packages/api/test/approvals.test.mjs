// The approval queue over HTTP: approve, reject, edit → re-gate, bulk, and the gate as the only way in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

const queue = async (status = 'review') => (await api.call('GET', `${api.W}/approvals?status=${status}`)).body.items;
const byCompany = async (company, step = 0, status = 'review') =>
  (await queue(status)).find((d) => d.recipient.company === company && d.step === step);

test('the card carries recipient, evidence behind each claim, the whole sequence, gate result and trust level', async () => {
  const d = await byCompany('Maple Grove Dental');
  assert.equal(d.recipient.name, 'Tom Becker');
  assert.equal(d.fitScore, 83);
  assert.equal(d.gate.passed, true);
  assert.deepEqual(d.gate.findings, []);
  assert.equal(d.claims.length, 1);
  assert.equal(d.claims[0].evidence.facts.reviews.summary, '3 recent reviews mention long hold times');
  assert.deepEqual(d.sequence.map((s) => s.step), [0, 1]);
  assert.equal(d.trustLevel, 1);
  assert.equal(d.agent.name, 'Sales Outbound');
});

test('the blocked draft shows why', async () => {
  const blocked = await queue('blocked');
  assert.equal(blocked.length, 1);
  assert.deepEqual(blocked[0].gate.findings.map((f) => f.code).sort(), ['no_evidence', 'unsupported_sentence']);
});

test('approve: only from review, once, recorded with who and when; not for a blocked draft', async () => {
  const d = await byCompany('Maple Grove Dental');
  const r = await api.call('POST', `${api.W}/approvals/${d.id}/approve`, { as: 'riley@example.com' });
  assert.equal(r.status, 200);
  const again = await api.call('POST', `${api.W}/approvals/${d.id}/approve`);
  assert.equal(again.status, 409);
  const row = (await api.q(`SELECT status, approved_by, approved_at FROM drafts WHERE id = $1`, [d.id]))[0];
  assert.equal(row.status, 'approved');
  assert.ok(row.approved_at);
  const riley = (await api.q(`SELECT id FROM users WHERE email = 'riley@example.com'`))[0].id;
  assert.equal(row.approved_by, riley);
  const blocked = (await queue('blocked'))[0];
  assert.equal((await api.call('POST', `${api.W}/approvals/${blocked.id}/approve`)).status, 409);
  const audit = await api.q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'approve' AND entity_id = $1`, [d.id]);
  assert.equal(audit[0].n, 1);
});

test('edit an approved draft: approval voided, gate re-run at once, back in review', async () => {
  const d = (await queue('approved')).find((x) => x.recipient.company === 'Maple Grove Dental' && !x.dispatched);
  const body = d.body.replace('Open to a short call', 'Would a short call help');
  const r = await api.call('PATCH', `${api.W}/approvals/${d.id}`, { body: { body } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.gate, 'passed');
  assert.equal(r.body.item.status, 'review');
  assert.equal(r.body.item.approvedBy, null);
  assert.equal(r.body.item.body, body);
});

test('edit that adds an unsupported number: blocked, with the finding, and it cannot be approved', async () => {
  const d = await byCompany('Crescent Orthodontics');
  const r = await api.call('PATCH', `${api.W}/approvals/${d.id}`, { body: { body: `${d.body}\n\nWe reply to 98% of requests in 5 minutes.` } });
  assert.equal(r.status, 200);
  assert.equal(r.body.gate, 'blocked');
  assert.ok(r.body.item.gate.findings.some((f) => f.code === 'unsupported_sentence'));
  assert.equal((await api.call('POST', `${api.W}/approvals/${d.id}/approve`)).status, 409);
  // Fixing the text brings it back through the gate.
  const fixed = await api.call('PATCH', `${api.W}/approvals/${d.id}`, { body: { body: d.body } });
  assert.equal(fixed.body.gate, 'passed');
});

test('a dispatched draft can be neither edited, rejected, nor approved again', async () => {
  const sent = (await queue('approved')).find((x) => x.dispatched);
  assert.ok(sent, 'the seed sends three first touches');
  assert.equal((await api.call('PATCH', `${api.W}/approvals/${sent.id}`, { body: { body: 'changed after sending' } })).status, 409);
  assert.equal((await api.call('POST', `${api.W}/approvals/${sent.id}/reject`, { body: {} })).status, 409);
  const row = (await api.q(`SELECT body, status FROM drafts WHERE id = $1`, [sent.id]))[0];
  assert.equal(row.status, 'approved');
  assert.notEqual(row.body, 'changed after sending');
});

test('reject keeps the reason (an Auto-adjust source)', async () => {
  const d = await byCompany('Harbor Pediatric Dentistry', 1);
  const r = await api.call('POST', `${api.W}/approvals/${d.id}/reject`, { body: { reason: 'Too pushy for a follow-up' } });
  assert.equal(r.status, 200);
  const row = (await api.q(`SELECT status, rejection_reason FROM drafts WHERE id = $1`, [d.id]))[0];
  assert.deepEqual(row, { status: 'discarded', rejection_reason: 'Too pushy for a follow-up' });
});

test('bulk approve: each draft on its own; a bad one does not sink the rest', async () => {
  const items = (await queue()).slice(0, 2);
  const blocked = (await queue('blocked'))[0];
  const r = await api.call('POST', `${api.W}/approvals/bulk-approve`, { body: { ids: [...items.map((x) => x.id), blocked.id] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.approved, items.length);
  assert.equal(r.body.results.find((x) => x.id === blocked.id).ok, false);
  // A role that can't approve is refused outright, not item by item.
  assert.equal((await api.call('POST', `${api.W}/approvals/bulk-approve`, { as: 'stranger@example.com', body: { ids: [blocked.id] } })).status, 403);
});

test('creating a draft runs the gate: evidence-backed passes, a made-up claim does not', async () => {
  const c = (await api.call('GET', `${api.W}/contacts?q=Tom`)).body.items[0];
  const contact = (await api.call('GET', `${api.W}/contacts/${c.id}`)).body;
  const ev = contact.evidence[0];
  const enrollment = contact.enrollments[0].id;
  const good = await api.call('POST', `${api.W}/drafts`, { as: 'sam@example.com', body: {
    enrollmentId: enrollment, step: 0, subject: 'Hold times', body: 'Hi Tom, I noticed 3 recent reviews mention long hold times. Want to fix that?',
    claims: [{ text: '3 recent reviews mention long hold times', evidence_id: ev.id, fact_key: 'reviews.summary' }] } });
  assert.equal(good.status, 201);
  assert.equal(good.body.gate, 'passed', JSON.stringify(good.body.findings));
  const bad = await api.call('POST', `${api.W}/drafts`, { as: 'sam@example.com', body: {
    enrollmentId: enrollment, step: 0, subject: 'Hold times', body: 'Hi Tom, I noticed 30 recent reviews mention long hold times.',
    claims: [{ text: '30 recent reviews mention long hold times', evidence_id: ev.id, fact_key: 'reviews.summary' }] } });
  assert.equal(bad.body.gate, 'blocked');
  assert.ok(bad.body.findings.some((f) => f.code === 'number_mismatch'));
  // A reviewer can't create drafts (build).
  assert.equal((await api.call('POST', `${api.W}/drafts`, { as: 'riley@example.com', body: { enrollmentId: enrollment, body: 'x' } })).status, 403);
});

test('there is no route that approves around the gate or sends', async () => {
  const d = (await queue('blocked'))[0];
  // The DB would refuse it anyway (approved_requires_gate); the API exposes no status field to set.
  assert.equal((await api.call('PATCH', `${api.W}/approvals/${d.id}`, { body: { status: 'approved' } })).status, 400);
  for (const p of ['send', 'dispatch']) {
    assert.equal((await api.call('POST', `${api.W}/approvals/${d.id}/${p}`)).status, 404, p);
  }
});
