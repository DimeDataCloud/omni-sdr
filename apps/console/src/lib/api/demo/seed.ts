// The demo world: the SPEC §1 agency story ("Northside Growth"), the same people as packages/api/src/seed-demo.mjs,
// plus 30 days of history so Analytics has real rows behind every number. Everyone and every company is fictional;
// every address is on a reserved .example domain.
import type { Role } from '../types';

export interface Row { id: string }
export interface WorkspaceRow extends Row { name: string; timezone: string; trustLevel: 1 | 2 | 3; clientApprovalsEnabled: boolean; autoAdjustEnabled: boolean;
  autoAdjustSources: string[]; postalAddress: string | null; customDomain: string | null; createdAt: string }
export interface MemberRow { userId: string; email: string; name: string; role: Role; workspaceIds: string[] | null; bookingUrl?: string | null }
export interface InviteRow extends Row { email: string; role: Role; workspaceIds: string[] | null; expiresAt: string; createdAt: string; revokedAt: string | null; acceptedAt: string | null }
export interface AgentRow extends Row { ws: string; name: string; station: string; badge: string; modelTier: 'flash_lite' | 'flash' | 'pro'; systemPrompt: string;
  contextSources: string[]; autonomousMode: boolean; appearance: Record<string, unknown>; archivedAt: string | null; createdBy: string | null; createdAt: string }
export interface ChatRow extends Row { ws: string; agentId: string; sender: 'user' | 'agent'; authorId: string | null; body: string; meta: Record<string, unknown>; createdAt: string }
export interface RoutineRow extends Row { ws: string; agentId: string | null; name: string; category: 'briefing' | 'triage' | 'outbound' | 'sync'; schedule: string; active: boolean;
  pausedReason: string | null; lastRunAt: string | null; nextRunAt: string | null; createdAt: string }
export interface MailboxRow extends Row { ws: string; provider: 'gmail' | 'smtp_imap'; address: string; dailyCap: number; pausedReason: string | null }
export interface HoldRow { ws: string; scopeType: 'org' | 'workspace' | 'campaign' | 'mailbox'; scopeId: string; reason: string; setBy: string; setAt: string }
export interface ContactRow extends Row { ws: string; name: string | null; email: string | null; emailStatus: 'unknown' | 'valid' | 'invalid' | 'risky'; phone: string | null;
  company: string | null; title: string | null; fitScore: number | null; createdAt: string }
export interface EvidenceRow extends Row { ws: string; contactId: string; type: string; sourceUri: string; fetchedAt: string; facts: Record<string, unknown>; expiresAt: string }
export interface IcpRow extends Row { ws: string; lineageId: string; name: string; version: number; data: Record<string, unknown>; createdAt: string; archivedAt: string | null }
export interface CampaignRow extends Row { ws: string; name: string; status: 'draft' | 'active' | 'paused' | 'archived'; icpId: string | null; autoAuditEnabled: boolean }
export interface EnrollmentRow extends Row { ws: string; campaignId: string; contactId: string; state: string; step: number; heat: number; stopReason: string | null }
export interface DraftRow extends Row { ws: string; enrollmentId: string; step: number; channel: 'email' | 'sms' | 'linkedin_assist'; subject: string | null; body: string;
  claims: { text: string; evidence_id: string; fact_key: string }[]; status: 'generating' | 'gating' | 'blocked' | 'review' | 'approved' | 'discarded' | 'superseded';
  gatePassed: boolean; gateVersion: string | null; gatedAt: string | null; gateFindings: { code: string; detail: string }[] | null; rejectionReason: string | null;
  approvedBy: string | null; approvedAt: string | null; createdAt: string; agentId: string | null }
export interface SentRow extends Row { ws: string; draftId: string; mailboxId: string; state: 'sent'; sentAt: string; claimedAt: string }
export interface InboundRow extends Row { ws: string; contactId: string | null; messageId: string | null; channel: 'email' | 'linkedin' | 'form'; fromAddress: string | null;
  subject: string | null; body: string; receivedAt: string; intent: string; intentConfidence: number | null; classifiedBy: string | null; slaDueAt: string | null;
  handledAt: string | null; handledBy: string | null }
