import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, approvedDraft, send, as, refused, one } from './helpers.mjs';

test('app_rw cannot store an approved draft that never passed the gate', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const msg = await refused(as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => db.query(
    `INSERT INTO drafts (org_id, workspace_id, enrollment_id, channel, body, status)
     VALUES ($1, $2, $3, 'email', 'hi', 'approved')`, [t.org, t.ws, t.enrollment])));
  assert.match(msg ?? '', /approved_requires_gate/);
});

test('app_rw cannot write gate columns; only gate_svc can', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const d = await approvedDraft(db, t, { approve: false });
  const msg = await refused(as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () =>
    db.query(`UPDATE drafts SET gate_passed = true WHERE id = $1`, [d])));
  assert.match(msg ?? '', /permission denied/);
});

test('editing an approved draft voids its gate pass and approval', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const d = await approvedDraft(db, t);
  await as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () =>
    db.query(`UPDATE drafts SET body = body || ' Guaranteed 40% more bookings.' WHERE id = $1`, [d]));
  const row = await one(db, `SELECT status, gate_passed, approved_by FROM drafts WHERE id = $1`, [d]);
  assert.deepEqual(row, { status: 'gating', gate_passed: false, approved_by: null });
});

// Each case starts from a draft that WOULD send, breaks exactly one condition, and must be refused.
const CASES = [
  ['draft not approved', async (db, t) => ({ draft: await approvedDraft(db, t, { approve: false }) }), /not approved/],
  ['edited after approval', async (db, t) => {
    const draft = await approvedDraft(db, t);
    await as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () =>
      db.query(`UPDATE drafts SET body = 'changed' WHERE id = $1`, [draft]));
    return { draft };
  }, /not approved/],
  ['contact suppressed by the org', async (db, t) => {
    await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason)
      SELECT $1, value_hash(email), 'email', 'unsubscribe' FROM contacts WHERE id = $2`, [t.org, t.contact]);
    return { draft: await approvedDraft(db, t) };
  }, /suppressed/],
  ['contact suppressed globally (hard bounce)', async (db, t) => {
    await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason)
      SELECT NULL, value_hash(email), 'email', 'hard_bounce' FROM contacts WHERE id = $1`, [t.contact]);
    return { draft: await approvedDraft(db, t) };
  }, /suppressed/],
  ['email not verified', async (db, t) => {
    await db.query(`UPDATE contacts SET email_status = 'risky' WHERE id = $1`, [t.contact]);
    return { draft: await approvedDraft(db, t) };
  }, /not verified/],
  ['mailbox paused', async (db, t) => {
    await db.query(`UPDATE mailboxes SET paused_reason = 'bounce breaker' WHERE id = $1`, [t.mailbox]);
    return { draft: await approvedDraft(db, t) };
  }, /paused/],
  ...['org', 'workspace', 'campaign', 'mailbox'].map((scope) => [`hold on ${scope}`, async (db, t) => {
    const id = { org: t.org, workspace: t.ws, campaign: t.campaign, mailbox: t.mailbox }[scope];
    await db.query(`INSERT INTO holds (org_id, scope_type, scope_id, reason, set_by) VALUES ($1, $2, $3, 'test', 'test')`,
      [t.org, scope, id]);
    return { draft: await approvedDraft(db, t) };
  }, /on hold/]),
  ['daily cap reached', async (db, t) => {
    await db.query(`UPDATE mailboxes SET daily_cap = 1 WHERE id = $1`, [t.mailbox]); // seed already used 1
    return { draft: await approvedDraft(db, t) };
  }, /cap reached/],
  ['trust level 1 with no human approver', async (db, t) => {
    const draft = await approvedDraft(db, t);
    await db.query(`UPDATE drafts SET approved_by = NULL WHERE id = $1`, [draft]);
    return { draft };
  }, /requires human approval/],
  ['mailbox from another tenant', async (db, t, other) => ({ draft: await approvedDraft(db, t), mailbox: other.mailbox }),
    /another tenant|not in this workspace/],
  ['second send of the same draft', async (db, t) => {
    const draft = await approvedDraft(db, t);
    await send(db, t, draft);
    return { draft };
  }, /duplicate key|messages_draft_id_key/],
  ['sender acting in another tenant context', async (db, t, other) => ({
    draft: await approvedDraft(db, t), ctx: { org: other.org, ws: [other.ws] } }), /row-level security/],
];

test('send guard sabotage suite', async () => {
  let refusedCount = 0;
  for (const [name, arrange, reason] of CASES) {
    const db = await freshDb();
    const t = await seedTenant(db, 'alpha');
    const other = await seedTenant(db, 'bravo');
    const { draft, mailbox, ctx } = await arrange(db, t, other);
    const msg = await refused(send(db, t, draft, { mailbox: mailbox ?? t.mailbox, ctx }));
    assert.ok(msg, `${name}: the send was ALLOWED`);
    assert.match(msg, reason, `${name}: refused for the wrong reason: ${msg}`);
    refusedCount++;
  }
  console.log(`  send guard: refused ${refusedCount} of ${CASES.length} seeded bad sends`);
  assert.equal(refusedCount, CASES.length);
});

test('positive controls: a clean send goes through, and trust 2 auto-sends only hot leads', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  assert.equal(await refused(send(db, t, await approvedDraft(db, t))), null, 'clean approved send was refused');

  const hot = await seedTenant(db, 'hot', { trust: 2, heat: 4 });
  const auto = await approvedDraft(db, hot);
  await db.query(`UPDATE drafts SET approved_by = NULL WHERE id = $1`, [auto]);
  assert.equal(await refused(send(db, hot, auto)), null, 'trust 2 + heat 4 auto-send was refused');

  const cold = await seedTenant(db, 'cold', { trust: 2, heat: 3 });
  const coldDraft = await approvedDraft(db, cold);
  await db.query(`UPDATE drafts SET approved_by = NULL WHERE id = $1`, [coldDraft]);
  assert.match(await refused(send(db, cold, coldDraft)) ?? '', /requires human approval/);
});
