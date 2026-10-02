// Demo tenant for the dev server: the SPEC §1 agency story ("Northside Growth") with realistic data made by
// the real pipeline. Drafts go through the real gate, approved first touches go through the real sender with a
// capture adapter (nothing leaves the process), and replies come back through the real inbox ingest.
// Every person and company is fictional and every address is on a reserved .example domain.
import { gateDraft } from '../../gate/src/apply.mjs';
import { sendDraft } from '../../sender/src/send.mjs';
import { withTenant } from '../../db/src/context.mjs';
import { ingestReply } from './services/inbox.mjs';

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];

export const DEMO_USERS = [
  { email: 'maya@example.com', role: 'admin' },
  { email: 'sam@example.com', role: 'operator' },
  { email: 'riley@example.com', role: 'reviewer' },
  { email: 'client@example.com', role: 'client_viewer', firstWorkspaceOnly: true },
];

const AGENTS = [
  ['Chief of Staff', 'chief_of_staff', 'EXEC', 'flash', 'Keeps the whole pipeline in view: what needs a decision today, what is blocked, and why.'],
  ['EA Dispatch', 'ea_dispatch', 'OPS', 'flash_lite', 'Scheduling: proposes three open slots and watches the 2-business-hour meeting-request SLA.'],
  ['Inbox Triage', 'inbox_triage', 'TRI', 'flash_lite', 'Sorts replies (meeting request, question, objection, opt-out) and flags anything that needs a person.'],
  ['Sales Outbound', 'sales_outbound', 'SDR', 'flash', 'Drafts evidence-backed first touches and follow-ups for approval. Never sends.'],
  ['Research Analyst', 'research_analyst', 'INT', 'pro', 'Competitor and prospect research with sources; every finding cites where it came from.'],
  ['Growth Marketer', 'growth_marketer', 'MKT', 'flash', 'Company-page posts and campaign angles, drafted for approval.'],
];

// fact_key values carry the numbers the gate checks claims against.
const PROSPECTS = [
  { name: 'Lena Ortiz', title: 'Owner', company: 'Brightline Family Dental', email: 'lena@brightline-dental.example', fit: 94,
    facts: { reviews: { summary: '212 Google reviews, 4.8 stars' }, booking: { summary: 'no online booking on the website' } },
    claim: ['212 Google reviews, 4.8 stars', 'reviews.summary'],
    subject: 'New-patient booking at Brightline',
    body: 'Hi Lena,\n\nBrightline has 212 Google reviews, 4.8 stars, so patients clearly like the practice. The website doesn\'t offer online booking yet, which means a new patient has to call during office hours.\n\nWould it help if new patients could book a cleaning straight from the site? I can show you what that looks like.\n\nThanks,\nMaya',
    reply: 'Hi Maya, good timing. Could we set up a call Thursday afternoon? Send me a few times that work.' },
  { name: 'Marcus Hale', title: 'Office Manager', company: 'Harbor Pediatric Dentistry', email: 'marcus@harbor-pediatric.example', fit: 91,
    facts: { hiring: { summary: 'hiring a front desk coordinator' } },
    claim: ['hiring a front desk coordinator', 'hiring.summary'],
    subject: 'Front desk coverage at Harbor',
    body: 'Hi Marcus,\n\nI saw Harbor is hiring a front desk coordinator. While that seat is open, calls and booking requests tend to pile up.\n\nWe help practices answer booking requests the same day without adding headcount. Worth a short look?\n\nThanks,\nMaya',
    reply: 'What does this cost per month, and does it work with Dentrix?' },
  { name: 'Priya Raman', title: 'Owner', company: 'Eastside Smiles', email: 'priya@eastside-smiles.example', fit: 88,
    facts: { speed: { summary: 'mobile page load of 6.2 seconds' } },
    claim: ['mobile page load of 6.2 seconds', 'speed.summary'],
    subject: 'Eastside Smiles on a phone',
    body: 'Hi Priya,\n\nI checked eastside-smiles on a phone and measured a mobile page load of 6.2 seconds. Many visitors leave before a page that slow finishes loading.\n\nWould a quick walkthrough of the fixes be useful?\n\nThanks,\nMaya',
    reply: 'Please remove me from your list.' },
  { name: 'Tom Becker', title: 'Practice Manager', company: 'Maple Grove Dental', email: 'tom@maplegrove-dental.example', fit: 83,
    facts: { reviews: { summary: '3 recent reviews mention long hold times' } },
    claim: ['3 recent reviews mention long hold times', 'reviews.summary'],
    subject: 'Hold times at Maple Grove',
    body: 'Hi Tom,\n\nI noticed 3 recent reviews mention long hold times at Maple Grove. That usually means the phones are busy right when new patients call.\n\nOpen to a short call about taking booking requests online?\n\nThanks,\nMaya' },
  { name: 'Aisha Grant', title: 'Owner', company: 'Crescent Orthodontics', email: 'aisha@crescent-ortho.example', fit: 79,
    facts: { booking: { summary: 'consultations are booked by phone only' } },
    claim: ['consultations are booked by phone only', 'booking.summary'],
    subject: 'Consult requests at Crescent',
    body: 'Hi Aisha,\n\nOn your site, consultations are booked by phone only. Parents often research after work, when the office is closed.\n\nWould it help to take consult requests online in the evening?\n\nThanks,\nMaya' },
  // Blocked on purpose: an unsupported number. Shows the gate's findings on the approval card.
  { name: 'Daniel Kim', title: 'Director', company: 'Northgate Dental Group', email: 'daniel@northgate-dental.example', fit: 72,
    facts: { hiring: { summary: 'hiring two hygienists' } },
    claim: null,
    subject: 'Northgate no-shows',
    body: 'Hi Daniel,\n\nWe cut no-shows by 40% for practices like Northgate. Worth a look?\n\nThanks,\nMaya' },
];

