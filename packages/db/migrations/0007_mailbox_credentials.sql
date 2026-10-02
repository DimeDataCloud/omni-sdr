-- Omni-SDR 0007: mailbox credentials and the send loop's work list (docs/claude/SENDER-PLAN.md §1, §3).
-- A connected mailbox's OAuth refresh token, sealed by the application with AES-256-GCM under a key held in Secret
-- Manager (the $0 rule, DECISIONS 2026-10-02, in place of KMS). The database never sees the key or the plaintext.
-- The console can connect and disconnect (app_rw: insert, update) but never read a token back: app_rw has no
-- SELECT on `secret`. Only sender_svc reads it.

CREATE TABLE mailbox_credentials (
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  mailbox_id    uuid PRIMARY KEY,
  provider      text NOT NULL CHECK (provider IN ('gmail')),
  -- v1.<12-byte iv, base64url>.<ciphertext + 16-byte tag, base64url> (packages/sender/src/credentials.mjs)
  secret        text NOT NULL CHECK (secret ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$' AND length(secret) <= 8192),
  scopes        text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 8),
  connected_by  uuid REFERENCES users(id),
  connected_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, mailbox_id) REFERENCES mailboxes(org_id, workspace_id, id)
);
ALTER TABLE mailbox_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON mailbox_credentials USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()));

-- app_rw: connect (insert) and reconnect/disconnect (update), and read the status columns. Never `secret`.
GRANT SELECT (org_id, workspace_id, mailbox_id, provider, scopes, connected_by, connected_at, revoked_at) ON mailbox_credentials TO app_rw;
GRANT INSERT ON mailbox_credentials TO app_rw;
GRANT UPDATE (secret, scopes, connected_by, connected_at, revoked_at) ON mailbox_credentials TO app_rw;
-- sender_svc: reads the sealed token to send; pauses a mailbox whose token Google refused.
GRANT SELECT ON mailbox_credentials TO sender_svc;
GRANT UPDATE (paused_reason) ON mailboxes TO sender_svc;
GRANT SELECT (org_id, workspace_id, mailbox_id, provider, scopes, connected_at, revoked_at) ON mailbox_credentials TO ops;

-- The loop's work list, across tenants: ids only, never text. Each workspace is then opened in its own scope
-- (withService) and every rule is applied there; this function only saves visiting idle workspaces.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sender_owner') THEN CREATE ROLE sender_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO sender_owner;
GRANT SELECT (id, org_id, workspace_id, status, channel) ON drafts TO sender_owner;
GRANT SELECT (draft_id) ON messages TO sender_owner;
CREATE POLICY sender_list ON drafts TO sender_owner USING (true);
CREATE POLICY sender_list ON messages TO sender_owner USING (true);

CREATE FUNCTION sender_due_workspaces(p_limit int)
RETURNS TABLE (org_id uuid, workspace_id uuid, approved bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.org_id, d.workspace_id, count(*) FROM drafts d
  WHERE d.status = 'approved' AND d.channel = 'email'
    AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.draft_id = d.id)
  GROUP BY d.org_id, d.workspace_id ORDER BY count(*) DESC LIMIT least(greatest(p_limit, 1), 1000)
$$;
GRANT CREATE ON SCHEMA public TO sender_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION sender_due_workspaces(int) OWNER TO sender_owner;
REVOKE CREATE ON SCHEMA public FROM sender_owner;
REVOKE EXECUTE ON FUNCTION sender_due_workspaces(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sender_due_workspaces(int) TO sender_svc;

-- The loop reads today's counters to prefer the mailbox with the most room (the guard still enforces the cap).
GRANT SELECT ON send_counters TO sender_svc;

-- send_guard() (0001) never looked at the enrollment, so an approved follow-up could still go out after the person
-- replied, booked, unsubscribed or was paused: the inbound path stops the enrollment, but nothing made a stopped
-- enrollment stop the send (found 2026-10-02 writing the send loop). A second guard on the same INSERT, in the same
-- transaction, so its refusal also rolls back the cap unit send_guard() took.
CREATE FUNCTION send_guard_enrollment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st text;
BEGIN
  SELECT e.state INTO st FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id WHERE d.id = NEW.draft_id;
  IF st IS NULL THEN RAISE EXCEPTION 'send_guard: enrollment not found' USING ERRCODE = 'P0001'; END IF;
  IF st IN ('stopped', 'converted', 'completed', 'paused', 'snoozed') THEN
    RAISE EXCEPTION 'send_guard: enrollment is %', st USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER send_guard_enrollment BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION send_guard_enrollment();
GRANT CREATE ON SCHEMA public TO guard_owner;  -- owned like send_guard(): guard_owner already reads drafts and enrollments
ALTER FUNCTION send_guard_enrollment() OWNER TO guard_owner;
REVOKE CREATE ON SCHEMA public FROM guard_owner;
REVOKE EXECUTE ON FUNCTION send_guard_enrollment() FROM PUBLIC;
