-- Omni-SDR 0004: what the sender needs to address and route a message (INFRA §14).
-- Grounding: omni-sdr-journal/citations/email-compliance-can-spam.md (commercial email carries
-- the sender's valid postal address) and google-oauth-scopes.md (send-only; replies come back via Reply-To).

-- The customer's own postal address for its outreach footers (DECISIONS: "customer outreach carries
-- the customer's address, collected in onboarding, enforced by the gate"). Admin-editable like the
-- other workspace settings (0002 trigger applies). The sender refuses to send without it.
ALTER TABLE workspaces ADD COLUMN postal_address text CHECK (postal_address IS NULL OR length(btrim(postal_address)) BETWEEN 10 AND 300);
GRANT UPDATE (postal_address) ON workspaces TO app_rw;

-- Reply routing without Gmail read scopes: Reply-To: r+<token>@reply.omnisdr.com. Only the hash is
-- stored; the email worker hashes the local part it receives and looks the message up.
ALTER TABLE messages ADD COLUMN reply_token_hash text UNIQUE CHECK (reply_token_hash IS NULL OR reply_token_hash ~ '^[0-9a-f]{64}$');

-- The sender must read the recipient address and the evidence-free parts of the contact it writes to.
GRANT SELECT (id, org_id, workspace_id, name, email, phone) ON contacts TO sender_svc;
GRANT SELECT ON enrollments TO sender_svc;

-- Unknown outcomes: a message claimed but never recorded as sent/failed (a crash between the provider
-- call and the record step). Nothing may resend these (draft_id is UNIQUE); a human checks the
-- provider's Sent folder and records the truth. security_invoker keeps RLS in force for whoever reads it.
CREATE VIEW ops_unknown_outcomes WITH (security_invoker = true) AS
  SELECT id, org_id, workspace_id, draft_id, mailbox_id, channel, claimed_at
  FROM messages WHERE state = 'claimed' AND claimed_at < now() - interval '15 minutes';
GRANT SELECT ON ops_unknown_outcomes TO ops;
