-- 0022 (S2L-1): the lead-level record for speed to lead, one row per lead from any source, and the time to first touch.
--
-- A lead_event WRAPS what already exists. The text of a form or an email reply stays in inbound_messages, whose own dedupe
-- (workspace_id, channel, external_id) is untouched; a form or email adapter links its row through inbound_message_id and passes
-- the same external_id, so the two keys cannot disagree. lead_events adds what inbound_messages cannot say: which source and
-- adapter, on what consent basis, when the first touch happened, and by whom. (inbound_messages.channel was widened in 0015 to
-- the eight inbound channels; this migration does not touch it. sms and voice have no inbound row yet.)
--
-- Every write goes through a definer function (owner lead_owner); app_rw can only read. Each function proves the caller's tenant
-- context itself and answers 'not_found' for another tenant's id, so a sender-role call cannot reach another tenant's lead.
--
-- Reserved, no columns yet (S2L-6 and S2L-7 add them in their own migration, once their shapes are known): the outcome fields
-- booked_at, paid_at, handed_off_at, closed_at and handoff_at. Rows are immutable except for the one write-once first touch.
--
-- Nothing here sends. No adapter is wired. The send lock is unchanged.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_owner') THEN CREATE ROLE lead_owner NOLOGIN; END IF;
END $$;

-- The window a first touch should land in. Read by ttft_by_source(); no UPDATE grant yet (the setting UI comes later).
ALTER TABLE workspaces ADD COLUMN response_window_minutes int NOT NULL DEFAULT 5 CHECK (response_window_minutes BETWEEN 1 AND 1440);

CREATE TABLE lead_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  workspace_id         uuid NOT NULL,
  contact_id           uuid,                 -- who the lead is, once resolved; identity itself stays on contacts
  inbound_message_id   uuid UNIQUE,          -- the wrapped inbound_messages row, when the channel has one
  source               text NOT NULL CHECK (source IN ('web_form', 'ad_lead', 'inbound_email', 'list_import', 'social_dm',
                         'social_comment', 'sms', 'voice', 'crm')),
  channel              text NOT NULL CHECK (channel IN ('email', 'linkedin', 'form', 'chat', 'instagram_comment', 'instagram_dm',
                         'facebook_comment', 'messenger', 'sms', 'voice')),
  -- The source's own id for this lead (a form submission id, a platform lead id). Never an email address or a phone number.
  external_id          text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 998),
  -- Why we may contact this person. 'none' is recorded and measured, and blocks any first touch: no basis, no outbound.
  consent_basis        text NOT NULL CHECK (consent_basis IN ('express_form', 'existing_customer', 'inquiry_reply', 'imported_attested', 'none')),
  received_at          timestamptz NOT NULL,
  -- Platform-specific context for the adapter. ADAPTERS MUST NOT COPY CONTACT IDENTITY HERE (no email, phone, handle or name):
  -- ad forms will tempt this, and identity belongs on contacts, where suppression and erasure can find it. Size-capped; never secrets or tokens.
  payload              jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 20000),
  first_touch_at       timestamptz,
  first_touch_channel  text CHECK (first_touch_channel IN ('email', 'linkedin', 'form', 'chat', 'instagram_comment', 'instagram_dm',
                         'facebook_comment', 'messenger', 'sms', 'voice')),
  first_touch_by       text CHECK (first_touch_by IN ('agent', 'human', 'system')),   -- system: missed-call text-back, timed fallbacks
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, inbound_message_id) REFERENCES inbound_messages(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id),
  UNIQUE (workspace_id, source, external_id),
  CHECK ((first_touch_at IS NULL) = (first_touch_channel IS NULL) AND (first_touch_at IS NULL) = (first_touch_by IS NULL)),
  CHECK (first_touch_at IS NULL OR first_touch_at >= received_at)
);
CREATE INDEX lead_events_by_contact ON lead_events (workspace_id, contact_id, received_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX lead_events_by_received ON lead_events (workspace_id, received_at);

-- Immutable except the first touch, and the first touch is write-once. Enforced here, not only in the definer, so no other
-- path (a future grant, the migrator, ops) can rewrite history: the number the pilot is sold on cannot be edited after the fact.
CREATE FUNCTION lead_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.org_id, NEW.workspace_id, NEW.contact_id, NEW.inbound_message_id, NEW.source, NEW.channel, NEW.external_id,
      NEW.consent_basis, NEW.received_at, NEW.payload, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.workspace_id, OLD.contact_id, OLD.inbound_message_id, OLD.source, OLD.channel, OLD.external_id,
      OLD.consent_basis, OLD.received_at, OLD.payload, OLD.created_at) THEN
    RAISE EXCEPTION 'lead_events: a lead event is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.first_touch_at IS NOT NULL AND (NEW.first_touch_at, NEW.first_touch_channel, NEW.first_touch_by)
       IS DISTINCT FROM (OLD.first_touch_at, OLD.first_touch_channel, OLD.first_touch_by) THEN
    RAISE EXCEPTION 'lead_events: the first touch is write-once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_events_immutable BEFORE UPDATE ON lead_events FOR EACH ROW EXECUTE FUNCTION lead_events_immutable();

