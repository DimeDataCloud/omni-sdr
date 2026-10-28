-- 0027: inbound lead addresses. S2L-2b (inbound email as a lead source).
--
-- Today an inbound email can only be tied to a workspace through a reply token (`r+<token>@`, inbox_resolve_reply), so mail that
-- is NOT a reply to one of our sends has nowhere to go. A workspace now gets its own lead address: `<token>@<inbound domain>`.
-- The local part is a random token shown once; only its sha256 is stored (the same shape as inbound_hooks, 0014).
--
--   * One table, inbound_lead_addresses: workspace, token_hash, name, created_by, revoked_at. Forced RLS, composite FK with org_id.
--     app_rw creates, lists and revokes; it never reads the token hash back. ops has full access.
--   * One definer, inbox_resolve_lead_address(p_token_hash): the only way a token hash is compared. It answers (org_id,
--     workspace_id) for a live address and NOTHING for an unknown, revoked or malformed one: all three look the same to the
--     caller. The comparison is an equality lookup on a sha256 the caller computed from the token, so there is no secret-dependent
--     early exit to time; a revoked row never resolves.
--   * Built to the 0026 standard: `SET search_path = public, pg_temp`, owner inbox_owner (reads this one table through a SELECT-only
--     policy), EXECUTE for inbox_svc only, TEMP already revoked database-wide. Grants before the owner change (0008a).
-- Nothing here sends and nothing reads mail; the adapter that uses it is a later commit.

CREATE TABLE inbound_lead_addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash    text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  UNIQUE (org_id, workspace_id, id),
  UNIQUE (token_hash)
);
ALTER TABLE inbound_lead_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_lead_addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON inbound_lead_addresses USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()));
-- A closer sees only their handed-off thread (0015); a workspace's lead addresses are not part of it.
CREATE POLICY closer_scope ON inbound_lead_addresses AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id)) WITH CHECK (true);
CREATE POLICY ops_all ON inbound_lead_addresses TO ops USING (true) WITH CHECK (true);
GRANT ALL ON inbound_lead_addresses TO ops;
-- app_rw: create, list and revoke. Never the token hash.
GRANT SELECT (id, org_id, workspace_id, name, created_by, created_at, revoked_at) ON inbound_lead_addresses TO app_rw;
GRANT INSERT (org_id, workspace_id, name, token_hash, created_by) ON inbound_lead_addresses TO app_rw;
GRANT UPDATE (revoked_at) ON inbound_lead_addresses TO app_rw;

CREATE FUNCTION inbox_resolve_lead_address(p_token_hash text)
RETURNS TABLE (org_id uuid, workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.org_id, a.workspace_id FROM inbound_lead_addresses a
  WHERE a.revoked_at IS NULL AND p_token_hash ~ '^[0-9a-f]{64}$' AND a.token_hash = p_token_hash
$$;
GRANT SELECT (org_id, workspace_id, token_hash, revoked_at) ON inbound_lead_addresses TO inbox_owner;
CREATE POLICY inbox_read ON inbound_lead_addresses FOR SELECT TO inbox_owner USING (true);
-- Grants before the owner change (0008a: after it, the migration role is no longer the grantor and they'd be no-ops).
REVOKE EXECUTE ON FUNCTION inbox_resolve_lead_address(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inbox_resolve_lead_address(text) TO inbox_svc;
GRANT CREATE ON SCHEMA public TO inbox_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION inbox_resolve_lead_address(text) OWNER TO inbox_owner;
REVOKE CREATE ON SCHEMA public FROM inbox_owner;
