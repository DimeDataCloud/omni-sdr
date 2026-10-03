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
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, conflict, HttpError } from '../errors.mjs';
import { CHANNELS, STATES, timeline } from '../services/conversations.mjs';

const REASONS = ['qualified', 'meeting_request', 'asked_for_human', 'escalation'];
const OUTCOMES = ['won', 'lost', 'no_show', 'not_a_fit', 'reassigned'];
const SNIPPET = 160;

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
      if (!c) throw notFound('conversation not found');
      if (['closed', 'spam'].includes(c.state)) throw conflict(`a ${c.state} conversation can't be handed off`);
      if ((await tx.query(`SELECT 1 FROM handoffs WHERE conversation_id = $1 AND outcome IS NULL`, [c.id])).rows.length) {
        throw conflict('this conversation already has an open handoff');
      }
      let h;
      try {
        h = (await tx.query(`INSERT INTO handoffs (org_id, workspace_id, conversation_id, closer_id, reason, summary, answers, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [m.orgId, m.workspaceId, c.id, b.closerId, b.reason, b.summary, JSON.stringify(b.answers ?? {}), m.userId])).rows[0];
      } catch (e) {
        if (/not a closer, operator or admin/.test(e.message)) throw new HttpError(400, 'bad_request', 'that person can\'t take handoffs in this workspace', { field: 'closerId' });
        throw e;
      }
      // The handoffs_sync trigger marks the conversation handed off to that closer.
      await audit(tx, m, 'handoff', 'conversation', c.id);
      return { status: 201, body: camel(h) };
    }, { action: 'handoff' });
  });

  r.get(`${T}/handoffs`, (ctx) => {
    const q = parse(v.object({ open: v.optional(v.oneOf(['true', 'false'])) }), ctx.query);
    return ctx.tenant(async (tx) => {
      // RLS already narrows a closer to their own; everyone else sees the workspace's. LEFT JOIN: a closer keeps the
      // record of a handoff that ended (not won) but no longer sees its conversation.
      const rows = (await tx.query(`SELECT h.*, c.channel, c.state AS conversation_state, k.name AS contact_name, k.email AS contact_email,
          k.company AS contact_company
        FROM handoffs h LEFT JOIN conversations c ON c.id = h.conversation_id LEFT JOIN contacts k ON k.id = c.contact_id
        ${q.open === 'false' ? '' : 'WHERE h.outcome IS NULL'} ORDER BY h.created_at DESC LIMIT 200`)).rows;
      return { items: rows.map(camel) };
    }, { action: 'handoff_work' });
  });

  r.get(`${T}/handoffs/:id`, (ctx) => ctx.tenant(async (tx) => {
    const h = (await tx.query(`SELECT * FROM handoffs WHERE id = $1`, [ctx.params.id])).rows[0];
    if (!h) throw notFound('handoff not found');
    // A closer whose handoff ended (other than won) no longer sees the conversation: the handoff, not the thread.
    const c = await conversationRow(tx, h.conversation_id);
    return { ...camel(h), conversation: c ? { ...camel(c), messages: (await timeline(tx, c)).map(camel) } : null };
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
}
