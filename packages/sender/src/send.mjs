// The send path (INFRA §14): claim → provider → record. Exactly once, fails closed.
//
// 1. Claim (one transaction, as sender_svc): INSERT messages. send_guard() runs here and refuses
//    anything unapproved, edited, held, suppressed, unverified, over cap, or outside trust level. The
//    unsubscribe token is issued in the same transaction. Commit.
// 2. Hand the composed message to the provider adapter, outside any transaction.
// 3. Record (one transaction): state 'sent' + provider id + outbox 'message.sent', or 'failed' + error.
//
// No automatic retry: a retry would reuse the claimed row, and send_guard only runs on INSERT, so an
// unsubscribe or hold that lands between attempts would be missed. Failed stays failed until a guard
// re-check function exists (proposal in the PR). A crash between 2 and 3 leaves 'claimed' with no
// provider id; reconciliation flags it for a human and never resends (draft_id is UNIQUE).
import { randomBytes, createHash } from 'node:crypto';
import { withService } from '../../db/src/context.mjs';
import { composeEmail } from './compose.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const token = () => randomBytes(24).toString('base64url');
// The Reply-To token is lowercase hex: mail servers may lower-case an address's local part, and a token that changed
// case would no longer match its hash, so the reply would be lost (found in the 2026-10-02 audit).
const replyToken = () => randomBytes(24).toString('hex');

/**
 * @param client  one DB connection
 * @param opts    { orgId, workspaceId, draftId, mailboxId, adapter, urls: { unsubscribeBase, replyDomain } }
 * @returns       { outcome: 'sent'|'failed'|'refused'|'already_claimed', reason?, messageId?, providerMessageId? }
 */
export async function sendDraft(client, { orgId, workspaceId, draftId, mailboxId, adapter, urls }) {
  const ctx = { orgId, workspaceId, role: 'sender_svc' };
  let claim;
  try {
    claim = await withService(client, ctx, async (tx) => {
      const existing = (await tx.query(`SELECT id, state FROM messages WHERE draft_id = $1`, [draftId])).rows[0];
      if (existing) return { outcome: 'already_claimed', reason: existing.state, messageId: existing.id };

      const d = (await tx.query(
        `SELECT d.subject, d.body, d.channel, c.id AS contact_id, c.email, w.postal_address
         FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN contacts c ON c.id = e.contact_id
         JOIN workspaces w ON w.id = d.workspace_id WHERE d.id = $1`, [draftId])).rows[0];
      if (!d) return { outcome: 'refused', reason: 'draft not found in this workspace' };
      if (d.channel !== 'email') return { outcome: 'refused', reason: `channel ${d.channel} is not sent by this path` };
      if (!d.postal_address) return { outcome: 'refused', reason: 'workspace has no postal address (required in every outreach email)' };
      const mb = (await tx.query(`SELECT address, provider FROM mailboxes WHERE id = $1`, [mailboxId])).rows[0];
      if (!mb) return { outcome: 'refused', reason: 'mailbox not found in this workspace' };

      const unsub = token();
      const reply = replyToken();
      const messageId = (await tx.query(
        `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel, reply_token_hash)
         VALUES ($1, $2, $3, $4, 'email', $5) RETURNING id`,   // send_guard() runs here
        [orgId, workspaceId, draftId, mailboxId, sha(reply)])).rows[0].id;
      await tx.query(
        `INSERT INTO unsubscribe_tokens (token_hash, org_id, workspace_id, contact_id) VALUES ($1, $2, $3, $4)`,
        [sha(unsub), orgId, workspaceId, d.contact_id]);
      return {
        outcome: 'claimed', messageId, mailbox: mb,
        raw: composeEmail({
          from: mb.address, to: d.email, replyTo: `r+${reply}@${urls.replyDomain}`,
          subject: d.subject ?? '', body: d.body, postalAddress: d.postal_address,
          unsubscribeUrl: `${urls.unsubscribeBase}/u/${unsub}`,
        }).raw,
      };
    });
  } catch (err) {
    if (/^send_guard:/.test(err.message)) return { outcome: 'refused', reason: err.message };
    throw err;
  }
  if (claim.outcome !== 'claimed') return claim;

  let result;
  try {
    result = { ok: true, ...(await adapter.send({ raw: claim.raw, mailbox: claim.mailbox })) };
  } catch (err) {
    result = { ok: false, error: `${err.kind ?? 'unknown'}: ${err.message}`.slice(0, 500) };
  }

  await withService(client, ctx, async (tx) => {
    if (result.ok) {
      await tx.query(`UPDATE messages SET state = 'sent', provider_message_id = $2, sent_at = now() WHERE id = $1`,
        [claim.messageId, result.providerMessageId]);
    } else {
      await tx.query(`UPDATE messages SET state = 'failed', error = $2 WHERE id = $1`, [claim.messageId, result.error]);
    }
    await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, $2, $3, $4)`,
      [orgId, result.ok ? 'message.sent' : 'message.failed', claim.messageId,
        JSON.stringify({ message_id: claim.messageId, draft_id: draftId, error: result.ok ? null : result.error })]);
  });
  return result.ok
    ? { outcome: 'sent', messageId: claim.messageId, providerMessageId: result.providerMessageId }
    : { outcome: 'failed', messageId: claim.messageId, reason: result.error };
}
