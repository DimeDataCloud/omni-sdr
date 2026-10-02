// The approval queue (Station 13, Trust Dial Level 1). A draft reaches 'review' only through the gate;
// approving writes approved_by, and the approved_requires_gate CHECK refuses anything whose gate pass
// doesn't cover its current text. Editing voids both (trigger) and re-runs the gate at once.
// Nothing here sends: the sender worker picks up approved drafts under send_guard().
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, conflict } from '../errors.mjs';
import { gateDraft } from '../../../gate/src/apply.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['generating', 'gating', 'blocked', 'review', 'approved', 'discarded', 'superseded'];
const affected = (r) => r.affectedRows ?? r.rowCount ?? 0;

const DRAFT_SQL = `
  SELECT d.id, d.status, d.channel, d.step, d.purpose, d.subject, d.body, d.claims, d.gate_passed, d.gate_version, d.gated_at,
         d.gate_findings, d.rejection_reason, d.approved_by, d.approved_at, d.created_at, d.enrollment_id,
         c.id AS contact_id, c.name AS contact_name, c.title AS contact_title, c.company AS contact_company,
         c.email AS contact_email, c.email_status, c.fit_score,
         cp.id AS campaign_id, cp.name AS campaign_name,
         a.id AS agent_id, a.name AS agent_name, a.model_tier,
         EXISTS (SELECT 1 FROM messages msg WHERE msg.draft_id = d.id) AS dispatched
  FROM drafts d
  JOIN enrollments e ON e.id = d.enrollment_id
  JOIN contacts c ON c.id = e.contact_id
  JOIN campaigns cp ON cp.id = e.campaign_id
  LEFT JOIN agents a ON a.id = d.agent_id`;

// Shape for the approval card (UI ApprovalItem, with real fields instead of mock ones).
async function hydrate(tx, rows, trustLevel) {
  if (!rows.length) return [];
  const evidenceIds = [...new Set(rows.flatMap((d) => (Array.isArray(d.claims) ? d.claims : [])
    .map((c) => c?.evidence_id).filter((x) => typeof x === 'string' && UUID.test(x))))];
  const evidence = new Map(evidenceIds.length ? (await tx.query(
    `SELECT id, type, source_uri, fetched_at, facts, expires_at FROM evidence WHERE id = ANY ($1::uuid[])`,
    [evidenceIds])).rows.map((e) => [e.id, camel(e)]) : []);
  const enrollmentIds = [...new Set(rows.map((d) => d.enrollment_id))];
  const siblings = (await tx.query(
    `SELECT id, enrollment_id, step, subject, body, status FROM drafts
     WHERE enrollment_id = ANY ($1::uuid[]) AND status NOT IN ('discarded', 'superseded') ORDER BY step, created_at`,
    [enrollmentIds])).rows;
  return rows.map((d) => ({
    id: d.id,
    status: d.status,
    dispatched: d.dispatched,
    channel: d.channel,
    step: d.step,
    purpose: d.purpose,
    subject: d.subject,
    body: d.body,
    recipient: { contactId: d.contact_id, name: d.contact_name, title: d.contact_title, company: d.contact_company,
      email: d.contact_email, emailStatus: d.email_status },
    fitScore: d.fit_score,
    campaign: { id: d.campaign_id, name: d.campaign_name },
    agent: d.agent_id ? { id: d.agent_id, name: d.agent_name, modelTier: d.model_tier } : null,
    gate: { passed: d.gate_passed, version: d.gate_version, gatedAt: d.gated_at, findings: d.gate_findings ?? [] },
    claims: (Array.isArray(d.claims) ? d.claims : []).map((c) => ({
      text: c?.text ?? null, factKey: c?.fact_key ?? null, evidence: evidence.get(c?.evidence_id) ?? null })),
    sequence: siblings.filter((s) => s.enrollment_id === d.enrollment_id)
      .map((s) => ({ id: s.id, step: s.step, subject: s.subject, body: s.body, status: s.status })),
    trustLevel,
    rejectionReason: d.rejection_reason,
    approvedBy: d.approved_by,
    approvedAt: d.approved_at,
    createdAt: d.created_at,
  }));
}

const trustOf = async (tx, m) => (await tx.query(`SELECT trust_level FROM workspaces WHERE id = $1`, [m.workspaceId])).rows[0].trust_level;

async function approveOne(tx, m, id) {
  const r = await tx.query(
    `UPDATE drafts SET status = 'approved', approved_by = $2, approved_at = now()
     WHERE id = $1 AND status = 'review' AND NOT EXISTS (SELECT 1 FROM messages WHERE draft_id = $1)`, [id, m.userId]);
  if (!affected(r)) {
    const cur = (await tx.query(`SELECT status FROM drafts WHERE id = $1`, [id])).rows[0];
    if (!cur) throw notFound('draft not found');
    throw conflict(`draft is ${cur.status}; only drafts in review can be approved`, { status: cur.status });
  }
  await audit(tx, m, 'approve', 'draft', id);
}

