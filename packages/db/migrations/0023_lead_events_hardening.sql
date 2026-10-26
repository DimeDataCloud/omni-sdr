-- 0023 (S2L-1b): hardening for lead_events, from the V audit of #127 (five P3s; the DB-level ones are here). 0022 is not edited.
--
--  1. First-touch time is the SERVER's. record_first_touch no longer takes the caller's time: the definer stamps clock_timestamp()
--     itself (never earlier than received_at, which a lead may overstate by at most 5 minutes of clock skew), and a trigger
--     rejects a first touch stamped after that or a lead received more than 5 minutes in the future. The old 4-argument function is dropped.
--  2. No DELETE and no TRUNCATE on lead_events, for anyone, the table owner and the migrator included (triggers, since an owner
--     always holds the privilege). A superuser can still disable a trigger or drop the table: that is outside what SQL can promise.
--     Erasure is "anonymize the contact, never delete" (the composite FK to contacts is NO ACTION, and the anonymizing UPDATE
--     does not touch the key columns); a controlled erasure definer belongs to the privacy card (B-20).
--  3. Contact identity cannot enter a lead_event by structure: a CHECK on payload and on external_id, so even a role that
--     bypasses the definer cannot write it. Keys are normalized (lower-case, only letters and digits) so camelCase, snake_case,
--     "full name" and "e-mail" collapse before the deny list; string and number values shaped like an email or a phone are refused.
--     LIMIT: this guards structured identity fields, not free text. A name typed into a free-text value is not detected.
--  4. lead_touch_blocker takes the channel of the TOUCH, not only the lead's own: suppression is checked on that channel, and an
--     sms or voice touch needs the lead to have arrived on that channel until per-channel consent exists (S2L-5).
--
-- Not here: tying a first touch to a real send (S2L-2, where sends are wired).