export interface MeetingRow extends Row { ws: string; contactId: string | null; inboundMessageId: string | null; provider: 'native' | 'calendly' | 'cal_com'; externalId: string | null;
  startsAt: string; endsAt: string; meetUrl: string | null; status: 'booked' | 'completed' | 'no_show' | 'canceled'; createdBy: string | null; createdAt: string }
export interface HandoffRow extends Row { ws: string; contactId: string; closerId: string; reason: 'qualified' | 'meeting_request' | 'asked_for_human' | 'escalation';
  summary: string; answers: Record<string, string>; createdBy: string | null; createdAt: string; dueAt: string | null; acceptedAt: string | null;
  outcome: 'won' | 'lost' | 'no_show' | 'not_a_fit' | 'reassigned' | null; outcomeAt: string | null }
export interface AuditRow { id: string; ws: string | null; actor: string; action: string; entityType: string; entityId: string; at: string }

export interface World {
  version: number;
  org: { id: string; name: string; accountType: 'owner' | 'agency'; subscriptionStatus: 'trialing'; trialEndsAt: string; featureFlags: Record<string, boolean> };
  workspaces: WorkspaceRow[]; members: MemberRow[]; invites: InviteRow[]; agents: AgentRow[]; chat: ChatRow[]; routines: RoutineRow[];
  mailboxes: MailboxRow[]; holds: HoldRow[]; suppression: string[]; contacts: ContactRow[]; evidence: EvidenceRow[]; icps: IcpRow[];
  campaigns: CampaignRow[]; enrollments: EnrollmentRow[]; drafts: DraftRow[]; sent: SentRow[]; inbound: InboundRow[]; meetings: MeetingRow[];
  audit: AuditRow[]; credits: { data: number; action: number; media: number }; handoffs: HandoffRow[];
}

export const WORLD_VERSION = 8;

// Deterministic randomness so the demo looks the same on every device.
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let idn = 0;
const uid = (p: string) => `${p}-${(++idn).toString(36).padStart(4, '0')}-${Math.random().toString(36).slice(2, 8)}`;
const iso = (d: Date) => d.toISOString();
const ago = (now: Date, min: number) => new Date(now.getTime() - min * 60000);
/** The same calendar day at hh:mm Central (UTC-5 in the demo season), skipping weekends forward. */
function businessSlot(d: Date, hour: number, minute = 0) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour + 5, minute));
  while ([0, 6].includes(new Date(x.getTime() - 5 * 3600e3).getUTCDay())) x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

export const PERSONAS: { email: string; name: string; role: Role; firstWorkspaceOnly?: boolean; blurb: string }[] = [
  { email: 'maya@example.com', name: 'Maya Chen', role: 'admin', blurb: 'Agency owner: everything' },
  { email: 'sam@example.com', name: 'Sam Rivera', role: 'operator', blurb: 'Runs campaigns and approvals' },
  { email: 'riley@example.com', name: 'Riley Brooks', role: 'reviewer', blurb: 'Approves drafts, reads the inbox' },
  { email: 'client@example.com', name: 'Dr. Lena Ortiz (client)', role: 'client_viewer', firstWorkspaceOnly: true, blurb: 'A client: sees results' },
  { email: 'cole@example.com', name: 'Cole Park (closer)', role: 'closer', firstWorkspaceOnly: true, blurb: 'Takes the conversations handed to them' },
];

