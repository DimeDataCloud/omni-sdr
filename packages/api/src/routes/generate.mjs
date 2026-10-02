// Generate a campaign's sequences (SPEC §1 step 6; Station 7's run rule). The estimate shows what a run costs before
// anyone presses; the press is the consent, and credits are reserved at that moment (one action credit per lead
// that has facts to cite). Leads that fail to generate get their credit back. Every draft lands in Approvals through
// the gate: generation never approves or sends anything.
import { randomUUID } from 'node:crypto';
import { T, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, HttpError } from '../errors.mjs';
import { gateDraft } from '../../../gate/src/apply.mjs';
import { citableFacts, buildRequest, parseSequence, PROMPT_ID, PROMPT_SHA, TIER, CREDITS_PER_LEAD } from '../services/generate.mjs';

const MAX_PER_RUN = 10;   // synchronous for the MVP: ~10 model calls fit well inside a request

// Enrollments in this campaign with no drafts yet, each with its contact and citable facts.
async function candidates(tx, campaignId, limit, now) {
  const rows = (await tx.query(`SELECT e.id, e.contact_id, c.name, c.company, c.title FROM enrollments e JOIN contacts c ON c.id = e.contact_id
    WHERE e.campaign_id = $1 AND e.state IN ('waiting', 'drafting') AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.enrollment_id = e.id)
    ORDER BY e.id LIMIT $2`, [campaignId, limit])).rows;
  const ev = rows.length ? (await tx.query(`SELECT id, contact_id, facts FROM evidence WHERE contact_id = ANY ($1::uuid[]) AND expires_at > $2
    ORDER BY fetched_at DESC`, [rows.map((r) => r.contact_id), now])).rows : [];
  return rows.map((r) => ({ ...r, facts: citableFacts(ev.filter((x) => x.contact_id === r.contact_id)) }));
}

async function offerFor(tx, campaignId, brief) {
  const c = (await tx.query(`SELECT c.name, i.name AS icp_name, i.data AS icp, w.name AS workspace FROM campaigns c
    LEFT JOIN icps i ON i.id = c.icp_id JOIN workspaces w ON w.id = c.workspace_id WHERE c.id = $1`, [campaignId])).rows[0];
  if (!c) return null;
  return { business: c.workspace, campaign: c.name, brief: brief ?? null, ideal_customer: c.icp_name ? { name: c.icp_name, ...c.icp } : null };
}

