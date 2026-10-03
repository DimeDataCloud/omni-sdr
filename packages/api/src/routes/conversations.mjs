// Conversations and handoffs (0015; DECISIONS 2026-10-03 pivot, SDR-PIVOT P1). The inbox becomes the product: every
// person on every channel is one conversation; a qualified one is handed to a human closer with a summary and the
// answers that qualified it. A closer sees only their handoffs (can() here, RESTRICTIVE RLS in the database).
//
//   GET  …/conversations                    the queue (inbox_read)
//   GET  …/conversations/:id                one thread, oldest first (inbox_read)
//   POST …/conversations/:id/handoff        { closerId, reason, summary, answers? } (handoff)
//   GET  …/handoffs                         yours if you're a closer, every open one otherwise (handoff_work)
//   GET  …/handoffs/:id                     the handoff and its thread (handoff_work)
//   POST …/handoffs/:id/accept              the closer takes it (handoff_work, the closer only)
//   POST …/handoffs/:id/outcome             { outcome } closes it (handoff_work); 'reassigned' not by a closer
//   GET  …/conversations/:id/handoff-draft  the card's first draft + who can take it (handoff; 0016)
//   GET  …/me/booking-link                  your booking link in this org (handoff_work; 0016)
//   PUT  …/me/booking-link                  { url | null } (handoff_work; 0016)
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, conflict, HttpError } from '../errors.mjs';
import { CHANNELS, STATES, timeline, draftHandoff } from '../services/conversations.mjs';
import { addBusinessMinutes, SLA_MINUTES } from '../services/reply-rules.mjs';

