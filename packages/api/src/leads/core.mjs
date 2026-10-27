// Speed to lead, the core (S2L-1). One pipeline for every source: an adapter verifies and normalizes an event into one
// lead record; the core dedupes it, resolves who it is, records it with its consent basis, and later records the first touch.
// The core never knows which source a lead came from beyond its `source` label.
//
// Nothing here sends and nothing here is wired to a route: it records leads and measures time to first touch. A reply goes
// out only through the existing Approvals and send_guard path, which is still locked.
//
// ADAPTER CONTRACT (an adapter is a plain object):
//   source     one of SOURCES
//   verify(raw)      -> boolean      signature or per-hook token check; false means the event is dropped, nothing recorded
//   normalize(raw)   -> { channel, externalId, consentBasis, receivedAt, contact?: { email?, name?, phone? }, payload? }
// Contact identity (email, phone, name, handle) goes in `contact`, never in `payload`: the DB keeps identity on contacts, where
// suppression and erasure can find it. normalizeLead() refuses a payload that carries identity keys; the externalId is the
// source's own id for the lead (a submission id), never an address.
import { withService, withTenant } from '../../../db/src/context.mjs';

export const SOURCES = Object.freeze(['web_form', 'ad_lead', 'inbound_email', 'list_import', 'social_dm', 'social_comment', 'sms', 'voice', 'crm']);
export const CHANNELS = Object.freeze(['email', 'linkedin', 'form', 'chat', 'instagram_comment', 'instagram_dm', 'facebook_comment', 'messenger', 'sms', 'voice']);
export const CONSENT_BASES = Object.freeze(['express_form', 'existing_customer', 'inquiry_reply', 'imported_attested', 'none']);
export const TOUCHERS = Object.freeze(['agent', 'human', 'system']);

export class LeadError extends Error {
  constructor(reason) { super(`lead refused: ${reason}`); this.name = 'LeadError'; this.reason = reason; }
}

// The same rules as the database CHECKs in 0023 (lead_key_identity_free, lead_value_identity_free); one shared case list
// (db/test/lead-identity-cases.json) is run against both layers. The DB is the guarantee; this gives the adapter a readable error.
// LIMIT: structured identity fields only. Free text in a value (a name typed into a note) is not detected.
const EMAIL_SHAPE = /[^\s@"]+@[^\s@"]+\.[A-Za-z]{2,}/;

// Keys are normalized (lower-case, letters and digits only) so camelCase, snake_case, "full name" and "e-mail" collapse.
const keyLooksLikeIdentity = (k) => {
  const n = String(k).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return ['tel', 'ssn', 'cell'].includes(n) || /(mail|phone|mobile|handle|address|name|(phone|mobile|cell|tel)(number|num|no))$/.test(n);
};

// Email-shaped; or phone-shaped: 7+ digits with a separator or leading + (a bare ISO date is fine), or a BARE run of exactly
// 10 or 11 digits. Other bare digit runs pass: ad-platform ids are 15+ digits.
const valueLooksLikeIdentity = (v) => {
  const s = String(v).trim();
  if (EMAIL_SHAPE.test(s)) return true;
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) return false;
  const digits = s.replace(/[^0-9]/g, '').length;
  if (/^[+(]?[0-9][0-9 ()./+-]*$/.test(s)) return /^[0-9]+$/.test(s) ? (digits === 10 || digits === 11) : digits >= 7;
  return false;
};

/** Why a payload may not be stored, or null. Walks objects and arrays. Exported so the shared case list can test it. */
export function payloadIdentityProblem(v, path = 'payload') {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { const p = payloadIdentityProblem(v[i], `${path}[${i}]`); if (p) return p; }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (keyLooksLikeIdentity(k)) return `${path}.${k} looks like contact identity (put it in contact, not payload)`;
      const p = payloadIdentityProblem(x, `${path}.${k}`); if (p) return p;
    }
  } else if ((typeof v === 'string' || typeof v === 'number') && valueLooksLikeIdentity(v)) {
    return `${path} holds something shaped like an email address or a phone number`;
  }
  return null;
}

/** Why an external id may not be stored (it is the source's own id, never an address or a number), or null. */
export const externalIdIdentityProblem = (id) => (valueLooksLikeIdentity(id) ? 'externalId must be the source\'s own id, not an email address or a phone number' : null);

function scanPayload(v) {
  const why = payloadIdentityProblem(v);
  if (why) throw new LeadError(why);
}

