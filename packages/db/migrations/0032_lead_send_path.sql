-- 0032 (3b): the send path for lead drafts. After this, an approved lead_drafts row can become a message, through the same guard.
--
-- 3a (0031) made a lead's reply reviewable and approvable. This is the only change that lets one reach a provider. Nothing sends
-- while the send lock is ON; this is built against fakes and held for the go-live bundle.
--
-- What changes, and why each piece is here (design: omnisdr-pivot/DESIGN-backend-3b-send-path.md, verifier answers V-42):
--  1. messages names exactly ONE draft: draft_id (an enrollment's) or lead_draft_id (a lead's). A table CHECK enforces it for every role.
--  2. lead_drafts.contact_id must be the lead's own contact, structurally (composite FK), not only in the guard.
--  3. An approval is made by the signed-in approver, by trigger, with no exception for a missing user context.
--  4. send_guard() is ONE body for both shapes. The subject is resolved first (draft + enrollment, or lead draft + lead event);
--     everything after is the same tail, so the two shapes cannot drift. Lead-shape additions: an approver who is still allowed to
--     approve NOW, an approval no older than 7 days, and a consent check that reads lead_events directly (no GUC dependence).
--  5. Every reader that reached a message through drafts and enrollments learns the lead shape (V-42 rows 1-6, 11, 12).
--
-- Lead-shape email_status: 'unknown' and 'valid' pass, 'invalid' and 'risky' refuse (Halo ruling 2026-10-27: the person typed their
-- own address into the form and expects a reply inside the response window). Suppression, bounce and complaint stay hard blocks.

-- ─── 1. messages names exactly one draft ─────────────────────────────────────────────────────────────────────────
ALTER TABLE messages ALTER COLUMN draft_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN lead_draft_id uuid UNIQUE;
ALTER TABLE messages ADD CONSTRAINT messages_lead_draft_fk
  FOREIGN KEY (org_id, workspace_id, lead_draft_id) REFERENCES lead_drafts (org_id, workspace_id, id);
ALTER TABLE messages ADD CONSTRAINT messages_exactly_one_draft CHECK ((draft_id IS NULL) <> (lead_draft_id IS NULL));

-- ─── 2. a lead draft is for the lead's own contact ───────────────────────────────────────────────────────────────
ALTER TABLE lead_events ADD CONSTRAINT lead_events_id_contact_key UNIQUE (org_id, workspace_id, id, contact_id);
ALTER TABLE lead_drafts ADD CONSTRAINT lead_drafts_lead_contact_fk
  FOREIGN KEY (org_id, workspace_id, lead_event_id, contact_id) REFERENCES lead_events (org_id, workspace_id, id, contact_id);

-- ─── what the guard family reads, under FORCE RLS ────────────────────────────────────────────────────────────────
-- guard_owner is not the table owner, so each table needs a grant AND a policy; PGlite as a superuser would hide a gap, which is
-- why the new guard tests also run through definer-acl's non-superuser path.
GRANT SELECT ON lead_drafts, lead_events TO guard_owner;
CREATE POLICY guard_read ON lead_drafts FOR SELECT TO guard_owner USING (true);
CREATE POLICY guard_read ON lead_events FOR SELECT TO guard_owner USING (true);
GRANT SELECT (org_id, user_id, role, workspace_ids) ON memberships TO guard_owner;
CREATE POLICY guard_read ON memberships FOR SELECT TO guard_owner USING (true);

-- The sender reads the lead draft it is about to send (the tenant and closer_scope policies already apply to it).
GRANT SELECT ON lead_drafts TO sender_svc;
GRANT INSERT (lead_draft_id) ON messages TO sender_svc;

