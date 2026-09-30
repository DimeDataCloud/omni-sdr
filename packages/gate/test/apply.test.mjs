import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, one, refused } from '../../db/test/helpers.mjs';
import { gateDraft } from '../src/apply.mjs';
import { withService, TenantAccessError } from '../../db/src/context.mjs';

async function addEvidence(db, t, facts) {
  return (await one(db, `INSERT INTO evidence (org_id, workspace_id, contact_id, type, source_uri, fetched_at, snapshot_sha, facts, expires_at)
    VALUES ($1, $2, $3, 'places', 'https://maps.example.test', now(), 'sha', $4, now() + interval '30 days') RETURNING id`,
    [t.org, t.ws, t.contact, JSON.stringify(facts)])).id;
}
// A draft as the generator writes it: app_rw, status 'gating', claims attached, no gate columns.
async function newDraft(db, t, { body, claims, subject = 'Your booking page' }) {
  return as(db, 'app_rw', { org: t.org, ws: [t.ws] }, async () => (await one(db,
    `INSERT INTO drafts (org_id, workspace_id, enrollment_id, channel, subject, body, claims)
     VALUES ($1, $2, $3, 'email', $4, $5, $6) RETURNING id`,
    [t.org, t.ws, t.enrollment, subject, body, JSON.stringify(claims)])).id);
}
const approve = (db, t, id) => as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () =>
  db.query(`UPDATE drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, t.user]));

test('gateDraft: a supported draft passes, binds the gate to its exact text, and becomes approvable', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const ev = await addEvidence(db, t, { rating: 3.2, review_count: 41 });
  const id = await newDraft(db, t, {
    body: 'Hi Pat. Your Google rating is 3.2 from 41 reviews. Worth a look?',
    claims: [{ text: 'rating is 3.2', evidence_id: ev, fact_key: 'rating' }, { text: '41 reviews', evidence_id: ev, fact_key: 'review_count' }],
  });
  const r = await gateDraft(db, { orgId: t.org, workspaceId: t.ws, draftId: id });
  assert.equal(r.outcome, 'passed', JSON.stringify(r.findings));
  const d = await one(db, `SELECT status, gate_passed, gate_body_sha = draft_sha(subject, body) AS bound, gate_version FROM drafts WHERE id = $1`, [id]);
  assert.deepEqual([d.status, d.gate_passed, d.bound, d.gate_version], ['review', true, true, 'gate-1']);
  await approve(db, t, id);
  const ev2 = await one(db, `SELECT payload FROM outbox WHERE topic = 'draft.gated' AND key = $1`, [id]);
  assert.equal(ev2.payload.passed, true);
  // A second run is a no-op: the draft has left 'gating'.
  assert.equal((await gateDraft(db, { orgId: t.org, workspaceId: t.ws, draftId: id })).outcome, 'skipped');
});

test('gateDraft: an invented number is blocked and the draft cannot be approved', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const ev = await addEvidence(db, t, { review_count: 41 });
  const id = await newDraft(db, t, { body: 'You have 45 reviews. Worth a look?', claims: [{ text: '45 reviews', evidence_id: ev, fact_key: 'review_count' }] });
  const r = await gateDraft(db, { orgId: t.org, workspaceId: t.ws, draftId: id });
  assert.equal(r.outcome, 'blocked');
  assert.ok(r.findings.some((f) => f.code === 'number_mismatch'));
  const d = await one(db, `SELECT status, gate_passed, gate_body_sha FROM drafts WHERE id = $1`, [id]);
  assert.deepEqual([d.status, d.gate_passed, d.gate_body_sha], ['blocked', false, null]);
  assert.match(await refused(approve(db, t, id)) ?? '', /approved_requires_gate/);
});

test("gateDraft: another tenant's evidence is invisible, so citing it blocks the draft", async () => {
  const db = await freshDb();
  const a = await seedTenant(db, 'alpha');
  const b = await seedTenant(db, 'bravo');
  const foreign = await addEvidence(db, b, { review_count: 41 });
  const id = await newDraft(db, a, { body: 'You have 41 reviews. Worth a look?', claims: [{ text: '41 reviews', evidence_id: foreign, fact_key: 'review_count' }] });
  const r = await gateDraft(db, { orgId: a.org, workspaceId: a.ws, draftId: id });
  assert.equal(r.outcome, 'blocked');
  assert.ok(r.findings.some((f) => f.code === 'evidence_not_found'), JSON.stringify(r.findings));
});

test('withService: only worker roles, never a user context', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const err = await withService(db, { orgId: t.org, workspaceId: t.ws, role: 'app_rw' }, async () => {}).then(() => null, (e) => e);
  assert.ok(err instanceof TenantAccessError);
  // gate_svc can't touch the text it judges.
  assert.match(await refused(withService(db, { orgId: t.org, workspaceId: t.ws, role: 'gate_svc' }, (tx) =>
    tx.query(`UPDATE drafts SET body = 'changed' WHERE org_id = $1`, [t.org]))) ?? '', /permission denied/);
});
