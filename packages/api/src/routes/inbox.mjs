// Inbox (Station 15) and meetings (Station 16). Replies are recorded by the inbox worker only; people read
// them, mark them handled, and book meetings from them. A booked meeting ends the contact's sequence (DB trigger).
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, conflict } from '../errors.mjs';
import { gateDraft } from '../../../gate/src/apply.mjs';

// A no-show's reschedule note (acceptance step 9). Plain, no facts to cite, so it passes the gate on its own words;
// it still goes through Approvals like every other draft and is never sent without a person's yes.
export function rescheduleNote(name) {
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return `Hi${first ? ` ${first}` : ''},\n\nLooks like we missed each other for our call. No problem at all. Would another time this week or next work for you? Reply with a time that suits you and I'll send a fresh invite.`;
}

const affected = (r) => r.affectedRows ?? r.rowCount ?? 0;

const INBOX_SQL = `
  SELECT i.id, i.channel, i.from_address, i.subject, i.body, i.received_at, i.intent, i.intent_confidence,
         i.classified_by, i.sla_due_at, i.handled_at, i.handled_by, i.message_id, i.conversation_id,
         c.id AS contact_id, c.name AS contact_name, c.company AS contact_company, c.title AS contact_title
  FROM inbound_messages i LEFT JOIN contacts c ON c.id = i.contact_id`;

const shapeReply = (x, nowMs) => ({
  ...camel(x),
  // The guide's "needs you" rule: anything a model or rule isn't ≥0.8 sure of goes to a person.
  needsHuman: x.intent_confidence === null || x.intent_confidence < 0.8,
  slaMinutesRemaining: x.sla_due_at && !x.handled_at ? Math.round((new Date(x.sla_due_at).getTime() - nowMs) / 60000) : null,
});

const MEETING_FIELDS = {
  startsAt: v.datetime(),
  endsAt: v.datetime(),
  meetUrl: v.optional(v.nullable(v.url())),
};

