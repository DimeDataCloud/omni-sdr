-- Omni-SDR 0019: the reply send step (#94). A playbook reply a person approved (0017) goes out from the workspace's
-- mailbox, exactly once, and only past a guard in the database. It ships OFF: the send job picks replies up only when
-- OMNI_REPLY_SEND=1, which is the orchestrator's call (rails §3.4).
--
--   * reply_messages: one row per approved reply draft (UNIQUE), claimed → sent | failed, like messages (0001). A new
--     table because messages.draft_id is NOT NULL and points at outreach drafts.
--   * reply_send_guard(): the last check before a provider, as send_guard() is for outreach. It runs as guard_owner and
--     refuses unless the draft is approved by a person in the last 48 hours, on email or a website form, in a
--     conversation still open or qualified, answering the newest message in it, to a contact who isn't suppressed,
--     with no hold, from a live mailbox in the workspace, within that mailbox's daily cap (the same counter outreach
--     uses, so replies and outreach share the mailbox's limit). The recipient is the conversation's contact's address,
--     set here, never by the caller.
--   * sender_due_replies(): which workspaces have a reply waiting, for the send loop (cross-tenant, names nothing else).
--   * LinkedIn, chat and Meta replies are never sent from here: those are copied by hand.

CREATE TABLE reply_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  workspace_id         uuid NOT NULL,
  reply_draft_id       uuid NOT NULL UNIQUE,   -- exactly once, structurally
  conversation_id      uuid NOT NULL,          -- set by the guard
  mailbox_id           uuid NOT NULL,
  to_address           text NOT NULL CHECK (length(to_address) <= 320),   -- set by the guard
  state                text NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed', 'sent', 'failed')),
  provider_message_id  text CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 998),
  claimed_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  error                text CHECK (error IS NULL OR length(error) <= 500),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, reply_draft_id) REFERENCES reply_drafts(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, conversation_id) REFERENCES conversations(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, mailbox_id) REFERENCES mailboxes(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id),
  CHECK ((state = 'sent') = (sent_at IS NOT NULL)),
  CHECK (state <> 'failed' OR error IS NOT NULL)
);
CREATE INDEX reply_messages_by_conversation ON reply_messages (conversation_id, claimed_at);

-- A claimed row moves once, to sent or failed, and then never again: no resend through an UPDATE.
CREATE FUNCTION reply_messages_settle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'claimed' THEN
    RAISE EXCEPTION 'reply message: already %', OLD.state USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reply_messages_settle BEFORE UPDATE ON reply_messages FOR EACH ROW EXECUTE FUNCTION reply_messages_settle();

CREATE FUNCTION reply_send_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d  reply_drafts%ROWTYPE;
  cv conversations%ROWTYPE;
  i  inbound_messages%ROWTYPE;
  c  contacts%ROWTYPE;
  mb mailboxes%ROWTYPE;
  n  int;
