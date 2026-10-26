-- 0021 (B-12): the 200-a-day organisation cap, and what a bounce or a complaint does.
--
-- 1. send_guard() takes one unit of an organisation-wide counter for the UTC day as well as one of the mailbox's, in the
--    same transaction with one send_day() read. A refusal by either raises, and the rollback undoes the other's unit.
--    A refused send is never queued: the claim transaction fails and no message row exists.
--    The limit is 200 by CHECK on the counter, so a code path that forgot the guard still cannot push a row past it.
--    mailboxes.daily_cap gets the same upper bound; 0001's default of 5 is the warm-up floor and stays.
-- 2. mail_events + record_mail_event(): provider events (Cloudflare Email Service, via the queue consumer later) land here.
--    Idempotent on (provider message id, type). Suppress on a complaint (the person, as an unsubscribe does) and on a
--    terminal bounce or failure (the address only, as 0020's inbox path does). Never on deferred, rejected or delivered.
-- 3. sender_svc may append an audit_log row, so a refusal can be recorded AFTER its transaction rolled back (a row written
--    inside it would roll back with it).
--
-- send_guard is guard_owner's and only its owner may replace it, so, as in 0019 and 0020, this acts as that role.
-- The body is 0020's with the marked (0021) lines added; nothing else moves.

CREATE FUNCTION send_day() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'UTC')::date $$;

CREATE TABLE org_send_counters (
  org_id  uuid NOT NULL REFERENCES orgs(id),
  day     date NOT NULL,
  count   int  NOT NULL DEFAULT 0 CHECK (count >= 0 AND count <= 200),
  PRIMARY KEY (org_id, day)
);
ALTER TABLE org_send_counters ENABLE ROW LEVEL SECURITY;  ALTER TABLE org_send_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON org_send_counters USING (org_id = app_org()) WITH CHECK (org_id = app_org());
CREATE POLICY guard_all ON org_send_counters TO guard_owner USING (true) WITH CHECK (true);
GRANT SELECT ON org_send_counters TO sender_svc, app_rw;   -- the same readers as send_counters
GRANT SELECT, INSERT, UPDATE ON org_send_counters TO guard_owner;

-- PRE-MIGRATE CHECK: this fails if any mailbox has daily_cap > 200. Run `SELECT id, daily_cap FROM mailboxes WHERE daily_cap > 200` first and
-- lower those rows. (2026-10-26: prod has no live mailboxes yet, so the risk is low.)
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_daily_cap_max CHECK (daily_cap <= 200);

GRANT INSERT ON audit_log TO sender_svc;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO sender_svc;

GRANT CREATE ON SCHEMA public TO guard_owner;
SET ROLE guard_owner;