-- ─── RLS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;  ALTER TABLE lead_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON lead_events FOR SELECT USING (org_id = app_org() AND workspace_id = ANY (app_ws()));
-- A closer sees only their handed-off thread (0015); a lead event is not part of it.
CREATE POLICY closer_scope ON lead_events AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id)) WITH CHECK (true);
GRANT SELECT ON lead_events TO app_rw;          -- read only: no INSERT, UPDATE or DELETE for any caller but lead_owner

-- lead_owner is the definer: it inserts a lead event and writes the first touch, nothing else.
GRANT USAGE ON SCHEMA public TO lead_owner;
CREATE POLICY lead_all ON lead_events TO lead_owner USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON lead_events TO lead_owner;
GRANT UPDATE (first_touch_at, first_touch_channel, first_touch_by) ON lead_events TO lead_owner;
GRANT EXECUTE ON FUNCTION app_org(), app_ws() TO lead_owner;
-- person_suppressed is guard_owner's, so only its owner may grant on it (as in 0021, this acts as that role for one statement).
SET ROLE guard_owner;
GRANT EXECUTE ON FUNCTION person_suppressed(uuid, text) TO lead_owner;
RESET ROLE;

-- ─── definer functions ───────────────────────────────────────────────────────────────────────────────────────────

-- Intake: record one lead, idempotent on (workspace, source, external_id). related_lead_event_id names the same contact's
-- most recent earlier lead in the last 24 h (the same person arriving by a second source), so the core can avoid a second
-- first touch; it is NULL when there is none. The caller's tenant context must be the org and workspace passed.
CREATE FUNCTION record_lead_event(p_org uuid, p_ws uuid, p_source text, p_channel text, p_external_id text, p_contact uuid,
                                  p_consent_basis text, p_received_at timestamptz, p_payload jsonb)
