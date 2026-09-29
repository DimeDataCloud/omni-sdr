// Inbound replies (SPEC Station 15): Reply-To r+<token>@reply.omnisdr.com → the email-worker → here.
// The prospect's text is hostile input. Classification can only push toward the safe side: suppress on
// anything that looks like an opt-out, stop the sequence on any real reply, and hand everything to a human
// (rule confidence is 0.6, below the guide's 0.8 "needs you" line). Nothing here drafts or sends.
import { createHash } from 'node:crypto';
import { withoutTenant, withService } from '../../../db/src/context.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// Order matters: the safest reading wins when a reply matches several ("not interested, remove me" → unsubscribe).
const RULES = [
  ['unsubscribe', /\b(unsubscribe|remove me|take me off|opt[- ]?out|stop (emailing|contacting|sending|messaging)|do not (contact|email|message)|don'?t (contact|email|message)|no more (emails?|messages))\b|^\s*stop\s*[.!]?\s*$/i],
  ['bounce', /\b(undeliverable|delivery status notification|mail delivery (failed|subsystem)|address not found|mailbox (unavailable|not found)|recipient address rejected)\b/i],
  ['out_of_office', /\b(out of (the )?office|on (annual |parental )?leave|on vacation|auto(matic)?[- ]?reply|away (until|from)|currently away|limited access to email)\b/i],
  ['wrong_person', /\b(wrong person|not the right (person|contact)|no longer (with|at|work)|left the company)\b/i],
  ['not_interested', /\b(not interested|no thanks|no,? thank you|not a (good )?fit|not right now|we('| a)re all set|pass on this)\b/i],
  ['meeting_request', /\b((book|schedule|set up|hop on|jump on|grab) (a |some )?(call|meeting|time|demo|chat)|let'?s (talk|chat|meet|connect)|send (me |over )?(a |your |some )?(calendar|link|invite|times|availability)|(are you|you) (free|available)|what (times?|does your calendar))\b/i],
  ['referral', /\b(reach out to|talk to|contact|loop(ing)? in|cc'?(ing|d)?)\b.{0,40}@/i],
  ['question', /\?/],
];

export function classifyReply({ subject = '', body = '', from = '' }) {
  const text = `${subject}\n${body}`;
  if (/^(mailer-daemon|postmaster)@/i.test(from)) return { intent: 'bounce', confidence: 0.9, by: 'rules-1' };
  for (const [intent, re] of RULES) if (re.test(text)) return { intent, confidence: 0.6, by: 'rules-1' };
  return { intent: 'unclassified', confidence: null, by: 'rules-1' };
}

// Business minutes in the workspace's time zone, Mon–Fri 09:00–17:00 (SPEC Station 16: 2 business hours).
export function addBusinessMinutes(start, minutes, timeZone, { open = 9, close = 17 } = {}) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let t = Math.ceil(start.getTime() / 60000) * 60000;
  let left = minutes;
  for (let guard = 0; left > 0 && guard < 60 * 24 * 21; guard++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    const h = Number(parts.hour);
    if (parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && h >= open && h < close) left--;
    t += 60000;
  }
  return new Date(t);
}

export const SLA_MINUTES = 120;
const TERMINAL = `('stopped', 'converted', 'completed')`;

/**
 * @param msg { to, from, subject, body, receivedAt: Date, externalId?, channel: 'email' }
 * @returns { outcome: 'recorded'|'duplicate'|'unmatched', id?, intent?, slaDueAt? }
 */
export async function ingestReply(client, msg, { classify = classifyReply } = {}) {
  const token = /^r\+([A-Za-z0-9_-]{16,64})@/i.exec(String(msg.to ?? '').trim())?.[1];
  if (!token) return { outcome: 'unmatched' };
  const hit = await withoutTenant(client, { role: 'inbox_svc' }, async (tx) =>
    (await tx.query(`SELECT * FROM inbox_resolve_reply($1)`, [sha(token)])).rows[0]);
  if (!hit) return { outcome: 'unmatched' };

  const verdict = classify({ subject: msg.subject ?? '', body: msg.body ?? '', from: msg.from ?? '' });
  return withService(client, { orgId: hit.org_id, workspaceId: hit.workspace_id, role: 'inbox_svc' }, async (tx) => {
    if (msg.externalId) {
      const dup = (await tx.query(`SELECT id FROM inbound_messages WHERE workspace_id = $1 AND channel = $2 AND external_id = $3`,
        [hit.workspace_id, msg.channel ?? 'email', msg.externalId])).rows[0];
      if (dup) return { outcome: 'duplicate', id: dup.id };
    }
    const tz = (await tx.query(`SELECT timezone FROM workspaces WHERE id = $1`, [hit.workspace_id])).rows[0]?.timezone ?? 'America/Chicago';
    const slaDueAt = verdict.intent === 'meeting_request' ? addBusinessMinutes(msg.receivedAt, SLA_MINUTES, tz) : null;
    const id = (await tx.query(
      `INSERT INTO inbound_messages (org_id, workspace_id, contact_id, message_id, channel, from_address, subject, body,
         received_at, intent, intent_confidence, classified_by, sla_due_at, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [hit.org_id, hit.workspace_id, hit.contact_id, hit.message_id, msg.channel ?? 'email', msg.from?.slice(0, 320) ?? null,
        msg.subject?.slice(0, 998) ?? null, String(msg.body ?? '').slice(0, 100000), msg.receivedAt, verdict.intent,
        verdict.confidence, verdict.by, slaDueAt, msg.externalId ?? null])).rows[0].id;

    // Safe-side effects only.
    if (verdict.intent === 'unsubscribe' || verdict.intent === 'bounce') {
      const email = (await tx.query(`SELECT email FROM contacts WHERE id = $1`, [hit.contact_id])).rows[0]?.email;
      if (email) {
        await tx.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash($2), 'email', $3)
                        ON CONFLICT DO NOTHING`, [hit.org_id, email, verdict.intent === 'bounce' ? 'bounce' : 'reply_unsubscribe']);
      }
    }
    if (verdict.intent !== 'out_of_office') {
      await tx.query(`UPDATE enrollments SET state = 'stopped', stop_reason = $2, next_run_at = NULL
                      WHERE contact_id = $1 AND state NOT IN ${TERMINAL}`, [hit.contact_id, `reply:${verdict.intent}`]);
    }
    await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'inbound.received', $2, $3)`,
      [hit.org_id, id, JSON.stringify({ inbound_id: id, intent: verdict.intent, sla_due_at: slaDueAt })]);
    return { outcome: 'recorded', id, intent: verdict.intent, slaDueAt: slaDueAt?.toISOString() ?? null };
  });
}
