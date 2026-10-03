// Conversations (0015; SDR-PIVOT P1): one person on one channel. The messages stay in inbound_messages and messages;
// a conversation is the thread they belong to, its state on the way to a closer, and its latest category.

export const CHANNELS = Object.freeze(['email', 'linkedin', 'form', 'chat', 'instagram_comment', 'instagram_dm', 'facebook_comment', 'messenger']);
export const STATES = Object.freeze(['open', 'qualifying', 'qualified', 'handed_off', 'closed', 'spam']);

/** The thread key of an email conversation: the contact, so every reply from them lands in one thread. */
export const emailThreadKey = (contactId) => `contact:${contactId}`;

// An opt-out or a bounce ends the conversation for good. A conversation closed by a handoff outcome (lost, no-show,
// not a fit, won) opens again when the person writes again (#87 audit P2-1: a no-show asking to reschedule goes back
// in the queue and can be handed off again), unless what came in is an out-of-office auto-reply. Nothing else a reply
// says changes the state on its own.
const CLOSING = new Set(['unsubscribe', 'bounce']);
const NOT_A_PERSON = new Set(['out_of_office']);

/**
 * Find or open the conversation for an inbound message, inside the caller's tenant transaction (inbox_svc or app_rw).
 * @returns { id, state }
 */
export async function threadFor(tx, { orgId, workspaceId, channel, threadKey, contactId = null, at, category = null }) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel ${channel}`);
  const row = (await tx.query(
    `INSERT INTO conversations (org_id, workspace_id, contact_id, channel, thread_key, category, last_inbound_at, state, closed_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN 'closed' ELSE 'open' END, CASE WHEN $8 THEN $6 END)
     ON CONFLICT (workspace_id, channel, thread_key) DO UPDATE SET
       category = COALESCE(EXCLUDED.category, conversations.category),
       last_inbound_at = GREATEST(conversations.last_inbound_at, EXCLUDED.last_inbound_at),
       state = CASE WHEN $8 THEN 'closed'
                    WHEN $9 AND conversations.state = 'closed' AND conversations.closed_reason = 'outcome' THEN 'open'
                    ELSE conversations.state END,
       closed_reason = CASE WHEN $8 THEN EXCLUDED.closed_reason
                            WHEN $9 AND conversations.state = 'closed' AND conversations.closed_reason = 'outcome' THEN NULL
                            ELSE conversations.closed_reason END,
       updated_at = now()
     RETURNING id, state`,
    [orgId, workspaceId, contactId, channel, String(threadKey).slice(0, 500), category, at, CLOSING.has(category), !NOT_A_PERSON.has(category)])).rows[0];
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