export function registerInbox(r) {
  // ?status=open (default) | handled | all
  r.get(`${T}/inbox`, (ctx) => {
    const q = parse(v.object({ status: v.optional(v.oneOf(['open', 'handled', 'all'])), limit: v.optional(v.int({ min: 1, max: 200 })) }), ctx.query);
    return ctx.tenant(async (tx) => {
      const where = { open: 'WHERE i.handled_at IS NULL', handled: 'WHERE i.handled_at IS NOT NULL', all: '' }[q.status ?? 'open'];
      const rows = (await tx.query(`${INBOX_SQL} ${where}
        ORDER BY (i.sla_due_at IS NULL), i.sla_due_at, i.received_at DESC LIMIT $1`, [q.limit ?? 100])).rows;
      const nowMs = ctx.now().getTime();
      return { items: rows.map((x) => shapeReply(x, nowMs)) };
    }, { action: 'inbox_read' });
  });

  r.post(`${T}/inbox/:id/handle`, (ctx) => ctx.tenant(async (tx, m) => {
    const res = await tx.query(`UPDATE inbound_messages SET handled_at = now(), handled_by = $2 WHERE id = $1 AND handled_at IS NULL`,
      [ctx.params.id, m.userId]);
    if (!affected(res)) {
      if (!(await tx.query(`SELECT 1 FROM inbound_messages WHERE id = $1`, [ctx.params.id])).rows.length) throw notFound('reply not found');
      throw conflict('reply already handled');
    }
    await audit(tx, m, 'handle', 'inbound_message', ctx.params.id);
    return { id: ctx.params.id, handled: true };
  }, { action: 'inbox_draft' }));

  // Book from a reply: the meeting, the SLA cleared, and the sequence ended, in one transaction.
  r.post(`${T}/inbox/:id/meeting`, (ctx) => {
    const b = parse(v.object(MEETING_FIELDS), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const reply = (await tx.query(`SELECT id, contact_id, handled_at FROM inbound_messages WHERE id = $1`, [ctx.params.id])).rows[0];
      if (!reply) throw notFound('reply not found');
      const meeting = (await tx.query(
        `INSERT INTO meetings (org_id, workspace_id, contact_id, inbound_message_id, provider, starts_at, ends_at, meet_url, created_by)
         VALUES ($1, $2, $3, $4, 'native', $5, $6, $7, $8) RETURNING *`,
        [m.orgId, m.workspaceId, reply.contact_id, reply.id, b.startsAt, b.endsAt, b.meetUrl ?? null, m.userId])).rows[0];
      if (!reply.handled_at) {
        await tx.query(`UPDATE inbound_messages SET handled_at = now(), handled_by = $2 WHERE id = $1`, [reply.id, m.userId]);
      }
      await audit(tx, m, 'book', 'meeting', meeting.id);
      return { status: 201, body: camel(meeting) };
    }, { action: 'inbox_draft' });
  });

  // In-app notifications (0008): unread SLA alerts with the reply they're about, newest first; and (0016) handoffs no
  // closer accepted in time, with the conversation's contact.
  r.get(`${T}/notifications`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT n.id, n.kind, n.channel, n.due_at, n.created_at, n.read_at, n.inbound_message_id, n.handoff_id,
        i.sla_due_at, i.handled_at, coalesce(c.name, hc.name) AS contact_name, coalesce(c.company, hc.company) AS contact_company,
        h.closer_id, h.accepted_at
      FROM notifications n
        LEFT JOIN inbound_messages i ON i.id = n.inbound_message_id LEFT JOIN contacts c ON c.id = i.contact_id
        LEFT JOIN handoffs h ON h.id = n.handoff_id LEFT JOIN conversations cv ON cv.id = h.conversation_id
        LEFT JOIN contacts hc ON hc.id = cv.contact_id
      WHERE n.channel = 'in_app' AND n.read_at IS NULL ORDER BY n.created_at DESC LIMIT 100`)).rows;
    return { items: rows.map(camel) };
  }, { action: 'inbox_read' }));

  r.post(`${T}/notifications/:id/read`, (ctx) => ctx.tenant(async (tx) => {
    const res = await tx.query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`, [ctx.params.id]);
    if (!affected(res) && !(await tx.query(`SELECT 1 FROM notifications WHERE id = $1`, [ctx.params.id])).rows.length) throw notFound('notification not found');
    return { id: ctx.params.id, read: true };
  }, { action: 'inbox_read' }));

  // ?range=upcoming (default) | past | all
  r.get(`${T}/meetings`, (ctx) => {
    const q = parse(v.object({ range: v.optional(v.oneOf(['upcoming', 'past', 'all'])) }), ctx.query);
    return ctx.tenant(async (tx) => {
      const where = { upcoming: 'WHERE mt.ends_at >= now()', past: 'WHERE mt.ends_at < now()', all: '' }[q.range ?? 'upcoming'];
      const rows = (await tx.query(`SELECT mt.*, c.name AS contact_name, c.company AS contact_company
        FROM meetings mt LEFT JOIN contacts c ON c.id = mt.contact_id ${where}
        ORDER BY mt.starts_at ${q.range === 'past' ? 'DESC' : 'ASC'} LIMIT 200`)).rows;
      return { items: rows.map(camel) };
    }, { action: 'reports_view' });
  });

  r.post(`${T}/meetings`, (ctx) => {
    const b = parse(v.object({ ...MEETING_FIELDS, contactId: v.optional(v.nullable(v.uuid())) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const row = (await tx.query(
        `INSERT INTO meetings (org_id, workspace_id, contact_id, provider, starts_at, ends_at, meet_url, created_by)
         VALUES ($1, $2, $3, 'native', $4, $5, $6, $7) RETURNING *`,
        [m.orgId, m.workspaceId, b.contactId ?? null, b.startsAt, b.endsAt, b.meetUrl ?? null, m.userId])).rows[0];
      await audit(tx, m, 'book', 'meeting', row.id);
      return { status: 201, body: camel(row) };
    }, { action: 'inbox_draft' });
  });

  r.patch(`${T}/meetings/:id`, async (ctx) => {
    const b = parse(v.object({
      status: v.optional(v.oneOf(['booked', 'completed', 'no_show', 'canceled'])),
      startsAt: v.optional(v.datetime()), endsAt: v.optional(v.datetime()), meetUrl: v.optional(v.nullable(v.url())),
    }, { atLeastOne: true }), ctx.body);
    const out = await ctx.tenant(async (tx, m) => {
      const before = (await tx.query(`SELECT status FROM meetings WHERE id = $1 FOR UPDATE`, [ctx.params.id])).rows[0];
      if (!before) throw notFound('meeting not found');
      const cols = { status: 'status', startsAt: 'starts_at', endsAt: 'ends_at', meetUrl: 'meet_url' };
      const keys = Object.keys(b);
      const row = (await tx.query(`UPDATE meetings SET ${keys.map((k, i) => `${cols[k]} = $${i + 2}`).join(', ')}
        WHERE id = $1 RETURNING *`, [ctx.params.id, ...keys.map((k) => b[k])])).rows[0];
      await audit(tx, m, 'update', 'meeting', row.id);
      // A booked meeting that becomes a no-show reopens the sequence the booking converted and drafts a reschedule
      // note into Approvals. Only once: a meeting already marked no_show doesn't draft again.
      let draftId = null;
      if (b.status === 'no_show' && before.status === 'booked' && row.contact_id) {
        const e = (await tx.query(`SELECT e.id, e.step, c.name FROM enrollments e JOIN contacts c ON c.id = e.contact_id
          WHERE e.contact_id = $1 AND e.state = 'converted' AND e.stop_reason = 'meeting_booked' ORDER BY e.step DESC LIMIT 1`,
        [row.contact_id])).rows[0];
        if (e) {
          await tx.query(`UPDATE enrollments SET state = 'awaiting_approval', stop_reason = NULL WHERE id = $1`, [e.id]);
          const last = (await tx.query(`SELECT subject, step FROM drafts WHERE enrollment_id = $1 ORDER BY step DESC, created_at DESC LIMIT 1`, [e.id])).rows[0];
          const subject = last?.subject ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : 'Finding another time';
          draftId = (await tx.query(`INSERT INTO drafts (org_id, workspace_id, enrollment_id, step, channel, subject, body, status, purpose)
            VALUES ($1, $2, $3, $4, 'email', $5, $6, 'gating', 'reschedule') RETURNING id`,
          [m.orgId, m.workspaceId, e.id, Math.max(e.step, last?.step ?? 0) + 1, subject.slice(0, 300), rescheduleNote(e.name)])).rows[0].id;
          await audit(tx, m, 'reschedule_draft', 'draft', draftId);
        }
      }
      return { meeting: camel(row), draftId };
    }, { action: 'inbox_draft' });
    if (!out.draftId) return out.meeting;
    const verdict = await gateDraft(ctx.client, { orgId: ctx.params.org, workspaceId: ctx.params.ws, draftId: out.draftId, now: ctx.now() });
    return { ...out.meeting, reschedule: { draftId: out.draftId, gate: verdict.outcome } };
  });
}