-- Other definers' reads, each through its own policy.
GRANT SELECT ON lead_drafts TO unsub_owner, inbox_owner, lead_owner;
CREATE POLICY unsub_all ON lead_drafts FOR SELECT TO unsub_owner USING (true);
CREATE POLICY inbox_all ON lead_drafts FOR SELECT TO inbox_owner USING (true);
CREATE POLICY lead_read ON lead_drafts FOR SELECT TO lead_owner USING (org_id = app_org() AND workspace_id = ANY (app_ws()));
GRANT SELECT (id, org_id, workspace_id, status, channel, approved_at) ON lead_drafts TO sender_owner;
GRANT SELECT (lead_draft_id) ON messages TO sender_owner;
CREATE POLICY sender_list ON lead_drafts FOR SELECT TO sender_owner USING (true);

GRANT USAGE ON SCHEMA public TO guard_owner;
GRANT CREATE ON SCHEMA public TO guard_owner, unsub_owner, inbox_owner, lead_owner, sender_owner;

-- ─── guard_owner: the approver check, the consent check, the binding trigger, send_guard, the readers it owns ───
SET ROLE guard_owner;

-- Who may approve a lead draft, now: one function mirroring packages/db/src/permissions.mjs for the 'approve' action (admin,
-- operator, reviewer; client_viewer only when the workspace allows client approvals; closer and anything else never), over a
-- membership that covers the workspace. A parity test pins it to can() so the two cannot drift.
CREATE FUNCTION lead_approver_ok(p_org uuid, p_ws uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM memberships m JOIN workspaces w ON w.org_id = m.org_id AND w.id = p_ws
     WHERE m.org_id = p_org AND m.user_id = p_user AND (m.workspace_ids IS NULL OR p_ws = ANY (m.workspace_ids))
       AND (m.role IN ('admin', 'operator', 'reviewer') OR (m.role = 'client_viewer' AND w.client_approvals_enabled)))
$$;

