// Conversations (0014; SDR-PIVOT P1): one person on one channel. The messages stay in inbound_messages and messages;
// a conversation is the thread they belong to, its state on the way to a closer, and its latest category.

export const CHANNELS = Object.freeze(['email', 'linkedin', 'form', 'instagram', 'facebook', 'chat']);
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