CREATE OR REPLACE FUNCTION send_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d  drafts%ROWTYPE;
  e  enrollments%ROWTYPE;
  c  contacts%ROWTYPE;
  w  workspaces%ROWTYPE;
  mb mailboxes%ROWTYPE;
  n  int;
  today date;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(org_lock_key(NEW.org_id));
  PERFORM pg_advisory_xact_lock_shared(org_lock_key(NULL));
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'send_guard: sends need a READ COMMITTED transaction' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO d FROM drafts WHERE id = NEW.draft_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_guard: draft not found' USING ERRCODE = 'P0001'; END IF;
  IF d.org_id <> NEW.org_id OR d.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'send_guard: draft belongs to another tenant' USING ERRCODE = 'P0001';
  END IF;
  IF d.status <> 'approved' OR NOT d.gate_passed OR d.gate_body_sha IS DISTINCT FROM draft_sha(d.subject, d.body) THEN
    RAISE EXCEPTION 'send_guard: draft not approved with a current gate pass' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.channel <> d.channel THEN
    RAISE EXCEPTION 'send_guard: channel mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO e FROM enrollments WHERE id = d.enrollment_id;
  SELECT * INTO c FROM contacts WHERE id = e.contact_id;
  IF e.workspace_id IS DISTINCT FROM d.workspace_id OR c.workspace_id IS DISTINCT FROM d.workspace_id THEN
    RAISE EXCEPTION 'send_guard: enrollment or contact belongs to another tenant' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO w FROM workspaces WHERE id = d.workspace_id;

  IF d.approved_by IS NULL AND NOT (w.trust_level >= 2 AND e.heat >= 4) THEN
    RAISE EXCEPTION 'send_guard: trust level % requires human approval', w.trust_level USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM holds h WHERE
       (h.scope_type = 'org' AND h.scope_id = d.org_id) OR
       (h.scope_type = 'workspace' AND h.scope_id = d.workspace_id) OR
       (h.scope_type = 'campaign' AND h.scope_id = e.campaign_id) OR
       (h.scope_type = 'mailbox' AND h.scope_id = NEW.mailbox_id)) THEN
    RAISE EXCEPTION 'send_guard: on hold' USING ERRCODE = 'P0001';
  END IF;

  IF _person_suppressed(c.id, NEW.channel) THEN
    RAISE EXCEPTION 'send_guard: contact suppressed' USING ERRCODE = 'P0001';
  END IF;

  IF d.channel = 'email' THEN
    IF c.email IS NULL OR c.email_status <> 'valid' THEN
      RAISE EXCEPTION 'send_guard: contact email not verified' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM suppression s WHERE s.value_hash = value_hash(c.email)
               AND (s.scope_org_id IS NULL OR s.scope_org_id = d.org_id)) THEN
      RAISE EXCEPTION 'send_guard: contact suppressed' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO mb FROM mailboxes WHERE id = NEW.mailbox_id;
    IF NOT FOUND OR mb.workspace_id <> d.workspace_id THEN
      RAISE EXCEPTION 'send_guard: mailbox not in this workspace' USING ERRCODE = 'P0001';
    END IF;
    IF mb.paused_reason IS NOT NULL THEN
      RAISE EXCEPTION 'send_guard: mailbox paused (%)', mb.paused_reason USING ERRCODE = 'P0001';
    END IF;

    -- (0021) One UTC day for both counters, read once. The organisation's unit first, then the mailbox's: whichever refuses,
    -- the exception rolls this transaction back, including the unit the other took.
    today := send_day();
    INSERT INTO org_send_counters AS oc (org_id, day, count) VALUES (d.org_id, today, 1)
      ON CONFLICT (org_id, day) DO UPDATE SET count = oc.count + 1 WHERE oc.count < 200
      RETURNING count INTO n;
    IF n IS NULL THEN
      RAISE EXCEPTION 'send_guard: organization daily cap reached (200)' USING ERRCODE = 'P0001';
    END IF;

    n := NULL;
    INSERT INTO send_counters AS sc (org_id, mailbox_id, day, count)
      VALUES (d.org_id, mb.id, today, 1)
      ON CONFLICT (mailbox_id, day) DO UPDATE SET count = sc.count + 1 WHERE sc.count < mb.daily_cap
      RETURNING count INTO n;
    IF n IS NULL THEN
      RAISE EXCEPTION 'send_guard: mailbox daily cap reached' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'send_guard: channel % has no send path', d.channel USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM guard_owner;

-- ─── provider events ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE mail_events (
  provider_message_id  text NOT NULL,
  type                 text NOT NULL CHECK (type IN ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained')),
  org_id               uuid NOT NULL REFERENCES orgs(id),
  workspace_id         uuid NOT NULL,
  message_id           uuid NOT NULL,
  terminal             boolean NOT NULL DEFAULT false,
  acted                text NOT NULL CHECK (acted IN ('none', 'address', 'person')),
  received_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_message_id, type, terminal),
  FOREIGN KEY (org_id, workspace_id, message_id) REFERENCES messages(org_id, workspace_id, id) ON DELETE CASCADE
);
ALTER TABLE mail_events ENABLE ROW LEVEL SECURITY;  ALTER TABLE mail_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON mail_events FOR SELECT USING (org_id = app_org());
GRANT SELECT ON mail_events TO app_rw;
-- A closer sees only their handed-off thread (0015): neither new table is part of it.
CREATE POLICY closer_scope ON mail_events AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id)) WITH CHECK (true);
CREATE POLICY closer_scope ON org_send_counters AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id)) WITH CHECK (true);