const AGENTS: [string, string, string, 'flash_lite' | 'flash' | 'pro', string, string[]][] = [
  ['Chief of Staff', 'chief_of_staff', 'EXEC', 'flash', 'Keeps the whole pipeline in view: what needs a decision today, what is blocked, and why. Answers from workspace data and cites it.', ['Approvals', 'Inbox', 'Meetings', 'Analytics']],
  ['Sales Outbound', 'sales_outbound', 'SDR', 'flash', 'Drafts evidence-backed first touches and follow-ups for approval. Never sends; every claim must point at fetched evidence.', ['Leads', 'Evidence', 'ICP']],
  ['Inbox Triage', 'inbox_triage', 'TRI', 'flash_lite', 'Sorts replies (meeting request, question, objection, opt-out) and flags anything that needs a person. Opt-outs are suppressed automatically.', ['Inbox']],
  ['EA Dispatch', 'ea_dispatch', 'OPS', 'flash_lite', 'Scheduling: proposes three open slots and watches the 2-business-hour meeting-request SLA.', ['Calendar', 'Inbox']],
  ['Research Analyst', 'research_analyst', 'INT', 'pro', 'Competitor and prospect research with sources; every finding cites where it came from.', ['Web', 'Evidence']],
  ['Growth Marketer', 'growth_marketer', 'MKT', 'flash', 'Company-page posts and campaign angles, drafted for approval.', ['Brand', 'Analytics']],
];

// fact_key values carry the numbers the gate checks claims against.
const PROSPECTS = [
  { name: 'Lena Ortiz', title: 'Owner', company: 'Brightline Family Dental', email: 'lena@brightline-dental.example', fit: 94, type: 'reviews',
    facts: { reviews: { summary: '212 Google reviews, 4.8 stars' }, booking: { summary: 'no online booking on the website' } },
    claim: ['212 Google reviews, 4.8 stars', 'reviews.summary'], subject: 'New-patient booking at Brightline',
    body: "Hi Lena,\n\nBrightline has 212 Google reviews, 4.8 stars, so patients clearly like the practice. The website doesn't offer online booking yet, which means a new patient has to call during office hours.\n\nWould it help if new patients could book a cleaning straight from the site? I can show you what that looks like.\n\nThanks,\nMaya",
    reply: 'Hi Maya, good timing. Could we set up a call Thursday afternoon? Send me a few times that work.', sent: true },
  { name: 'Marcus Hale', title: 'Office Manager', company: 'Harbor Pediatric Dentistry', email: 'marcus@harbor-pediatric.example', fit: 91, type: 'job_post',
    facts: { hiring: { summary: 'hiring a front desk coordinator' } }, claim: ['hiring a front desk coordinator', 'hiring.summary'], subject: 'Front desk coverage at Harbor',
    body: "Hi Marcus,\n\nI saw Harbor is hiring a front desk coordinator. While that seat is open, calls and booking requests tend to pile up.\n\nWe help practices answer booking requests the same day without adding headcount. Worth a short look?\n\nThanks,\nMaya",
    reply: 'What does this cost per month, and does it work with Dentrix?', sent: true },
  { name: 'Priya Raman', title: 'Owner', company: 'Eastside Smiles', email: 'priya@eastside-smiles.example', fit: 88, type: 'site_speed',
    facts: { speed: { summary: 'mobile page load of 6.2 seconds' } }, claim: ['mobile page load of 6.2 seconds', 'speed.summary'], subject: 'Eastside Smiles on a phone',
    body: "Hi Priya,\n\nI checked eastside-smiles on a phone and measured a mobile page load of 6.2 seconds. Many visitors leave before a page that slow finishes loading.\n\nWould a quick walkthrough of the fixes be useful?\n\nThanks,\nMaya",
    reply: 'Please remove me from your list.', sent: true },
  { name: 'Tom Becker', title: 'Practice Manager', company: 'Maple Grove Dental', email: 'tom@maplegrove-dental.example', fit: 83, type: 'reviews',
    facts: { reviews: { summary: '3 recent reviews mention long hold times' } }, claim: ['3 recent reviews mention long hold times', 'reviews.summary'], subject: 'Hold times at Maple Grove',
    body: "Hi Tom,\n\nI noticed 3 recent reviews mention long hold times at Maple Grove. That usually means the phones are busy right when new patients call.\n\nOpen to a short call about taking booking requests online?\n\nThanks,\nMaya" },
  { name: 'Aisha Grant', title: 'Owner', company: 'Crescent Orthodontics', email: 'aisha@crescent-ortho.example', fit: 79, type: 'website',
    facts: { booking: { summary: 'consultations are booked by phone only' } }, claim: ['consultations are booked by phone only', 'booking.summary'], subject: 'Consult requests at Crescent',
    body: "Hi Aisha,\n\nOn your site, consultations are booked by phone only. Parents often research after work, when the office is closed.\n\nWould it help to take consult requests online in the evening?\n\nThanks,\nMaya", meetingSoon: true },
  { name: 'Daniel Kim', title: 'Director', company: 'Northgate Dental Group', email: 'daniel@northgate-dental.example', fit: 72, type: 'job_post',
    facts: { hiring: { summary: 'hiring two hygienists' } }, claim: null, subject: 'Northgate no-shows',
    body: 'Hi Daniel,\n\nWe cut no-shows by 40% for practices like Northgate. Worth a look?\n\nThanks,\nMaya' },
  { name: 'Rosa Delgado', title: 'Owner', company: 'Sunrise Family Dentistry', email: 'rosa@sunrise-family.example', fit: 86, type: 'reviews',
    facts: { reviews: { summary: '47 reviews mention friendly staff' }, booking: { summary: 'the contact form asks patients to call back' } },
    claim: ['47 reviews mention friendly staff', 'reviews.summary'], subject: 'Sunrise reviews',
    body: "Hi Rosa,\n\nI read through your reviews: 47 reviews mention friendly staff. The contact form still asks patients to call back, which is a lot of phone tag for a busy front desk.\n\nWant to see how practices take those requests online instead?\n\nThanks,\nMaya" },
  { name: 'Ethan Park', title: 'Practice Owner', company: 'Riverbend Dental Studio', email: 'ethan@riverbend-dental.example', fit: 81, type: 'website',
    facts: { hours: { summary: 'closed on Saturdays' } }, claim: ['closed on Saturdays', 'hours.summary'], subject: 'Weekend booking at Riverbend',
    body: "Hi Ethan,\n\nRiverbend is closed on Saturdays, which is when many families plan appointments.\n\nWould it help if they could request a time over the weekend and your team confirmed on Monday?\n\nThanks,\nMaya" },
];

