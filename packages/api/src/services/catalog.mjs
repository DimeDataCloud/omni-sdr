// Connector modules (SPEC §9) and the free email checks (Station 11). Data, not screens: adding a module is
// a row here. Status is derived from what the workspace really has; nothing reports "Connected" on faith.
// `activation: 'live'` means the backend can connect and use it today (ops.mjs derives its status). A module with no
// backend yet is 'later', so the console shows "activates later" instead of a Connect button that goes nowhere.

export const CONNECTORS = Object.freeze([
  { id: 'gmail', name: 'Gmail', category: 'mail', auth: 'oauth', activation: 'live', costOwner: 'omni',
    scopes: [{ scope: 'https://www.googleapis.com/auth/gmail.send', why: 'Send the emails you approve from your own mailbox. Omni-SDR cannot read your mail.' }],
    note: 'Replies come back through reply.omnisdr.com, so no read access is needed.' },
  { id: 'smtp_imap', name: 'SMTP (app password)', category: 'mail', auth: 'app_password', activation: 'live', costOwner: 'customer',
    scopes: [], note: 'Fallback sending lane while Google verification is pending.' },
  { id: 'email_routing', name: 'Reply routing (reply.omnisdr.com)', category: 'mail', auth: 'provider', activation: 'live', costOwner: 'omni',
    scopes: [], note: 'Replies to your outreach land in the Omni-SDR inbox.' },
  { id: 'google_calendar', name: 'Google Calendar', category: 'calendar', auth: 'oauth', activation: 'later', costOwner: 'omni',
    scopes: [{ scope: '[VERIFY] free/busy + events', why: 'Offer three open slots and book the meeting.' }] },
  { id: 'calendly', name: 'Calendly', category: 'booking', auth: 'api_key', activation: 'later', costOwner: 'customer', scopes: [] },
  { id: 'cal_com', name: 'Cal.com', category: 'booking', auth: 'api_key', activation: 'later', costOwner: 'customer', scopes: [] },
  { id: 'linkedin_official', name: 'LinkedIn (official API)', category: 'social', auth: 'oauth', activation: 'later', costOwner: 'omni', scopes: [] },
  { id: 'linkedin_provider', name: 'LinkedIn automation (provider)', category: 'social', auth: 'provider', activation: 'later', costOwner: 'customer',
    scopes: [], consent: { required: true, version: 'draft-1' },
    note: 'Opt-in per account. Automation breaks LinkedIn\'s User Agreement and the account may be restricted.' },
  { id: 'shopify', name: 'Shopify', category: 'commerce', auth: 'oauth', activation: 'later', costOwner: 'omni', scopes: [] },
  { id: 'gohighlevel', name: 'GoHighLevel', category: 'crm', auth: 'oauth', activation: 'later', costOwner: 'omni', scopes: [] },
  { id: 'whop', name: 'Whop', category: 'commerce', auth: 'api_key', activation: 'later', costOwner: 'omni', scopes: [] },
  { id: 'google_drive', name: 'Google Drive, Docs, Sheets (exports)', category: 'export', auth: 'oauth', activation: 'later', costOwner: 'omni', scopes: [] },
  { id: 'webhooks', name: 'Outbound webhooks (signed)', category: 'export', auth: 'api_key', activation: 'later', costOwner: 'omni', scopes: [] },
  { id: 'mcp', name: 'MCP (two-way)', category: 'mcp', auth: 'api_key', activation: 'later', costOwner: 'omni', scopes: [] },
  { id: 'warmup', name: 'Third-party warm-up', category: 'warmup', auth: 'api_key', activation: 'later', costOwner: 'customer', scopes: [],
    note: 'Reply-network warm-up can put your mailbox at risk. Your hard daily cap always applies.' },
  { id: 'hubspot', name: 'HubSpot (two-way)', category: 'crm', auth: 'oauth', activation: 'later', costOwner: 'omni', scopes: [] },
  { id: 'other_social', name: 'Other social', category: 'social', auth: 'oauth', activation: 'later', costOwner: 'omni', scopes: [] },
  { id: 'sms', name: 'SMS', category: 'sms', auth: 'provider', activation: 'later', costOwner: 'customer', scopes: [],
    note: 'Collects A2P 10DLC details now; sending activates later.' },
]);

const ROLE_PREFIXES = new Set(['info', 'sales', 'support', 'admin', 'contact', 'hello', 'office', 'team', 'billing', 'marketing',
  'noreply', 'no-reply', 'help', 'jobs', 'careers', 'hr', 'webmaster', 'postmaster', 'abuse']);
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'trashmail.com',
  'yopmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc']);

// Free checks run on every lead. They can only mark an address invalid; only paid verification marks it
// valid (and only 'valid' can be sent to; send_guard enforces that).
export function freeEmailChecks(email) {
  const e = String(email ?? '').trim().toLowerCase();
  const m = /^([^@\s]+)@([a-z0-9-]+(\.[a-z0-9-]+)+)$/.exec(e);
  if (!m || e.length > 254 || m[1].length > 64) return { email: e, status: 'invalid', role: false, disposable: false, reason: 'syntax' };
  const disposable = DISPOSABLE.has(m[2]);
  return { email: e, status: disposable ? 'invalid' : 'unknown', role: ROLE_PREFIXES.has(m[1]), disposable,
    reason: disposable ? 'disposable domain' : null };
}
