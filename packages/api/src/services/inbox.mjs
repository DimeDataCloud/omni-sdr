// Inbound replies (SPEC Station 15): Reply-To r+<token>@reply.omnisdr.com → the email-worker → here.
// The prospect's text is hostile input. Classification can only push toward the safe side: suppress on
// anything that looks like an opt-out, stop the sequence on any real reply, and hand everything to a human
// (rule confidence is 0.6, below the guide's 0.8 "needs you" line). Nothing here drafts or sends.
import { createHash, randomUUID } from 'node:crypto';
import { withoutTenant, withService } from '../../../db/src/context.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

import { classifyReply, cleanReplyBody, addBusinessMinutes, SLA_MINUTES, returnDateFrom, OOO_DEFAULT_SNOOZE_DAYS } from './reply-rules.mjs';
import { offDecider } from '../../../ai/src/decide.mjs';
import { threadFor, emailThreadKey } from './conversations.mjs';
import { REPLY_TRIAGE } from '../../../ai/src/registry.mjs';
export { classifyReply, cleanReplyBody, addBusinessMinutes, SLA_MINUTES };


const TERMINAL = `('stopped', 'converted', 'completed')`;

// SLA escalation (0008): the in-app step is written with the reply; push and email come from escalateSla().
async function notifyInApp(tx, { orgId, workspaceId, inboundId, at }) {
  await tx.query(`INSERT INTO notifications (org_id, workspace_id, inbound_message_id, kind, channel, due_at)
                  VALUES ($1, $2, $3, 'sla_meeting', 'in_app', $4) ON CONFLICT DO NOTHING`, [orgId, workspaceId, inboundId, at]);
}

/**
 * @param msg { to, from, subject, body, receivedAt: Date, externalId?, channel: 'email' }
 * @returns { outcome: 'recorded'|'duplicate'|'unmatched', id?, intent?, slaDueAt? }
 */