-- May this lead draft be sent on p_channel? NULL = yes; else the reason. Reads lead_events directly, so the answer never depends on
-- the caller's app.org_id / app.workspace_ids (lead_touch_blocker returns not_found without them). Mirrors lead_touch_blocker's
-- rules and reasons (parity-tested over consent x channel x suppression) and adds what that function cannot check because it takes a
-- lead id, not a draft: the draft's contact is the lead's contact.
CREATE FUNCTION lead_send_blocker(p_lead_draft uuid, p_channel text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ld lead_drafts%ROWTYPE; l lead_events%ROWTYPE;
BEGIN
  SELECT * INTO ld FROM lead_drafts WHERE id = p_lead_draft;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT * INTO l FROM lead_events WHERE id = ld.lead_event_id AND org_id = ld.org_id AND workspace_id = ld.workspace_id;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF l.consent_basis = 'none' THEN RETURN 'no_consent'; END IF;
  IF p_channel IN ('sms', 'voice') AND l.channel <> p_channel THEN RETURN 'no_consent'; END IF;
  IF l.contact_id IS NULL THEN RETURN 'no_contact'; END IF;
  IF l.contact_id <> ld.contact_id THEN RETURN 'contact_mismatch'; END IF;
  IF _person_suppressed(l.contact_id, p_channel) THEN RETURN 'suppressed'; END IF;
  RETURN NULL;
END $$;

-- An approval is a signed-in person's act. Whenever a row becomes approved, or its approver changes while approved, the signed-in
-- user must be the named approver and must be allowed to approve in this workspace. There is no exception for a missing user
-- context: a service role with no app.user_id (gate_svc has UPDATE on status) cannot complete an approval. A NULL approver on an
-- approved row is left to lead_drafts_approved_has_approver.
CREATE FUNCTION lead_drafts_approver_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.approved_by IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved' OR OLD.approved_by IS DISTINCT FROM NEW.approved_by THEN
      IF app_user() IS NULL OR NEW.approved_by <> app_user() THEN
        RAISE EXCEPTION 'lead_drafts: an approval is made by the signed-in approver' USING ERRCODE = '42501';
      END IF;
      IF NOT lead_approver_ok(NEW.org_id, NEW.workspace_id, NEW.approved_by) THEN
        RAISE EXCEPTION 'lead_drafts: this member cannot approve here' USING ERRCODE = '42501';
      END IF;
      -- The time of an approval is the database's, never the caller's: the 7-day cap in send_guard and sender_due_workspaces
      -- reads it, so a value the approver supplies (a date far ahead) would defeat the cap (V-45 P2-1).
      NEW.approved_at := now();
    ELSIF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      -- Nor can it be rewritten on an approved row: an old approval would be refreshed without a re-approval.
      RAISE EXCEPTION 'lead_drafts: approved_at is set by the approval itself and cannot be changed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- (the trigger itself is created after RESET ROLE: guard_owner has no TRIGGER privilege on lead_drafts, and should not)

-- One body for both shapes. Text is 0021's with the lead shape added; every 0021 message is kept word for word.
CREATE OR REPLACE FUNCTION send_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d  drafts%ROWTYPE;
  e  enrollments%ROWTYPE;
  ld lead_drafts%ROWTYPE;
  c  contacts%ROWTYPE;
  w  workspaces%ROWTYPE;
  mb mailboxes%ROWTYPE;
  n  int;
  today date;
  why text;
  is_lead boolean := NEW.lead_draft_id IS NOT NULL;
  s_org uuid; s_ws uuid; s_status text; s_gate boolean; s_sha text; s_subject text; s_body text; s_channel text;
  s_contact uuid; s_approved_by uuid; s_approved_at timestamptz; s_campaign uuid; s_heat int;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(org_lock_key(NEW.org_id));
  PERFORM pg_advisory_xact_lock_shared(org_lock_key(NULL));
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'send_guard: sends need a READ COMMITTED transaction' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.draft_id IS NULL) = (NEW.lead_draft_id IS NULL) THEN
    RAISE EXCEPTION 'send_guard: a message names exactly one draft' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Resolve the subject.
  IF NOT is_lead THEN
    SELECT * INTO d FROM drafts WHERE id = NEW.draft_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'send_guard: draft not found' USING ERRCODE = 'P0001'; END IF;
    SELECT * INTO e FROM enrollments WHERE id = d.enrollment_id;
    s_org := d.org_id; s_ws := d.workspace_id; s_status := d.status; s_gate := d.gate_passed; s_sha := d.gate_body_sha;
    s_subject := d.subject; s_body := d.body; s_channel := d.channel; s_contact := e.contact_id;
    s_approved_by := d.approved_by; s_campaign := e.campaign_id; s_heat := e.heat;
  ELSE
    SELECT * INTO ld FROM lead_drafts WHERE id = NEW.lead_draft_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'send_guard: draft not found' USING ERRCODE = 'P0001'; END IF;
    s_org := ld.org_id; s_ws := ld.workspace_id; s_status := ld.status; s_gate := ld.gate_passed; s_sha := ld.gate_body_sha;
    s_subject := ld.subject; s_body := ld.body; s_channel := ld.channel; s_contact := ld.contact_id;
    s_approved_by := ld.approved_by; s_approved_at := ld.approved_at;
  END IF;

  -- 2. The shared tail.
  IF s_org <> NEW.org_id OR s_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'send_guard: draft belongs to another tenant' USING ERRCODE = 'P0001';
  END IF;
  IF s_status <> 'approved' OR NOT s_gate OR s_sha IS DISTINCT FROM draft_sha(s_subject, s_body) THEN
    RAISE EXCEPTION 'send_guard: draft not approved with a current gate pass' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.channel <> s_channel THEN
    RAISE EXCEPTION 'send_guard: channel mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO c FROM contacts WHERE id = s_contact;
  IF (NOT is_lead AND e.workspace_id IS DISTINCT FROM s_ws) OR c.workspace_id IS DISTINCT FROM s_ws THEN
    RAISE EXCEPTION 'send_guard: enrollment or contact belongs to another tenant' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO w FROM workspaces WHERE id = s_ws;

  IF NOT is_lead THEN
    IF s_approved_by IS NULL AND NOT (w.trust_level >= 2 AND s_heat >= 4) THEN
      RAISE EXCEPTION 'send_guard: trust level % requires human approval', w.trust_level USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- A lead reply is always a person's approval (no trust-dial path), by someone who may still approve, recently.
    IF s_approved_by IS NULL THEN
      RAISE EXCEPTION 'send_guard: a lead reply requires human approval' USING ERRCODE = 'P0001';
    END IF;
    IF NOT lead_approver_ok(s_org, s_ws, s_approved_by) THEN
      RAISE EXCEPTION 'send_guard: the approver may no longer approve' USING ERRCODE = 'P0001';
    END IF;
    IF s_approved_at IS NULL OR s_approved_at < now() - interval '7 days' THEN
      RAISE EXCEPTION 'send_guard: the approval is older than 7 days' USING ERRCODE = 'P0001';
    END IF;
    why := lead_send_blocker(NEW.lead_draft_id, NEW.channel);
    IF why IS NOT NULL THEN
      RAISE EXCEPTION 'send_guard: lead cannot be contacted (%)', why USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM holds h WHERE
       (h.scope_type = 'org' AND h.scope_id = s_org) OR
       (h.scope_type = 'workspace' AND h.scope_id = s_ws) OR
       (h.scope_type = 'campaign' AND h.scope_id = s_campaign) OR
       (h.scope_type = 'mailbox' AND h.scope_id = NEW.mailbox_id)) THEN
    RAISE EXCEPTION 'send_guard: on hold' USING ERRCODE = 'P0001';
  END IF;

  IF _person_suppressed(c.id, NEW.channel) THEN
    RAISE EXCEPTION 'send_guard: contact suppressed' USING ERRCODE = 'P0001';
  END IF;

  IF s_channel = 'email' THEN
    IF c.email IS NULL OR (NOT is_lead AND c.email_status <> 'valid') OR (is_lead AND c.email_status NOT IN ('unknown', 'valid')) THEN
      RAISE EXCEPTION 'send_guard: contact email not verified' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM suppression s WHERE s.value_hash = value_hash(c.email)
               AND (s.scope_org_id IS NULL OR s.scope_org_id = s_org)) THEN
      RAISE EXCEPTION 'send_guard: contact suppressed' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO mb FROM mailboxes WHERE id = NEW.mailbox_id;
    IF NOT FOUND OR mb.workspace_id <> s_ws THEN
      RAISE EXCEPTION 'send_guard: mailbox not in this workspace' USING ERRCODE = 'P0001';
    END IF;
    IF mb.paused_reason IS NOT NULL THEN
      RAISE EXCEPTION 'send_guard: mailbox paused (%)', mb.paused_reason USING ERRCODE = 'P0001';
    END IF;

    today := send_day();
    INSERT INTO org_send_counters AS oc (org_id, day, count) VALUES (s_org, today, 1)
      ON CONFLICT (org_id, day) DO UPDATE SET count = oc.count + 1 WHERE oc.count < 200
      RETURNING count INTO n;
    IF n IS NULL THEN
      RAISE EXCEPTION 'send_guard: organization daily cap reached (200)' USING ERRCODE = 'P0001';
    END IF;

    n := NULL;
    INSERT INTO send_counters AS sc (org_id, mailbox_id, day, count)
      VALUES (s_org, mb.id, today, 1)
      ON CONFLICT (mailbox_id, day) DO UPDATE SET count = sc.count + 1 WHERE sc.count < mb.daily_cap
      RETURNING count INTO n;
    IF n IS NULL THEN
      RAISE EXCEPTION 'send_guard: mailbox daily cap reached' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'send_guard: channel % has no send path', s_channel USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

