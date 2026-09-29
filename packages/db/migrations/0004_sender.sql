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
