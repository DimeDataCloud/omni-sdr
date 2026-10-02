-- Omni-SDR 0008: follow-up (SPEC §1 acceptance steps 8–9; Stations 15–16).
-- 1. An out-of-office reply snoozes the sequence to the return date, and it resumes where it was.
-- 2. A meeting request's SLA escalates in-app → push → email, once each (the DB makes "once" a constraint).
-- 3. A draft says what it is for: a sequence step, or a no-show's reschedule note. The send loop holds a sequence
--    step until its wait has passed; a reschedule note goes once approved (claude-local's #45 audit: as a step>0
--    draft it waited 3–4 business days, or forever if the earlier step never sent). Either way it is gated and
--    approved like every draft, and send_guard() still decides.

-- ─── draft purpose ──────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE drafts ADD COLUMN purpose text NOT NULL DEFAULT 'sequence' CHECK (purpose IN ('sequence', 'reschedule'));
GRANT INSERT (purpose) ON drafts TO app_rw;

-- ─── snooze ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Where the sequence was when it snoozed, so waking resumes it instead of restarting it.
ALTER TABLE enrollments ADD COLUMN resume_state text
  CHECK (resume_state IS NULL OR resume_state IN ('waiting', 'drafting', 'awaiting_approval', 'scheduled', 'sent'));
GRANT UPDATE (resume_state) ON enrollments TO inbox_svc;

-- Waking runs across tenants (the refine job), so it is one narrow definer function: it only turns `snoozed`
-- enrollments whose time has come back into the state they had. Nothing else on the row, no text, no other state.
GRANT UPDATE (state, stop_reason, resume_state) ON enrollments TO inbox_owner;
CREATE FUNCTION inbox_wake_snoozed(p_now timestamptz, p_limit int)
RETURNS TABLE (id uuid, org_id uuid, workspace_id uuid, state text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE enrollments e SET state = coalesce(e.resume_state, 'waiting'), resume_state = NULL, stop_reason = NULL
  WHERE e.id IN (SELECT x.id FROM enrollments x WHERE x.state = 'snoozed' AND x.next_run_at <= p_now
                 ORDER BY x.next_run_at LIMIT least(greatest(p_limit, 1), 1000))
  RETURNING e.id, e.org_id, e.workspace_id, e.state
$$;
GRANT CREATE ON SCHEMA public TO inbox_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION inbox_wake_snoozed(timestamptz, int) OWNER TO inbox_owner;
REVOKE CREATE ON SCHEMA public FROM inbox_owner;
REVOKE EXECUTE ON FUNCTION inbox_wake_snoozed(timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inbox_wake_snoozed(timestamptz, int) TO inbox_svc;

-- ─── notifications ──────────────────────────────────────────────────────────────────────────────────────────────
-- One row per (reply, kind, channel): the UNIQUE is what makes each escalation step happen once, however often the
-- job runs or races. Push and email are delivered by the notify relay (Station 22) from the outbox event written in
-- the same transaction; the row is the record that the step happened.
CREATE TABLE notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  workspace_id        uuid NOT NULL,
  inbound_message_id  uuid NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('sla_meeting')),
  channel             text NOT NULL CHECK (channel IN ('in_app', 'push', 'email')),
  due_at              timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  read_at             timestamptz,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  -- A notification only exists because of its reply: deleting the reply (retention, a test's cleanup) takes it along.
  FOREIGN KEY (org_id, workspace_id, inbound_message_id) REFERENCES inbound_messages(org_id, workspace_id, id) ON DELETE CASCADE,
  UNIQUE (inbound_message_id, kind, channel)
);
CREATE INDEX notifications_ws_unread ON notifications (workspace_id, created_at DESC) WHERE read_at IS NULL;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON notifications USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()));

GRANT SELECT ON notifications TO app_rw;
GRANT UPDATE (read_at) ON notifications TO app_rw;
GRANT SELECT, INSERT ON notifications TO inbox_svc;
CREATE POLICY ops_all ON notifications TO ops USING (true) WITH CHECK (true);
GRANT ALL ON notifications TO ops;

-- The escalation steps that are due, across tenants: ids and times only. The job then writes each step inside that
-- reply's own tenant scope as inbox_svc. Steps: in-app when the SLA starts, push when an hour is left (a wall-clock
-- halfway point would land at night over a weekend), email when the SLA is breached. A handled reply escalates no further.
GRANT SELECT (sla_due_at, handled_at) ON inbound_messages TO inbox_owner;
GRANT SELECT (inbound_message_id, kind, channel) ON notifications TO inbox_owner;
CREATE POLICY inbox_all ON notifications TO inbox_owner USING (true);
CREATE FUNCTION inbox_sla_due(p_now timestamptz, p_limit int)
RETURNS TABLE (org_id uuid, workspace_id uuid, inbound_message_id uuid, channel text, due_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.org_id, i.workspace_id, i.id, s.channel, s.due_at
  FROM inbound_messages i
  CROSS JOIN LATERAL (VALUES ('in_app', i.received_at),
                             ('push', greatest(i.received_at, i.sla_due_at - interval '60 minutes')),
                             ('email', i.sla_due_at)) AS s(channel, due_at)
  WHERE i.sla_due_at IS NOT NULL AND i.handled_at IS NULL AND s.due_at <= p_now
    AND NOT EXISTS (SELECT 1 FROM notifications n
                    WHERE n.inbound_message_id = i.id AND n.kind = 'sla_meeting' AND n.channel = s.channel)
  ORDER BY s.due_at LIMIT least(greatest(p_limit, 1), 1000)
$$;
GRANT CREATE ON SCHEMA public TO inbox_owner;
ALTER FUNCTION inbox_sla_due(timestamptz, int) OWNER TO inbox_owner;
REVOKE CREATE ON SCHEMA public FROM inbox_owner;
REVOKE EXECUTE ON FUNCTION inbox_sla_due(timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inbox_sla_due(timestamptz, int) TO inbox_svc;
