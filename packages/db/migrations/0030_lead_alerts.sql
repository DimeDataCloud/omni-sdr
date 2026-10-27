-- 0030: owner alert for a new lead (go-live, speed to lead). Nothing here sends mail to a lead and nothing touches the send lock.
--
-- The owner is told within seconds that a lead arrived. Three parts:
--   * notifications.kind gains 'new_lead' (channel in_app: the console's unread item, written by inbox_svc in the intake
--     transaction next to the message). UNIQUE (inbound_message_id, kind, channel) makes it once per message.
--   * the same transaction writes outbox topic 'notify.lead' (ids only: no name, address, phone or message text). A relay
--     (api, /internal/relay) claims unpublished rows, emails the workspace's admins, then marks them published.
--   * a separate service role, alert_svc, runs the relay. It is NOT sender_svc: it has no table grants at all, only EXECUTE on
--     three definers, so it cannot create a message, read a lead or touch send_counters / send_guard. The lead-facing send
--     lock therefore does not block an internal owner alert, and the alert path can never send to a lead.
--
-- The definers (owner alert_owner, search_path public, pg_temp, EXECUTE for alert_svc only; grants before the owner change, 0008a):
--   alert_claim(limit)      unpublished notify.lead rows, FOR UPDATE SKIP LOCKED, oldest first, across tenants: ids only.
--   alert_recipients(o, w)  addresses of the org's admin members whose membership covers workspace w. The recipient list comes
--                           only from memberships; nothing a lead typed can reach it.
--   alert_publish(ids)      sets published_at on notify.lead rows only.
-- A duplicate alert is acceptable (internal), a lost one is not: a row is marked published only after the send returned.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alert_svc')   THEN CREATE ROLE alert_svc NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alert_owner') THEN CREATE ROLE alert_owner NOLOGIN; END IF;
END $$;

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('sla_meeting', 'new_lead'));

-- What the definers read, through SELECT-only policies for alert_owner (they are not the table owner, so FORCE RLS applies).
GRANT SELECT (id, org_id, topic, payload, published_at) ON outbox TO alert_owner;
GRANT UPDATE (published_at) ON outbox TO alert_owner;
CREATE POLICY alert_all ON outbox TO alert_owner USING (true) WITH CHECK (true);
GRANT SELECT (org_id, user_id, role, workspace_ids) ON memberships TO alert_owner;
CREATE POLICY alert_read ON memberships FOR SELECT TO alert_owner USING (true);
GRANT SELECT (id, email) ON users TO alert_owner;

CREATE FUNCTION alert_claim(p_limit int)
RETURNS TABLE (id bigint, org_id uuid, payload jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id, o.org_id, o.payload FROM outbox o
  WHERE o.topic = 'notify.lead' AND o.published_at IS NULL
  ORDER BY o.id LIMIT least(greatest(p_limit, 1), 100)
  FOR UPDATE SKIP LOCKED
$$;

CREATE FUNCTION alert_recipients(p_org uuid, p_workspace uuid)
RETURNS TABLE (email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT u.email FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.org_id = p_org AND m.role = 'admin' AND (m.workspace_ids IS NULL OR p_workspace = ANY (m.workspace_ids))
    AND u.email ~ '^[^@\s]+@[^@\s]+$'
$$;

CREATE FUNCTION alert_publish(p_ids bigint[])
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (UPDATE outbox SET published_at = now()
             WHERE id = ANY (p_ids) AND topic = 'notify.lead' AND published_at IS NULL RETURNING 1)
  SELECT count(*)::int FROM u
$$;

REVOKE EXECUTE ON FUNCTION alert_claim(int), alert_recipients(uuid, uuid), alert_publish(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION alert_claim(int), alert_recipients(uuid, uuid), alert_publish(bigint[]) TO alert_svc;
GRANT USAGE ON SCHEMA public TO alert_svc, alert_owner;
GRANT CREATE ON SCHEMA public TO alert_owner;
ALTER FUNCTION alert_claim(int) OWNER TO alert_owner;
ALTER FUNCTION alert_recipients(uuid, uuid) OWNER TO alert_owner;
ALTER FUNCTION alert_publish(bigint[]) OWNER TO alert_owner;
REVOKE CREATE ON SCHEMA public FROM alert_owner;