export function registerApprovals(r) {
  // Seeing the queue is the same permission as acting on it (client_viewer only when the workspace toggle is on).
  // ?status=review (default) | blocked | approved | all ; ?channel=email|linkedin_assist|sms ; ?minFit=0-100
  r.get(`${T}/approvals`, (ctx) => {
    const q = parse(v.object({
      status: v.optional(v.oneOf([...STATUSES, 'all'])),
      channel: v.optional(v.oneOf(['email', 'sms', 'linkedin_assist'])),
      minFit: v.optional(v.int({ min: 0, max: 100 })),
      limit: v.optional(v.int({ min: 1, max: 200 })),
    }), ctx.query);
    return ctx.tenant(async (tx, m) => {
      const where = [];
      const args = [];
      if ((q.status ?? 'review') !== 'all') { args.push(q.status ?? 'review'); where.push(`d.status = $${args.length}`); }
      if (q.channel) { args.push(q.channel); where.push(`d.channel = $${args.length}`); }
      if (q.minFit !== undefined) { args.push(q.minFit); where.push(`coalesce(c.fit_score, 0) >= $${args.length}`); }
      args.push(q.limit ?? 50);
      const rows = (await tx.query(`${DRAFT_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.fit_score DESC NULLS LAST, d.created_at LIMIT $${args.length}`, args)).rows;
      const counts = Object.fromEntries((await tx.query(`SELECT status, count(*)::int AS n FROM drafts GROUP BY status`)).rows
        .map((x) => [x.status, x.n]));
      return { items: await hydrate(tx, rows, await trustOf(tx, m)), counts };
    }, { action: 'approve' });
  });

  r.get(`${T}/approvals/:id`, (ctx) => ctx.tenant(async (tx, m) => {
    const rows = (await tx.query(`${DRAFT_SQL} WHERE d.id = $1`, [ctx.params.id])).rows;
    if (!rows.length) throw notFound('draft not found');
    return (await hydrate(tx, rows, await trustOf(tx, m)))[0];
  }, { action: 'approve' }));

  r.post(`${T}/approvals/:id/approve`, (ctx) => ctx.tenant(async (tx, m) => {
    await approveOne(tx, m, ctx.params.id);
    return { id: ctx.params.id, status: 'approved' };
  }, { action: 'approve' }));

  // Approve several at once; each draft succeeds or fails on its own (one transaction each).
  r.post(`${T}/approvals/bulk-approve`, async (ctx) => {
    const b = parse(v.object({ ids: v.array(v.uuid(), { min: 1, max: 100 }) }), ctx.body);
    const results = [];
    for (const id of b.ids) {
      try {
        await ctx.tenant((tx, m) => approveOne(tx, m, id), { action: 'approve' });
        results.push({ id, ok: true });
      } catch (err) {
        if (err?.status === 403 || err?.name === 'TenantAccessError') throw err;
        results.push({ id, ok: false, error: err?.message ?? 'failed' });
      }
    }
    return { results, approved: results.filter((x) => x.ok).length };
  });

  r.post(`${T}/approvals/:id/reject`, (ctx) => {
    const b = parse(v.object({ reason: v.optional(v.string({ max: 500 })) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const res = await tx.query(`UPDATE drafts SET status = 'discarded', rejection_reason = $2
        WHERE id = $1 AND status IN ('gating', 'blocked', 'review', 'approved')
          AND NOT EXISTS (SELECT 1 FROM messages WHERE draft_id = $1)`, [ctx.params.id, b.reason || null]);
      if (!affected(res)) {
        const cur = (await tx.query(`SELECT status FROM drafts WHERE id = $1`, [ctx.params.id])).rows[0];
        if (!cur) throw notFound('draft not found');
        throw conflict(`draft is ${cur.status}${cur.status === 'approved' ? ' and already dispatched' : ''}; it can't be rejected`);
      }
      await audit(tx, m, 'reject', 'draft', ctx.params.id);
      return { id: ctx.params.id, status: 'discarded' };
    }, { action: 'approve' });
  });

  // Edit text → the trigger voids gate + approval → the gate runs again right away (its own transaction,
  // as gate_svc) → the answer carries the new verdict.
  r.patch(`${T}/approvals/:id`, async (ctx) => {
    const b = parse(v.object({
      subject: v.optional(v.nullable(v.string({ max: 300, trim: false }))),
      body: v.optional(v.string({ min: 1, max: 20000, trim: false })),
    }, { atLeastOne: true }), ctx.body);
    await ctx.tenant(async (tx, m) => {
      const sets = ["status = 'gating'"];
      const args = [ctx.params.id];
      if ('subject' in b) { args.push(b.subject); sets.push(`subject = $${args.length}`); }
      if ('body' in b) { args.push(b.body); sets.push(`body = $${args.length}`); }
      const res = await tx.query(`UPDATE drafts SET ${sets.join(', ')} WHERE id = $1
        AND status IN ('gating', 'blocked', 'review', 'approved') AND NOT EXISTS (SELECT 1 FROM messages WHERE draft_id = $1)`, args);
      if (!affected(res)) {
        const cur = (await tx.query(`SELECT status FROM drafts WHERE id = $1`, [ctx.params.id])).rows[0];
        if (!cur) throw notFound('draft not found');
        throw conflict(`draft is ${cur.status}; it can't be edited`);
      }
      await audit(tx, m, 'edit', 'draft', ctx.params.id);
    }, { action: 'approve' });
    const verdict = await gateDraft(ctx.client, { orgId: ctx.params.org, workspaceId: ctx.params.ws, draftId: ctx.params.id, now: ctx.now() });
    const item = await ctx.tenant(async (tx, m) =>
      (await hydrate(tx, (await tx.query(`${DRAFT_SQL} WHERE d.id = $1`, [ctx.params.id])).rows, await trustOf(tx, m)))[0]);
    return { gate: verdict.outcome, item };
  });
}
