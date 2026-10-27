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
import { ingestForm } from '../services/inbox.mjs';
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
 * @returns ingestForm's result ({ outcome: 'recorded'|'duplicate'|'unknown_hook', id, ... }) plus, when recorded, `lead`:
 *   { outcome, leadEventId, relatedLeadEventId, touchBlocker }. A duplicate or unknown hook writes nothing more.
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
  return withService(client, { ...scope, role: 'inbox_svc' }, async (tx) => {
    const form = await ingestForm(client, hook, { ...msg, externalId }, { ...opts, tx, hit });
    if (form.outcome !== 'recorded') return form;
    return { ...form, lead: await recordLeadIn(tx, scope, lead) };
  });
}
