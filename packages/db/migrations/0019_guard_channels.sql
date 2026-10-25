-- 0019: send_guard fails closed on a channel it has no checks for.
-- Until now an approved, gated draft on 'sms' got only a suppression check (no daily cap) and one on
-- 'linkedin_assist' got no channel checks at all; the message row was allowed in. Neither channel sends today.
-- The function belongs to guard_owner (0001) and only its owner may replace it, so, like 0008a, this acts as that role,
-- which the migration role may SET ROLE to. CREATE OR REPLACE keeps the owner and the ACL from 0001 and 0008a.
-- guard_owner has no CREATE on the schema (and must not keep it), so the grant is lent for this file only.
-- The email branch is unchanged, line for line.

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
BEGIN
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
  -- The FKs already bind these to the draft's workspace; the guard re-checks rather than trust them.
  IF e.workspace_id IS DISTINCT FROM d.workspace_id OR c.workspace_id IS DISTINCT FROM d.workspace_id THEN
    RAISE EXCEPTION 'send_guard: enrollment or contact belongs to another tenant' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO w FROM workspaces WHERE id = d.workspace_id;

  -- Trust dial: level 1 needs a human; 2–3 may auto-send only hot leads.
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

    -- Take one unit of today's cap in the same transaction; no row back = cap reached.
    INSERT INTO send_counters AS sc (org_id, mailbox_id, day, count)
      VALUES (d.org_id, mb.id, (now() AT TIME ZONE 'UTC')::date, 1)
      ON CONFLICT (mailbox_id, day) DO UPDATE SET count = sc.count + 1 WHERE sc.count < mb.daily_cap
      RETURNING count INTO n;
    IF n IS NULL THEN
      RAISE EXCEPTION 'send_guard: mailbox daily cap reached' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Fail closed (SPEC S5, S13). 'sms' and 'linkedin_assist' have no send path yet, and the checks they will need
    -- (caps, suppression, restriction breakers) are not written. Whoever builds a channel adds its branch above and
    -- a test that sabotages each check, in the same migration that lets it through.
    RAISE EXCEPTION 'send_guard: channel % has no send path', d.channel USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM guard_owner;
