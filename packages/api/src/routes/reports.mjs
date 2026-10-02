// Reports and exports (SPEC §1 acceptance step 11; Station 21). The campaign report is the analytics funnel for one
// campaign (no open rate, ever: S14), as JSON for the console and as a self-contained page a browser prints to PDF.
// White-label: the page names the workspace's own org (the agency, for an agency) and never Omni-SDR.
// CSV exports carry PII, so they need `export_pii` (admin, operator) and are written to the audit log.
import { T, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound } from '../errors.mjs';

const POSITIVE = `('meeting_request', 'positive_inquiry', 'referral')`;
const SENT = `('sent', 'confirmed', 'handed_off')`;
const rate = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);   // null, not 0%, when nothing was sent

export async function campaignReport(tx, campaignId) {
  const c = (await tx.query(`SELECT c.id, c.name, c.status, c.icp_id, w.name AS workspace_name, w.timezone, o.name AS org_name, o.account_type
    FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id JOIN orgs o ON o.id = c.org_id WHERE c.id = $1`, [campaignId])).rows[0];
  if (!c) return null;
  const q = async (sql) => (await tx.query(sql, [campaignId])).rows;
  const [counts] = await q(`
    WITH e AS (SELECT id, contact_id, state FROM enrollments WHERE campaign_id = $1),
         m AS (SELECT x.id FROM messages x JOIN drafts d ON d.id = x.draft_id JOIN e ON e.id = d.enrollment_id WHERE x.state IN ${SENT}),
         r AS (SELECT i.intent FROM inbound_messages i WHERE i.message_id IN (SELECT id FROM m))
    SELECT (SELECT count(*) FROM e)::int AS enrolled,
           (SELECT count(*) FROM m)::int AS sent,
           (SELECT count(*) FROM r WHERE intent NOT IN ('bounce', 'out_of_office'))::int AS replies,
           (SELECT count(*) FROM r WHERE intent IN ${POSITIVE})::int AS positive,
           (SELECT count(*) FROM r WHERE intent = 'unsubscribe')::int AS unsubscribes,
           (SELECT count(*) FROM r WHERE intent = 'bounce')::int AS bounces,
           -- A meeting counts for this campaign when the reply it was booked from answered this campaign's email; one
           -- booked without a reply counts only when the contact is in no other campaign (#46 audit P3).
           (SELECT count(*) FROM meetings mt WHERE mt.status <> 'canceled' AND (
              mt.inbound_message_id IN (SELECT i.id FROM inbound_messages i WHERE i.message_id IN (SELECT id FROM m))
              OR (mt.inbound_message_id IS NULL AND mt.contact_id IN (SELECT contact_id FROM e)
                  AND NOT EXISTS (SELECT 1 FROM enrollments o WHERE o.contact_id = mt.contact_id AND o.campaign_id <> $1))))::int AS meetings`);
  const byStep = await q(`
    SELECT d.step, count(DISTINCT x.id)::int AS sent,
           count(DISTINCT i.message_id) FILTER (WHERE i.intent NOT IN ('bounce', 'out_of_office'))::int AS replied
    FROM messages x JOIN drafts d ON d.id = x.draft_id JOIN enrollments e ON e.id = d.enrollment_id
    LEFT JOIN inbound_messages i ON i.message_id = x.id
    WHERE e.campaign_id = $1 AND x.state IN ${SENT} GROUP BY d.step ORDER BY d.step`);
  const outcomes = await q(`SELECT i.intent, count(*)::int AS n FROM inbound_messages i
    JOIN messages x ON x.id = i.message_id JOIN drafts d ON d.id = x.draft_id JOIN enrollments e ON e.id = d.enrollment_id
    WHERE e.campaign_id = $1 GROUP BY i.intent ORDER BY n DESC, i.intent`);
  const states = await q(`SELECT state, count(*)::int AS n FROM enrollments WHERE campaign_id = $1 GROUP BY state ORDER BY state`);
  return {
    campaign: { id: c.id, name: c.name, status: c.status, icpId: c.icp_id },
    brand: { name: c.org_name, workspace: c.workspace_name, accountType: c.account_type },
    timezone: c.timezone,
    totals: counts,
    rates: { replyRate: rate(counts.replies, counts.sent), positiveRate: rate(counts.positive, counts.sent), meetingRate: rate(counts.meetings, counts.sent) },
    byStep: byStep.map((x) => ({ ...x, replyRate: rate(x.replied, x.sent) })),
    outcomes, sequences: states,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pct = (x) => (x === null ? '—' : `${x}%`);
const LABEL = { meeting_request: 'Meeting requests', positive_inquiry: 'Interested', referral: 'Referrals', question: 'Questions',
  objection: 'Objections', not_interested: 'Not interested', unsubscribe: 'Unsubscribed', out_of_office: 'Out of office', bounce: 'Bounced',
  wrong_person: 'Wrong person', unclassified: 'Other' };

/** The report as one self-contained page (no scripts, no external requests; prints to PDF from any browser). */
export function reportHtml(r, { now = new Date() } = {}) {
  const t = r.totals;
  const tile = (label, value) => `<div class="tile"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;
  const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: r.timezone }).format(now);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.campaign.name)}: campaign report</title>
<style>
  :root{color-scheme:light}
  body{margin:0;background:#F7F5F0;color:#1A1A1A;font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:860px;margin:0 auto;padding:40px 24px}
  header{border-bottom:1px solid #E8E4D9;padding-bottom:16px;margin-bottom:24px}
  .brand{font-weight:600;font-size:14px;color:#55524A}
  h1{font-size:28px;margin:4px 0}
  h2{font-size:17px;margin:32px 0 12px}
  .meta{color:#55524A;font-size:13px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
  .tile{background:#fff;border:1px solid #E8E4D9;border-radius:12px;padding:14px 16px}
  .tile .v{font-size:26px;font-weight:600}
  .tile .l{font-size:13px;color:#55524A}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E8E4D9;border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #E8E4D9;font-size:14px}
  th{font-weight:600;background:#FBFAF7}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
  footer{margin-top:32px;color:#55524A;font-size:12px}
  @media print{body{background:#fff}main{padding:0}.tile,table{break-inside:avoid}}
</style></head><body><main>
<header><div class="brand">${esc(r.brand.name)}</div><h1>${esc(r.campaign.name)}</h1>
<div class="meta">${esc(r.brand.workspace)} · Campaign report · ${esc(when)}</div></header>
<div class="tiles">${tile('Contacts in sequence', t.enrolled)}${tile('Emails sent', t.sent)}${tile('Replies', t.replies)}${tile('Positive replies', t.positive)}${tile('Meetings', t.meetings)}</div>
<h2>Rates</h2>
<div class="tiles">${tile('Reply rate', pct(r.rates.replyRate))}${tile('Positive reply rate', pct(r.rates.positiveRate))}${tile('Meetings per email', pct(r.rates.meetingRate))}</div>
<h2>By step</h2>
${r.byStep.length ? `<table><thead><tr><th>Step</th><th class="n">Sent</th><th class="n">Replied</th><th class="n">Reply rate</th></tr></thead><tbody>
${r.byStep.map((s) => `<tr><td>Email ${s.step + 1}</td><td class="n">${s.sent}</td><td class="n">${s.replied}</td><td class="n">${pct(s.replyRate)}</td></tr>`).join('')}
</tbody></table>` : '<p class="meta">Nothing has been sent yet.</p>'}
<h2>Replies by outcome</h2>
${r.outcomes.length ? `<table><thead><tr><th>Outcome</th><th class="n">Replies</th></tr></thead><tbody>
${r.outcomes.map((o) => `<tr><td>${esc(LABEL[o.intent] ?? o.intent)}</td><td class="n">${o.n}</td></tr>`).join('')}
</tbody></table>` : '<p class="meta">No replies yet.</p>'}
<footer>Rates count replies and meetings, never email opens. Unsubscribes: ${t.unsubscribes}. Bounces: ${t.bounces}.</footer>
</main></body></html>`;
}

// CSV with spreadsheet formula injection neutralised: a cell starting with = + - @ tab or CR gets a leading quote.
const cell = (x) => {
  let s = x === null || x === undefined ? '' : x instanceof Date ? x.toISOString() : String(x);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (cols, rows) => `${cols.map(([h]) => cell(h)).join(',')}\r\n${rows.map((r) => cols.map(([, k]) => cell(r[k])).join(',')).join('\r\n')}${rows.length ? '\r\n' : ''}`;

export function registerReports(r) {
  r.get(`${T}/reports/campaigns/:id`, (ctx) => {
    const q = parse(v.object({ format: v.optional(v.oneOf(['json', 'html'])) }), ctx.query);
    return ctx.tenant(async (tx, m) => {
      const rep = await campaignReport(tx, ctx.params.id);
      if (!rep) throw notFound('campaign not found');
      await audit(tx, m, 'report', 'campaign', ctx.params.id);
      return q.format === 'html' ? { status: 200, html: reportHtml(rep, { now: ctx.now() }) } : rep;
    }, { action: 'reports_view' });
  });

  r.get(`${T}/exports/contacts.csv`, (ctx) => ctx.tenant(async (tx, m) => {
    const rows = (await tx.query(`SELECT name, email, company, title, email_status, fit_score, created_at FROM contacts ORDER BY created_at, id LIMIT 50000`)).rows;
    await audit(tx, m, 'export', 'contacts', m.workspaceId);
    return { status: 200, file: { name: 'contacts.csv', type: 'text/csv; charset=utf-8', content: toCsv(
      [['Name', 'name'], ['Email', 'email'], ['Company', 'company'], ['Title', 'title'], ['Email status', 'email_status'], ['Fit score', 'fit_score'], ['Added', 'created_at']], rows) } };
  }, { action: 'export_pii' }));

  r.get(`${T}/exports/meetings.csv`, (ctx) => ctx.tenant(async (tx, m) => {
    const rows = (await tx.query(`SELECT mt.starts_at, mt.ends_at, mt.status, mt.provider, c.name, c.email, c.company
      FROM meetings mt LEFT JOIN contacts c ON c.id = mt.contact_id ORDER BY mt.starts_at LIMIT 50000`)).rows;
    await audit(tx, m, 'export', 'meetings', m.workspaceId);
    return { status: 200, file: { name: 'meetings.csv', type: 'text/csv; charset=utf-8', content: toCsv(
      [['Starts', 'starts_at'], ['Ends', 'ends_at'], ['Status', 'status'], ['Booked via', 'provider'], ['Name', 'name'], ['Email', 'email'], ['Company', 'company']], rows) } };
  }, { action: 'export_pii' }));
}