-- The enrollment guard has nothing to check for a lead message. The early return is reachable only through a row that names a lead
-- draft and no enrollment draft, which messages_exactly_one_draft guarantees; a row naming neither is refused by the CHECK first.
CREATE OR REPLACE FUNCTION send_guard_enrollment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st text;
BEGIN
  IF NEW.lead_draft_id IS NOT NULL AND NEW.draft_id IS NULL THEN RETURN NEW; END IF;
  SELECT e.state INTO st FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id WHERE d.id = NEW.draft_id;
  IF st IS NULL THEN RAISE EXCEPTION 'send_guard: enrollment not found' USING ERRCODE = 'P0001'; END IF;
  IF st IN ('stopped', 'converted', 'completed', 'paused', 'snoozed') THEN
    RAISE EXCEPTION 'send_guard: enrollment is %', st USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- The sender's last look before the provider call (0020), now placing a lead message too.
CREATE OR REPLACE FUNCTION message_handoff_ok(p_message uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org uuid := app_org(); v_contact uuid; v_channel text;
BEGIN
  IF v_org IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock_shared(org_lock_key(v_org));
  PERFORM pg_advisory_xact_lock_shared(org_lock_key(NULL));
  SELECT coalesce(e.contact_id, ld.contact_id), m.channel INTO v_contact, v_channel
    FROM messages m
    LEFT JOIN drafts d ON d.id = m.draft_id LEFT JOIN enrollments e ON e.id = d.enrollment_id
    LEFT JOIN lead_drafts ld ON ld.id = m.lead_draft_id
   WHERE m.id = p_message AND m.org_id = v_org;
  IF v_contact IS NULL THEN RETURN false; END IF;
  RETURN NOT _person_suppressed(v_contact, v_channel);
END $$;

REVOKE EXECUTE ON FUNCTION lead_approver_ok(uuid, uuid, uuid), lead_send_blocker(uuid, text) FROM PUBLIC;
RESET ROLE;

CREATE TRIGGER lead_drafts_approver_binding BEFORE INSERT OR UPDATE ON lead_drafts
  FOR EACH ROW EXECUTE FUNCTION lead_drafts_approver_binding();
SET ROLE guard_owner;
REVOKE EXECUTE ON FUNCTION lead_drafts_approver_binding() FROM PUBLIC;
RESET ROLE;

-- ─── unsub_owner: a complaint or a bounce on a lead message must suppress the contact ────────────────────────────
-- If this resolved to nothing we would keep mailing someone who complained, so both lookups learn the lead shape.
SET ROLE unsub_owner;
CREATE OR REPLACE FUNCTION record_mail_event(p_provider_message_id text, p_type text, p_terminal boolean, p_recipient text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m messages%ROWTYPE; c contacts%ROWTYPE; act text; n int;
BEGIN
  IF p_type NOT IN ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained') THEN
    RAISE EXCEPTION 'record_mail_event: unknown type' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM messages WHERE provider_message_id = p_provider_message_id AND channel = 'email'
    ORDER BY claimed_at LIMIT 1;
  IF NOT FOUND AND btrim(coalesce(p_recipient, '')) <> '' THEN
    SELECT ms.* INTO m FROM messages ms
      LEFT JOIN drafts d ON d.id = ms.draft_id LEFT JOIN enrollments e ON e.id = d.enrollment_id
      LEFT JOIN lead_drafts ld ON ld.id = ms.lead_draft_id
      JOIN contacts k ON k.id = coalesce(e.contact_id, ld.contact_id)
      WHERE ms.channel = 'email' AND ms.state = 'sent' AND ms.sent_at > now() - interval '30 days'
        AND k.email IS NOT NULL AND value_hash(k.email) = value_hash(p_recipient)
      ORDER BY ms.sent_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN 'unknown_message'; END IF;
  SELECT k.* INTO c FROM messages ms
    LEFT JOIN drafts d ON d.id = ms.draft_id LEFT JOIN enrollments e ON e.id = d.enrollment_id
    LEFT JOIN lead_drafts ld ON ld.id = ms.lead_draft_id
    JOIN contacts k ON k.id = coalesce(e.contact_id, ld.contact_id)
    WHERE ms.id = m.id AND k.org_id = m.org_id;
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
RESET ROLE;

-- ─── inbox_owner: a reply to a lead message threads to that lead ─────────────────────────────────────────────────
SET ROLE inbox_owner;
CREATE OR REPLACE FUNCTION inbox_resolve_reply(p_token_hash text)
RETURNS TABLE (org_id uuid, workspace_id uuid, message_id uuid, contact_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.org_id, m.workspace_id, m.id, coalesce(e.contact_id, ld.contact_id)
  FROM messages m
  LEFT JOIN drafts d ON d.id = m.draft_id LEFT JOIN enrollments e ON e.id = d.enrollment_id
  LEFT JOIN lead_drafts ld ON ld.id = m.lead_draft_id
  WHERE m.reply_token_hash = p_token_hash AND p_token_hash ~ '^[0-9a-f]{64}$'
    AND coalesce(e.contact_id, ld.contact_id) IS NOT NULL
$$;
RESET ROLE;

-- ─── sender_owner: a workspace with only an approved lead draft is due ───────────────────────────────────────────
-- The 7 days match the guard's approval age, so an expired approval does not keep a workspace "due" forever.
SET ROLE sender_owner;
CREATE OR REPLACE FUNCTION sender_due_workspaces(p_limit int)
RETURNS TABLE (org_id uuid, workspace_id uuid, approved bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT x.org_id, x.workspace_id, sum(x.n)::bigint FROM (
    SELECT d.org_id, d.workspace_id, count(*) AS n FROM drafts d
     WHERE d.status = 'approved' AND d.channel = 'email'
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.draft_id = d.id)
     GROUP BY d.org_id, d.workspace_id
    UNION ALL
    SELECT l.org_id, l.workspace_id, count(*) FROM lead_drafts l
     WHERE l.status = 'approved' AND l.channel = 'email' AND l.approved_at > now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.lead_draft_id = l.id)
     GROUP BY l.org_id, l.workspace_id) x
  GROUP BY x.org_id, x.workspace_id ORDER BY sum(x.n) DESC LIMIT least(greatest(p_limit, 1), 1000)
$$;
RESET ROLE;

-- ─── lead_owner: the first touch can be a lead message ───────────────────────────────────────────────────────────
SET ROLE lead_owner;
CREATE OR REPLACE FUNCTION record_first_touch(p_lead_event uuid, p_channel text, p_by text, p_message uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l lead_events%ROWTYPE; v_id uuid; v_state text; v_channel text; v_sent timestamptz; v_contact uuid; why text; n int;
BEGIN
  IF app_org() IS NULL THEN RETURN 'not_found'; END IF;
  SELECT * INTO l FROM lead_events WHERE id = p_lead_event AND org_id = app_org() AND workspace_id = ANY (app_ws());
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF l.first_touch_at IS NOT NULL THEN RETURN 'already_touched'; END IF;
  why := lead_touch_blocker(p_lead_event, p_channel);
  IF why IS NOT NULL THEN RETURN why; END IF;
  IF p_message IS NULL THEN RETURN 'no_message'; END IF;
  SELECT ms.id, ms.state, ms.channel, ms.sent_at, coalesce(e.contact_id, ld.contact_id) INTO v_id, v_state, v_channel, v_sent, v_contact
    FROM messages ms
    LEFT JOIN drafts d ON d.id = ms.draft_id LEFT JOIN enrollments e ON e.id = d.enrollment_id
    LEFT JOIN lead_drafts ld ON ld.id = ms.lead_draft_id
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
RESET ROLE;

REVOKE CREATE ON SCHEMA public FROM guard_owner, unsub_owner, inbox_owner, lead_owner, sender_owner;
