-- Omni-SDR 0016: the closer's side of a handoff (docs/claude/SDR-PIVOT.md P4). A handoff carries an accept-by time;
-- one not accepted by then escalates to the workspace (an in-app alert, and an outbox event for push/email). Each member
-- keeps their own booking link, which the closer's summary card offers to the person being handed over.
--
--   * handoffs.due_at: set by the API when the handoff is made (business minutes, the meeting SLA's clock).
--   * memberships.booking_url: https only; written only by its own member, through app_set_booking_url().
--   * notifications may now be about a handoff instead of an inbound message (exactly one of the two).
--   * inbox_handoffs_overdue(): the escalation job's cross-tenant finder, ids and times only (like inbox_sla_due).
--   * A closer sees no workspace notifications (RESTRICTIVE, as in 0015): their alerts are their open handoffs.

-- ─── accept-by ────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE handoffs ADD COLUMN due_at timestamptz;
ALTER TABLE handoffs ADD CONSTRAINT handoffs_due_after_created CHECK (due_at IS NULL OR due_at >= created_at);
CREATE INDEX handoffs_due ON handoffs (due_at) WHERE outcome IS NULL AND accepted_at IS NULL;
GRANT INSERT (due_at) ON handoffs TO app_rw;

-- ─── booking link ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE memberships ADD COLUMN booking_url text
  CHECK (booking_url IS NULL OR (length(booking_url) <= 500 AND booking_url ~ '^https://[^[:space:]<>"]+$'));

-- The acting user sets (or clears, with NULL) the booking link on their own membership in p_org. Nobody else's.
CREATE FUNCTION app_set_booking_url(p_org uuid, p_url text) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
  WITH u AS (UPDATE memberships SET booking_url = p_url
             WHERE org_id = p_org AND user_id = app_user() AND app_user() IS NOT NULL RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;
GRANT UPDATE (booking_url) ON memberships TO tenancy_owner;
-- Grants before the owner change (0008a).
REVOKE EXECUTE ON FUNCTION app_set_booking_url(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_set_booking_url(uuid, text) TO app_rw;
GRANT CREATE ON SCHEMA public TO tenancy_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION app_set_booking_url(uuid, text) OWNER TO tenancy_owner;
REVOKE CREATE ON SCHEMA public FROM tenancy_owner;

-- ─── notifications about a handoff ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE notifications ALTER COLUMN inbound_message_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN handoff_id uuid;
ALTER TABLE notifications ADD CONSTRAINT notifications_handoff_fk
  FOREIGN KEY (org_id, workspace_id, handoff_id) REFERENCES handoffs(org_id, workspace_id, id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_one_subject CHECK (num_nonnulls(inbound_message_id, handoff_id) = 1);
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('sla_meeting', 'handoff_overdue'));
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_subject
  CHECK ((kind = 'handoff_overdue') = (handoff_id IS NOT NULL));
CREATE UNIQUE INDEX notifications_handoff_once ON notifications (handoff_id, kind, channel) WHERE handoff_id IS NOT NULL;

CREATE POLICY closer_scope ON notifications AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc USING (NOT app_is_closer(org_id));

-- The handoffs not accepted by their due time and not yet escalated, across tenants. The job then writes each alert
-- inside that handoff's own tenant scope as inbox_svc.
GRANT SELECT (id, org_id, workspace_id, closer_id, due_at, accepted_at, outcome) ON handoffs TO inbox_owner;
CREATE POLICY inbox_read ON handoffs FOR SELECT TO inbox_owner USING (true);
GRANT SELECT (handoff_id) ON notifications TO inbox_owner;
CREATE FUNCTION inbox_handoffs_overdue(p_now timestamptz, p_limit int)
RETURNS TABLE (org_id uuid, workspace_id uuid, handoff_id uuid, closer_id uuid, due_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.org_id, h.workspace_id, h.id, h.closer_id, h.due_at FROM handoffs h
  WHERE h.outcome IS NULL AND h.accepted_at IS NULL AND h.due_at IS NOT NULL AND h.due_at <= p_now
    AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.handoff_id = h.id AND n.kind = 'handoff_overdue')
  ORDER BY h.due_at LIMIT least(greatest(p_limit, 1), 1000)
$$;
REVOKE EXECUTE ON FUNCTION inbox_handoffs_overdue(timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inbox_handoffs_overdue(timestamptz, int) TO inbox_svc;
GRANT CREATE ON SCHEMA public TO inbox_owner;
ALTER FUNCTION inbox_handoffs_overdue(timestamptz, int) OWNER TO inbox_owner;
REVOKE CREATE ON SCHEMA public FROM inbox_owner;