const FOLLOW_UP = (first: string) => `Hi ${first},\n\nOne more thought on online booking: it can start with a single "request a time" button, and your team still confirms every appointment.\n\nShould I send a two-minute walkthrough?\n\nThanks,\nMaya`;

const HISTORY_FIRST = ['Nora', 'James', 'Olivia', 'Mateo', 'Grace', 'Leo', 'Hannah', 'Owen', 'Zoe', 'Caleb', 'Ivy', 'Miles', 'Chloe', 'Eli', 'Ruby', 'Isaac', 'Maya', 'Jonah', 'Ava', 'Theo'];
const HISTORY_LAST = ['Walsh', 'Nguyen', 'Foster', 'Silva', 'Patel', 'Morris', 'Kowalski', 'Reyes', 'Bennett', 'Ahmed', 'Lindqvist', 'Okafor', 'Duarte', 'Hughes', 'Tanaka', 'Moreau'];
const HISTORY_CO = ['Oakridge Dental', 'Bluebird Smiles', 'Cedar Park Orthodontics', 'Lakeview Family Dental', 'Parkside Dental Care', 'Willow Creek Dentistry',
  'Summit Smile Studio', 'Greenway Dental', 'Hillcrest Pediatric Dental', 'Stonebridge Dental', 'Meadowbrook Dental', 'Harborview Orthodontics'];

