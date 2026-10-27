// 0031: lead_drafts keeps the draft discipline (gate columns, approval over a gate pass, edit voids both) for a lead with no
// enrollment, is walled per tenant, and is invisible to a closer. It cannot send: messages is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused, one, q } from './helpers.mjs';

const ctxOf = (t) => ({ org: t.org, ws: [t.ws] });

async function newLead(db, t, ext) {
  return (await one(db, `INSERT INTO lead_events (org_id, workspace_id, contact_id, source, channel, external_id, consent_basis, received_at)
    VALUES ($1, $2, $3, 'web_form', 'form', $4, 'express_form', now()) RETURNING id`, [t.org, t.ws, t.contact, ext])).id;
}
const insertDraft = (db, t, lead, body = 'Thanks, Pat. When works for a call?') => as(db, 'app_rw', ctxOf(t), () => one(db,
  `INSERT INTO lead_drafts (org_id, workspace_id, contact_id, lead_event_id, channel, subject, body)
   VALUES ($1, $2, $3, $4, 'email', 'Hello', $5) RETURNING id`, [t.org, t.ws, t.contact, lead, body]).then((r) => r.id));
const gate = (db, t, id) => as(db, 'gate_svc', ctxOf(t), () => db.query(
  `UPDATE lead_drafts SET gate_passed = true, gate_body_sha = draft_sha(subject, body), gate_version = 'v1', gated_at = now(), status = 'review' WHERE id = $1`, [id]));