export function registerGenerate(r) {
  r.get(`${T}/campaigns/:id/generate/estimate`, (ctx) => {
    const q = parse(v.object({ limit: v.optional(v.int({ min: 1, max: MAX_PER_RUN })) }), ctx.query);
    return ctx.tenant(async (tx) => {
      if (!(await tx.query(`SELECT 1 FROM campaigns WHERE id = $1`, [ctx.params.id])).rows.length) throw notFound('campaign not found');
      const list = await candidates(tx, ctx.params.id, q.limit ?? MAX_PER_RUN, ctx.now());
      const ready = list.filter((x) => x.facts.length > 0).length;
      const bal = (await tx.query(`SELECT balance FROM credit_balances WHERE meter = 'action'`)).rows[0];
      return { leads: list.length, ready, missingEvidence: list.length - ready, credits: { action: ready * CREDITS_PER_LEAD },
        balance: { action: bal ? Number(bal.balance) : 0 }, available: ctx.model.name !== 'off', tier: TIER, prompt: PROMPT_ID };
    }, { action: 'build' });
  });

  r.post(`${T}/campaigns/:id/generate`, async (ctx) => {
    const b = parse(v.object({
      limit: v.optional(v.int({ min: 1, max: MAX_PER_RUN })),
      steps: v.optional(v.int({ min: 1, max: 3 })),
      brief: v.optional(v.string({ min: 1, max: 2000 })),
    }), ctx.body ?? {});
    if (ctx.model.name === 'off') throw new HttpError(503, 'generation_off', 'text generation is turned off in this environment');
    if (!ctx.allow(`generate:${ctx.user.id}`, 6, 60000, ctx.now().getTime())) throw new HttpError(429, 'rate_limited', 'one run at a time, please');
    const steps = b.steps ?? 3;
    const job = randomUUID();

    // The press: pick the leads and reserve their credits in one transaction.
    const { leads, offer } = await ctx.tenant(async (tx, m) => {
      const offer0 = await offerFor(tx, ctx.params.id, b.brief);
      if (!offer0) throw notFound('campaign not found');
      const all = await candidates(tx, ctx.params.id, b.limit ?? MAX_PER_RUN, ctx.now());
      const ready = all.filter((x) => x.facts.length > 0);
      if (ready.length) {
        try {
          await tx.query(`SELECT app_credit_reserve('action', $1, 'generate', $2)`, [ready.length * CREDITS_PER_LEAD, job]);
        } catch (e) {
          if (/balance_check|no action balance/.test(e.message)) {
            throw new HttpError(402, 'insufficient_credits', `this run needs ${ready.length * CREDITS_PER_LEAD} action credits`);
          }
          throw e;
        }
      }
      await audit(tx, m, 'generate', 'campaign', ctx.params.id);
      return { leads: all, offer: offer0 };
    }, { action: 'build' });

    const generated = []; const skipped = []; let failed = 0;
    for (const lead of leads) {
      if (!lead.facts.length) { skipped.push({ enrollmentId: lead.id, reason: 'no_evidence' }); continue; }
      let out; const started = Date.now();
      try {
        out = await ctx.model.generate(buildRequest({ steps, offer,
          prospect: { name: lead.name, company: lead.company, title: lead.title }, facts: lead.facts }));
      } catch {
        failed++; skipped.push({ enrollmentId: lead.id, reason: 'model_failed' }); continue;
      }
      const { drafts, problems } = parseSequence(out.text, lead.facts, steps);
      if (!drafts.length) { failed++; skipped.push({ enrollmentId: lead.id, reason: problems[0] ?? 'no_drafts' }); continue; }
      const provenance = { model: out.model, tier: TIER, prompt: PROMPT_ID, prompt_sha: PROMPT_SHA, job, ms: Date.now() - started,
        ...(problems.length ? { problems: problems.slice(0, 5) } : {}) };
      const ids = await ctx.tenant(async (tx, m) => {
        const made = [];
        for (const d of drafts) {
          made.push({ step: d.step, id: (await tx.query(`INSERT INTO drafts (org_id, workspace_id, enrollment_id, step, channel, subject, body, claims, status, generated)
            VALUES ($1, $2, $3, $4, 'email', $5, $6, $7, 'gating', $8) RETURNING id`,
          [m.orgId, m.workspaceId, lead.id, d.step, d.subject, d.body, JSON.stringify(d.claims), JSON.stringify(provenance)])).rows[0].id });
        }
        await tx.query(`UPDATE enrollments SET state = 'awaiting_approval' WHERE id = $1 AND state IN ('waiting', 'drafting')`, [lead.id]);
        return made;
      }, { action: 'build' });
      const gated = [];
      for (const d of ids) {
        const verdict = await gateDraft(ctx.client, { orgId: ctx.params.org, workspaceId: ctx.params.ws, draftId: d.id, now: ctx.now() });
        gated.push({ ...d, gate: verdict.outcome, findings: verdict.findings });
      }
      generated.push({ enrollmentId: lead.id, drafts: gated });
    }

    // Leads that failed get their credit back; leads with no facts were never charged.
    if (failed) {
      await ctx.tenant((tx) => tx.query(`SELECT app_credit_release('action', $1, 'generate', $2)`, [failed * CREDITS_PER_LEAD, job]), { action: 'build' });
    }
    const charged = leads.filter((l) => l.facts.length).length - failed;
    return { status: 201, body: { job, generated, skipped, credits: { action: charged * CREDITS_PER_LEAD } } };
  });
}