export function buildWorld(now = new Date()): World {
  idn = 0;
  const rand = rng(20260929);
  const org = { id: uid('org'), name: 'Northside Growth', accountType: 'agency' as const, subscriptionStatus: 'trialing' as const,
    trialEndsAt: iso(new Date(now.getTime() + 5 * 86400e3)), // Generation flags ON in the demo only, so Studio's Create can be judged (STUDIO-PLAN decision 3, default (a) pending
    // Christian). Nothing is generated: the demo draws labeled samples on the device. Production orgs start with every flag OFF.
    featureFlags: { level2: false, imageGeneration: true, videoGeneration: true } };
  const mkWs = (name: string, clientApprovals: boolean): WorkspaceRow => ({ id: uid('ws'), name, timezone: 'America/Chicago', trustLevel: 1,
    clientApprovalsEnabled: clientApprovals, autoAdjustEnabled: false, autoAdjustSources: ['booked_meetings', 'rejections'],
    postalAddress: '100 Example Ave, Suite 200, Nashville, TN 37203', customDomain: null, createdAt: iso(ago(now, 60 * 24 * 21)) });
  const workspaces = [mkWs('Brightline & friends (dental)', true), mkWs('Harbor Legal', false), mkWs('Summit Roofing', false)];
  const [w0, w1] = workspaces;
  const members: MemberRow[] = PERSONAS.map((p) => ({ userId: uid('user'), email: p.email, name: p.name, role: p.role, workspaceIds: p.firstWorkspaceOnly ? [w0.id] : null }));
  const maya = members[0].userId;

  const w: World = { version: WORLD_VERSION, org, workspaces, members, invites: [], agents: [], chat: [], routines: [], mailboxes: [], holds: [], suppression: [],
    contacts: [], evidence: [], icps: [], campaigns: [], enrollments: [], drafts: [], sent: [], inbound: [], meetings: [], audit: [], credits: { data: 30000, action: 38420, media: 0 }, handoffs: [] };

  // Agents
  const agentIds: Record<string, string> = {};
  for (const [name, station, badge, tier, prompt, sources] of AGENTS) {
    const id = uid('agent');
    agentIds[station] = id;
    w.agents.push({ id, ws: w0.id, name, station, badge, modelTier: tier, systemPrompt: prompt, contextSources: sources,
      autonomousMode: station !== 'research_analyst', appearance: {}, archivedAt: null, createdBy: maya, createdAt: iso(ago(now, 60 * 24 * 20)) });
  }
  for (const ws of workspaces.slice(1)) {
    w.agents.push({ id: uid('agent'), ws: ws.id, name: 'Sales Outbound', station: 'sales_outbound', badge: 'SDR', modelTier: 'flash',
      systemPrompt: 'Drafts evidence-backed outreach for approval.', contextSources: ['Leads'], autonomousMode: false, appearance: {}, archivedAt: null, createdBy: maya, createdAt: iso(ago(now, 60 * 24 * 7)) });
  }
  // Agent bodies are filled in by store.prime() from the finished world (brain.answer), never hand-written.
  const chat = (agent: string, sender: 'user' | 'agent', body: string, minAgo: number, meta: Record<string, unknown> = {}) =>
    w.chat.push({ id: uid('msg'), ws: w0.id, agentId: agentIds[agent], sender, authorId: sender === 'user' ? maya : null, body, meta, createdAt: iso(ago(now, minAgo)) });
  chat('chief_of_staff', 'user', 'What needs me today?', 62);
  chat('chief_of_staff', 'agent', '', 61, { model: 'demo', tier: 'flash', ms: 820 });
  chat('sales_outbound', 'user', 'Why was the Northgate draft blocked?', 180);
  chat('sales_outbound', 'agent', '', 179, { model: 'demo', tier: 'flash', ms: 960 });

  // Routines
  for (const [name, category, schedule, active, agent, runMin] of [
    ['Evidence harvester', 'sync', 'hourly', true, 'research_analyst', 34], ['Meeting-request SLA guard', 'triage', 'weekdays 08:00-18:00', true, 'ea_dispatch', 12],
    ['Morning pipeline briefing', 'briefing', 'daily 08:00', true, 'chief_of_staff', 60 * 10], ['Follow-up drafting', 'outbound', 'weekdays 10:00', false, 'sales_outbound', null],
    ['Competitor watch', 'sync', 'mondays 07:00', true, 'research_analyst', 60 * 30],
  ] as const) {
    w.routines.push({ id: uid('routine'), ws: w0.id, agentId: agentIds[agent], name, category, schedule, active, pausedReason: name === 'Competitor watch' ? 'ops: provider quota review' : null,
      lastRunAt: runMin === null ? null : iso(ago(now, runMin)), nextRunAt: null, createdAt: iso(ago(now, 60 * 24 * 14)) });
  }

  // Mailboxes
  const mb = { id: uid('mailbox'), ws: w0.id, provider: 'gmail' as const, address: 'maya@northside-growth.example', dailyCap: 40, pausedReason: null };
  w.mailboxes.push(mb, { id: uid('mailbox'), ws: w0.id, provider: 'smtp_imap', address: 'outreach@northside-growth.example', dailyCap: 25, pausedReason: null });

  // ICP + campaigns
  const icp: IcpRow = { id: uid('icp'), ws: w0.id, lineageId: uid('lineage'), name: 'Independent dental practices', version: 1, archivedAt: null, createdAt: iso(ago(now, 60 * 24 * 18)),
    data: { industry: 'Dental', size: '1-3 locations', region: 'Middle Tennessee', pains: ['phone-only booking', 'slow mobile site', 'front desk turnover'], titles: ['Owner', 'Practice Manager', 'Office Manager'] } };
  w.icps.push(icp);
  const camp: CampaignRow = { id: uid('campaign'), ws: w0.id, name: 'Online booking - Q4', status: 'active', icpId: icp.id, autoAuditEnabled: false };
  const pastCamp: CampaignRow = { id: uid('campaign'), ws: w0.id, name: 'Reviews follow-through - Sept', status: 'active', icpId: icp.id, autoAuditEnabled: false };
  w.campaigns.push(camp, pastCamp);

  const addContact = (ws: string, p: { name: string; email: string; company: string; title: string; fit: number }, created: Date, status: ContactRow['emailStatus'] = 'valid') => {
    const c: ContactRow = { id: uid('contact'), ws, name: p.name, email: p.email, emailStatus: status, phone: null, company: p.company, title: p.title, fitScore: p.fit, createdAt: iso(created) };
    w.contacts.push(c); return c;
  };
  const addEvidence = (ws: string, contactId: string, type: string, domain: string, facts: Record<string, unknown>, fetched: Date) => {
    const e: EvidenceRow = { id: uid('evidence'), ws, contactId, type, sourceUri: `https://${domain}/`, fetchedAt: iso(fetched), facts, expiresAt: iso(new Date(fetched.getTime() + 30 * 86400e3)) };
    w.evidence.push(e); return e;
  };
  const addDraft = (d: Omit<DraftRow, 'id' | 'gatePassed' | 'gateVersion' | 'gatedAt' | 'gateFindings' | 'rejectionReason' | 'approvedBy' | 'approvedAt' | 'status'> & Partial<DraftRow>) => {
    const row: DraftRow = { status: 'gating', gatePassed: false, gateVersion: null, gatedAt: null, gateFindings: null, rejectionReason: null, approvedBy: null, approvedAt: null, ...d, id: uid('draft') } as DraftRow;
    w.drafts.push(row); return row;
  };

  // History: 30 days of sends and replies on the past campaign, so Analytics reflects rows.
  const historyReplies = ['Thanks, not right now.', 'Can you send pricing?', 'Out of office until Monday.', 'Sure, let us talk next week. What times work?',
    'We already use a booking tool.', 'Who else in Nashville uses this?', 'Please take me off this list.', 'Interesting. Send me a short video?'];
  for (let i = 0; i < 44; i++) {
    const name = `${HISTORY_FIRST[i % HISTORY_FIRST.length]} ${HISTORY_LAST[(i * 7) % HISTORY_LAST.length]}`;
    const company = HISTORY_CO[i % HISTORY_CO.length];
    const email = `${name.split(' ')[0].toLowerCase()}.${i}@${company.toLowerCase().replace(/[^a-z]/g, '')}.example`;
    const dayAgo = 2 + Math.floor(rand() * 28);
    const created = ago(now, dayAgo * 1440 + 600);
    const c = addContact(w0.id, { name, email, company, title: ['Owner', 'Practice Manager', 'Office Manager'][i % 3], fit: 60 + Math.floor(rand() * 35) }, created);
    const ev = addEvidence(w0.id, c.id, 'reviews', email.split('@')[1], { reviews: { summary: `${10 + i} Google reviews` } }, created);
    const enr: EnrollmentRow = { id: uid('enr'), ws: w0.id, campaignId: pastCamp.id, contactId: c.id, state: 'waiting', step: 0, heat: 1, stopReason: null };
    w.enrollments.push(enr);
    const steps = 1 + Math.floor(rand() * 3);
    for (let s = 0; s < steps; s++) {
      const sentAt = ago(now, (dayAgo - s * 3) * 1440 - Math.floor(rand() * 480));
      if (sentAt > ago(now, 1440)) break;
      const d = addDraft({ ws: w0.id, enrollmentId: enr.id, step: s, channel: 'email', subject: s ? 'Re: booking' : `Reviews at ${company}`,
        body: s ? FOLLOW_UP(name.split(' ')[0]) : `Hi ${name.split(' ')[0]},\n\nYou have ${10 + i} Google reviews. Want patients to book online too?\n\nThanks,\nMaya`,
        claims: s ? [] : [{ text: `${10 + i} Google reviews`, evidence_id: ev.id, fact_key: 'reviews.summary' }], agentId: agentIds.sales_outbound, createdAt: iso(ago(sentAt, 120)) });
      Object.assign(d, { status: 'approved', gatePassed: true, gateVersion: 'gate-1', gatedAt: iso(ago(sentAt, 110)), gateFindings: [], approvedBy: maya, approvedAt: iso(ago(sentAt, 60)) });
      const sent: SentRow = { id: uid('sent'), ws: w0.id, draftId: d.id, mailboxId: rand() > 0.3 ? mb.id : w.mailboxes[1].id, state: 'sent', sentAt: iso(sentAt), claimedAt: iso(sentAt) };
      w.sent.push(sent);
      w.audit.push({ id: uid('audit'), ws: w0.id, actor: maya, action: 'approve', entityType: 'draft', entityId: d.id, at: iso(ago(sentAt, 60)) });
      enr.step = s + 1;
      if (s === steps - 1 && rand() < 0.36) {
        const text = historyReplies[Math.floor(rand() * historyReplies.length)];
        const intent = /take me off/.test(text) ? 'unsubscribe' : /out of office/i.test(text) ? 'out_of_office' : /times work|talk next week/.test(text) ? 'meeting_request'
          : /pricing|who else|video/i.test(text) ? (/video/i.test(text) ? 'positive_inquiry' : 'question') : 'not_interested';
        const rec = new Date(sentAt.getTime() + (3 + rand() * 30) * 3600e3);
        if (rec > now) continue;
        w.inbound.push({ id: uid('reply'), ws: w0.id, contactId: c.id, messageId: sent.id, channel: 'email', fromAddress: email, subject: 'Re: booking', body: text,
          receivedAt: iso(rec), intent, intentConfidence: 0.6, classifiedBy: 'rules-1', slaDueAt: null, handledAt: iso(new Date(rec.getTime() + 3600e3)), handledBy: maya });
        if (intent !== 'out_of_office') { enr.state = 'stopped'; enr.stopReason = `reply:${intent}`; }
        if (intent === 'unsubscribe') w.suppression.push(email);
        if (intent === 'meeting_request') {
          const start = businessSlot(new Date(rec.getTime() + 2 * 86400e3), 10 + Math.floor(rand() * 6), rand() > 0.5 ? 30 : 0);
          w.meetings.push({ id: uid('meeting'), ws: w0.id, contactId: c.id, inboundMessageId: null, provider: 'native', externalId: null, startsAt: iso(start),
            endsAt: iso(new Date(start.getTime() + 1800e3)), meetUrl: 'https://meet.example/northside', status: start < now ? (rand() > 0.2 ? 'completed' : 'no_show') : 'booked', createdBy: maya, createdAt: iso(rec) });
          enr.state = 'converted'; enr.stopReason = 'meeting_booked';
        }
      } else if (s === steps - 1 && steps === 3) { enr.state = 'completed'; }
    }
  }

  // Today's prospects (gated by the store when it loads; see store.ts).
  const todays: { p: typeof PROSPECTS[number]; contact: ContactRow; first: DraftRow }[] = [];
  PROSPECTS.forEach((p, i) => {
    // Found overnight by the hourly evidence harvester, and researched the same minute (the Home briefing counts them).
    const contact = addContact(w0.id, p, ago(now, 300 + i * 10));
    const ev = addEvidence(w0.id, contact.id, p.type, p.email.split('@')[1], p.facts, ago(now, 299 + i * 10));
    const enr: EnrollmentRow = { id: uid('enr'), ws: w0.id, campaignId: camp.id, contactId: contact.id, state: 'awaiting_approval', step: 0, heat: 2, stopReason: null };
    w.enrollments.push(enr);
    const first = addDraft({ ws: w0.id, enrollmentId: enr.id, step: 0, channel: 'email', subject: p.subject, body: p.body,
      claims: p.claim ? [{ text: p.claim[0], evidence_id: ev.id, fact_key: p.claim[1] }] : [], agentId: agentIds.sales_outbound, createdAt: iso(ago(now, 90 - i * 7)) });
    if (p.claim) addDraft({ ws: w0.id, enrollmentId: enr.id, step: 1, channel: 'email', subject: `Re: ${p.subject}`, body: FOLLOW_UP(p.name.split(' ')[0]), claims: [],
      agentId: agentIds.sales_outbound, createdAt: iso(ago(now, 88 - i * 7)) });
    todays.push({ p, contact, first });
  });

  // Aisha booked through Cal.com; her sequence ends.
  const aisha = todays.find((t) => t.p.meetingSoon)!;
  const start = businessSlot(new Date(now.getTime() + 20 * 3600e3), 10, 30);
  w.meetings.push({ id: uid('meeting'), ws: w0.id, contactId: aisha.contact.id, inboundMessageId: null, provider: 'cal_com', externalId: 'cal-1', startsAt: iso(start),
    endsAt: iso(new Date(start.getTime() + 1800e3)), meetUrl: 'https://cal.example/meet/northside', status: 'booked', createdBy: null, createdAt: iso(ago(now, 40)) });

  // Harbor Legal: a little data. Summit Roofing: empty on purpose (empty states).
  const lawIcp: IcpRow = { id: uid('icp'), ws: w1.id, lineageId: uid('lineage'), name: 'Small law firms', version: 1, archivedAt: null, createdAt: iso(ago(now, 60 * 24 * 5)),
    data: { industry: 'Legal', size: '2-15 attorneys', region: 'Tennessee' } };
  w.icps.push(lawIcp);
  const lawCamp: CampaignRow = { id: uid('campaign'), ws: w1.id, name: 'Intake speed', status: 'draft', icpId: lawIcp.id, autoAuditEnabled: false };
  w.campaigns.push(lawCamp);
  for (const [name, company, email] of [['Paul Nakamura', 'Nakamura & Lowe', 'paul@nakamuralowe.example'], ['Dana Whitfield', 'Whitfield Family Law', 'dana@whitfieldlaw.example']] as const) {
    const c = addContact(w1.id, { name, email, company, title: 'Managing Partner', fit: 77 }, ago(now, 60 * 24));
    w.evidence.push({ id: uid('evidence'), ws: w1.id, contactId: c.id, type: 'website', sourceUri: `https://${email.split('@')[1]}/`, fetchedAt: iso(ago(now, 1440)),
      facts: { intake: { summary: 'the intake form has 14 required fields' } }, expiresAt: iso(ago(now, -1440 * 29)) });
    w.enrollments.push({ id: uid('enr'), ws: w1.id, campaignId: lawCamp.id, contactId: c.id, state: 'waiting', step: 0, heat: 1, stopReason: null });
  }

  w.audit.push({ id: uid('audit'), ws: null, actor: 'seed', action: 'create', entityType: 'org', entityId: org.id, at: iso(ago(now, 60 * 24 * 21)) });
  (w as World & { _todays?: unknown })._todays = todays.map((t) => ({ firstDraftId: t.first.id, sendNow: Boolean(t.p.sent), reply: t.p.reply ?? null, email: t.p.email, subject: t.p.subject }));
  return w;
}
