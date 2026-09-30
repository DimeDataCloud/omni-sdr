// The "build" side: contacts (with the free checks), versioned ICPs, campaigns, enrollments, and drafts.
// A draft is created in 'gating' and gated at once; only the gate can move it to 'review'.
// Evidence is deliberately NOT writable from here: it is a fetched, hashed snapshot made by the enricher,
// and the gate trusts it. Letting a person type evidence would let them "prove" any claim.
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound } from '../errors.mjs';
import { freeEmailChecks } from '../services/catalog.mjs';
import { gateDraft } from '../../../gate/src/apply.mjs';

const CONTACT = {
  name: v.optional(v.nullable(v.string({ max: 200 }))),
  email: v.optional(v.nullable(v.string({ max: 320 }))),
  phone: v.optional(v.nullable(v.string({ max: 40, pattern: /^\+?[0-9 ().-]{7,40}$/ }))),
  company: v.optional(v.nullable(v.string({ max: 200 }))),
  title: v.optional(v.nullable(v.string({ max: 200 }))),
};

export function registerProspects(r) {
  // ?q= search name/email/company
  r.get(`${T}/contacts`, (ctx) => {
    const q = parse(v.object({ q: v.optional(v.string({ max: 100 })), limit: v.optional(v.int({ min: 1, max: 500 })),
      offset: v.optional(v.int({ min: 0, max: 100000 })) }), ctx.query);
    return ctx.tenant(async (tx) => {
      const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const rows = (await tx.query(`SELECT id, name, email, email_status, phone, company, title, fit_score, created_at FROM contacts
        WHERE $1::text IS NULL OR name ILIKE $1 OR email ILIKE $1 OR company ILIKE $1
        ORDER BY fit_score DESC NULLS LAST, created_at DESC LIMIT $2 OFFSET $3`, [like, q.limit ?? 100, q.offset ?? 0])).rows;
      return { items: rows.map(camel) };
    }, { action: 'build' });
  });

  // One or many (CSV rows mapped by the client). Duplicates by email are skipped, not overwritten.
  r.post(`${T}/contacts`, (ctx) => {
    const b = parse(v.object({ contacts: v.array(v.object(CONTACT), { min: 1, max: 500 }) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const created = [];
      const skipped = [];
      for (const [i, c] of b.contacts.entries()) {
        const check = c.email ? freeEmailChecks(c.email) : null;
        const row = (await tx.query(
          `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, phone, company, title)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (workspace_id, email) DO NOTHING RETURNING id, email_status`,
          [m.orgId, m.workspaceId, c.name ?? null, check?.email ?? null, check?.status ?? 'unknown', c.phone ?? null,
            c.company ?? null, c.title ?? null])).rows[0];
        if (row) created.push({ index: i, id: row.id, emailStatus: row.email_status, role: check?.role ?? false, reason: check?.reason ?? null });
        else skipped.push({ index: i, reason: 'email already in this workspace' });
      }
      await audit(tx, m, 'import', 'contacts', `${created.length}`);
      return { status: 201, body: { created, skipped } };
    }, { action: 'build' });
  });

  r.get(`${T}/contacts/:id`, (ctx) => ctx.tenant(async (tx) => {
    const c = (await tx.query(`SELECT id, name, email, email_status, phone, company, title, fit_score, created_at FROM contacts WHERE id = $1`,
      [ctx.params.id])).rows[0];
    if (!c) throw notFound('contact not found');
    const evidence = (await tx.query(`SELECT id, type, source_uri, fetched_at, facts, expires_at FROM evidence WHERE contact_id = $1
      ORDER BY fetched_at DESC`, [c.id])).rows;
    const enrollments = (await tx.query(`SELECT e.id, e.state, e.step, e.heat, e.stop_reason, cp.name AS campaign_name, cp.id AS campaign_id
      FROM enrollments e JOIN campaigns cp ON cp.id = e.campaign_id WHERE e.contact_id = $1`, [c.id])).rows;
    return { ...camel(c), evidence: evidence.map(camel), enrollments: enrollments.map(camel) };
  }, { action: 'build' }));

  // Latest version of each ICP lineage.
  r.get(`${T}/icps`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT DISTINCT ON (lineage_id) id, lineage_id, name, version, data, created_at FROM icps
      WHERE archived_at IS NULL ORDER BY lineage_id, version DESC`)).rows;
    return { items: rows.map(camel) };
  }, { action: 'build' }));

  // Without lineageId: a new ICP (v1). With it: the next version; earlier versions never change (S8).
  r.post(`${T}/icps`, (ctx) => {
    const b = parse(v.object({ name: v.string({ min: 1, max: 120 }), data: v.json({ maxBytes: 20000 }), lineageId: v.optional(v.uuid()) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      let version = 1;
      if (b.lineageId) {
        const cur = (await tx.query(`SELECT max(version) AS v FROM icps WHERE lineage_id = $1`, [b.lineageId])).rows[0];
        if (cur.v === null) throw notFound('ICP lineage not found');
        version = cur.v + 1;
      }
      const row = (await tx.query(`INSERT INTO icps (org_id, workspace_id, ${b.lineageId ? 'lineage_id, ' : ''}name, version, data)
        VALUES ($1, $2, ${b.lineageId ? '$5, ' : ''}$3, $4, $${b.lineageId ? 6 : 5}) RETURNING id, lineage_id, name, version, data, created_at`,
      b.lineageId ? [m.orgId, m.workspaceId, b.name, version, b.lineageId, JSON.stringify(b.data)]
        : [m.orgId, m.workspaceId, b.name, version, JSON.stringify(b.data)])).rows[0];
      await audit(tx, m, 'create', 'icp', row.id);
      return { status: 201, body: camel(row) };
    }, { action: 'build' });
  });

  r.get(`${T}/campaigns`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT cp.id, cp.name, cp.status, cp.icp_id, cp.auto_audit_enabled,
        count(e.id)::int AS enrolled, count(e.id) FILTER (WHERE e.state NOT IN ('stopped', 'converted', 'completed'))::int AS live
      FROM campaigns cp LEFT JOIN enrollments e ON e.campaign_id = cp.id GROUP BY cp.id ORDER BY cp.name`)).rows;
    return { items: rows.map(camel) };
  }, { action: 'reports_view' }));

  r.post(`${T}/campaigns`, (ctx) => {
    const b = parse(v.object({ name: v.string({ min: 1, max: 120 }), icpId: v.optional(v.nullable(v.uuid())) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const row = (await tx.query(`INSERT INTO campaigns (org_id, workspace_id, name, icp_id) VALUES ($1, $2, $3, $4)
        RETURNING id, name, status, icp_id, auto_audit_enabled`, [m.orgId, m.workspaceId, b.name, b.icpId ?? null])).rows[0];
      await audit(tx, m, 'create', 'campaign', row.id);
      return { status: 201, body: camel(row) };
    }, { action: 'build' });
  });

  r.patch(`${T}/campaigns/:id`, (ctx) => {
    const b = parse(v.object({ name: v.optional(v.string({ min: 1, max: 120 })), status: v.optional(v.oneOf(['draft', 'active', 'paused', 'archived'])),
      autoAuditEnabled: v.optional(v.bool()) }, { atLeastOne: true }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const cols = { name: 'name', status: 'status', autoAuditEnabled: 'auto_audit_enabled' };
      const keys = Object.keys(b);
      const row = (await tx.query(`UPDATE campaigns SET ${keys.map((k, i) => `${cols[k]} = $${i + 2}`).join(', ')} WHERE id = $1
        RETURNING id, name, status, icp_id, auto_audit_enabled`, [ctx.params.id, ...keys.map((k) => b[k])])).rows[0];
      if (!row) throw notFound('campaign not found');
      await audit(tx, m, 'update', 'campaign', row.id);
      return camel(row);
    }, { action: 'build' });
  });

  r.post(`${T}/campaigns/:id/enrollments`, (ctx) => {
    const b = parse(v.object({ contactIds: v.array(v.uuid(), { min: 1, max: 500 }) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      if (!(await tx.query(`SELECT 1 FROM campaigns WHERE id = $1`, [ctx.params.id])).rows.length) throw notFound('campaign not found');
      const rows = (await tx.query(`INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id)
        SELECT $1, $2, $3, c.id FROM contacts c WHERE c.id = ANY ($4::uuid[])
        ON CONFLICT (campaign_id, contact_id) DO NOTHING RETURNING id, contact_id`,
      [m.orgId, m.workspaceId, ctx.params.id, b.contactIds])).rows;
      await audit(tx, m, 'enroll', 'campaign', ctx.params.id);
      return { status: 201, body: { enrolled: rows.map(camel), skipped: b.contactIds.length - rows.length } };
    }, { action: 'build' });
  });

  // Manual or generator-made draft → gate at once. claims: [{ text, evidence_id, fact_key }] (INFRA §12.1).
  r.post(`${T}/drafts`, async (ctx) => {
    const b = parse(v.object({
      enrollmentId: v.uuid(),
      step: v.optional(v.int({ min: 0, max: 20 })),
      channel: v.optional(v.oneOf(['email', 'linkedin_assist'])),
      subject: v.optional(v.nullable(v.string({ max: 300, trim: false }))),
      body: v.string({ min: 1, max: 20000, trim: false }),
      claims: v.optional(v.array(v.object({ text: v.string({ min: 1, max: 2000 }), evidence_id: v.uuid(), fact_key: v.string({ min: 1, max: 200 }) }), { max: 30 })),
      agentId: v.optional(v.nullable(v.uuid())),
    }), ctx.body);
    const id = await ctx.tenant(async (tx, m) => {
      const row = (await tx.query(`INSERT INTO drafts (org_id, workspace_id, enrollment_id, step, channel, subject, body, claims, status, agent_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'gating', $9) RETURNING id`,
      [m.orgId, m.workspaceId, b.enrollmentId, b.step ?? 0, b.channel ?? 'email', b.subject ?? null, b.body,
        JSON.stringify(b.claims ?? []), b.agentId ?? null])).rows[0];
      await audit(tx, m, 'create', 'draft', row.id);
      return row.id;
    }, { action: 'build' });
    const verdict = await gateDraft(ctx.client, { orgId: ctx.params.org, workspaceId: ctx.params.ws, draftId: id, now: ctx.now() });
    return { status: 201, body: { id, gate: verdict.outcome, findings: verdict.findings } };
  });
}