/** Validate an adapter's normalized output; throws LeadError. Returns a clean copy. */
export function normalizeLead(adapter, n) {
  if (!SOURCES.includes(adapter?.source)) throw new LeadError(`unknown source ${JSON.stringify(adapter?.source)}`);
  if (!CHANNELS.includes(n?.channel)) throw new LeadError(`unknown channel ${JSON.stringify(n?.channel)}`);
  if (!CONSENT_BASES.includes(n?.consentBasis)) throw new LeadError('a consent basis is required (use "none" to record without outbound)');
  const externalId = String(n.externalId ?? '').trim();
  if (!externalId || externalId.length > 998) throw new LeadError('externalId is required');
  const idWhy = externalIdIdentityProblem(externalId);
  if (idWhy) throw new LeadError(idWhy);
  const receivedAt = n.receivedAt instanceof Date ? n.receivedAt : new Date(n.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) throw new LeadError('receivedAt is not a date');
  const payload = n.payload ?? {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new LeadError('payload must be an object');
  scanPayload(payload);
  const email = n.contact?.email ? String(n.contact.email).trim().toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s]+$/.test(email)) throw new LeadError('contact.email is not an address');
  return { source: adapter.source, channel: n.channel, externalId, consentBasis: n.consentBasis, receivedAt, payload,
    contact: { email, name: n.contact?.name ? String(n.contact.name).slice(0, 200) : null, phone: n.contact?.phone ? String(n.contact.phone).slice(0, 40) : null } };
}

/**
 * Intake one raw event through one adapter, inside the workspace's tenant context (role inbox_svc).
 * @returns { outcome: 'dropped'|'recorded'|'duplicate', leadEventId?, relatedLeadEventId?, touchBlocker? }
 *   touchBlocker is why a first touch is not allowed right now (null = allowed): 'no_consent' | 'no_contact' | 'suppressed'.
 */
export async function ingestLead(client, { orgId, workspaceId }, adapter, raw) {
  if (typeof adapter?.verify !== 'function' || typeof adapter?.normalize !== 'function') throw new LeadError('an adapter needs verify() and normalize()');
  if (!(await adapter.verify(raw))) return { outcome: 'dropped' };
  const lead = normalizeLead(adapter, await adapter.normalize(raw));
  return withService(client, { orgId, workspaceId, role: 'inbox_svc' }, async (tx) => {
    // Same person, same workspace: one contacts row per address, as the form intake does. Without an address the lead stays
    // anonymous (contact_id NULL) and cannot be touched until a later step resolves it.
    let contactId = null;
    if (lead.contact.email) {
      await tx.query(`INSERT INTO contacts (org_id, workspace_id, name, email, phone) VALUES ($1, $2, $3, $4, $5)
                      ON CONFLICT (workspace_id, email) DO NOTHING`, [orgId, workspaceId, lead.contact.name, lead.contact.email, lead.contact.phone]);
      contactId = (await tx.query(`SELECT id FROM contacts WHERE workspace_id = $1 AND email = $2`, [workspaceId, lead.contact.email])).rows[0]?.id ?? null;
    }
    const r = (await tx.query(`SELECT * FROM record_lead_event($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [orgId, workspaceId, lead.source, lead.channel, lead.externalId, contactId, lead.consentBasis, lead.receivedAt, JSON.stringify(lead.payload)])).rows[0];
    const touchBlocker = (await tx.query(`SELECT lead_touch_blocker($1) AS r`, [r.lead_event_id])).rows[0].r;
    return { outcome: r.outcome, leadEventId: r.lead_event_id, relatedLeadEventId: r.related_lead_event_id, touchBlocker };
  });
}

/**
 * Record the first touch of a lead (write-once). `role` is the caller's worker role: inbox_svc or sender_svc.
 * @returns 'recorded' | 'already_touched' | 'not_found' | 'no_consent' | 'no_contact' | 'suppressed'
 */
export async function markFirstTouch(client, { orgId, workspaceId, role = 'sender_svc' }, leadEventId, { channel, by }) {
  if (!CHANNELS.includes(channel)) throw new LeadError(`unknown channel ${JSON.stringify(channel)}`);
  if (!TOUCHERS.includes(by)) throw new LeadError(`unknown toucher ${JSON.stringify(by)}`);
  // No time argument: the database stamps the first touch with its own clock, so a caller cannot back-date or future-date it.
  return withService(client, { orgId, workspaceId, role }, async (tx) =>
    (await tx.query(`SELECT record_first_touch($1, $2, $3) AS r`, [leadEventId, channel, by])).rows[0].r);
}

/** Median and p90 time to first touch, and how many landed inside the workspace's window, per source and channel. */
export async function ttftBySource(client, { userId, orgId, workspaceId }, from, to) {
  return withTenant(client, { userId, orgId, workspaceId, role: 'app_rw' }, async (tx) =>
    (await tx.query(`SELECT source, channel, n, touched, median_s, p90_s, within_window FROM ttft_by_source($1, $2)`, [from, to])).rows);
}