const REASONS = ['qualified', 'meeting_request', 'asked_for_human', 'escalation'];
const OUTCOMES = ['won', 'lost', 'no_show', 'not_a_fit', 'reassigned'];
const SNIPPET = 160;
// How long a closer has to accept a handoff before it escalates: the meeting SLA's clock (business minutes in the
// workspace's timezone). Proposal (SDR-PIVOT P4), not a decision.
export const HANDOFF_ACCEPT_MINUTES = SLA_MINUTES;
const BOOKING_URL = /^https:\/\/[^\s<>"]+$/;

// The handoff with what a closer needs on one card: the person, the thread, and the closer's own booking link.
async function handoffCard(tx, h) {
  const c = await conversationRow(tx, h.conversation_id);
  const closer = (await tx.query(`SELECT u.email, m.booking_url FROM users u LEFT JOIN memberships m ON m.user_id = u.id AND m.org_id = $2
    WHERE u.id = $1`, [h.closer_id, h.org_id])).rows[0];
  return { ...camel(h), overdue: !h.accepted_at && !h.outcome && h.due_at && new Date(h.due_at) <= new Date(),
    closerEmail: closer?.email ?? null, bookingUrl: closer?.booking_url ?? null,
    contact: c ? { name: c.contact_name, email: c.contact_email, company: c.contact_company } : null,
    conversation: c ? { ...camel(c), messages: (await timeline(tx, c)).map(camel) } : null };
}

async function conversationRow(tx, id) {
  return (await tx.query(`SELECT c.*, k.name AS contact_name, k.email AS contact_email, k.company AS contact_company
    FROM conversations c LEFT JOIN contacts k ON k.id = c.contact_id WHERE c.id = $1`, [id])).rows[0];
}

export function registerConversations(r) {
  r.get(`${T}/conversations`, (ctx) => {
    const q = parse(v.object({
      state: v.optional(v.oneOf(STATES)), channel: v.optional(v.oneOf(CHANNELS)),
      limit: v.optional(v.int({ min: 1, max: 200 })), offset: v.optional(v.int({ min: 0, max: 100000 })),
    }), ctx.query);
    return ctx.tenant(async (tx) => {
      const args = []; const where = [];
      if (q.state) { args.push(q.state); where.push(`c.state = $${args.length}`); }
      if (q.channel) { args.push(q.channel); where.push(`c.channel = $${args.length}`); }
      args.push(q.limit ?? 50, q.offset ?? 0);
      const rows = (await tx.query(`SELECT c.id, c.channel, c.state, c.category, c.closer_id, c.last_inbound_at, c.last_outbound_at, c.created_at,
          k.name AS contact_name, k.email AS contact_email, k.company AS contact_company,
          (SELECT left(i.body, ${SNIPPET}) FROM inbound_messages i WHERE i.conversation_id = c.id ORDER BY i.received_at DESC LIMIT 1) AS last_message
        FROM conversations c LEFT JOIN contacts k ON k.id = c.contact_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.last_inbound_at DESC NULLS LAST, c.created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args)).rows;
      return { items: rows.map(camel) };
    }, { action: 'inbox_read' });
  });

  r.get(`${T}/conversations/:id`, (ctx) => ctx.tenant(async (tx) => {
    const c = await conversationRow(tx, ctx.params.id);
    if (!c) throw notFound('conversation not found');
    const handoffs = (await tx.query(`SELECT * FROM handoffs WHERE conversation_id = $1 ORDER BY created_at DESC`, [c.id])).rows;
    return { ...camel(c), messages: (await timeline(tx, c)).map(camel), handoffs: handoffs.map(camel) };
  }, { action: 'inbox_read' }));

  r.post(`${T}/conversations/:id/handoff`, (ctx) => {
    const b = parse(v.object({
      closerId: v.uuid(), reason: v.oneOf(REASONS),
      summary: v.string({ min: 1, max: 4000 }),
      answers: v.optional(v.json({ maxBytes: 8000 })),
    }), ctx.body);
    if (b.answers !== undefined && (typeof b.answers !== 'object' || b.answers === null || Array.isArray(b.answers))) {
      throw new HttpError(400, 'bad_request', 'answers must be an object of question → answer');
    }
    return ctx.tenant(async (tx, m) => {
      const c = (await tx.query(`SELECT id, state FROM conversations WHERE id = $1 FOR UPDATE`, [ctx.params.id])).rows[0];
      const tz = (await tx.query(`SELECT timezone FROM workspaces WHERE id = $1`, [m.workspaceId])).rows[0]?.timezone ?? 'America/Chicago';
      const dueAt = addBusinessMinutes(ctx.now(), HANDOFF_ACCEPT_MINUTES, tz);
      if (!c) throw notFound('conversation not found');
      if (['closed', 'spam'].includes(c.state)) throw conflict(`a ${c.state} conversation can't be handed off`);
      if ((await tx.query(`SELECT 1 FROM handoffs WHERE conversation_id = $1 AND outcome IS NULL`, [c.id])).rows.length) {
        throw conflict('this conversation already has an open handoff');
      }
      let h;
      try {
        h = (await tx.query(`INSERT INTO handoffs (org_id, workspace_id, conversation_id, closer_id, reason, summary, answers, created_by, due_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [m.orgId, m.workspaceId, c.id, b.closerId, b.reason, b.summary, JSON.stringify(b.answers ?? {}), m.userId, dueAt])).rows[0];
      } catch (e) {
        if (/not a closer, operator or admin/.test(e.message)) throw new HttpError(400, 'bad_request', 'that person can\'t take handoffs in this workspace', { field: 'closerId' });
        throw e;
      }
      // The handoffs_sync trigger marks the conversation handed off to that closer.
      await audit(tx, m, 'handoff', 'conversation', c.id);
      // For the notify relay: tell the closer they have one (in the console, it's their open handoffs).
      await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'notify.handoff', $2, $3)`,
        [m.orgId, `${h.id}:new`, JSON.stringify({ handoff_id: h.id, workspace_id: m.workspaceId, closer_id: b.closerId, kind: 'new' })]);
      return { status: 201, body: camel(h) };
    }, { action: 'handoff' });
  });

  r.get(`${T}/handoffs`, (ctx) => {
    const q = parse(v.object({ open: v.optional(v.oneOf(['true', 'false'])) }), ctx.query);
    return ctx.tenant(async (tx) => {
      // RLS already narrows a closer to their own; everyone else sees the workspace's. LEFT JOIN: a closer keeps the
      // record of a handoff that ended (not won) but no longer sees its conversation.
      // Open first, the most urgent (earliest due, not yet accepted) on top.
      const rows = (await tx.query(`SELECT h.*, c.channel, c.state AS conversation_state, c.category, k.name AS contact_name,
          k.email AS contact_email, k.company AS contact_company,
          (h.accepted_at IS NULL AND h.outcome IS NULL AND h.due_at <= now()) AS overdue
        FROM handoffs h LEFT JOIN conversations c ON c.id = h.conversation_id LEFT JOIN contacts k ON k.id = c.contact_id
        ${q.open === 'false' ? '' : 'WHERE h.outcome IS NULL'}
        ORDER BY (h.outcome IS NULL) DESC, (h.accepted_at IS NULL) DESC, h.due_at ASC NULLS LAST, h.created_at DESC LIMIT 200`)).rows;
      return { items: rows.map(camel) };
    }, { action: 'handoff_work' });
  });

  r.get(`${T}/handoffs/:id`, (ctx) => ctx.tenant(async (tx) => {
    const h = (await tx.query(`SELECT * FROM handoffs WHERE id = $1`, [ctx.params.id])).rows[0];
    if (!h) throw notFound('handoff not found');
    // A closer whose handoff ended (other than won) no longer sees the conversation: the card has it null.
    return handoffCard(tx, h);
  }, { action: 'handoff_work' }));

  r.post(`${T}/handoffs/:id/accept`, (ctx) => ctx.tenant(async (tx, m) => {
    const h = (await tx.query(`SELECT id, closer_id, accepted_at, outcome FROM handoffs WHERE id = $1 FOR UPDATE`, [ctx.params.id])).rows[0];
    if (!h) throw notFound('handoff not found');
    if (h.closer_id !== m.userId) throw new HttpError(403, 'forbidden', 'only the closer it was handed to can accept it');
    if (h.outcome) throw conflict('this handoff is already closed');
    if (!h.accepted_at) {
      await tx.query(`UPDATE handoffs SET accepted_at = now() WHERE id = $1`, [h.id]);
      await audit(tx, m, 'handoff_accept', 'handoff', h.id);
    }
    return camel((await tx.query(`SELECT * FROM handoffs WHERE id = $1`, [h.id])).rows[0]);
  }, { action: 'handoff_work' }));

  r.post(`${T}/handoffs/:id/outcome`, (ctx) => {
    const b = parse(v.object({ outcome: v.oneOf(OUTCOMES) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const h = (await tx.query(`SELECT id, closer_id, conversation_id, outcome FROM handoffs WHERE id = $1 FOR UPDATE`, [ctx.params.id])).rows[0];
      if (!h) throw notFound('handoff not found');
      if (m.role === 'closer' && h.closer_id !== m.userId) throw new HttpError(403, 'forbidden', 'not your handoff');
      if (b.outcome === 'reassigned' && m.role === 'closer') throw new HttpError(403, 'forbidden', 'a closer can\'t reassign; ask an operator');
      if (h.outcome) throw conflict('this handoff already has an outcome');
      await tx.query(`UPDATE handoffs SET outcome = $2, outcome_at = now() WHERE id = $1`, [h.id, b.outcome]);
      // The handoffs_sync trigger settles the conversation: reassigned → open; otherwise closed until they write again,
      // and the closer keeps it only when won.
      await audit(tx, m, `handoff_${b.outcome}`, 'handoff', h.id);
      return camel((await tx.query(`SELECT * FROM handoffs WHERE id = $1`, [h.id])).rows[0]);
    }, { action: 'handoff_work' });
  });

  r.get(`${T}/conversations/:id/handoff-draft`, (ctx) => ctx.tenant(async (tx, m) => {
    const c = await conversationRow(tx, ctx.params.id);
    if (!c) throw notFound('conversation not found');
    // Who can take it: the trigger's rule (0015), shown so the person handing off picks someone who can.
    const closers = (await tx.query(`SELECT m.user_id AS id, u.email, m.role, m.booking_url IS NOT NULL AS has_booking_link
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND m.role IN ('closer', 'operator', 'admin') AND (m.workspace_ids IS NULL OR $2 = ANY (m.workspace_ids))
      ORDER BY (m.role = 'closer') DESC, u.email`, [m.orgId, m.workspaceId])).rows;
    return { ...draftHandoff(c, await timeline(tx, c)), closers: closers.map(camel) };
  }, { action: 'handoff' }));

  r.get(`${T}/me/booking-link`, (ctx) => ctx.tenant(async (tx, m) => {
    const row = (await tx.query(`SELECT booking_url FROM memberships WHERE org_id = $1 AND user_id = $2`, [m.orgId, m.userId])).rows[0];
    return { url: row?.booking_url ?? null };
  }, { action: 'handoff_work' }));

  r.put(`${T}/me/booking-link`, (ctx) => {
    const b = parse(v.object({ url: v.nullable(v.string({ min: 1, max: 500 })) }), ctx.body ?? {});
    if (b.url !== null && !BOOKING_URL.test(b.url)) throw new HttpError(400, 'bad_request', 'the booking link must be an https:// address', { field: 'url' });
    return ctx.tenant(async (tx, m) => {
      const ok = (await tx.query(`SELECT app_set_booking_url($1, $2) AS ok`, [m.orgId, b.url])).rows[0].ok;
      if (!ok) throw notFound('membership not found');
      await audit(tx, m, 'booking_link', 'membership', m.userId);
      return { url: b.url };
    }, { action: 'handoff_work' });
  });
}
