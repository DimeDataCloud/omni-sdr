// The website enricher (sprint 4, the $0 slice): one contact's company homepage → one evidence row the claims gate
// can cite. Runs inside the caller's tenant transaction (withTenant as app_rw, which may INSERT evidence), so RLS
// decides which contact it can touch. Evidence is immutable (0001); a re-run writes a new row.
import { createHash } from 'node:crypto';
import { safeFetch, FetchRefused } from './fetch.mjs';
import { extractFacts } from './extract.mjs';

export const EVIDENCE_DAYS = 30;
// Free mailbox providers: their domain is not the prospect's business, so there is nothing to fetch.
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com', 'att.net', 'comcast.net',
  'verizon.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net']);

/** The homepage to fetch for an email address, or null for a free-mail or malformed address. */
export function websiteFor(email) {
  const m = /^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,63})$/i.exec(String(email ?? '').trim());
  if (!m) return null;
  const domain = m[1].toLowerCase();
  return FREEMAIL.has(domain) ? null : `https://${domain}/`;
}

/**
 * @param tx    a client inside withTenant(…, role app_rw)
 * @returns     { evidenceId, facts, url } | { skipped: reason }
 */
export async function enrichContact(tx, { orgId, workspaceId, contactId, now = new Date(), fetchPage = safeFetch }) {
  const c = (await tx.query(`SELECT email FROM contacts WHERE id = $1`, [contactId])).rows[0];
  if (!c) return { skipped: 'contact_not_found' };
  const site = websiteFor(c.email);
  if (!site) return { skipped: 'no_business_domain' };
  let page;
  try {
    page = await fetchPage(site);
  } catch (e) {
    return { skipped: e instanceof FetchRefused ? e.reason : (e?.skip ?? 'fetch_failed') };
  }
  if (page.status < 200 || page.status >= 300) return { skipped: `http_${page.status}` };
  const facts = extractFacts(page.body, page.url);
  const sha = createHash('sha256').update(page.body, 'utf8').digest('hex');
  // The same page again is the same evidence: reuse the newest unexpired row rather than adding one per press (#48
  // audit P3-2: up to ~43k rows/day/org at the route's rate limit).
  const same = (await tx.query(`SELECT id FROM evidence WHERE contact_id = $1 AND type = 'website' AND source_uri = $2 AND snapshot_sha = $3
    AND expires_at > $4 ORDER BY fetched_at DESC LIMIT 1`, [contactId, page.url, sha, now])).rows[0];
  if (same) return { evidenceId: same.id, facts, url: page.url, reused: true };
  const id = (await tx.query(
    `INSERT INTO evidence (org_id, workspace_id, contact_id, type, source_uri, fetched_at, snapshot_sha, facts, expires_at)
     VALUES ($1, $2, $3, 'website', $4, $5, $6, $7, $8) RETURNING id`,
    [orgId, workspaceId, contactId, page.url, now, sha, JSON.stringify(facts), new Date(now.getTime() + EVIDENCE_DAYS * 86400000)])).rows[0].id;
  return { evidenceId: id, facts, url: page.url };
}