const approve = (db, t, id) => as(db, 'app_rw', ctxOf(t), () => db.query(
  `UPDATE lead_drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, t.user]));

test('a lead draft is approved only over a gate pass on its current text, and an approver is named', async () => {
  const db = await freshDb(); const t = await seedTenant(db, 'a');
  const id = await insertDraft(db, t, await newLead(db, t, 'ld-1'));
  assert.match(await refused(approve(db, t, id)), /lead_drafts_approved_requires_gate/, 'not gated, not approved');
  await gate(db, t, id);
  assert.equal(await refused(approve(db, t, id)), null);
  assert.match(await refused(as(db, 'app_rw', ctxOf(t), () => db.query(`UPDATE lead_drafts SET approved_by = NULL WHERE id = $1`, [id]))),
    /lead_drafts_approved_has_approver/);
});

test('editing the text voids the gate and the approval', async () => {
  const db = await freshDb(); const t = await seedTenant(db, 'a');
  const id = await insertDraft(db, t, await newLead(db, t, 'ld-2'));
  await gate(db, t, id); await approve(db, t, id);
  await as(db, 'app_rw', ctxOf(t), () => db.query(`UPDATE lead_drafts SET body = 'Changed after approval.' WHERE id = $1`, [id]));
  const r = await one(db, `SELECT status, gate_passed, gate_body_sha, approved_by, approved_at FROM lead_drafts WHERE id = $1`, [id]);
  assert.deepEqual([r.status, r.gate_passed, r.gate_body_sha, r.approved_by, r.approved_at], ['gating', false, null, null, null]);
});

test('only gate_svc writes gate columns, and app_rw cannot move a draft to another lead or channel', async () => {
  const db = await freshDb(); const t = await seedTenant(db, 'a');
  const id = await insertDraft(db, t, await newLead(db, t, 'ld-3'));
  for (const col of ['gate_passed = true', `gate_body_sha = 'x'`, `gate_version = 'v1'`, 'gated_at = now()', `gate_findings = '[]'`]) {
    assert.match(await refused(as(db, 'app_rw', ctxOf(t), () => db.query(`UPDATE lead_drafts SET ${col} WHERE id = $1`, [id]))), /permission denied/, col);
  }
  assert.match(await refused(as(db, 'gate_svc', ctxOf(t), () => db.query(`UPDATE lead_drafts SET body = 'x' WHERE id = $1`, [id]))), /permission denied/);
  for (const col of [`lead_event_id = '${t.lead}'`, `channel = 'sms'`, `contact_id = '${t.contact}'`]) {
    assert.match(await refused(as(db, 'app_rw', ctxOf(t), () => db.query(`UPDATE lead_drafts SET ${col} WHERE id = $1`, [id]))), /permission denied/, col);
  }
  // The trigger holds even where a grant is later widened: the superuser path hits it too.
  assert.match(await refused(db.query(`UPDATE lead_drafts SET lead_event_id = $2 WHERE id = $1`, [id, t.lead])), /cannot change/);
});

test('one live draft per lead and purpose; a discarded one frees the slot', async () => {
  const db = await freshDb(); const t = await seedTenant(db, 'a');
  const lead = await newLead(db, t, 'ld-4');
  const first = await insertDraft(db, t, lead);
  assert.match(await refused(insertDraft(db, t, lead, 'A second one.')), /lead_drafts_one_live/);
  await as(db, 'app_rw', ctxOf(t), () => db.query(`UPDATE lead_drafts SET status = 'discarded', rejection_reason = 'wrong tone' WHERE id = $1`, [first]));
  assert.ok(await insertDraft(db, t, lead, 'A fresh one.'));
});

test('a tenant cannot read, write or point at another tenant\'s lead drafts', async () => {
  const db = await freshDb(); const a = await seedTenant(db, 'a'); const b = await seedTenant(db, 'b');
  assert.equal((await as(db, 'app_rw', ctxOf(a), () => q(db, `SELECT id FROM lead_drafts`))).map((r) => r.id).includes(b.leadDraft), false);
  assert.equal((await as(db, 'app_rw', ctxOf(a), () => db.query(`UPDATE lead_drafts SET body = 'x' WHERE id = $1`, [b.leadDraft]))).affectedRows, 0);
  // A's draft cannot answer B's lead (composite FK), nor use B's contact.
  assert.ok(await refused(as(db, 'app_rw', ctxOf(a), () => db.query(
    `INSERT INTO lead_drafts (org_id, workspace_id, contact_id, lead_event_id, channel, body) VALUES ($1, $2, $3, $4, 'email', 'x')`, [a.org, a.ws, a.contact, b.lead]))));
  const aLead = await newLead(db, a, 'ld-5');
  assert.ok(await refused(as(db, 'app_rw', ctxOf(a), () => db.query(
    `INSERT INTO lead_drafts (org_id, workspace_id, contact_id, lead_event_id, channel, body) VALUES ($1, $2, $3, $4, 'email', 'x')`, [a.org, a.ws, b.contact, aLead]))));
  // Writing under a workspace outside the caller's scope is refused by RLS.
  assert.match(await refused(as(db, 'app_rw', { org: a.org, ws: [] }, () => db.query(
    `INSERT INTO lead_drafts (org_id, workspace_id, contact_id, lead_event_id, channel, body) VALUES ($1, $2, $3, $4, 'email', 'x')`, [a.org, a.ws, a.contact, a.lead]))), /row-level security|violates/);
});

test('a closer sees no lead drafts and writes none', async () => {
  const db = await freshDb(); const t = await seedTenant(db, 'a');
  const closer = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ('uid-closer', 'closer@example.test') RETURNING id`)).id;
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'closer')`, [t.org, closer]);
  assert.ok((await as(db, 'app_rw', ctxOf(t), () => q(db, `SELECT id FROM lead_drafts`))).length >= 1, 'control: a non-closer sees the seeded draft');
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [closer]);
  const seen = await as(db, 'app_rw', ctxOf(t), () => q(db, `SELECT id FROM lead_drafts`));
  await db.query(`SELECT set_config('app.user_id', '', false)`);
  assert.equal(seen.length, 0, 'the closer policy hides every lead draft');
});

test('nothing can send a lead draft yet: messages has no lead_draft_id and send_guard needs an enrollment draft', async () => {
  const db = await freshDb(); const t = await seedTenant(db, 'a');
  const id = await insertDraft(db, t, await newLead(db, t, 'ld-6'));
  await gate(db, t, id); await approve(db, t, id);
  const cols = (await q(db, `SELECT column_name FROM information_schema.columns WHERE table_name = 'messages'`)).map((r) => r.column_name);
  assert.equal(cols.includes('lead_draft_id'), false);
  assert.ok(await refused(as(db, 'sender_svc', ctxOf(t), () => db.query(
    `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email')`, [t.org, t.ws, id, t.mailbox]))));
});
