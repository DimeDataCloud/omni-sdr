-- Omni-SDR 0006: model decisions on inbound replies (DECISIONS 2026-10-01: Laya, self-hosted as `decider`).
-- The rules classify a reply the moment it lands (0005). A second, later pass asks the decider two safety
-- questions and may only ADD effects: a suppression, a stopped sequence, an SLA. The row records what the
-- model answered, which checkpoint and which registry version, so every effect is traceable.
-- The trigger below enforces the safe side in the database, not only in the service code: the model pass
-- runs once per reply, and an SLA once set can never be cleared or pushed later by it.

ALTER TABLE inbound_messages
  ADD COLUMN decision   jsonb CHECK (decision IS NULL OR jsonb_typeof(decision) = 'object'),
  ADD COLUMN decided_at timestamptz,
  ADD CONSTRAINT inbound_decided_together CHECK ((decision IS NULL) = (decided_at IS NULL));

CREATE INDEX inbound_messages_undecided ON inbound_messages (received_at) WHERE decided_at IS NULL;

CREATE OR REPLACE FUNCTION inbound_decision_safe_side() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decided_at IS NOT NULL AND (NEW.decision IS DISTINCT FROM OLD.decision OR NEW.decided_at IS DISTINCT FROM OLD.decided_at) THEN
    RAISE EXCEPTION 'inbound decision: already decided' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.sla_due_at IS NOT NULL AND NEW.sla_due_at IS DISTINCT FROM OLD.sla_due_at THEN
    RAISE EXCEPTION 'inbound decision: an SLA can only be added, never moved or cleared' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inbound_decision_safe_side BEFORE UPDATE OF decision, decided_at, sla_due_at ON inbound_messages
  FOR EACH ROW EXECUTE FUNCTION inbound_decision_safe_side();

-- inbox_svc writes the decision and may add an SLA; nothing else on the row.
GRANT UPDATE (decision, decided_at, sla_due_at) ON inbound_messages TO inbox_svc;

-- The model pass works through replies it has not decided yet, across tenants. This lists ids only (no text);
-- the pass then opens each one inside that reply's own tenant scope.
CREATE FUNCTION inbox_undecided(p_limit int)
RETURNS TABLE (id uuid, org_id uuid, workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.org_id, i.workspace_id FROM inbound_messages i
  WHERE i.decided_at IS NULL ORDER BY i.received_at LIMIT least(greatest(p_limit, 1), 500)
$$;
GRANT SELECT (id, org_id, workspace_id, decided_at, received_at) ON inbound_messages TO inbox_owner;
CREATE POLICY inbox_all ON inbound_messages TO inbox_owner USING (true);
ALTER FUNCTION inbox_undecided(int) OWNER TO inbox_owner;
REVOKE EXECUTE ON FUNCTION inbox_undecided(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inbox_undecided(int) TO inbox_svc;
