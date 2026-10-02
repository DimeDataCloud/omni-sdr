// "Find 50 Nashville dental practices" (SPEC §1 step 5; Station 11). A places search names the businesses; each one's
// own homepage, fetched through the SSRF guard, gives the evidence, the company name and an address to write to, and
// the ICP's traits give a deterministic fit score. Only the place id is kept from the search (0013). Data credits are
// spent per page of search results; pages not fetched come back.
import { randomUUID, createHash } from 'node:crypto';
import { T, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { HttpError } from '../errors.mjs';
import { safeFetch } from '../../../enrich/src/fetch.mjs';
import { extractFacts } from '../../../enrich/src/extract.mjs';
import { EVIDENCE_DAYS } from '../../../enrich/src/enrich.mjs';
import { offPlaces, PAGE_SIZE } from '../services/places.mjs';
import { hostOf, emailOn, companyFrom, siteText, pool } from '../services/leads.mjs';
import { fitScore } from '../services/fit.mjs';

const MAX_LEADS = 50;
const CREDITS_PER_PAGE = 1;   // placeholder until vendor pricing is set [VERIFY Places pricing]
const FETCHES_AT_ONCE = 8;
// The server answers within 60 s (server.mjs requestTimeout): homepages still unfetched at this point are kept as
// leads with no evidence yet, and the lead drawer's research button can fetch them later.
const FETCH_BUDGET_MS = 35000;
const pagesFor = (limit) => Math.ceil(limit / PAGE_SIZE);

export function registerLeads(r) {
  r.get(`${T}/leads/find/estimate`, (ctx) => {
    const q = parse(v.object({ limit: v.optional(v.int({ min: 1, max: MAX_LEADS })) }), ctx.query);
    return ctx.tenant(async (tx) => {
      const pages = pagesFor(q.limit ?? MAX_LEADS);
      const bal = (await tx.query(`SELECT balance FROM credit_balances WHERE meter = 'data'`)).rows[0];
      return { limit: q.limit ?? MAX_LEADS, credits: { data: pages * CREDITS_PER_PAGE }, balance: { data: bal ? Number(bal.balance) : 0 },
        available: (ctx.config.places ?? offPlaces()).name !== 'off' };
    }, { action: 'build' });
  });

  r.post(`${T}/leads/find`, async (ctx) => {
    const b = parse(v.object({
      query: v.string({ min: 3, max: 200 }),
      limit: v.optional(v.int({ min: 1, max: MAX_LEADS })),
      icpId: v.optional(v.uuid()),
    }), ctx.body);
    const places = ctx.config.places ?? offPlaces();
    if (places.name === 'off') throw new HttpError(503, 'places_off', 'finding leads by place is turned off in this environment');
    if (!ctx.allow(`leads:${ctx.user.id}`, 3, 60000, ctx.now().getTime())) throw new HttpError(429, 'rate_limited', 'one search at a time, please');
    const limit = b.limit ?? MAX_LEADS;
    const reserved = pagesFor(limit) * CREDITS_PER_PAGE;
    const job = randomUUID();
    const fetchPage = ctx.config.fetchPage ?? safeFetch;

    const { icp, known } = await ctx.tenant(async (tx, m) => {
      try { await tx.query(`SELECT app_credit_reserve('data', $1, 'lead_find', $2)`, [reserved, job]); } catch (e) {
        if (/balance_check|no data balance/.test(e.message)) throw new HttpError(402, 'insufficient_credits', `this search needs ${reserved} data credits`);
        throw e;
      }
      await audit(tx, m, 'find_leads', 'workspace', m.workspaceId);
      const icp0 = (await tx.query(`SELECT id, version, data FROM icps ${b.icpId ? 'WHERE id = $1' : ''} ORDER BY created_at DESC LIMIT 1`,
        b.icpId ? [b.icpId] : [])).rows[0] ?? null;
      const rows = (await tx.query(`SELECT place_id, website, email FROM contacts WHERE place_id IS NOT NULL OR website IS NOT NULL`)).rows;
      return { icp: icp0, known: { places: new Set(rows.map((x) => x.place_id).filter(Boolean)), hosts: new Set(rows.map((x) => hostOf(x.website)).filter(Boolean)) } };
    }, { action: 'build' });

    let pagesUsed = 0; const picked = []; const skipped = { alreadyLeads: 0, noWebsite: 0 };
    let created = [];
    try {
      // 1. The search: pages until there are enough new businesses with a website, or no more pages.
      let next = null;
      do {
        let page;
        try { page = await places.search({ query: b.query, pageToken: next }); } catch {
          if (!pagesUsed) throw new HttpError(502, 'search_failed', 'the places search didn’t come back; your credits were returned');
          break;
        }
        pagesUsed++;
        for (const p of page.places) {
          if (picked.length >= limit) break;
          const host = hostOf(p.website);
          if (!p.placeId) continue;
          if (known.places.has(p.placeId) || (host && known.hosts.has(host))) { skipped.alreadyLeads++; continue; }
          if (!host || !/^https?:\/\//i.test(p.website)) { skipped.noWebsite++; continue; }
          known.places.add(p.placeId); known.hosts.add(host);
          picked.push({ placeId: p.placeId, site: `https://${host}/`, host, place: p.address });
        }
        next = page.next;
      } while (next && picked.length < limit && pagesUsed < pagesFor(limit));

      // 2. Each homepage, a few at a time, outside any transaction.
      const deadline = Date.now() + FETCH_BUDGET_MS;
      const pages = await pool(picked, FETCHES_AT_ONCE, deadline, async (lead) => {
        try {
          const pg = await fetchPage(lead.site);
          return pg.status >= 200 && pg.status < 300 ? { page: pg } : { reason: 'site_unreachable' };
        } catch { return { reason: 'site_unreachable' }; }
      });

      // 3. The leads, their evidence and fit, in one transaction.
      created = await ctx.tenant(async (tx, m) => {
        const out = [];
        for (const [i, lead] of picked.entries()) {
          const got = pages[i] ?? {};
          const html = got.page?.body ?? '';
          const facts = got.page ? extractFacts(html, got.page.url) : null;
          const company = companyFrom(facts?.site?.title, lead.host);
          const mail = got.page ? emailOn(html, lead.host) : null;
          const { score, fit } = fitScore(icp, { company, text: got.page ? siteText(html) : '', place: lead.place });
          const row = (await tx.query(`INSERT INTO contacts (org_id, workspace_id, email, email_status, company, website, place_id, fit_score, fit)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING RETURNING id`,
          [m.orgId, m.workspaceId, mail?.email ?? null, mail?.status ?? 'unknown', company, got.page?.url?.slice(0, 300) ?? lead.site, lead.placeId,
            score, JSON.stringify(fit)])).rows[0];
          if (!row) { skipped.alreadyLeads++; continue; }
          let evidenceId = null;
          if (got.page) {
            evidenceId = (await tx.query(`INSERT INTO evidence (org_id, workspace_id, contact_id, type, source_uri, fetched_at, snapshot_sha, facts, expires_at)
              VALUES ($1, $2, $3, 'website', $4, $5, $6, $7, $8) RETURNING id`,
            [m.orgId, m.workspaceId, row.id, got.page.url, ctx.now(), createHash('sha256').update(html, 'utf8').digest('hex'), JSON.stringify(facts),
              new Date(ctx.now().getTime() + EVIDENCE_DAYS * 86400000)])).rows[0].id;
          }
          out.push({ id: row.id, company, website: got.page?.url ?? lead.site, email: mail?.email ?? null, emailStatus: mail?.status ?? 'unknown',
            roleAddress: mail?.role ?? false, fitScore: score, fit, evidenceId,
            ...(evidenceId ? {} : { evidence: got.late ? 'not_fetched_yet' : 'no_evidence_found' }) });
        }
        return out;
      }, { action: 'build' });
    } finally {
      // Pages the search actually served are spent (the vendor charges for them); the rest come back.
      await ctx.tenant(async (tx) => {
        const back = reserved - pagesUsed * CREDITS_PER_PAGE;
        if (back > 0) await tx.query(`SELECT app_credit_release('data', $1, 'lead_find', $2)`, [back, job]);
        if (pagesUsed) await tx.query(`SELECT app_credit_settle('data', 'lead_find', $1)`, [job]);
      }, { action: 'build' });
    }
    return { status: 201, body: { job, query: b.query, leads: created, skipped,
      icp: icp ? { id: icp.id, version: icp.version } : null, credits: { data: pagesUsed * CREDITS_PER_PAGE } } };
  });
}
