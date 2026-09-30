-- Omni-SDR 0002: access. Sign-up (org + first workspace + admin), invites, admin-only workspace settings.
-- Spec: SPEC §7 (roles), guide Station 5 (auth). Every rule here is enforced in the database, so a
-- server action that forgets a can() check still can't escalate.

-- ─── request context: the acting user ───────────────────────────────────────
-- withTenant() sets app.user_id alongside app.org_id / app.workspace_ids, transaction-scoped.
CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenancy_owner') THEN CREATE ROLE tenancy_owner NOLOGIN; END IF;
END $$;

-- True when the acting user is an admin of this org whose membership covers the workspace.
CREATE FUNCTION app_is_admin(p_org uuid, p_ws uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM memberships m
                  WHERE m.org_id = p_org AND m.user_id = app_user() AND m.role = 'admin'
                    AND (m.workspace_ids IS NULL OR p_ws IS NULL OR p_ws = ANY (m.workspace_ids))) $$;

-- ─── workspace settings: admin only ─────────────────────────────────────────
-- The app role may change these columns and nothing else on workspaces. trust_level,
-- custom_domain and org feature flags stay ops-only (SPEC §5 S7).
GRANT UPDATE (name, timezone, client_approvals_enabled, auto_adjust_enabled, auto_adjust_sources) ON workspaces TO app_rw;

CREATE FUNCTION workspaces_admin_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_rw' AND NOT app_is_admin(NEW.org_id, NEW.id) THEN
    RAISE EXCEPTION 'workspace settings: admin only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspaces_admin_only BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION workspaces_admin_only();

-- ─── invites ────────────────────────────────────────────────────────────────
-- Only hashes are stored. The raw token lives in the invite link; the email is matched by hash
-- against the accepting user's address, so a forwarded link doesn't work for someone else.
CREATE TABLE invites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  email_hash     text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  role           text NOT NULL CHECK (role IN ('admin', 'operator', 'reviewer', 'client_viewer')),
  workspace_ids  uuid[],                                   -- NULL = every workspace in the org
  token_hash     text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by     uuid NOT NULL REFERENCES users(id),
  expires_at     timestamptz NOT NULL,
  accepted_at    timestamptz,
  accepted_by    uuid REFERENCES users(id),
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days')
);

CREATE FUNCTION invites_admin_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_rw' THEN
    IF NOT app_is_admin(NEW.org_id, NULL) THEN
      RAISE EXCEPTION 'invites: admin only' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.invited_by IS DISTINCT FROM app_user() THEN
      RAISE EXCEPTION 'invites: invited_by must be the acting user' USING ERRCODE = '42501';
    END IF;
    -- Invites may only name workspaces the request is scoped to (and so proven to be in this org).
    IF NEW.workspace_ids IS NOT NULL AND NOT (NEW.workspace_ids <@ app_ws()) THEN
      RAISE EXCEPTION 'invites: workspace outside the request scope' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invites_admin_only BEFORE INSERT OR UPDATE ON invites FOR EACH ROW EXECUTE FUNCTION invites_admin_only();

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;  ALTER TABLE invites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON invites USING (org_id = app_org()) WITH CHECK (org_id = app_org());

GRANT SELECT ON invites TO app_rw;
GRANT INSERT (org_id, email_hash, role, workspace_ids, token_hash, invited_by, expires_at) ON invites TO app_rw;
GRANT UPDATE (revoked_at) ON invites TO app_rw;
GRANT ALL ON invites TO ops;
CREATE POLICY ops_all ON invites TO ops USING (true) WITH CHECK (true);

-- ─── sign-up and invite acceptance (cross-tenant by nature, so definer functions) ───────────
-- Owned by tenancy_owner: explicit grants + USING (true) policies, never a superuser (0001 header).
GRANT USAGE ON SCHEMA public TO tenancy_owner;
GRANT SELECT ON users TO tenancy_owner;
GRANT SELECT, INSERT ON orgs, workspaces, memberships TO tenancy_owner;
GRANT SELECT, UPDATE (accepted_at, accepted_by) ON invites TO tenancy_owner;
GRANT INSERT ON audit_log TO tenancy_owner;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO tenancy_owner;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orgs', 'workspaces', 'memberships', 'invites', 'audit_log'] LOOP
    EXECUTE format('CREATE POLICY tenancy_all ON %I TO tenancy_owner USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Sign-up: the acting user (app.user_id) creates an org, its first workspace, and becomes admin.
CREATE FUNCTION create_org_with_admin(p_org_name text, p_account_type text, p_workspace_name text)
RETURNS TABLE (org_id uuid, workspace_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := app_user(); o uuid; w uuid;
BEGIN
  IF u IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = u) THEN
    RAISE EXCEPTION 'create_org_with_admin: no signed-in user' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_org_name), '') = '' OR coalesce(btrim(p_workspace_name), '') = '' THEN
    RAISE EXCEPTION 'create_org_with_admin: names are required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO orgs (name, account_type) VALUES (btrim(p_org_name), p_account_type) RETURNING id INTO o;
  INSERT INTO workspaces (org_id, name) VALUES (o, btrim(p_workspace_name)) RETURNING id INTO w;
  INSERT INTO memberships (org_id, user_id, role) VALUES (o, u, 'admin');
  INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES (o, u::text, 'create', 'org', o::text);
  RETURN QUERY SELECT o, w;
END $$;

-- Accept: single use, unexpired, unrevoked, and only by the invited email.
CREATE FUNCTION accept_invite(p_token text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := app_user(); inv invites%ROWTYPE; em text;
BEGIN
  SELECT email INTO em FROM users WHERE id = u;
  IF u IS NULL OR em IS NULL THEN
    RAISE EXCEPTION 'accept_invite: no signed-in user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO inv FROM invites WHERE token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    FOR UPDATE;
  -- One message for every failure, so the function can't be used to probe which tokens exist.
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at <= now()
     OR inv.email_hash <> value_hash(em) THEN
    RAISE EXCEPTION 'accept_invite: invalid or expired invite' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM memberships WHERE org_id = inv.org_id AND user_id = u) THEN
    RAISE EXCEPTION 'accept_invite: already a member' USING ERRCODE = '23505';
  END IF;
  INSERT INTO memberships (org_id, user_id, role, workspace_ids) VALUES (inv.org_id, u, inv.role, inv.workspace_ids);
  UPDATE invites SET accepted_at = now(), accepted_by = u WHERE id = inv.id;
  INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id)
    VALUES (inv.org_id, u::text, 'accept_invite', 'membership', u::text);
  RETURN inv.org_id;
END $$;

ALTER FUNCTION create_org_with_admin(text, text, text) OWNER TO tenancy_owner;
ALTER FUNCTION accept_invite(text) OWNER TO tenancy_owner;
REVOKE EXECUTE ON FUNCTION create_org_with_admin(text, text, text), accept_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_org_with_admin(text, text, text), accept_invite(text) TO app_rw;
GRANT EXECUTE ON FUNCTION app_user(), app_is_admin(uuid, uuid) TO app_rw, gate_svc, sender_svc, ops, tenancy_owner;
