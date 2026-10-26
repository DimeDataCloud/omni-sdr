// The "build" side: contacts (with the free checks), versioned ICPs, campaigns, enrollments, and drafts.
// A draft is created in 'gating' and gated at once; only the gate can move it to 'review'.
// Evidence is deliberately NOT writable from here: it is a fetched, hashed snapshot made by the enricher,
// and the gate trusts it. Letting a person type evidence would let them "prove" any claim.
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, HttpError } from '../errors.mjs';
import { freeEmailChecks } from '../services/catalog.mjs';
import { normalizeLinkedIn } from '../services/inbox.mjs';
import { gateDraft } from '../../../gate/src/apply.mjs';
import { enrichContact, websiteFor } from '../../../enrich/src/enrich.mjs';
import { safeFetch } from '../../../enrich/src/fetch.mjs';

// Homepage lookups per org per minute: each is an outbound fetch from our IP, so a script can't turn it into a crawler.
const ENRICH_PER_MINUTE = 30;

const CONTACT = {
  name: v.optional(v.nullable(v.string({ max: 200 }))),
  email: v.optional(v.nullable(v.string({ max: 320 }))),
  phone: v.optional(v.nullable(v.string({ max: 40, pattern: /^\+?[0-9 ().-]{7,40}$/ }))),
  company: v.optional(v.nullable(v.string({ max: 200 }))),
  title: v.optional(v.nullable(v.string({ max: 200 }))),
  // A person's own profile. Company pages are not people and are refused; the database stores the canonical slug.
  linkedinUrl: v.optional(v.nullable(v.string({ max: 300 }))),
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
  // A row that is, or turns out to be, an opted-out person is REFUSED: it is not stored (each row runs in a savepoint that is
  // rolled back) and comes back under `held`, while the rest of the batch goes on. A held row is never left in a sendable state.
  // A duplicate skipped by address still keeps its profile link as an identity of the existing contact: the import is the
  // evidence that links it to the person who opted out by profile.
  r.post(`${T}/contacts`, (ctx) => {
    const b = parse(v.object({ contacts: v.array(v.object(CONTACT), { min: 1, max: 500 }) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const created = [];
      const skipped = [];
      const held = [];
      for (const [i, c] of b.contacts.entries()) {
        const check = c.email ? freeEmailChecks(c.email) : null;
        const profile = c.linkedinUrl ? normalizeLinkedIn(c.linkedinUrl) : null;
        if (c.linkedinUrl && !profile?.startsWith('in/')) throw new HttpError(400, 'bad_request', 'use a linkedin.com/in/… link to a person', { field: `contacts.${i}.linkedinUrl` });
        await tx.query('SAVEPOINT import_row');
        // A slug the database cannot canonicalise (a reserved escape, nested encoding) is a bad link, not a server error.
        let row;
        try {
          row = (await tx.query(
            `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, phone, company, title, linkedin_slug)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (workspace_id, email) DO NOTHING RETURNING id, email_status`,
            [m.orgId, m.workspaceId, c.name ?? null, check?.email ?? null, check?.status ?? 'unknown', c.phone ?? null,
              c.company ?? null, c.title ?? null, profile])).rows[0];
        } catch (e) {
          if (e.code === '22023') throw new HttpError(400, 'bad_request', 'that linkedin link cannot be used', { field: `contacts.${i}.linkedinUrl` });
          throw e;
        }
        if (row) {
          // person_suppressed is STABLE, so it cannot see the row inserted by the statement that calls it: ask in a new statement.
          if ((await tx.query(`SELECT person_suppressed($1) AS held`, [row.id])).rows[0].held) {
            await tx.query('ROLLBACK TO SAVEPOINT import_row');
            // The rollback also took the suppression of the row's own address and phone. When the row was held through a profile that
            // is opted out, they are that person's: write them back, outside the rolled-back work (ADV N-3).
            if (profile) await tx.query(`SELECT import_suppress_held($1, $2, $3)`, [profile, check?.email ?? null, c.phone ?? null]);
            held.push({ index: i, reason: 'matches an opted-out person' });
          } else created.push({ index: i, id: row.id, emailStatus: row.email_status, role: check?.role ?? false, reason: check?.reason ?? null });
        } else {
          skipped.push({ index: i, reason: 'email already in this workspace' });
          if (profile && check?.email) {
            const existing = (await tx.query(`SELECT id FROM contacts WHERE workspace_id = $1 AND email = $2`, [m.workspaceId, check.email])).rows[0];
            if (existing) {
              // A slug the identity table refuses must not sink the batch: the row stays skipped, unlinked.
              await tx.query('SAVEPOINT import_link');
              try { await tx.query(`SELECT record_identity($1, $2, 'import')`, [existing.id, profile]); await tx.query('RELEASE SAVEPOINT import_link'); }
              catch { await tx.query('ROLLBACK TO SAVEPOINT import_link'); }
              if ((await tx.query(`SELECT person_suppressed($1) AS held`, [existing.id])).rows[0].held) held.push({ index: i, reason: 'existing contact matches an opted-out person' });
            }
          }
        }
        await tx.query('RELEASE SAVEPOINT import_row');
      }
      await audit(tx, m, 'import', 'contacts', `${created.length}`);
      return { status: 201, body: { created, skipped, held } };
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

  // Research one contact: fetch their company homepage (SSRF-guarded, packages/enrich) and keep what it shows as
  // evidence the gate can cite. The fetch runs between two short transactions, so a slow site never holds one open.
  // Refusal reasons stay server-side: telling a caller "resolves to a non-public address" would map internal DNS.
  r.post(`${T}/contacts/:id/enrich`, async (ctx) => {
    const c = await ctx.tenant(async (tx, m) => {
      const row = (await tx.query(`SELECT email FROM contacts WHERE id = $1`, [ctx.params.id])).rows[0];
      if (!row) throw notFound('contact not found');
      return { orgId: m.orgId, email: row.email };
    }, { action: 'build' });
    if (!ctx.allow(`enrich:${c.orgId}`, ENRICH_PER_MINUTE, 60000, ctx.now().getTime())) throw new HttpError(429, 'rate_limited', 'too many lookups; try again in a minute');
    const site = websiteFor(c.email);
    if (!site) return { status: 200, body: { enriched: false, reason: 'no_business_domain' } };
    let page;
    try {
      page = await (ctx.config.fetchPage ?? safeFetch)(site);
    } catch {
      return { status: 200, body: { enriched: false, reason: 'site_unreachable' } };
    }
    const r2 = await ctx.tenant(async (tx, m) => {
      const out = await enrichContact(tx, { orgId: m.orgId, workspaceId: m.workspaceId, contactId: ctx.params.id, now: ctx.now(), fetchPage: async (url) => {
        // The address may have changed since the fetch: the page is evidence only for the site it came from (#48 audit P3-1).
        if (url !== site) throw Object.assign(new Error('address changed'), { skip: 'address_changed' });
        return page;
      } });
      if (out.evidenceId && !out.reused) await audit(tx, m, 'enrich', 'contact', ctx.params.id);
      return out;
    }, { action: 'build' });
    if (!r2.evidenceId) return { status: 200, body: { enriched: false, reason: /^http_/.test(r2.skipped ?? '') ? 'site_unreachable' : r2.skipped } };
    return { status: 201, body: { enriched: true, evidenceId: r2.evidenceId, url: r2.url, facts: r2.facts } };
  });

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
  }, { action: 'team_view' }));

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
