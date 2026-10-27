// Speed to lead, the web-form adapter (S2L-2b). A form submission through an inbound hook (routes/hooks.mjs, services/inbox.mjs
// ingestForm) becomes TWO rows in ONE transaction: the message (inbound_messages, which keeps the text) and the lead event
// (lead_events, which keeps source, consent basis and the first-touch clock). Both land or neither does.
//
// What the lead event carries: source web_form, channel form, consent_basis express_form (the person filled in a form to be
// contacted), the external id, and a payload of `page` only. The submitter's words are NEVER copied into the lead: they stay in
// inbound_messages. Identity (email, name, phone) goes to the contact, not the payload.
//
// Nothing here is wired to POST /v1/hooks/:id yet (that route stays as it is, closed by default behind the edge allowlist); this
// is the engine a later card connects. Nothing sends.
import { randomUUID } from 'node:crypto';
import { withoutTenant, withService } from '../../../db/src/context.mjs';
import { ingestForm, formDailyCap, classifyReply } from '../services/inbox.mjs';
import { verifiedLead, recordLeadIn, safeExternalId, payloadIdentityProblem } from './core.mjs';

/** The adapter on the S2L-1 contract. `raw` is the submission after the hook token was proved ({ hookVerified, ... }). */
export const webFormAdapter = Object.freeze({
  source: 'web_form',
  // The hook's bearer token is checked by the database (inbox_resolve_hook) before this runs; there is no other secret to check.
  verify: (raw) => raw?.hookVerified === true,
  normalize: (raw) => {
    // `page` is the one field the lead keeps. A page that looks like identity (an address typed into the field) is left out of the
    // lead rather than failing the intake: the submission itself is real and is still recorded, in full, in inbound_messages.
    const page = raw.page ? String(raw.page).slice(0, 200) : null;
    const payload = page && !payloadIdentityProblem({ page }) ? { page } : {};
    return {
      channel: 'form',
      externalId: raw.externalId,
      consentBasis: 'express_form',
      receivedAt: raw.receivedAt,
      contact: { email: raw.email, name: raw.name, phone: raw.phone },
      payload,
    };
  },
});

/**
 * One submission, one transaction.
 * @param hook { id, tokenHash } as for ingestForm
 * @param msg  { body, email?, name?, phone?, page?, externalId?, receivedAt: Date }
 * @param opts  { dailyCap? } the most form submissions a workspace may record in 24 hours (default FORM_DAILY_CAP)
 * @returns ingestForm's result ({ outcome: 'recorded'|'duplicate'|'unknown_hook', id, ... }) plus, when recorded, `lead`:
 *   { outcome, leadEventId, relatedLeadEventId, touchBlocker }. A duplicate or unknown hook writes nothing more.
 *   Over the cap: { outcome: 'rate_limited', cap } and NOTHING is written (lead_events is append-only, so the limit has to be
 *   here, not a cleanup later); concurrent requests can overshoot by at most the number in flight. The count is per workspace (every hook of it): neither table records which hook a row came from.
 */
export async function ingestFormLead(client, hook, msg, opts = {}) {
  const hit = await withoutTenant(client, { role: 'inbox_svc' }, async (tx) =>
    (await tx.query(`SELECT * FROM inbox_resolve_hook($1, $2)`, [hook.id, hook.tokenHash])).rows[0]);
  if (!hit) return { outcome: 'unknown_hook' };
  // ONE id for both rows (0022: the two dedupe keys cannot disagree): the form's own, else a server-generated submission id;
  // hashed if it could look like an address. Fixed before the transaction, so a deadlock retry reuses it.
  const externalId = safeExternalId(msg.externalId) ?? `sub-${randomUUID()}`;
  const lead = await verifiedLead(webFormAdapter, { ...msg, externalId, hookVerified: true });
  const scope = { orgId: hit.org_id, workspaceId: hit.workspace_id };
  const cap = formDailyCap(opts.dailyCap);
  return withService(client, { ...scope, role: 'inbox_svc' }, async (tx) => {
    // No lock: 0020 revokes the advisory-lock functions from PUBLIC on purpose (a tenant-facing role must not hold them), so
    // requests in flight at the same moment can each see cap - 1 and overshoot by at most the number in flight. It is an abuse limit,
    // not a quota; the 60/min/IP limit bounds the burst. An exact cap would need a definer that takes the lock (a migration).
    const recent = (await tx.query(`SELECT count(*)::int AS n FROM inbound_messages WHERE workspace_id = $1 AND channel = 'form'
      AND received_at > $2::timestamptz - interval '24 hours'`, [hit.workspace_id, msg.receivedAt])).rows[0].n;
    if (recent >= cap) {
      // A retry of a submission already recorded is still a duplicate (200), not a 429.
      const dup = (await tx.query(`SELECT id FROM inbound_messages WHERE workspace_id = $1 AND channel = 'form' AND external_id = $2`,
        [hit.workspace_id, externalId])).rows[0];
      if (dup) return { outcome: 'duplicate', id: dup.id };
      // An opt-out is never dropped (decisions log): one that names an address is recorded and the person suppressed, with no model
      // pass, no reply and no lead event (ingestForm marks a capped message decided; the count taken above is passed on, not repeated).
      // Without an address there is no one to suppress, so it stays a 429. The rules verdict is the same one ingestForm reaches.
      const email = msg.email ? String(msg.email).trim().toLowerCase() : null;
      const classify = opts.classify ?? classifyReply;
      if (email && classify({ subject: '', body: msg.body ?? '', from: email }).intent === 'unsubscribe') {
        const form = await ingestForm(client, hook, { ...msg, externalId }, { ...opts, dailyCap: cap, recent, tx, hit });
        return form.outcome === 'recorded' ? { ...form, capped: true } : form;
      }
      return { outcome: 'rate_limited', cap };
    }
    const form = await ingestForm(client, hook, { ...msg, externalId }, { ...opts, tx, hit });
    if (form.outcome !== 'recorded') return form;
    return { ...form, lead: await recordLeadIn(tx, scope, lead) };
  });
}
