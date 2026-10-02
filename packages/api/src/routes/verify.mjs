// Verify contacts' email addresses (SPEC §1 step 5; Station 11). Free checks first, for nothing; then the vendor, one
// Data credit per address it checks. Only app_email_verified() (0014) can make an address 'valid', and only for a job
// that reserved its credit. What the vendor didn't answer is refunded and the job settled, in a finally.
import { randomUUID } from 'node:crypto';
import { T, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { HttpError } from '../errors.mjs';
import { freeEmailChecks } from '../services/catalog.mjs';
import { mxOk, offVerifier } from '../services/verify.mjs';
import { pool } from '../services/leads.mjs';

const MAX_PER_RUN = 50;
const CREDITS_PER_CHECK = 1;   // placeholder until the vendor's unit price is known [VERIFY]
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const VENDOR_BUDGET_MS = 40000;   // under server.mjs's 60 s request timeout

export function registerVerify(r) {
  r.post(`${T}/contacts/verify`, async (ctx) => {
    const b = parse(v.object({ contactIds: v.array(v.uuid(), { min: 1, max: MAX_PER_RUN }) }), ctx.body);
    if (!ctx.allow(`verify:${ctx.user.id}`, 6, 60000, ctx.now().getTime())) throw new HttpError(429, 'rate_limited', 'one check at a time, please');
    const verifier = ctx.config.verifier ?? offVerifier();
    const ids = [...new Set(b.contactIds)];
    const results = new Map();

    // 1. Who they are, and the free checks (no credit): syntax and disposable here, MX outside any transaction.
    const rows = await ctx.tenant((tx) => tx.query(`SELECT id, email, email_status FROM contacts WHERE id = ANY ($1::uuid[])`, [ids]).then((x) => x.rows), { action: 'build' });
    for (const id of ids) if (!rows.some((x) => x.id === id)) results.set(id, { contactId: id, outcome: 'not_found' });
    const todo = [];
    for (const c of rows) {
      if (!c.email) { results.set(c.id, { contactId: c.id, outcome: 'no_email' }); continue; }
      if (c.email_status === 'valid') { results.set(c.id, { contactId: c.id, email: c.email, outcome: 'valid', by: 'earlier' }); continue; }
      const free = freeEmailChecks(c.email);
      if (free.status === 'invalid') { results.set(c.id, { contactId: c.id, email: c.email, outcome: 'invalid', by: 'free', reason: free.reason }); continue; }
      todo.push(c);
    }
    const domains = [...new Set(todo.map((c) => c.email.split('@')[1]))];
    const mx = new Map(await Promise.all(domains.map(async (d) => [d, await mxOk(d, ctx.config.resolveMx)])));
    const paid = [];
    for (const c of todo) {
      if (mx.get(c.email.split('@')[1]) === false) results.set(c.id, { contactId: c.id, email: c.email, outcome: 'invalid', by: 'free', reason: 'no_mx' });
      else paid.push(c);
    }
    const freeInvalid = [...results.values()].filter((x) => x.by === 'free').map((x) => x.contactId);

    // 2. Save what the free checks found; claim and pay for the rest (one transaction).
    const job = randomUUID();
    const mine = await ctx.tenant(async (tx, m) => {
      if (freeInvalid.length) await tx.query(`UPDATE contacts SET email_status = 'invalid' WHERE id = ANY ($1::uuid[]) AND email_status <> 'valid'`, [freeInvalid]);
      await audit(tx, m, 'verify', 'workspace', m.workspaceId);
      if (verifier.name === 'off' || !paid.length) return [];
      const now = ctx.now();
      const got = new Set((await tx.query(`UPDATE contacts SET verify_job = $2, verify_at = $3 WHERE id = ANY ($1::uuid[])
        AND (verify_job IS NULL OR verify_at < $4) RETURNING id`, [paid.map((c) => c.id), job, now, new Date(now.getTime() - CLAIM_LEASE_MS)])).rows.map((x) => x.id));
      const claimed = paid.filter((c) => got.has(c.id));
      for (const c of paid) if (!got.has(c.id)) results.set(c.id, { contactId: c.id, email: c.email, outcome: 'already_running' });
      if (claimed.length) {
        try { await tx.query(`SELECT app_credit_reserve('data', $1, 'email_verify', $2)`, [claimed.length * CREDITS_PER_CHECK, job]); } catch (e) {
          if (/balance_check|no data balance/.test(e.message)) throw new HttpError(402, 'insufficient_credits', `checking ${claimed.length} addresses needs ${claimed.length * CREDITS_PER_CHECK} data credits`);
          throw e;
        }
      }
      return claimed;
    }, { action: 'build' });
    if (verifier.name === 'off') for (const c of paid) results.set(c.id, { contactId: c.id, email: c.email, outcome: 'unknown', by: 'free', reason: 'vendor_off' });

    // 3. The vendor, a few at a time, outside any transaction; each answer written through app_email_verified().
    let delivered = 0;
    try {
      const answers = await pool(mine, 5, Date.now() + VENDOR_BUDGET_MS, async (c) => {
        try { return await verifier.check(c.email); } catch { return null; }
      });
      await ctx.tenant(async (tx) => {
        for (const [i, c] of mine.entries()) {
          const a = answers[i];
          if (!a || a.late || !['valid', 'invalid', 'risky', 'unknown'].includes(a.verdict)) {
            results.set(c.id, { contactId: c.id, email: c.email, outcome: 'unknown', by: 'vendor', reason: 'no_answer' }); continue;
          }
          await tx.query('SAVEPOINT v');
          try {
            await tx.query(`SELECT app_email_verified($1, $2, $3, $4, $5)`, [c.id, c.email, a.verdict, verifier.name, job]);
            await tx.query('RELEASE SAVEPOINT v');
            delivered++;
            results.set(c.id, { contactId: c.id, email: c.email, outcome: a.verdict, by: 'vendor' });
          } catch (e) {
            await tx.query('ROLLBACK TO SAVEPOINT v');
            if (!/address changed|contact not found/.test(e.message)) throw e;
            results.set(c.id, { contactId: c.id, email: c.email, outcome: 'unknown', by: 'vendor', reason: 'address_changed' });
          }
        }
      }, { action: 'build' });
    } finally {
      if (mine.length) {
        await ctx.tenant(async (tx) => {
          const back = (mine.length - delivered) * CREDITS_PER_CHECK;
          if (back > 0) await tx.query(`SELECT app_credit_release('data', $1, 'email_verify', $2)`, [back, job]);
          if (delivered) await tx.query(`SELECT app_credit_settle('data', 'email_verify', $1)`, [job]);
          await tx.query(`UPDATE contacts SET verify_job = NULL, verify_at = NULL WHERE verify_job = $1`, [job]);
        }, { action: 'build' });
      }
    }
    return { status: 200, body: { job: mine.length ? job : null, vendor: verifier.name, results: ids.map((id) => results.get(id)),
      credits: { data: delivered * CREDITS_PER_CHECK } } };
  });
}