export async function ingestReply(client, msg, { classify = classifyReply } = {}) {
  // Lower-cased: reply tokens are lowercase hex, and a mail server on the way may have changed the case (send.mjs).
  const token = /^r\+([A-Za-z0-9_-]{16,64})@/i.exec(String(msg.to ?? '').trim())?.[1]?.toLowerCase();
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
    // The reply joins its conversation (0015): one per contact on email, so the closer sees the whole thread.
    const conversation = await threadFor(tx, { orgId: hit.org_id, workspaceId: hit.workspace_id, channel: msg.channel ?? 'email',
      threadKey: emailThreadKey(hit.contact_id), contactId: hit.contact_id, at: msg.receivedAt, category: verdict.intent });
    const id = (await tx.query(
      `INSERT INTO inbound_messages (org_id, workspace_id, contact_id, message_id, channel, from_address, subject, body,
         received_at, intent, intent_confidence, classified_by, sla_due_at, external_id, conversation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [hit.org_id, hit.workspace_id, hit.contact_id, hit.message_id, msg.channel ?? 'email', msg.from?.slice(0, 320) ?? null,
        msg.subject?.slice(0, 998) ?? null, String(msg.body ?? '').slice(0, 100000), msg.receivedAt, verdict.intent,
        verdict.confidence, verdict.by, slaDueAt, msg.externalId ?? null, conversation.id])).rows[0].id;

    // Safe-side effects only.
    if (verdict.intent === 'unsubscribe' || verdict.intent === 'bounce') {
      const email = (await tx.query(`SELECT email FROM contacts WHERE id = $1`, [hit.contact_id])).rows[0]?.email;
      if (email) {
        await tx.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash($2), 'email', $3)
                        ON CONFLICT DO NOTHING`, [hit.org_id, email, verdict.intent === 'bounce' ? 'bounce' : 'reply_unsubscribe']);
      }
    }
    let snoozedUntil = null;
    if (verdict.intent !== 'out_of_office') {
      await tx.query(`UPDATE enrollments SET state = 'stopped', stop_reason = $2, next_run_at = NULL
                      WHERE contact_id = $1 AND state NOT IN ${TERMINAL}`, [hit.contact_id, `reply:${verdict.intent}`]);
    } else {
      // Snooze to the return date (acceptance step 9), remembering where the sequence was; a paused one stays paused.
      // An earlier snooze is only ever pushed later, never brought forward.
      snoozedUntil = returnDateFrom(cleanReplyBody(msg.body ?? ''), msg.receivedAt, tz)
        ?? new Date(msg.receivedAt.getTime() + OOO_DEFAULT_SNOOZE_DAYS * 86400000);
      await tx.query(`UPDATE enrollments SET resume_state = state, state = 'snoozed', next_run_at = $2, stop_reason = 'ooo_snooze'
                      WHERE contact_id = $1 AND state NOT IN ${TERMINAL} AND state NOT IN ('paused', 'snoozed')`, [hit.contact_id, snoozedUntil]);
      await tx.query(`UPDATE enrollments SET next_run_at = $2 WHERE contact_id = $1 AND state = 'snoozed' AND next_run_at < $2`,
        [hit.contact_id, snoozedUntil]);
    }
    if (slaDueAt) await notifyInApp(tx, { orgId: hit.org_id, workspaceId: hit.workspace_id, inboundId: id, at: msg.receivedAt });
    await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'inbound.received', $2, $3)`,
      [hit.org_id, id, JSON.stringify({ inbound_id: id, intent: verdict.intent, sla_due_at: slaDueAt })]);
    return { outcome: 'recorded', id, conversationId: conversation.id, intent: verdict.intent, slaDueAt: slaDueAt?.toISOString() ?? null,
      ...(snoozedUntil ? { snoozedUntil: snoozedUntil.toISOString() } : {}) };
  });
}

/**
 * The model pass (DECISIONS 2026-10-01): ask the decider REPLY_TRIAGE's safety questions about one recorded
 * reply and apply only what they add: a suppression, a stopped sequence, an SLA. The rules' result stands
 * whatever the model says; `intent` is never rewritten. The decider call runs outside any transaction (a cold
 * decider can take a minute), and a failure leaves the reply undecided for the next pass.
 * @returns { outcome: 'decided'|'already_decided'|'not_found'|'decider_failed', effects?, reason? }
 */
export async function refineReply(client, { id, orgId, workspaceId }, { decider = offDecider(), shadowLabel = false } = {}) {
  const scope = { orgId, workspaceId, role: 'inbox_svc' };
  const row = await withService(client, scope, async (tx) => (await tx.query(
    `SELECT id, contact_id, subject, body, intent, sla_due_at, received_at, decided_at FROM inbound_messages WHERE id = $1`, [id])).rows[0]);
  if (!row) return { outcome: 'not_found' };
  if (row.decided_at) return { outcome: 'already_decided' };

  const questions = REPLY_TRIAGE.questions({ shadowLabel });
  let out;
  try {
    // The decider reads what the person wrote (reply-rules.mjs cleanReplyBody); one long reply went from 847 to 154 tokens (LAYA-PLAN 2a, n=4).
    out = await decider.decide({ state: REPLY_TRIAGE.state({ ...row, body: cleanReplyBody(row.body) }), questions });
  } catch (e) {
    return { outcome: 'decider_failed', reason: e.message };
  }

  return withService(client, scope, async (tx) => {
    const fresh = (await tx.query(`SELECT decided_at, sla_due_at, intent FROM inbound_messages WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (fresh.decided_at) return { outcome: 'already_decided' };
    const ruled = ['unsubscribe', 'bounce'].includes(fresh.intent);
    const fx = REPLY_TRIAGE.effects(out.answers, {
      intent: fresh.intent, suppressed: ruled, stopped: fresh.intent !== 'out_of_office', slaDueAt: fresh.sla_due_at });
    const applied = [];
    if (fx.suppress && row.contact_id) {
      const email = (await tx.query(`SELECT email FROM contacts WHERE id = $1`, [row.contact_id])).rows[0]?.email;
      if (email) {
        await tx.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash($2), 'email', 'reply_unsubscribe_model')
                        ON CONFLICT DO NOTHING`, [orgId, email]);
        applied.push('suppress');
      }
    }
    if (fx.stop && row.contact_id) {
      const n = (await tx.query(`UPDATE enrollments SET state = 'stopped', stop_reason = 'reply:model_stop', next_run_at = NULL
                                 WHERE contact_id = $1 AND state NOT IN ${TERMINAL}`, [row.contact_id])).rowCount;
      if (n) applied.push('stop');
    }
    let slaDueAt = fresh.sla_due_at;
    if (fx.startSla) {
      const tz = (await tx.query(`SELECT timezone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.timezone ?? 'America/Chicago';
      // From when the reply arrived, not from when the model got to it.
      slaDueAt = addBusinessMinutes(row.received_at, SLA_MINUTES, tz);
      applied.push('sla');
      await notifyInApp(tx, { orgId, workspaceId, inboundId: id, at: new Date() });
    }
    const decision = { engine: out.engine, model: out.model, revision: out.revision, registry: REPLY_TRIAGE.version,
      answers: fx.record, applied, input_tokens: out.inputTokens, ms: out.ms };
    await tx.query(`UPDATE inbound_messages SET decision = $2, decided_at = now(), sla_due_at = $3 WHERE id = $1`,
      [id, JSON.stringify(decision), slaDueAt]);
    if (applied.length) {
      await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'inbound.decided', $2, $3)`,
        [orgId, id, JSON.stringify({ inbound_id: id, applied, sla_due_at: slaDueAt })]);
    }
    return { outcome: 'decided', effects: applied };
  });
}

// One pass over undecided replies, oldest first, one at a time (the decider runs one request per instance).
export async function refinePending(client, { decider = offDecider(), limit = 50, shadowLabel = false } = {}) {
  const ids = await withoutTenant(client, { role: 'inbox_svc' }, async (tx) =>
    (await tx.query(`SELECT * FROM inbox_undecided_fair($1)`, [limit])).rows);   // round-robin by workspace (0014)
  const tally = { decided: 0, failed: 0, skipped: 0 };
  for (const r of ids) {
    const res = await refineReply(client, { id: r.id, orgId: r.org_id, workspaceId: r.workspace_id }, { decider, shadowLabel });
    if (res.outcome === 'decided') tally.decided++;
    else if (res.outcome === 'decider_failed') { tally.failed++; break; } // a down decider fails every reply; stop and retry later
    else tally.skipped++;
  }
  return tally;
}

// ─── follow-up pass (0008), run by the refine job before the model pass so it never waits on the decider ─────────
/** Wake snoozed sequences whose return date has come: each goes back to the state it had. */
export async function wakeSnoozed(client, { now = new Date(), limit = 500 } = {}) {
  return withoutTenant(client, { role: 'inbox_svc' }, async (tx) =>
    (await tx.query(`SELECT * FROM inbox_wake_snoozed($1, $2)`, [now, limit])).rows.length);
}

/**
 * SLA escalation for unhandled meeting requests: in-app when the SLA starts, push when an hour is left, email at the
 * breach. Each step once (UNIQUE in 0008). Push and email go out through the outbox (topic notify.sla) for the
 * notify relay, which delivers to the workspace's admins and operators.
 */
export async function escalateSla(client, { now = new Date(), limit = 500 } = {}) {
  const due = await withoutTenant(client, { role: 'inbox_svc' }, async (tx) =>
    (await tx.query(`SELECT * FROM inbox_sla_due($1, $2)`, [now, limit])).rows);
  const tally = { in_app: 0, push: 0, email: 0 };
  for (const d of due) {
    await withService(client, { orgId: d.org_id, workspaceId: d.workspace_id, role: 'inbox_svc' }, async (tx) => {
      const r = await tx.query(`INSERT INTO notifications (org_id, workspace_id, inbound_message_id, kind, channel, due_at)
        VALUES ($1, $2, $3, 'sla_meeting', $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
      [d.org_id, d.workspace_id, d.inbound_message_id, d.channel, d.due_at]);
      if (!r.rows.length) return;   // another run got there first
      tally[d.channel]++;
      if (d.channel !== 'in_app') {
        await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'notify.sla', $2, $3)`,
          [d.org_id, `${d.inbound_message_id}:${d.channel}`, JSON.stringify({ inbound_id: d.inbound_message_id, workspace_id: d.workspace_id, channel: d.channel })]);
      }
    });
  }
  return tally;
}

/**
 * A website form or chat submission through an inbound webhook (0014; SDR-PIVOT P5). Resolved by hook id + token
 * hash only; the submitter becomes (or matches) a contact in the hook's workspace; then the same triage as an email
 * reply: rules now, Laya on the next refine pass (inbox_undecided_fair lists every channel, round-robin by workspace).
 * Past FORM_DAILY_CAP submissions in 24 h a workspace's forms are still recorded and rules-triaged, but marked decided so
 * a flood (a public form anyone can post to) never spends model calls (#85 audit P2b).
 * @param hook { id, tokenHash }
 * @param msg { body, email?, name?, phone?, page?, externalId?, receivedAt: Date }
 * @returns { outcome: 'recorded'|'duplicate'|'unknown_hook', id?, intent?, slaDueAt? }
 */
export const FORM_DAILY_CAP = 500;
export async function ingestForm(client, hook, msg, { classify = classifyReply, dailyCap = FORM_DAILY_CAP } = {}) {
  const hit = await withoutTenant(client, { role: 'inbox_svc' }, async (tx) =>
    (await tx.query(`SELECT * FROM inbox_resolve_hook($1, $2)`, [hook.id, hook.tokenHash])).rows[0]);
  if (!hit) return { outcome: 'unknown_hook' };
  const email = msg.email ? String(msg.email).trim().toLowerCase() : null;
  const verdict = classify({ subject: '', body: msg.body ?? '', from: email ?? '' });
  return withService(client, { orgId: hit.org_id, workspaceId: hit.workspace_id, role: 'inbox_svc' }, async (tx) => {
    if (msg.externalId) {
      const dup = (await tx.query(`SELECT id FROM inbound_messages WHERE workspace_id = $1 AND channel = 'form' AND external_id = $2`,
        [hit.workspace_id, msg.externalId])).rows[0];
      if (dup) return { outcome: 'duplicate', id: dup.id };
    }
    let contactId = null;
    if (email) {
      await tx.query(`INSERT INTO contacts (org_id, workspace_id, name, email, phone) VALUES ($1, $2, $3, $4, $5)
                      ON CONFLICT (workspace_id, email) DO NOTHING`,
      [hit.org_id, hit.workspace_id, msg.name?.slice(0, 200) ?? null, email, msg.phone?.slice(0, 40) ?? null]);
      contactId = (await tx.query(`SELECT id FROM contacts WHERE workspace_id = $1 AND email = $2`, [hit.workspace_id, email])).rows[0]?.id ?? null;
    }
    const tz = (await tx.query(`SELECT timezone FROM workspaces WHERE id = $1`, [hit.workspace_id])).rows[0]?.timezone ?? 'America/Chicago';
    const slaDueAt = verdict.intent === 'meeting_request' ? addBusinessMinutes(msg.receivedAt, SLA_MINUTES, tz) : null;
    const subject = msg.page ? `Form: ${String(msg.page).slice(0, 200)}` : 'Form submission';
    // The submission joins its conversation (0015): one per contact on the form channel; without an address, its own.
    const conversation = await threadFor(tx, { orgId: hit.org_id, workspaceId: hit.workspace_id, channel: 'form',
      threadKey: contactId ? emailThreadKey(contactId) : `submission:${msg.externalId ?? randomUUID()}`, contactId,
      at: msg.receivedAt, category: verdict.intent });
    const recent = (await tx.query(`SELECT count(*)::int AS n FROM inbound_messages WHERE workspace_id = $1 AND channel = 'form'
      AND received_at > $2::timestamptz - interval '24 hours'`, [hit.workspace_id, msg.receivedAt])).rows[0].n;
    const capped = recent >= dailyCap;
    // ON CONFLICT: two concurrent retries with one externalId record one row (#85 audit P3-1).
    const ins = (await tx.query(
      `INSERT INTO inbound_messages (org_id, workspace_id, contact_id, channel, from_address, subject, body, received_at,
         intent, intent_confidence, classified_by, sla_due_at, external_id, decision, decided_at, conversation_id)
       VALUES ($1, $2, $3, 'form', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (workspace_id, channel, external_id) DO NOTHING RETURNING id`,
      [hit.org_id, hit.workspace_id, contactId, email, subject, String(msg.body ?? '').slice(0, 100000), msg.receivedAt,
        verdict.intent, verdict.confidence, verdict.by, slaDueAt, msg.externalId ?? null,
        capped ? JSON.stringify({ skipped: 'form_daily_cap', cap: dailyCap }) : null, capped ? msg.receivedAt : null, conversation.id])).rows[0];
    if (!ins) {
      const dup = (await tx.query(`SELECT id FROM inbound_messages WHERE workspace_id = $1 AND channel = 'form' AND external_id = $2`,
        [hit.workspace_id, msg.externalId])).rows[0];
      return { outcome: 'duplicate', id: dup?.id ?? null };
    }
    const id = ins.id;
    // Safe-side effects only, as for an email reply: an opt-out suppresses the address, and a real message stops any
    // sequence the person is in.
    if (verdict.intent === 'unsubscribe' && email) {
      await tx.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash($2), 'email', 'form_unsubscribe')
                      ON CONFLICT DO NOTHING`, [hit.org_id, email]);
    }
    if (contactId && verdict.intent !== 'out_of_office') {
      await tx.query(`UPDATE enrollments SET state = 'stopped', stop_reason = $2, next_run_at = NULL
                      WHERE contact_id = $1 AND state NOT IN ${TERMINAL}`, [contactId, `form:${verdict.intent}`]);
    }
    if (slaDueAt) await notifyInApp(tx, { orgId: hit.org_id, workspaceId: hit.workspace_id, inboundId: id, at: msg.receivedAt });
    await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'inbound.received', $2, $3)`,
      [hit.org_id, id, JSON.stringify({ inbound_id: id, channel: 'form', intent: verdict.intent, sla_due_at: slaDueAt })]);
    return { outcome: 'recorded', id, conversationId: conversation.id, intent: verdict.intent, slaDueAt: slaDueAt?.toISOString() ?? null };
  });
}