-- ─── 3. identity-free CHECKs ─────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION lead_key_identity_free(k text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE n text := regexp_replace(lower(k), '[^[:alnum:]]', '', 'g');
BEGIN
  RETURN NOT (n IN ('tel', 'ssn', 'cell') OR n ~ '(mail|phone|mobile|handle|address|name|(phone|mobile|cell|tel)(number|num|no))$');
END $$;

-- A value is refused if it looks like an email, or like a phone: 7+ digits with a separator or a leading + (a bare ISO date is
-- allowed), or a BARE run of exactly 10 or 11 digits. Other bare digit runs are allowed: ad-platform ids are 15+ digits.
CREATE FUNCTION lead_value_identity_free(p text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE s text := btrim(p); d int;
BEGIN
  IF s IS NULL THEN RETURN true; END IF;
  IF s ~ '[^[:space:]@"]+@[^[:space:]@"]+\.[A-Za-z]{2,}' THEN RETURN false; END IF;
  IF s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN true; END IF;
  d := length(regexp_replace(s, '[^0-9]', '', 'g'));
  IF s ~ '^[+(]?[0-9][0-9 ()./+-]*$' THEN
    IF s ~ '^[0-9]+$' THEN RETURN d NOT IN (10, 11); END IF;
    RETURN d < 7;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION lead_payload_identity_free(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE r record;
BEGIN
  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      FOR r IN SELECT key, value FROM jsonb_each(p) LOOP
        IF NOT public.lead_key_identity_free(r.key) OR NOT public.lead_payload_identity_free(r.value) THEN RETURN false; END IF;
      END LOOP;
    WHEN 'array' THEN
      FOR r IN SELECT value FROM jsonb_array_elements(p) LOOP
        IF NOT public.lead_payload_identity_free(r.value) THEN RETURN false; END IF;
      END LOOP;
    WHEN 'string', 'number' THEN
      RETURN public.lead_value_identity_free(p #>> '{}');
    ELSE NULL;
  END CASE;
  RETURN true;
END $$;

ALTER TABLE lead_events ADD CONSTRAINT lead_events_payload_identity_free CHECK (lead_payload_identity_free(payload));
ALTER TABLE lead_events ADD CONSTRAINT lead_events_external_id_identity_free CHECK (lead_value_identity_free(external_id));

-- ─── 1. server time, 2. no delete ────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION lead_events_bounds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.received_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'lead_events: received_at is more than 5 minutes in the future' USING ERRCODE = '23514';
  END IF;
  IF NEW.first_touch_at IS NOT NULL AND NEW.first_touch_at > greatest(clock_timestamp(), NEW.received_at) THEN
    RAISE EXCEPTION 'lead_events: first_touch_at is in the future' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_events_bounds BEFORE INSERT OR UPDATE ON lead_events FOR EACH ROW EXECUTE FUNCTION lead_events_bounds();

CREATE FUNCTION lead_events_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead_events: a lead event is never deleted (anonymize the contact instead)' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER lead_events_no_delete BEFORE DELETE ON lead_events FOR EACH ROW EXECUTE FUNCTION lead_events_no_delete();
CREATE TRIGGER lead_events_no_truncate BEFORE TRUNCATE ON lead_events FOR EACH STATEMENT EXECUTE FUNCTION lead_events_no_delete();

-- ─── 1 and 4. the two definers, replaced under their owner ───────────────────────────────────────────────────────
-- The old signatures are dropped (a caller can no longer pass its own time). As in 0019 to 0021, the migrator acts as the owner
-- for the replacement, so the new functions are lead_owner's from the start and the ACLs are set by their owner.
GRANT CREATE ON SCHEMA public TO lead_owner;
SET ROLE lead_owner;
DROP FUNCTION lead_touch_blocker(uuid);
DROP FUNCTION record_first_touch(uuid, text, text, timestamptz);

-- May this lead be touched, by p_channel (NULL = the lead's own channel)? NULL = yes; else 'not_found', 'no_consent',
-- 'no_contact' or 'suppressed'. sms and voice are the channels with their own consent law: until per-channel consent is
-- recorded (S2L-5), such a touch is allowed only when the person reached us on that same channel.
CREATE FUNCTION lead_touch_blocker(p_lead_event uuid, p_channel text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l lead_events%ROWTYPE; c text;
BEGIN
  IF app_org() IS NULL THEN RETURN 'not_found'; END IF;
  SELECT * INTO l FROM lead_events WHERE id = p_lead_event AND org_id = app_org() AND workspace_id = ANY (app_ws());
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  c := coalesce(p_channel, l.channel);
  IF l.consent_basis = 'none' THEN RETURN 'no_consent'; END IF;
  IF c IN ('sms', 'voice') AND l.channel <> c THEN RETURN 'no_consent'; END IF;
  IF l.contact_id IS NULL THEN RETURN 'no_contact'; END IF;
  IF person_suppressed(l.contact_id, c) THEN RETURN 'suppressed'; END IF;
  RETURN NULL;
END $$;

-- Record the first touch, once, at the server's clock. 'recorded', 'already_touched', 'not_found', or the blocker's reason
-- (nothing is written then). The table's triggers remain the guarantee of write-once; this only turns them into an answer.
CREATE FUNCTION record_first_touch(p_lead_event uuid, p_channel text, p_by text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l lead_events%ROWTYPE; why text; n int;
BEGIN
  IF app_org() IS NULL THEN RETURN 'not_found'; END IF;
  SELECT * INTO l FROM lead_events WHERE id = p_lead_event AND org_id = app_org() AND workspace_id = ANY (app_ws());
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF l.first_touch_at IS NOT NULL THEN RETURN 'already_touched'; END IF;
  why := lead_touch_blocker(p_lead_event, p_channel);
  IF why IS NOT NULL THEN RETURN why; END IF;
  UPDATE lead_events SET first_touch_at = greatest(clock_timestamp(), l.received_at), first_touch_channel = p_channel, first_touch_by = p_by
    WHERE id = p_lead_event AND first_touch_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'recorded' ELSE 'already_touched' END;
END $$;

REVOKE EXECUTE ON FUNCTION lead_touch_blocker(uuid, text), record_first_touch(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lead_touch_blocker(uuid, text) TO app_rw, inbox_svc, sender_svc;
GRANT EXECUTE ON FUNCTION record_first_touch(uuid, text, text) TO inbox_svc, sender_svc;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM lead_owner;