-- unsub_owner is the opt-out family's definer (0003, 0020): it already writes suppression and stops enrollments and may call
-- _suppress_person. It now also reads the message and its draft, and writes the event row.
GRANT SELECT ON messages, drafts TO unsub_owner;
GRANT SELECT, INSERT ON mail_events TO unsub_owner;
CREATE POLICY unsub_all ON messages FOR SELECT TO unsub_owner USING (true);
CREATE POLICY unsub_all ON drafts FOR SELECT TO unsub_owner USING (true);
CREATE POLICY unsub_all ON mail_events TO unsub_owner USING (true) WITH CHECK (true);

-- Called by the events route as inbox_svc, with no tenant: the message names the org. Cloudflare's REST send answers with
-- recipient lists and no message id, so an event's messageId usually matches nothing we stored. The fallback is the
-- recipient: the most recent email SENT to that address in the last 30 days (by whichever org sent it). The address
-- suppressed is always the one on our own contact row, never the text the caller sent. Answers 'recorded', 'duplicate'
-- or 'unknown_message'. p_provider_message_id is the event's messageId and, with the type, the idempotency key.
CREATE FUNCTION record_mail_event(p_provider_message_id text, p_type text, p_terminal boolean, p_recipient text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m messages%ROWTYPE; c contacts%ROWTYPE; act text; n int;
BEGIN
  IF p_type NOT IN ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained') THEN
    RAISE EXCEPTION 'record_mail_event: unknown type' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM messages WHERE provider_message_id = p_provider_message_id AND channel = 'email'
    ORDER BY claimed_at LIMIT 1;
  IF NOT FOUND AND btrim(coalesce(p_recipient, '')) <> '' THEN
    SELECT ms.* INTO m FROM messages ms JOIN drafts d ON d.id = ms.draft_id JOIN enrollments e ON e.id = d.enrollment_id
      JOIN contacts k ON k.id = e.contact_id
      WHERE ms.channel = 'email' AND ms.state = 'sent' AND ms.sent_at > now() - interval '30 days'
        AND k.email IS NOT NULL AND value_hash(k.email) = value_hash(p_recipient)
      ORDER BY ms.sent_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN 'unknown_message'; END IF;
  SELECT k.* INTO c FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN contacts k ON k.id = e.contact_id
    WHERE d.id = m.draft_id AND k.org_id = m.org_id;
  IF NOT FOUND THEN RETURN 'unknown_message'; END IF;

  act := CASE WHEN p_type = 'complained' THEN 'person'
              WHEN p_type IN ('bounced', 'failed') AND coalesce(p_terminal, false) THEN 'address'
              ELSE 'none' END;
  INSERT INTO mail_events (provider_message_id, type, org_id, workspace_id, message_id, terminal, acted)
    VALUES (p_provider_message_id, p_type, m.org_id, m.workspace_id, m.id, coalesce(p_terminal, false), act)
    ON CONFLICT (provider_message_id, type, terminal) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN 'duplicate'; END IF;

  IF act = 'person' THEN
    PERFORM _suppress_person(c.id, m.org_id, 'complaint', true);
  ELSIF act = 'address' THEN
    IF btrim(coalesce(c.email, '')) <> '' THEN
      INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES (m.org_id, value_hash(c.email), 'email', 'bounce')
        ON CONFLICT DO NOTHING;
    END IF;
    UPDATE enrollments SET state = 'stopped', stop_reason = 'bounce', next_run_at = NULL
      WHERE org_id = m.org_id AND contact_id = c.id AND state NOT IN ('stopped', 'converted', 'completed');
  END IF;
  IF act <> 'none' THEN
    INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id)
      VALUES (m.org_id, 'provider', 'mail_event:' || p_type || ':' || act, 'message', m.id::text);
  END IF;
  RETURN 'recorded';
END $$;

-- ACLs first, ownership last (0008a): once the function belongs to unsub_owner the migrator can no longer change them.
REVOKE EXECUTE ON FUNCTION record_mail_event(text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_mail_event(text, text, boolean, text) TO inbox_svc;
GRANT CREATE ON SCHEMA public TO unsub_owner;
ALTER FUNCTION record_mail_event(text, text, boolean, text) OWNER TO unsub_owner;
REVOKE CREATE ON SCHEMA public FROM unsub_owner;
