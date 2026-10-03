// Conversations (0015; SDR-PIVOT P1): one person on one channel. The messages stay in inbound_messages and messages;
// a conversation is the thread they belong to, its state on the way to a closer, and its latest category.
import { withoutTenant, withService } from '../../../db/src/context.mjs';

export const CHANNELS = Object.freeze(['email', 'linkedin', 'form', 'chat', 'instagram_comment', 'instagram_dm', 'facebook_comment', 'messenger']);
export const STATES = Object.freeze(['open', 'qualifying', 'qualified', 'handed_off', 'closed', 'spam']);

/** The thread key of an email conversation: the contact, so every reply from them lands in one thread. */
export const emailThreadKey = (contactId) => `contact:${contactId}`;

// An opt-out or a bounce ends the conversation; nothing else a reply says changes its state on its own.
const CLOSING = new Set(['unsubscribe', 'bounce']);

/**
 * Find or open the conversation for an inbound message, inside the caller's tenant transaction (inbox_svc or app_rw).
 * @returns { id, state }
 */
export async function threadFor(tx, { orgId, workspaceId, channel, threadKey, contactId = null, at, category = null }) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel ${channel}`);
  const row = (await tx.query(
    `INSERT INTO conversations (org_id, workspace_id, contact_id, channel, thread_key, category, last_inbound_at, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN 'closed' ELSE 'open' END)
     ON CONFLICT (workspace_id, channel, thread_key) DO UPDATE SET
       category = COALESCE(EXCLUDED.category, conversations.category),
       last_inbound_at = GREATEST(conversations.last_inbound_at, EXCLUDED.last_inbound_at),
       state = CASE WHEN $8 THEN 'closed' ELSE conversations.state END,
       updated_at = now()
     RETURNING id, state`,
    [orgId, workspaceId, contactId, channel, String(threadKey).slice(0, 500), category, at, CLOSING.has(category)])).rows[0];
  return row;
}

/** Every message in a conversation, oldest first: what they wrote and what was sent, as plain text. */
export async function timeline(tx, conversation) {
  const inbound = (await tx.query(
    `SELECT id, received_at AS at, channel, subject, body, intent AS category FROM inbound_messages
     WHERE conversation_id = $1 ORDER BY received_at LIMIT 500`, [conversation.id])).rows.map((r) => ({ direction: 'in', ...r }));
  // Sent messages: those threaded here, and for an email conversation the sequence emails sent to its contact.
  const outbound = (await tx.query(
    `SELECT m.id, coalesce(m.sent_at, m.claimed_at) AS at, m.channel, d.subject, d.body, m.state
     FROM messages m JOIN drafts d ON d.id = m.draft_id LEFT JOIN enrollments e ON e.id = d.enrollment_id
     WHERE m.state IN ('sent', 'confirmed', 'handed_off')
       AND (m.conversation_id = $1 OR ($2::uuid IS NOT NULL AND $3 = 'email' AND m.channel = 'email' AND e.contact_id = $2))
     ORDER BY 2 LIMIT 500`, [conversation.id, conversation.contact_id, conversation.channel])).rows.map((r) => ({ direction: 'out', ...r }));
  return [...inbound, ...outbound].sort((a, b) => new Date(a.at) - new Date(b.at));
}

// ─── the handoff (0016; SDR-PIVOT P4) ────────────────────────────────────────────────────────────────────────────

const CATEGORY_WORDS = {
  meeting_request: 'asked for a meeting', positive_inquiry: 'is interested', question: 'asked a question',
  objection: 'raised an objection', referral: 'pointed us to someone else', not_interested: 'said not interested',
  out_of_office: 'is out of office', wrong_person: 'says they are the wrong person', unsubscribe: 'asked to stop',
  bounce: 'bounced',
};
const CHANNEL_WORDS = {
  email: 'email', linkedin: 'LinkedIn', form: 'the website form', chat: 'chat', instagram_comment: 'an Instagram comment',
  instagram_dm: 'an Instagram DM', facebook_comment: 'a Facebook comment', messenger: 'Messenger',
};

/**
 * A first draft of the handoff card, from what the conversation already holds; the person handing off edits it.
 * Rules only (no model): who, where, what they asked for, and their last words, quoted.
 */
export function draftHandoff(conversation, messages) {
  const who = conversation.contact_name || conversation.contact_email || 'This person';
  const at = conversation.contact_company ? ` (${conversation.contact_company})` : '';
  const what = CATEGORY_WORDS[conversation.category] ?? 'replied';
  const lastIn = [...messages].reverse().find((m) => m.direction === 'in');
  const quote = lastIn?.body ? ` Last message: "${String(lastIn.body).replace(/\s+/g, ' ').trim().slice(0, 280)}"` : '';
  const inbound = messages.filter((m) => m.direction === 'in').length;
  const summary = `${who}${at} ${what} via ${CHANNEL_WORDS[conversation.channel] ?? conversation.channel}; `
    + `${inbound} message${inbound === 1 ? '' : 's'} from them so far.${quote}`;
  return { reason: conversation.category === 'meeting_request' ? 'meeting_request' : 'qualified', summary: summary.slice(0, 4000) };
}

/**
 * Handoffs not accepted by their due time: one in-app alert to the workspace each, plus an outbox event (topic
 * notify.handoff) for the notify relay to push or email the workspace's admins and operators. Each once (0016 UNIQUE).
 */
export async function escalateHandoffs(client, { now = new Date(), limit = 500 } = {}) {
  const due = await withoutTenant(client, { role: 'inbox_svc' }, async (tx) =>
    (await tx.query(`SELECT * FROM inbox_handoffs_overdue($1, $2)`, [now, limit])).rows);
  let escalated = 0;
  for (const d of due) {
    await withService(client, { orgId: d.org_id, workspaceId: d.workspace_id, role: 'inbox_svc' }, async (tx) => {
      const r = await tx.query(`INSERT INTO notifications (org_id, workspace_id, handoff_id, kind, channel, due_at)
        VALUES ($1, $2, $3, 'handoff_overdue', 'in_app', $4) ON CONFLICT DO NOTHING RETURNING id`, [d.org_id, d.workspace_id, d.handoff_id, d.due_at]);
      if (!r.rows.length) return;   // another run got there first
      escalated++;
      await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'notify.handoff', $2, $3)`,
        [d.org_id, `${d.handoff_id}:overdue`, JSON.stringify({ handoff_id: d.handoff_id, workspace_id: d.workspace_id, closer_id: d.closer_id, kind: 'overdue' })]);
    });
  }
  return escalated;
}
