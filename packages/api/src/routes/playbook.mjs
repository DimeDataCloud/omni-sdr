// The playbook and reply drafts (0017; SDR-PIVOT P3). Reading needs inbox_read; editing the playbook needs build;
// drafting and deciding a reply needs inbox_draft. Nothing here sends: approving records the final words and queues
// `reply.approved` for the send step, which is separate and audited.
//
//   GET    …/playbook                          replies, questions, autonomy per category (inbox_read)
//   POST   …/playbook/replies                  { category, name, subject?, body, asksNextQuestion? } (build)
//   PATCH  …/playbook/replies/:id              any of name, subject, body, asksNextQuestion (build)
//   DELETE …/playbook/replies/:id              archive it (build)
//   PUT    …/playbook/questions                { questions: [{ key, question }] } up to 4, in order (build)
//   GET    …/conversations/:id/reply-draft     the pending draft, if any (inbox_read)
//   POST   …/conversations/:id/reply-draft     { playbookReplyId? } a new draft from the playbook (inbox_draft)
//   POST   …/reply-drafts/:id/approve          { body? } (inbox_draft)
//   POST   …/reply-drafts/:id/discard          (inbox_draft)
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, conflict, HttpError } from '../errors.mjs';
import { PLAYBOOK_CATEGORIES, FIELDS, unknownFields, render, firstName, nextQuestion, autonomy, AUTONOMY_WINDOW, AUTONOMY_RATE } from '../services/playbook.mjs';

const bad = (message, field) => new HttpError(400, 'bad_request', message, field ? { field } : undefined);
function checkFields(body, field) {
  const unknown = unknownFields(body);
  if (unknown.length) throw bad(`unknown field${unknown.length > 1 ? 's' : ''} ${unknown.map((f) => `{${f}}`).join(', ')}; use ${FIELDS.map((f) => `{${f}}`).join(', ')}`, field);
}