RETURNS TABLE (outcome text, lead_event_id uuid, related_lead_event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_rel uuid;
BEGIN
  IF app_org() IS NULL OR p_org IS DISTINCT FROM app_org() OR NOT (p_ws = ANY (app_ws())) THEN
    RAISE EXCEPTION 'record_lead_event: the tenant context does not match' USING ERRCODE = '42501';
  END IF;
  INSERT INTO lead_events (org_id, workspace_id, contact_id, source, channel, external_id, consent_basis, received_at, payload)
    VALUES (p_org, p_ws, p_contact, p_source, p_channel, p_external_id, p_consent_basis, p_received_at, coalesce(p_payload, '{}'))
    ON CONFLICT (workspace_id, source, external_id) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT l.id INTO v_id FROM lead_events l WHERE l.workspace_id = p_ws AND l.source = p_source AND l.external_id = p_external_id;
    RETURN QUERY SELECT 'duplicate'::text, v_id, NULL::uuid;
    RETURN;
  END IF;
  IF p_contact IS NOT NULL THEN
    SELECT l.id INTO v_rel FROM lead_events l
      WHERE l.workspace_id = p_ws AND l.contact_id = p_contact AND l.id <> v_id
        AND l.received_at > p_received_at - interval '24 hours' AND l.received_at <= p_received_at
      ORDER BY l.received_at DESC LIMIT 1;
  END IF;
  RETURN QUERY SELECT 'recorded'::text, v_id, v_rel;
END $$;

-- May this lead be touched? NULL = yes. Otherwise the reason: 'not_found' (no such lead in this tenant), 'no_consent',
-- 'no_contact' (nobody resolved to contact), 'suppressed' (the person opted out, by any identity, via 0020's person check).
-- Cap, quiet hours and trust level stay in send_guard at send time.
CREATE FUNCTION lead_touch_blocker(p_lead_event uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l lead_events%ROWTYPE;
BEGIN
  IF app_org() IS NULL THEN RETURN 'not_found'; END IF;
  SELECT * INTO l FROM lead_events WHERE id = p_lead_event AND org_id = app_org() AND workspace_id = ANY (app_ws());
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF l.consent_basis = 'none' THEN RETURN 'no_consent'; END IF;
  IF l.contact_id IS NULL THEN RETURN 'no_contact'; END IF;
  IF person_suppressed(l.contact_id, l.channel) THEN RETURN 'suppressed'; END IF;
  RETURN NULL;
END $$;

-- Record the first touch, once. Answers 'recorded', 'already_touched', 'not_found', or the blocker's reason (nothing is written
-- then). The trigger above is the real guarantee of write-once; the check here only turns it into an answer.
CREATE FUNCTION record_first_touch(p_lead_event uuid, p_channel text, p_by text, p_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l lead_events%ROWTYPE; why text; n int;
BEGIN
  IF app_org() IS NULL THEN RETURN 'not_found'; END IF;
  SELECT * INTO l FROM lead_events WHERE id = p_lead_event AND org_id = app_org() AND workspace_id = ANY (app_ws());
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF l.first_touch_at IS NOT NULL THEN RETURN 'already_touched'; END IF;
  why := lead_touch_blocker(p_lead_event);
  IF why IS NOT NULL THEN RETURN why; END IF;
  UPDATE lead_events SET first_touch_at = p_at, first_touch_channel = p_channel, first_touch_by = p_by
    WHERE id = p_lead_event AND first_touch_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'recorded' ELSE 'already_touched' END;
END $$;

-- ACLs first, ownership last (0008a): once a function belongs to lead_owner the migrator can no longer change them.
REVOKE EXECUTE ON FUNCTION record_lead_event(uuid, uuid, text, text, text, uuid, text, timestamptz, jsonb),
  lead_touch_blocker(uuid), record_first_touch(uuid, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_lead_event(uuid, uuid, text, text, text, uuid, text, timestamptz, jsonb) TO inbox_svc;
GRANT EXECUTE ON FUNCTION lead_touch_blocker(uuid) TO app_rw, inbox_svc, sender_svc;
GRANT EXECUTE ON FUNCTION record_first_touch(uuid, text, text, timestamptz) TO inbox_svc, sender_svc;
GRANT CREATE ON SCHEMA public TO lead_owner;
ALTER FUNCTION record_lead_event(uuid, uuid, text, text, text, uuid, text, timestamptz, jsonb) OWNER TO lead_owner;
ALTER FUNCTION lead_touch_blocker(uuid) OWNER TO lead_owner;
ALTER FUNCTION record_first_touch(uuid, text, text, timestamptz) OWNER TO lead_owner;
REVOKE CREATE ON SCHEMA public FROM lead_owner;

-- ─── the metric ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Time to first touch per source and channel over [p_from, p_to) by received_at. SECURITY INVOKER: RLS scopes it to the
-- caller's workspaces, so no tenant can see another's numbers. within_window uses each workspace's own
-- response_window_minutes. Untouched leads count in n, not in touched, and never in the percentiles.
CREATE FUNCTION ttft_by_source(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (source text, channel text, n int, touched int, median_s double precision, p90_s double precision, within_window int)
LANGUAGE sql STABLE AS $$
  SELECT l.source, l.channel, count(*)::int, (count(*) FILTER (WHERE l.first_touch_at IS NOT NULL))::int,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.first_touch_at - l.received_at)) FILTER (WHERE l.first_touch_at IS NOT NULL),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM l.first_touch_at - l.received_at)) FILTER (WHERE l.first_touch_at IS NOT NULL),
         (count(*) FILTER (WHERE l.first_touch_at IS NOT NULL
                             AND l.first_touch_at <= l.received_at + make_interval(mins => w.response_window_minutes)))::int
  FROM lead_events l JOIN workspaces w ON w.org_id = l.org_id AND w.id = l.workspace_id
  WHERE l.received_at >= p_from AND l.received_at < p_to
  GROUP BY l.source, l.channel
  ORDER BY l.source, l.channel
$$;
GRANT EXECUTE ON FUNCTION ttft_by_source(timestamptz, timestamptz) TO app_rw;
