-- Omni-SDR 0014: inbound webhooks, the second channel of the SDR buffer (docs/claude/SDR-PIVOT.md §7, P5).
-- A workspace creates a hook and gets a URL plus a token, shown once. Its website form, chat widget or a Zapier step
-- POSTs each submission there with `Authorization: Bearer <token>`. The submission becomes an inbound message
-- (channel 'form') and runs the same triage as an email reply: rules first, then Laya.
--
--   * Only the token's sha256 is stored. app_rw never reads it back; only the resolver compares it.
--   * The public route resolves a hook through inbox_resolve_hook(), a narrow definer that answers only for a live
--     hook whose token matches. A wrong id and a wrong token look the same to the caller.
--   * inbox_svc may now create a contact (name, email, phone) for a submission from someone new, in the hook's own
--     workspace (the tenant policy's WITH CHECK still applies).

CREATE TABLE inbound_hooks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  kind          text NOT NULL DEFAULT 'form' CHECK (kind IN ('form')),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash    text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  UNIQUE (org_id, workspace_id, id),
  UNIQUE (token_hash)
);
ALTER TABLE inbound_hooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_hooks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON inbound_hooks USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()));
CREATE POLICY ops_all ON inbound_hooks TO ops USING (true) WITH CHECK (true);
GRANT ALL ON inbound_hooks TO ops;
-- app_rw: create, list and revoke. Never the token hash.
GRANT SELECT (id, org_id, workspace_id, kind, name, created_by, created_at, revoked_at) ON inbound_hooks TO app_rw;
GRANT INSERT (org_id, workspace_id, kind, name, token_hash, created_by) ON inbound_hooks TO app_rw;
GRANT UPDATE (revoked_at) ON inbound_hooks TO app_rw;

-- inbox_svc records a submission from someone new as a contact in the hook's workspace.
GRANT INSERT (org_id, workspace_id, name, email, phone) ON contacts TO inbox_svc;

CREATE FUNCTION inbox_resolve_hook(p_id uuid, p_token_hash text)
RETURNS TABLE (org_id uuid, workspace_id uuid, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.org_id, h.workspace_id, h.kind FROM inbound_hooks h
  WHERE h.id = p_id AND h.revoked_at IS NULL AND p_token_hash ~ '^[0-9a-f]{64}$' AND h.token_hash = p_token_hash
$$;
GRANT SELECT (id, org_id, workspace_id, kind, token_hash, revoked_at) ON inbound_hooks TO inbox_owner;
CREATE POLICY inbox_read ON inbound_hooks FOR SELECT TO inbox_owner USING (true);
-- Grants before the owner change (0008a: after it, the migration role is no longer the grantor and they'd be no-ops).
REVOKE EXECUTE ON FUNCTION inbox_resolve_hook(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inbox_resolve_hook(uuid, text) TO inbox_svc;
GRANT CREATE ON SCHEMA public TO inbox_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION inbox_resolve_hook(uuid, text) OWNER TO inbox_owner;
REVOKE CREATE ON SCHEMA public FROM inbox_owner;