const FOLLOW_UP = (name) => `Hi ${name},\n\nOne more thought on online booking: it can start with a single "request a time" button, and your team still confirms every appointment.\n\nShould I send a two-minute walkthrough?\n\nThanks,\nMaya`;

export async function seedDemo(db, { now = new Date() } = {}) {
  if ((await one(db, `SELECT count(*)::int AS n FROM orgs`)).n > 0) return null;

  const org = (await one(db, `INSERT INTO orgs (name, account_type, subscription_status, trial_ends_at)
    VALUES ('Northside Growth', 'agency', 'trialing', now() + interval '5 days') RETURNING id`)).id;
  const workspaces = [];
  for (const [name, extra] of [['Brightline & friends (dental)', true], ['Harbor Legal', false], ['Summit Roofing', false]]) {
    workspaces.push((await one(db, `INSERT INTO workspaces (org_id, name, timezone, client_approvals_enabled, postal_address)
      VALUES ($1, $2, 'America/Chicago', $3, '100 Example Ave, Suite 200, Nashville, TN 37203') RETURNING id`, [org, name, extra])).id);
  }
  const w = workspaces[0];

  const users = {};
  for (const u of DEMO_USERS) {
    users[u.email] = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ($1, $2) RETURNING id`, [`dev:${u.email}`, u.email])).id;
    await db.query(`INSERT INTO memberships (org_id, user_id, role, workspace_ids) VALUES ($1, $2, $3, $4)`,
      [org, users[u.email], u.role, u.firstWorkspaceOnly ? [w] : null]);
  }
  const maya = users['maya@example.com'];

  for (const [meter, amount] of [['data', 30000], ['action', 40000], ['media', 0]]) {
    // 0012 already granted the trial credits; the demo's own grant adds to them, through the ledger as well.
    await db.query(`INSERT INTO credit_balances (org_id, meter, balance) VALUES ($1, $2, $3)
      ON CONFLICT (org_id, meter) DO UPDATE SET balance = credit_balances.balance + EXCLUDED.balance`, [org, meter, amount]);
    if (amount) await db.query(`INSERT INTO credit_ledger (org_id, meter, delta, kind, ref_type) VALUES ($1, $2, $3, 'grant', 'trial')`, [org, meter, amount]);
  }

  const agents = {};
  for (const [name, station, badge, tier, prompt] of AGENTS) {
    agents[station] = (await one(db, `INSERT INTO agents (org_id, workspace_id, name, station, badge, model_tier, system_prompt,
      context_sources, autonomous_mode, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [org, w, name, station, badge, tier, prompt, ['Approvals', 'Inbox', 'Evidence'], station !== 'research_analyst', maya])).id;
  }
  for (const wsx of workspaces.slice(1)) {
    await db.query(`INSERT INTO agents (org_id, workspace_id, name, station, badge, system_prompt, created_by)
      VALUES ($1, $2, 'Sales Outbound', 'sales_outbound', 'SDR', 'Drafts evidence-backed outreach for approval.', $3)`, [org, wsx, maya]);
  }
  await db.query(`INSERT INTO agent_messages (org_id, workspace_id, agent_id, sender, author_id, body, created_at)
    VALUES ($1, $2, $3, 'user', $4, 'What needs me today?', $5)`, [org, w, agents.chief_of_staff, maya, new Date(now.getTime() - 3600e3)]);
  await db.query(`INSERT INTO agent_messages (org_id, workspace_id, agent_id, sender, body, meta, created_at)
    VALUES ($1, $2, $3, 'agent', $4, '{"model":"seed"}', $5)`, [org, w, agents.chief_of_staff,
    'Three things: a meeting request from Brightline Family Dental with the SLA running, drafts waiting in Approvals, and one draft the gate blocked for an unsupported number.',
    new Date(now.getTime() - 3590e3)]);

  for (const [name, category, schedule, active, agent] of [
    ['Evidence harvester', 'sync', 'hourly', true, 'research_analyst'],
    ['Meeting-request SLA guard', 'triage', 'weekdays 08:00-18:00', true, 'ea_dispatch'],
    ['Morning pipeline briefing', 'briefing', 'daily 08:00', true, 'chief_of_staff'],
    ['Follow-up drafting', 'outbound', 'weekdays 10:00', false, 'sales_outbound'],
  ]) {
    await db.query(`INSERT INTO routines (org_id, workspace_id, agent_id, name, category, schedule, active) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [org, w, agents[agent], name, category, schedule, active]);
  }

  const mailbox = (await one(db, `INSERT INTO mailboxes (org_id, workspace_id, provider, address, daily_cap)
    VALUES ($1, $2, 'gmail', 'maya@northside-growth.example', 40) RETURNING id`, [org, w])).id;
  const icp = (await one(db, `INSERT INTO icps (org_id, workspace_id, name, data) VALUES ($1, $2, 'Independent dental practices', $3) RETURNING id`,
    [org, w, JSON.stringify({ industry: 'dental', size: '1-3 locations', region: 'Middle Tennessee', pains: ['phone-only booking', 'slow mobile site', 'front desk turnover'] })])).id;
  const campaign = (await one(db, `INSERT INTO campaigns (org_id, workspace_id, name, icp_id, status) VALUES ($1, $2, 'Online booking - Q4', $3, 'active') RETURNING id`,
    [org, w, icp])).id;

  const ctx = { orgId: org, workspaceId: w };
  const sentTo = [];
  for (const p of PROSPECTS) {
    const contact = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, company, title, fit_score)
      VALUES ($1, $2, $3, $4, 'valid', $5, $6, $7) RETURNING id`, [org, w, p.name, p.email, p.company, p.title, p.fit])).id;
    const evidence = (await one(db, `INSERT INTO evidence (org_id, workspace_id, contact_id, type, source_uri, fetched_at, snapshot_sha, facts, expires_at)
      VALUES ($1, $2, $3, 'website', $4, now() - interval '1 day', 'seed', $5, now() + interval '30 days') RETURNING id`,
    [org, w, contact, `https://${p.email.split('@')[1]}/`, JSON.stringify(p.facts)])).id;
    const enrollment = (await one(db, `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id, heat) VALUES ($1, $2, $3, $4, 2) RETURNING id`,
      [org, w, campaign, contact])).id;
    const claims = p.claim ? [{ text: p.claim[0], evidence_id: evidence, fact_key: p.claim[1] }] : [];
    const first = (await one(db, `INSERT INTO drafts (org_id, workspace_id, enrollment_id, step, channel, subject, body, claims, agent_id)
      VALUES ($1, $2, $3, 0, 'email', $4, $5, $6, $7) RETURNING id`, [org, w, enrollment, p.subject, p.body, JSON.stringify(claims), agents.sales_outbound])).id;
    const verdict = await gateDraft(db, { ...ctx, draftId: first, now });
    if ((verdict.outcome === 'passed') !== Boolean(p.claim)) {
      throw new Error(`seed: ${p.company} gate ${verdict.outcome}: ${JSON.stringify(verdict.findings)}`);
    }
    if (p.claim) {
      const second = (await one(db, `INSERT INTO drafts (org_id, workspace_id, enrollment_id, step, channel, subject, body, agent_id)
        VALUES ($1, $2, $3, 1, 'email', $4, $5, $6) RETURNING id`, [org, w, enrollment, `Re: ${p.subject}`, FOLLOW_UP(p.name.split(' ')[0]), agents.sales_outbound])).id;
      const v2 = await gateDraft(db, { ...ctx, draftId: second, now });
      if (v2.outcome !== 'passed') throw new Error(`seed: follow-up for ${p.company} ${JSON.stringify(v2.findings)}`);
    }
    if (p.reply) sentTo.push({ p, first, contact });
  }

  // Approve and "send" the first touches that get replies, through the real sender with a capture adapter.
  const captured = [];
  const adapter = { async send({ raw }) { captured.push(raw); return { providerMessageId: `seed-${captured.length}` }; } };
  for (const { first } of sentTo) {
    await withTenant(db, { userId: maya, orgId: org, workspaceId: w }, (tx) =>
      tx.query(`UPDATE drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [first, maya]));
    const out = await sendDraft(db, { ...ctx, draftId: first, mailboxId: mailbox, adapter,
      urls: { unsubscribeBase: 'https://app.omnisdr.example', replyDomain: 'reply.omnisdr.com' } });
    if (out.outcome !== 'sent') throw new Error(`seed: send ${out.outcome} ${out.reason ?? ''}`);
  }
  for (const [i, { p }] of sentTo.entries()) {
    const replyTo = /^Reply-To: (.+)$/mi.exec(captured[i])[1].trim();
    await ingestReply(db, { to: replyTo, from: p.email, subject: `Re: ${p.subject}`, body: p.reply,
      receivedAt: new Date(now.getTime() - (40 - i * 10) * 60000), externalId: `<seed-${i}@example>`, channel: 'email' });
  }

  // A meeting that arrived by Cal.com webhook for Aisha (ends her sequence through the trigger).
  const aisha = (await one(db, `SELECT id FROM contacts WHERE email = 'aisha@crescent-ortho.example'`)).id;
  const start = new Date(now.getTime() + 26 * 3600e3);
  await db.query(`INSERT INTO meetings (org_id, workspace_id, contact_id, provider, external_id, starts_at, ends_at, meet_url)
    VALUES ($1, $2, $3, 'cal_com', 'seed-cal-1', $4, $5, 'https://cal.example/meet/seed')`, [org, w, aisha, start, new Date(start.getTime() + 30 * 60000)]);
  await db.query(`INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES ($1, 'seed', 'create', 'org', $2)`, [org, String(org)]);

  return { org, workspaces, users, mailbox };
}