BEGIN
  SELECT * INTO d FROM reply_drafts WHERE id = NEW.reply_draft_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_guard: reply draft not found' USING ERRCODE = 'P0001'; END IF;
  IF d.org_id <> NEW.org_id OR d.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'send_guard: reply draft belongs to another tenant' USING ERRCODE = 'P0001';
  END IF;
  IF d.status <> 'approved' OR d.decided_by IS NULL OR d.body_final IS NULL THEN
    RAISE EXCEPTION 'send_guard: reply not approved by a person' USING ERRCODE = 'P0001';
  END IF;
  IF d.decided_at < now() - interval '48 hours' THEN
    RAISE EXCEPTION 'send_guard: approval is older than 48 hours' USING ERRCODE = 'P0001';
  END IF;
  IF d.channel NOT IN ('email', 'form') THEN
    RAISE EXCEPTION 'send_guard: channel % is copied by hand, not sent', d.channel USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO cv FROM conversations WHERE id = d.conversation_id;
  IF cv.workspace_id IS DISTINCT FROM d.workspace_id THEN
    RAISE EXCEPTION 'send_guard: conversation belongs to another tenant' USING ERRCODE = 'P0001';
  END IF;
  IF cv.state NOT IN ('open', 'qualified') THEN
    RAISE EXCEPTION 'send_guard: conversation is %', cv.state USING ERRCODE = 'P0001';
  END IF;
  NEW.conversation_id := cv.id;

  -- The reply answers a message in this conversation, and nothing newer has come in since: a stale answer never goes.
  SELECT * INTO i FROM inbound_messages WHERE id = d.inbound_message_id;
  IF NOT FOUND OR i.conversation_id IS DISTINCT FROM cv.id THEN
    RAISE EXCEPTION 'send_guard: the reply answers no message in this conversation' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM inbound_messages j WHERE j.conversation_id = cv.id AND j.received_at > i.received_at) THEN
    RAISE EXCEPTION 'send_guard: a newer message arrived after this reply was approved' USING ERRCODE = 'P0001';
  END IF;

  -- The recipient is the conversation's contact, never an address the caller names.
  SELECT * INTO c FROM contacts WHERE id = cv.contact_id;
  IF NOT FOUND OR c.workspace_id IS DISTINCT FROM d.workspace_id OR c.email IS NULL THEN
    RAISE EXCEPTION 'send_guard: no contact address for this conversation' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM suppression s WHERE s.value_hash IN (value_hash(c.email), value_hash(c.phone))
             AND (s.scope_org_id IS NULL OR s.scope_org_id = d.org_id)) THEN
    RAISE EXCEPTION 'send_guard: contact suppressed' USING ERRCODE = 'P0001';
  END IF;
  NEW.to_address := lower(c.email);

  IF EXISTS (SELECT 1 FROM holds h WHERE
       (h.scope_type = 'org' AND h.scope_id = d.org_id) OR
       (h.scope_type = 'workspace' AND h.scope_id = d.workspace_id) OR
       (h.scope_type = 'mailbox' AND h.scope_id = NEW.mailbox_id)) THEN
    RAISE EXCEPTION 'send_guard: on hold' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO mb FROM mailboxes WHERE id = NEW.mailbox_id;
  IF NOT FOUND OR mb.workspace_id <> d.workspace_id THEN
    RAISE EXCEPTION 'send_guard: mailbox not in this workspace' USING ERRCODE = 'P0001';
  END IF;
  IF mb.paused_reason IS NOT NULL THEN
    RAISE EXCEPTION 'send_guard: mailbox paused (%)', mb.paused_reason USING ERRCODE = 'P0001';
  END IF;
  -- One unit of today's cap, shared with outreach; no row back = cap reached.
  INSERT INTO send_counters AS sc (org_id, mailbox_id, day, count)
    VALUES (d.org_id, mb.id, (now() AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (mailbox_id, day) DO UPDATE SET count = sc.count + 1 WHERE sc.count < mb.daily_cap
    RETURNING count INTO n;
  IF n IS NULL THEN
    RAISE EXCEPTION 'send_guard: mailbox daily cap reached' USING ERRCODE = 'P0001';
  END IF;

  NEW.state := 'claimed'; NEW.provider_message_id := NULL; NEW.sent_at := NULL; NEW.error := NULL;
  RETURN NEW;
END $$;
-- Created before the owner change and the revoke (a trigger fires whatever its function's EXECUTE privilege).
CREATE TRIGGER reply_send_guard BEFORE INSERT ON reply_messages FOR EACH ROW EXECUTE FUNCTION reply_send_guard();
-- guard_owner already reads contacts, holds, suppression and mailboxes and writes send_counters (0001); it now reads
-- the reply side too.
GRANT SELECT ON reply_drafts, conversations, inbound_messages TO guard_owner;
CREATE POLICY guard_read ON reply_drafts FOR SELECT TO guard_owner USING (true);
CREATE POLICY guard_read ON conversations FOR SELECT TO guard_owner USING (true);
CREATE POLICY guard_read ON inbound_messages FOR SELECT TO guard_owner USING (true);
REVOKE EXECUTE ON FUNCTION reply_send_guard() FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO guard_owner;
ALTER FUNCTION reply_send_guard() OWNER TO guard_owner;
REVOKE CREATE ON SCHEMA public FROM guard_owner;

-- Which workspaces have an approved reply waiting (the guard decides whether it may go). Names nothing but the tenant.
CREATE FUNCTION sender_due_replies(p_limit int)
RETURNS TABLE (org_id uuid, workspace_id uuid, waiting bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.org_id, d.workspace_id, count(*) FROM reply_drafts d
  WHERE d.status = 'approved' AND d.channel IN ('email', 'form') AND d.decided_at > now() - interval '48 hours'
    AND NOT EXISTS (SELECT 1 FROM reply_messages r WHERE r.reply_draft_id = d.id)
  GROUP BY d.org_id, d.workspace_id ORDER BY count(*) DESC LIMIT least(greatest(p_limit, 1), 1000)
$$;
GRANT SELECT (id, org_id, workspace_id, status, channel, decided_at) ON reply_drafts TO sender_owner;
CREATE POLICY sender_list ON reply_drafts FOR SELECT TO sender_owner USING (true);
REVOKE EXECUTE ON FUNCTION sender_due_replies(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sender_due_replies(int) TO sender_svc;
GRANT CREATE ON SCHEMA public TO sender_owner;
ALTER FUNCTION sender_due_replies(int) OWNER TO sender_owner;
REVOKE CREATE ON SCHEMA public FROM sender_owner;

ALTER TABLE reply_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reply_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON reply_messages USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()));
CREATE POLICY ops_all ON reply_messages TO ops USING (true) WITH CHECK (true);
-- A closer sees none of it (0015's rule for every org table).
CREATE POLICY closer_scope ON reply_messages AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id)) WITH CHECK (true);
GRANT ALL ON reply_messages TO ops;
-- sender_svc is the only role that creates or settles one; the app reads them.
GRANT SELECT, INSERT (org_id, workspace_id, reply_draft_id, mailbox_id) ON reply_messages TO sender_svc;
GRANT UPDATE (state, provider_message_id, sent_at, error) ON reply_messages TO sender_svc;
GRANT SELECT ON reply_messages TO app_rw;
-- What the send step reads to compose: the approved text, the conversation's contact and the message it answers.
GRANT SELECT ON reply_drafts TO sender_svc;
GRANT SELECT (id, org_id, workspace_id, contact_id, channel, state) ON conversations TO sender_svc;
GRANT SELECT (id, org_id, workspace_id, conversation_id, subject, external_id, received_at) ON inbound_messages TO sender_svc;
