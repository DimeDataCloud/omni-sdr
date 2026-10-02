// ICP proposal from past clients (SPEC §1 step 3). Costs Pro credits at the press; returns a proposal with the client
// rows behind every trait. Nothing is saved here: the person reviews it and saves with POST …/icps (versioned, S8).
import { randomUUID } from 'node:crypto';
import { T, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { HttpError } from '../errors.mjs';
import { cleanRows, buildIcpRequest, parseIcp, ICP_PROMPT_ID, ICP_PROMPT_SHA, ICP_TIER, ICP_CREDITS } from '../services/icp.mjs';

const ROW = v.object(Object.fromEntries(['company', 'title', 'industry', 'size', 'city', 'region', 'website', 'notes']
  .map((f) => [f, v.optional(v.nullable(v.string({ max: 500, trim: false })))])));

export function registerIcp(r) {
  r.get(`${T}/icps/propose/estimate`, (ctx) => ctx.tenant(async () => ({ credits: { action: ICP_CREDITS }, available: ctx.model.name !== 'off', tier: ICP_TIER }), { action: 'build' }));

  r.post(`${T}/icps/propose`, async (ctx) => {
    const b = parse(v.object({ clients: v.array(ROW, { min: 1, max: 200 }), notes: v.optional(v.string({ max: 2000 })) }), ctx.body);
    if (ctx.model.name === 'off') throw new HttpError(503, 'generation_off', 'text generation is turned off in this environment');
    if (!ctx.allow(`icp:${ctx.user.id}`, 6, 60000, ctx.now().getTime())) throw new HttpError(429, 'rate_limited', 'one proposal at a time, please');
    const rows = cleanRows(b.clients);
    if (!rows.length) throw new HttpError(400, 'bad_request', 'the past clients have no usable fields');
    const job = randomUUID();
    await ctx.tenant(async (tx, m) => {
      try { await tx.query(`SELECT app_credit_reserve('action', $1, 'icp_proposal', $2)`, [ICP_CREDITS, job]); } catch (e) {
        if (/balance_check|no action balance/.test(e.message)) throw new HttpError(402, 'insufficient_credits', `a proposal needs ${ICP_CREDITS} action credits`);
        throw e;
      }
      await audit(tx, m, 'icp_propose', 'workspace', m.workspaceId);
    }, { action: 'build' });
    let parsed = null; let failure = null;
    try {
      const out = await ctx.model.generate(buildIcpRequest({ rows, notes: b.notes }));
      parsed = parseIcp(out.text, rows, { hasNotes: Boolean(b.notes?.trim()) });
      if (!parsed.proposal) failure = parsed.problems.at(-1);
      else parsed.provenance = { model: out.model, tier: ICP_TIER, prompt: ICP_PROMPT_ID, prompt_sha: ICP_PROMPT_SHA, job };
    } catch { failure = 'model_failed'; }
    if (failure) {
      await ctx.tenant((tx) => tx.query(`SELECT app_credit_release('action', $1, 'icp_proposal', $2)`, [ICP_CREDITS, job]), { action: 'build' });
      throw new HttpError(502, 'proposal_failed', 'no usable proposal came back; your credits were returned', { reason: failure });
    }
    // `data` is what POST …/icps saves: the traits with their citations, plus the rows they cite, so the saved
    // version can always show why each trait is there.
    const cited = new Set(parsed.proposal.traits.flatMap((t) => t.rows));
    return { status: 200, body: { proposal: parsed.proposal, problems: parsed.problems, provenance: parsed.provenance,
      data: { summary: parsed.proposal.summary, traits: parsed.proposal.traits, sources: rows.filter((r) => cited.has(r.row)), source: 'past_clients', ...parsed.provenance } } };
  });
}
