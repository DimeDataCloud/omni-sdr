// Competitor research (SPEC §1 step 4; Station 10). Suggestions come with a reason and need the user's confirm
// before research spends credits (DECISIONS 2026-09-28). Research fetches each competitor's own pages through the
// SSRF guard (packages/enrich), keeps immutable snapshots, and writes the next battlecard version, in which every
// statement quotes its snapshot. The gap map and the version diff are derived, no model.
import { randomUUID, createHash } from 'node:crypto';
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, badRequest, conflict, HttpError } from '../errors.mjs';
import { safeFetch } from '../../../enrich/src/fetch.mjs';
import { SUGGEST, CARD, SUGGEST_CREDITS, CARD_CREDITS, SECTIONS, domainOf, suggestRequest, parseSuggestions, pageText, morePages,
  cardRequest, validateCard, diffCards } from '../services/research.mjs';

const MAX_PER_RUN = 5;

async function reserve(tx, amount, refType, job, what) {
  try { await tx.query(`SELECT app_credit_reserve('action', $1, $2, $3)`, [amount, refType, job]); } catch (e) {
    if (/balance_check|no action balance/.test(e.message)) throw new HttpError(402, 'insufficient_credits', `${what} needs ${amount} action credits`);
    throw e;
  }
}
const release = (ctx, amount, refType, job) => ctx.tenant((tx) => tx.query(`SELECT app_credit_release('action', $1, $2, $3)`, [amount, refType, job]), { action: 'build' });

