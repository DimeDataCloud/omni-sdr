import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/migrate.mjs';

export async function freshDb() {
  const db = new PGlite();
  await migrate(db);
  return db;
}

const q = (db, sql, params) => db.query(sql, params).then((r) => r.rows);
const one = async (db, sql, params) => (await q(db, sql, params))[0];

// Run fn as a DB role inside a tenant context, then return to the superuser with no context.
export async function as(db, role, ctx, fn) {
  await db.query(`SELECT set_config('app.org_id', $1, false), set_config('app.workspace_ids', $2, false)`,
    [ctx?.org ?? '', (ctx?.ws ?? []).join(',')]);
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE');
    await db.query(`SELECT set_config('app.org_id', '', false), set_config('app.workspace_ids', '', false)`);
  }
}

// Expect a statement to fail; returns the error message so callers can assert on the reason.
export async function refused(promise) {
  try {
    await promise;
  } catch (err) {
    return err.message;
  }
  return null;
}

// Seeds one complete tenant (a row in every tenant table) as the superuser.
// The draft is gated the way the gate service would, then approved by a user.
export async function seedTenant(db, label, { cap = 5, trust = 1, heat = 1 } = {}) {
  const org = (await one(db, `INSERT INTO orgs (name) VALUES ($1) RETURNING id`, [label])).id;
  const ws = (await one(db, `INSERT INTO workspaces (org_id, name, trust_level) VALUES ($1, $2, $3) RETURNING id`,
    [org, `${label}-ws`, trust])).id;
  const user = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ($1, $2) RETURNING id`,
    [`uid-${label}`, `${label}@example.test`])).id;
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')`, [org, user]);
  const contact = (await one(db,
    `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, phone)
     VALUES ($1, $2, 'Pat', $3, 'valid', '+16155550100') RETURNING id`, [org, ws, `pat@${label}.test`])).id;
  await db.query(`INSERT INTO evidence (org_id, workspace_id, contact_id, type, source_uri, fetched_at, snapshot_sha, facts, expires_at)
    VALUES ($1, $2, $3, 'website_gap', 'https://example.test', now(), 'abc', '{"booking":false}', now() + interval '30 days')`,
    [org, ws, contact]);
  const icp = (await one(db, `INSERT INTO icps (org_id, workspace_id, data) VALUES ($1, $2, '{}') RETURNING id`, [org, ws])).id;
  const campaign = (await one(db, `INSERT INTO campaigns (org_id, workspace_id, name, icp_id, status) VALUES ($1, $2, 'c1', $3, 'active') RETURNING id`,
    [org, ws, icp])).id;
  const enrollment = (await one(db,
    `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id, heat) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [org, ws, campaign, contact, heat])).id;
  const mailbox = (await one(db,
    `INSERT INTO mailboxes (org_id, workspace_id, provider, address, daily_cap) VALUES ($1, $2, 'gmail', $3, $4) RETURNING id`,
    [org, ws, `sender@${label}.test`, cap])).id;
  await db.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash('gone@x.test'), 'email', 'unsubscribe')`, [org]);
  await db.query(`INSERT INTO holds (org_id, scope_type, scope_id, reason, set_by) VALUES ($1, 'campaign', gen_random_uuid(), 'seed', 'test')`, [org]);
  await db.query(`INSERT INTO credit_balances (org_id, meter, balance) VALUES ($1, 'media', 100)`, [org]);
  await db.query(`INSERT INTO credit_ledger (org_id, meter, delta, kind) VALUES ($1, 'media', 100, 'grant')`, [org]);
  await db.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'events', 'k', '{}')`, [org]);
  await db.query(`INSERT INTO unsubscribe_tokens (token_hash, org_id, workspace_id, contact_id)
    VALUES (encode(sha256(convert_to($1, 'UTF8')), 'hex'), $2, $3, $4)`, [`unsub-${label}`, org, ws, contact]);
  await db.query(`INSERT INTO invites (org_id, email_hash, role, token_hash, invited_by, expires_at)
    VALUES ($1, value_hash($2), 'reviewer', encode(sha256(convert_to($3, 'UTF8')), 'hex'), $4, now() + interval '7 days')`,
    [org, `invitee@${label}.test`, `seed-token-${label}`, user]);
  await db.query(`INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES ($1, 'seed', 'create', 'org', $2)`, [org, org]);

  // 0005: console tables. The meeting uses its own contact (no enrollment), so the seed doesn't convert
  // the tenant's live enrollment and tests that count live enrollments stay meaningful.
  const agent = (await one(db, `INSERT INTO agents (org_id, workspace_id, name, created_by) VALUES ($1, $2, 'Sales Outbound', $3) RETURNING id`,
    [org, ws, user])).id;
  await db.query(`INSERT INTO agent_messages (org_id, workspace_id, agent_id, sender, author_id, body) VALUES ($1, $2, $3, 'user', $4, 'hello')`,
    [org, ws, agent, user]);
  await db.query(`INSERT INTO routines (org_id, workspace_id, agent_id, name, category, schedule) VALUES ($1, $2, $3, 'Morning briefing', 'briefing', 'daily 08:00')`,
    [org, ws, agent]);
  const t = { org, ws, user, contact, campaign, enrollment, mailbox, agent };
  const draft = await approvedDraft(db, t);
  const message = (await as(db, 'sender_svc', { org, ws: [ws] }, () => one(db,
    `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email') RETURNING id`,
    [org, ws, draft, mailbox]))).id;
  const inbound = (await one(db,
    `INSERT INTO inbound_messages (org_id, workspace_id, contact_id, message_id, channel, from_address, body, received_at, intent)
     VALUES ($1, $2, $3, $4, 'email', $5, 'Thanks, not now.', now(), 'not_interested') RETURNING id`,
    [org, ws, contact, message, `pat@${label}.test`])).id;
  const guest = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email) VALUES ($1, $2, 'Guest', $3) RETURNING id`,
    [org, ws, `guest@${label}.test`])).id;
  await db.query(`INSERT INTO meetings (org_id, workspace_id, contact_id, inbound_message_id, provider, starts_at, ends_at)
    VALUES ($1, $2, $3, $4, 'native', now() + interval '1 day', now() + interval '1 day 30 minutes')`, [org, ws, guest, inbound]);
  // 0008: one SLA notification per tenant, so the RLS matrix and the FK rule cover the table.
  await as(db, 'inbox_svc', { org, ws: [ws] }, () => db.query(
    `INSERT INTO notifications (org_id, workspace_id, inbound_message_id, kind, channel, due_at) VALUES ($1, $2, $3, 'sla_meeting', 'in_app', now())`,
    [org, ws, inbound]));
  return { ...t, message, inbound };
}

// A new draft for the tenant's enrollment, passed through the gate and approved.
export async function approvedDraft(db, t, { approve = true, body = 'Your booking page has no online scheduling.' } = {}) {
  const ctx = { org: t.org, ws: [t.ws] };
  const id = await as(db, 'app_rw', ctx, async () => (await one(db,
    `INSERT INTO drafts (org_id, workspace_id, enrollment_id, channel, subject, body)
     VALUES ($1, $2, $3, 'email', 'Quick note', $4) RETURNING id`, [t.org, t.ws, t.enrollment, body])).id);
  await as(db, 'gate_svc', ctx, () => db.query(
    `UPDATE drafts SET gate_passed = true, gate_body_sha = draft_sha(subject, body), gate_version = 'v1',
       gated_at = now(), status = 'review' WHERE id = $1`, [id]));
  if (approve) {
    await as(db, 'app_rw', ctx, () => db.query(
      `UPDATE drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, t.user]));
  }
  return id;
}

export function send(db, t, draftId, { mailbox = t.mailbox, ctx = { org: t.org, ws: [t.ws] } } = {}) {
  return as(db, 'sender_svc', ctx, () => db.query(
    `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email')`,
    [t.org, t.ws, draftId, mailbox]));
}

export { q, one };