export function registerPlaybook(r) {
  r.get(`${T}/playbook`, (ctx) => ctx.tenant(async (tx) => {
    const replies = (await tx.query(`SELECT * FROM playbook_replies WHERE archived_at IS NULL ORDER BY category, lower(name)`)).rows;
    const questions = (await tx.query(`SELECT id, position, key, question FROM qualification_questions ORDER BY position`)).rows;
    return { replies: replies.map(camel), questions: questions.map(camel), fields: FIELDS,
      autonomy: { window: AUTONOMY_WINDOW, rate: AUTONOMY_RATE, autoSend: false, categories: await autonomy(tx) } };
  }, { action: 'inbox_read' }));

  r.post(`${T}/playbook/replies`, (ctx) => {
    const b = parse(v.object({
      category: v.oneOf(PLAYBOOK_CATEGORIES), name: v.string({ min: 1, max: 80 }), subject: v.optional(v.nullable(v.string({ max: 200 }))),
      body: v.string({ min: 1, max: 4000, trim: false }), asksNextQuestion: v.optional(v.bool()),
    }), ctx.body ?? {});
    checkFields(b.body, 'body'); checkFields(b.subject, 'subject');
    return ctx.tenant(async (tx, m) => {
      try {
        const row = (await tx.query(`INSERT INTO playbook_replies (org_id, workspace_id, category, name, subject, body, asks_next_question, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [m.orgId, m.workspaceId, b.category, b.name, b.subject ?? null, b.body, b.asksNextQuestion ?? false, m.userId])).rows[0];
        await audit(tx, m, 'create', 'playbook_reply', row.id);
        return { status: 201, body: camel(row) };
      } catch (e) {
        if (/playbook_replies_name/.test(e.message)) throw conflict('a reply with that name already exists for this category');
        throw e;
      }
    }, { action: 'build' });
  });

  r.patch(`${T}/playbook/replies/:id`, (ctx) => {
    const b = parse(v.object({
      name: v.optional(v.string({ min: 1, max: 80 })), subject: v.optional(v.nullable(v.string({ max: 200 }))),
      body: v.optional(v.string({ min: 1, max: 4000, trim: false })), asksNextQuestion: v.optional(v.bool()),
    }), ctx.body ?? {});
    if (b.body !== undefined) checkFields(b.body, 'body');
    if (b.subject) checkFields(b.subject, 'subject');
    return ctx.tenant(async (tx, m) => {
      const sets = []; const args = [ctx.params.id];
      for (const [k, col] of [['name', 'name'], ['subject', 'subject'], ['body', 'body'], ['asksNextQuestion', 'asks_next_question']]) {
        if (b[k] !== undefined) { args.push(b[k]); sets.push(`${col} = $${args.length}`); }
      }
      if (!sets.length) throw bad('nothing to change');
      const row = (await tx.query(`UPDATE playbook_replies SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING *`, args)).rows[0];
      if (!row) throw notFound('playbook reply not found');
      await audit(tx, m, 'update', 'playbook_reply', row.id);
      return camel(row);
    }, { action: 'build' });
  });

  r.delete(`${T}/playbook/replies/:id`, (ctx) => ctx.tenant(async (tx, m) => {
    const row = (await tx.query(`UPDATE playbook_replies SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id`, [ctx.params.id])).rows[0];
    if (!row) throw notFound('playbook reply not found');
    await audit(tx, m, 'archive', 'playbook_reply', row.id);
    return { status: 204 };
  }, { action: 'build' }));

  r.put(`${T}/playbook/questions`, (ctx) => {
    const b = parse(v.object({ questions: v.array(v.object({
      key: v.string({ min: 1, max: 40, pattern: /^[a-z][a-z_]{0,39}$/ }), question: v.string({ min: 1, max: 300 }),
    }), { max: 4 }) }), ctx.body ?? {});
    if (new Set(b.questions.map((q) => q.key)).size !== b.questions.length) throw bad('each question needs its own key', 'questions');
    return ctx.tenant(async (tx, m) => {
      await tx.query(`DELETE FROM qualification_questions`);
      for (const [i, q] of b.questions.entries()) {
        await tx.query(`INSERT INTO qualification_questions (org_id, workspace_id, position, key, question) VALUES ($1, $2, $3, $4, $5)`,
          [m.orgId, m.workspaceId, i + 1, q.key, q.question]);
      }
      await audit(tx, m, 'update', 'qualification_questions', m.workspaceId);
      return { questions: b.questions.map((q, i) => ({ position: i + 1, ...q })) };
    }, { action: 'build' });
  });

  r.get(`${T}/conversations/:id/reply-draft`, (ctx) => ctx.tenant(async (tx) => {
    const d = (await tx.query(`SELECT * FROM reply_drafts WHERE conversation_id = $1 AND status = 'pending'`, [ctx.params.id])).rows[0];
    return { draft: d ? camel(d) : null };
  }, { action: 'inbox_read' }));

  r.post(`${T}/conversations/:id/reply-draft`, (ctx) => {
    const b = parse(v.object({ playbookReplyId: v.optional(v.uuid()) }), ctx.body ?? {});
    return ctx.tenant(async (tx, m) => {
      const c = (await tx.query(`SELECT c.*, k.name AS contact_name, k.company AS contact_company FROM conversations c
        LEFT JOIN contacts k ON k.id = c.contact_id WHERE c.id = $1 FOR UPDATE OF c`, [ctx.params.id])).rows[0];
      if (!c) throw notFound('conversation not found');
      if (['closed', 'spam', 'handed_off'].includes(c.state)) throw conflict(`a ${c.state.replace('_', ' ')} conversation gets no playbook reply`);
      const category = c.category ?? 'unclassified';
      if (!PLAYBOOK_CATEGORIES.includes(category)) throw conflict(`a ${category} is never answered`);
      const pick = b.playbookReplyId
        ? (await tx.query(`SELECT * FROM playbook_replies WHERE id = $1 AND archived_at IS NULL`, [b.playbookReplyId])).rows[0]
        : (await tx.query(`SELECT * FROM playbook_replies WHERE category = $1 AND archived_at IS NULL ORDER BY lower(name) LIMIT 1`, [category])).rows[0];
      if (!pick) throw notFound(b.playbookReplyId ? 'playbook reply not found' : `no playbook reply for ${category} yet`);
      const q = await nextQuestion(tx, c.id);
      const mine = (await tx.query(`SELECT booking_url FROM memberships WHERE org_id = $1 AND user_id = $2`, [m.orgId, m.userId])).rows[0];
      const ws = (await tx.query(`SELECT name FROM workspaces WHERE id = $1`, [m.workspaceId])).rows[0];
      const values = { first_name: firstName(c.contact_name), name: c.contact_name, company: c.contact_company, business_name: ws?.name,
        booking_link: mine?.booking_url, next_question: q?.question };
      let body = pick.body;
      // A reply set to ask the next question gets it appended, unless it already places {next_question} itself.
      const asks = pick.asks_next_question && q && !/\{next_question\}/.test(body);
      if (asks) body = `${body.replace(/\s+$/, '')}\n\n${q.question}`;
      const out = render(body, values);
      const subj = pick.subject ? render(pick.subject, values) : { text: null, missing: [] };
      const missing = [...new Set([...out.missing, ...subj.missing])];
      if (missing.length) throw conflict(`this reply needs ${missing.map((f) => `{${f}}`).join(', ')}, which we don't have here`, { missing });
      const last = (await tx.query(`SELECT id FROM inbound_messages WHERE conversation_id = $1 ORDER BY received_at DESC LIMIT 1`, [c.id])).rows[0];
      // A newer suggestion replaces a pending one.
      await tx.query(`UPDATE reply_drafts SET status = 'discarded', decided_by = $2, decided_at = now() WHERE conversation_id = $1 AND status = 'pending'`, [c.id, m.userId]);
      const d = (await tx.query(`INSERT INTO reply_drafts (org_id, workspace_id, conversation_id, inbound_message_id, playbook_reply_id, category,
          question_key, subject, body_proposed, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [m.orgId, m.workspaceId, c.id, last?.id ?? null, pick.id, category, (asks || /\{next_question\}/.test(pick.body)) && q ? q.key : null,
        subj.text, out.text, m.userId])).rows[0];
      await audit(tx, m, 'create', 'reply_draft', d.id);
      return { status: 201, body: camel(d) };
    }, { action: 'inbox_draft' });
  });

  r.post(`${T}/reply-drafts/:id/approve`, (ctx) => {
    const b = parse(v.object({ body: v.optional(v.string({ min: 1, max: 8000, trim: false })) }), ctx.body ?? {});
    return ctx.tenant(async (tx, m) => {
      const d = (await tx.query(`SELECT * FROM reply_drafts WHERE id = $1 FOR UPDATE`, [ctx.params.id])).rows[0];
      if (!d) throw notFound('reply draft not found');
      if (d.status !== 'pending') throw conflict(`this draft is already ${d.status}`);
      const final = b.body ?? d.body_proposed;
      const row = (await tx.query(`UPDATE reply_drafts SET status = 'approved', body_final = $2, decided_by = $3, decided_at = now() WHERE id = $1 RETURNING *`,
        [d.id, final, m.userId])).rows[0];
      await audit(tx, m, row.edited ? 'approve_edited' : 'approve', 'reply_draft', d.id);
      // For the send step (separate, audited). Never sent from here.
      await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'reply.approved', $2, $3)`,
        [m.orgId, d.id, JSON.stringify({ reply_draft_id: d.id, conversation_id: d.conversation_id, workspace_id: m.workspaceId, channel: d.channel })]);
      return camel(row);
    }, { action: 'inbox_draft' });
  });

  r.post(`${T}/reply-drafts/:id/discard`, (ctx) => ctx.tenant(async (tx, m) => {
    const d = (await tx.query(`SELECT id, status FROM reply_drafts WHERE id = $1 FOR UPDATE`, [ctx.params.id])).rows[0];
    if (!d) throw notFound('reply draft not found');
    if (d.status !== 'pending') throw conflict(`this draft is already ${d.status}`);
    const row = (await tx.query(`UPDATE reply_drafts SET status = 'discarded', decided_by = $2, decided_at = now() WHERE id = $1 RETURNING *`, [d.id, m.userId])).rows[0];
    await audit(tx, m, 'discard', 'reply_draft', d.id);
    return camel(row);
  }, { action: 'inbox_draft' }));
}
