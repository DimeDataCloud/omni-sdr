-- 0024 (S2L-2a): a first touch needs a real send. Closes P3 (2) of the V audit of #127: nothing tied a touch to a message.
--
-- record_first_touch now takes the id of the message that WAS the touch and refuses unless that message
--   - exists in this lead's org and workspace (another tenant's or another workspace's id answers 'message_not_found'),
--   - went to this lead's own contact (the message's enrollment contact; another contact's answers 'message_not_found' too, so the
--     id cannot be probed),
--   - has state 'sent' (or 'confirmed', which only a sent message reaches) and a sent_at,
--   - was sent on the touch's channel ('message_channel' otherwise),
--   - was sent at or after the lead arrived ('message_before_lead': last week's cold email to the same person is not a first touch).
-- The first touch is stamped with the message's own sent_at (the sender wrote it, the caller cannot choose it) and the message id is
-- stored on the lead event, write-once like the rest of the touch. The 4-argument 0023 function is dropped.
--
-- A touch recorded before this migration has no message id (first_touch_message_id NULL): history is not rewritten, and the
-- write-once trigger forbids tying one afterwards.

ALTER TABLE lead_events ADD COLUMN first_touch_message_id uuid;
ALTER TABLE lead_events ADD FOREIGN KEY (org_id, workspace_id, first_touch_message_id) REFERENCES messages(org_id, workspace_id, id);
ALTER TABLE lead_events ADD CONSTRAINT lead_events_touch_message_needs_touch CHECK (first_touch_message_id IS NULL OR first_touch_at IS NOT NULL);

-- Write-once now covers the message id too (0022's trigger function, same name, one more column in the touch tuple).
CREATE OR REPLACE FUNCTION lead_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.org_id, NEW.workspace_id, NEW.contact_id, NEW.inbound_message_id, NEW.source, NEW.channel, NEW.external_id,
      NEW.consent_basis, NEW.received_at, NEW.payload, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.workspace_id, OLD.contact_id, OLD.inbound_message_id, OLD.source, OLD.channel, OLD.external_id,
      OLD.consent_basis, OLD.received_at, OLD.payload, OLD.created_at) THEN
    RAISE EXCEPTION 'lead_events: a lead event is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.first_touch_at IS NOT NULL AND (NEW.first_touch_at, NEW.first_touch_channel, NEW.first_touch_by, NEW.first_touch_message_id)
       IS DISTINCT FROM (OLD.first_touch_at, OLD.first_touch_channel, OLD.first_touch_by, OLD.first_touch_message_id) THEN
    RAISE EXCEPTION 'lead_events: the first touch is write-once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- lead_owner reads the message, its draft and its enrollment, only to answer the questions above, and only inside the caller's
-- tenant context (org and workspace, the same predicate as the tenant policies): no context sees nothing, tenant A never sees B.
GRANT SELECT ON messages, drafts, enrollments TO lead_owner;
CREATE POLICY lead_read ON messages    FOR SELECT TO lead_owner USING (org_id = app_org() AND workspace_id = ANY (app_ws()));
CREATE POLICY lead_read ON drafts      FOR SELECT TO lead_owner USING (org_id = app_org() AND workspace_id = ANY (app_ws()));
CREATE POLICY lead_read ON enrollments FOR SELECT TO lead_owner USING (org_id = app_org() AND workspace_id = ANY (app_ws()));
GRANT UPDATE (first_touch_message_id) ON lead_events TO lead_owner;

-- Replace the definer under its owner (the 0023 pattern).
GRANT CREATE ON SCHEMA public TO lead_owner;
SET ROLE lead_owner;
DROP FUNCTION record_first_touch(uuid, text, text);

-- 'recorded', 'already_touched', 'not_found', the blocker's reason, or one of: 'no_message' (none given), 'message_not_found',
-- 'message_not_sent', 'message_channel', 'message_before_lead'. Nothing is written for any refusal.
CREATE FUNCTION record_first_touch(p_lead_event uuid, p_channel text, p_by text, p_message uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l lead_events%ROWTYPE; v_id uuid; v_state text; v_channel text; v_sent timestamptz; v_contact uuid; why text; n int;
BEGIN
  IF app_org() IS NULL THEN RETURN 'not_found'; END IF;
  SELECT * INTO l FROM lead_events WHERE id = p_lead_event AND org_id = app_org() AND workspace_id = ANY (app_ws());
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF l.first_touch_at IS NOT NULL THEN RETURN 'already_touched'; END IF;
  why := lead_touch_blocker(p_lead_event, p_channel);
  IF why IS NOT NULL THEN RETURN why; END IF;
  IF p_message IS NULL THEN RETURN 'no_message'; END IF;
  SELECT ms.id, ms.state, ms.channel, ms.sent_at, e.contact_id INTO v_id, v_state, v_channel, v_sent, v_contact
    FROM messages ms JOIN drafts d ON d.id = ms.draft_id JOIN enrollments e ON e.id = d.enrollment_id
   WHERE ms.id = p_message AND ms.org_id = l.org_id AND ms.workspace_id = l.workspace_id;
  IF NOT FOUND OR v_contact IS DISTINCT FROM l.contact_id THEN RETURN 'message_not_found'; END IF;
  IF v_state NOT IN ('sent', 'confirmed') OR v_sent IS NULL THEN RETURN 'message_not_sent'; END IF;
  IF v_channel IS DISTINCT FROM p_channel THEN RETURN 'message_channel'; END IF;
  IF v_sent < l.received_at THEN RETURN 'message_before_lead'; END IF;
  UPDATE lead_events SET first_touch_at = v_sent, first_touch_channel = p_channel, first_touch_by = p_by, first_touch_message_id = v_id
    WHERE id = p_lead_event AND first_touch_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'recorded' ELSE 'already_touched' END;
END $$;

REVOKE EXECUTE ON FUNCTION record_first_touch(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_first_touch(uuid, text, text, uuid) TO inbox_svc, sender_svc;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM lead_owner;