export function registerCompetitors(r) {
  r.get(`${T}/competitors`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT c.*, b.version AS card_version, b.created_at AS card_at
      FROM competitors c LEFT JOIN LATERAL (SELECT version, created_at FROM battlecards WHERE competitor_id = c.id ORDER BY version DESC LIMIT 1) b ON true
      WHERE c.status <> 'dismissed' ORDER BY c.status DESC, c.name`)).rows;
    return { items: rows.map(camel) };
  }, { action: 'team_view' }));

  r.post(`${T}/competitors`, (ctx) => {
    const b = parse(v.object({ url: v.string({ min: 3, max: 300 }), name: v.optional(v.string({ min: 1, max: 120 })) }), ctx.body);
    const domain = domainOf(b.url);
    if (!domain) throw badRequest('that doesn’t look like a website', { field: 'url' });
    return ctx.tenant(async (tx, m) => {
      const row = (await tx.query(`INSERT INTO competitors (org_id, workspace_id, name, domain) VALUES ($1, $2, $3, $4)
        ON CONFLICT (workspace_id, domain) DO UPDATE SET status = 'confirmed' RETURNING *`, [m.orgId, m.workspaceId, b.name ?? domain, domain])).rows[0];
      await audit(tx, m, 'add', 'competitor', row.id);
      return { status: 201, body: camel(row) };
    }, { action: 'build' });
  });

  r.post(`${T}/competitors/:id/status`, (ctx) => {
    const b = parse(v.object({ status: v.oneOf(['confirmed', 'dismissed']) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const row = (await tx.query(`UPDATE competitors SET status = $2 WHERE id = $1 RETURNING *`, [ctx.params.id, b.status])).rows[0];
      if (!row) throw notFound('competitor not found');
      await audit(tx, m, b.status === 'confirmed' ? 'confirm' : 'dismiss', 'competitor', row.id);
      return camel(row);
    }, { action: 'build' });
  });

  // "Find my competitors": one grounded call; each suggestion lands as `suggested`, with its reason and the pages the
  // search used. Nothing is researched until a person confirms it.
  r.post(`${T}/competitors/suggest`, async (ctx) => {
    if (ctx.model.name === 'off') throw new HttpError(503, 'generation_off', 'text generation is turned off in this environment');
    if (!ctx.allow(`suggest:${ctx.user.id}`, 4, 60000, ctx.now().getTime())) throw new HttpError(429, 'rate_limited', 'one search at a time, please');
    const job = randomUUID();
    const business = await ctx.tenant(async (tx, m) => {
      await reserve(tx, SUGGEST_CREDITS, 'competitor_suggest', job, 'a search');
      const p = (await tx.query(`SELECT w.name, p.offer, p.website FROM workspaces w LEFT JOIN workspace_profiles p ON p.workspace_id = w.id WHERE w.id = $1`,
        [m.workspaceId])).rows[0];
      const icp = (await tx.query(`SELECT name, data FROM icps ORDER BY created_at DESC LIMIT 1`)).rows[0];
      const known = (await tx.query(`SELECT domain FROM competitors`)).rows.map((x) => x.domain);
      return { name: p.name, offer: p.offer, website: p.website, ideal_customer: icp ? { name: icp.name, summary: icp.data?.summary ?? null } : null, known_competitors: known };
    }, { action: 'build' });
    let found;
    try {
      const out = await ctx.model.generate(suggestRequest(business));
      const own = domainOf(business.website ?? '');
      found = { list: parseSuggestions(out.text, { exclude: [...business.known_competitors, ...(own ? [own] : [])] }), sources: out.sources ?? [], model: out.model };
    } catch {
      await release(ctx, SUGGEST_CREDITS, 'competitor_suggest', job);
      throw new HttpError(502, 'search_failed', 'the search didn’t come back; your credit was returned');
    }
    const items = await ctx.tenant(async (tx, m) => {
      const made = [];
      for (const s of found.list) {
        const row = (await tx.query(`INSERT INTO competitors (org_id, workspace_id, name, domain, status, source, reason, suggested_sources)
          VALUES ($1, $2, $3, $4, 'suggested', 'suggested', $5, $6) ON CONFLICT (workspace_id, domain) DO NOTHING RETURNING *`,
        [m.orgId, m.workspaceId, s.name, s.domain, s.reason, JSON.stringify(found.sources.slice(0, 10))])).rows[0];
        if (row) made.push(camel(row));
      }
      return made;
    }, { action: 'build' });
    return { status: 201, body: { suggestions: items, sources: found.sources, prompt: SUGGEST.id } };
  });

  r.get(`${T}/competitors/research/estimate`, (ctx) => ctx.tenant(async (tx) => {
    const n = Number((await tx.query(`SELECT count(*) AS n FROM competitors WHERE status = 'confirmed'`)).rows[0].n);
    return { competitors: Math.min(n, MAX_PER_RUN), credits: { action: Math.min(n, MAX_PER_RUN) * CARD_CREDITS }, available: ctx.model.name !== 'off' };
  }, { action: 'build' }));

  // Research: snapshot each confirmed competitor's homepage and up to 2 of its pages (pricing first), then write the
  // next battlecard version from those snapshots only. A statement whose quote isn't on its page is dropped.
  r.post(`${T}/competitors/research`, async (ctx) => {
    const b = parse(v.object({ ids: v.optional(v.array(v.uuid(), { min: 1, max: MAX_PER_RUN })) }), ctx.body ?? {});
    if (ctx.model.name === 'off') throw new HttpError(503, 'generation_off', 'text generation is turned off in this environment');
    if (!ctx.allow(`research:${ctx.user.id}`, 4, 60000, ctx.now().getTime())) throw new HttpError(429, 'rate_limited', 'one run at a time, please');
    const fetchPage = ctx.config.fetchPage ?? safeFetch;
    const job = randomUUID();
    const { list, us } = await ctx.tenant(async (tx, m) => {
      const rows = (await tx.query(`SELECT id, name, domain, status FROM competitors WHERE status <> 'dismissed'
        ${b.ids ? 'AND id = ANY ($1::uuid[])' : ''} ORDER BY name LIMIT ${MAX_PER_RUN}`, b.ids ? [b.ids] : [])).rows;
      const unconfirmed = rows.filter((x) => x.status !== 'confirmed');
      if (unconfirmed.length) throw conflict('confirm a suggested competitor before researching it', { ids: unconfirmed.map((x) => x.id) });
      if (!rows.length) throw badRequest('no confirmed competitors to research');
      await reserve(tx, rows.length * CARD_CREDITS, 'battlecard', job, 'this research');
      await audit(tx, m, 'research', 'workspace', m.workspaceId);
      const p = (await tx.query(`SELECT w.name, p.offer, p.website FROM workspaces w LEFT JOIN workspace_profiles p ON p.workspace_id = w.id WHERE w.id = $1`,
        [m.workspaceId])).rows[0];
      return { list: rows, us: { name: p.name, offer: p.offer, website: p.website } };
    }, { action: 'build' });

    const results = []; let failed = 0;
    for (const comp of list) {
      // Fetch outside any transaction: a slow site never holds one open.
      const pages = [];
      try {
        const home = await fetchPage(`https://${comp.domain}/`);
        if (home.status >= 200 && home.status < 300) {
          pages.push({ url: home.url, body: home.body });
          for (const url of morePages(home.body, home.url)) {
            try { const p = await fetchPage(url); if (p.status >= 200 && p.status < 300) pages.push({ url: p.url, body: p.body }); } catch { /* one page short */ }
          }
        }
      } catch { /* the site refused or failed */ }
      const texts = pages.map((p) => ({ url: p.url, text: pageText(p.body) })).filter((p) => p.text.length >= 40);
      if (!texts.length) { failed++; results.push({ competitorId: comp.id, outcome: 'site_unreachable' }); continue; }
      const snapshots = await ctx.tenant(async (tx, m) => {
        const made = [];
        for (const [i, p] of texts.entries()) {
          const sha = createHash('sha256').update(p.text, 'utf8').digest('hex');
          const row = (await tx.query(`INSERT INTO competitor_snapshots (org_id, workspace_id, competitor_id, url, fetched_at, sha, text)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, fetched_at`, [m.orgId, m.workspaceId, comp.id, p.url.slice(0, 500), ctx.now(), sha, p.text])).rows[0];
          made.push({ ref: `S${i + 1}`, id: row.id, url: p.url, text: p.text, sha, fetchedAt: row.fetched_at });
        }
        return made;
      }, { action: 'build' });
      let card;
      try {
        const out = await ctx.model.generate(cardRequest({ us, snapshots }));
        card = { ...validateCard(out.text, snapshots), model: out.model };
      } catch { card = null; }
      if (!card?.doc || card.kept === 0) { failed++; results.push({ competitorId: comp.id, outcome: 'no_cited_statements', dropped: card?.dropped ?? 0 }); continue; }
      const saved = await ctx.tenant(async (tx) => {
        const ver = Number((await tx.query(`SELECT coalesce(max(version), 0) AS v FROM battlecards WHERE competitor_id = $1`, [comp.id])).rows[0].v) + 1;
        return (await tx.query(`INSERT INTO battlecards (org_id, workspace_id, competitor_id, version, doc, source_refs, generated)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, version`, [ctx.params.org, ctx.params.ws, comp.id, ver, JSON.stringify(card.doc), JSON.stringify(card.refs),
          JSON.stringify({ model: card.model, tier: 'pro', prompt: CARD.id, prompt_sha: CARD.sha, job, kept: card.kept, dropped: card.dropped })])).rows[0];
      }, { action: 'build' });
      results.push({ competitorId: comp.id, outcome: 'ok', battlecardId: saved.id, version: saved.version, kept: card.kept, dropped: card.dropped });
    }
    if (failed) await release(ctx, failed * CARD_CREDITS, 'battlecard', job);
    return { status: 201, body: { job, results, credits: { action: (list.length - failed) * CARD_CREDITS } } };
  });

  // Versions of one battlecard, newest first, each with what changed since the one before.
  r.get(`${T}/competitors/:id/battlecards`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT id, version, doc, source_refs, generated, created_at FROM battlecards WHERE competitor_id = $1 ORDER BY version DESC LIMIT 20`,
      [ctx.params.id])).rows;
    if (!rows.length && !(await tx.query(`SELECT 1 FROM competitors WHERE id = $1`, [ctx.params.id])).rows.length) throw notFound('competitor not found');
    return { items: rows.map((x, i) => ({ ...camel(x), changes: rows[i + 1] ? diffCards(rows[i + 1].doc, x.doc) : null })) };
  }, { action: 'team_view' }));

  // The positioning gap map across every competitor's latest battlecard: who each targets, whether pricing is public,
  // their strengths and weaknesses, and where we win, each statement still carrying its source.
  r.get(`${T}/competitors/gap-map`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT c.id, c.name, c.domain, b.version, b.doc FROM competitors c
      JOIN LATERAL (SELECT version, doc FROM battlecards WHERE competitor_id = c.id ORDER BY version DESC LIMIT 1) b ON true
      WHERE c.status = 'confirmed' ORDER BY c.name`)).rows;
    return {
      columns: ['targets', 'pricing', 'strengths', 'weaknesses', 'where_we_win'],
      rows: rows.map((x) => ({ competitorId: x.id, name: x.name, domain: x.domain, version: x.version,
        ...Object.fromEntries(['targets', 'pricing', 'strengths', 'weaknesses', 'where_we_win'].map((s) => [s, (x.doc?.[s] ?? []).slice(0, 4)])),
        pricingPublic: (x.doc?.pricing ?? []).length > 0 })),
      whereWeWin: rows.flatMap((x) => (x.doc?.where_we_win ?? []).map((w) => ({ competitor: x.name, ...w }))),
      sections: SECTIONS,
    };
  }, { action: 'team_view' }));
}
