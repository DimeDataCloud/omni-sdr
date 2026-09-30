-- Omni-SDR 0005: what the Fleet Console needs (DECISIONS 2026-09-29: the AI Studio console is the product floor).
-- Agents (the console's named operators, each a scoped assistant), their chat history, routines, the inbound
-- inbox with its SLA, meetings, and the fields the approval queue shows. Also the identity functions the API
-- calls before a tenant is known (first sign-in, "which orgs am I in").
-- Nothing here can send: agents and routines only ever produce drafts, and drafts still pass the gate,
-- a human approval (Trust Dial 1) and send_guard().

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inbox_svc')   THEN CREATE ROLE inbox_svc NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inbox_owner') THEN CREATE ROLE inbox_owner NOLOGIN; END IF;
END $$;

-- ─── identity (no tenant yet) ───────────────────────────────────────────────
-- The API verifies the identity-provider token, then calls ensure_user with the token's uid and email.
-- The email follows the IdP, since invites are matched against it.
CREATE FUNCTION ensure_user(p_idp_uid text, p_email text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid;
BEGIN
  IF coalesce(btrim(p_idp_uid), '') = '' OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'ensure_user: uid and a valid email are required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO users (idp_uid, email) VALUES (p_idp_uid, lower(btrim(p_email)))
    ON CONFLICT (idp_uid) DO UPDATE SET email = EXCLUDED.email
    RETURNING id INTO u;
  RETURN u;
END $$;

-- Every org the acting user belongs to, with the workspaces the membership covers.
CREATE FUNCTION my_memberships()
RETURNS TABLE (org_id uuid, org_name text, account_type text, subscription_status text, role text,
               workspace_id uuid, workspace_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.name, o.account_type, o.subscription_status, m.role, w.id, w.name
  FROM memberships m JOIN orgs o ON o.id = m.org_id
  JOIN workspaces w ON w.org_id = m.org_id AND (m.workspace_ids IS NULL OR w.id = ANY (m.workspace_ids))
  WHERE m.user_id = app_user() AND o.status = 'active'
  ORDER BY o.name, w.name
$$;

GRANT INSERT (idp_uid, email), UPDATE (email) ON users TO tenancy_owner;
ALTER FUNCTION ensure_user(text, text) OWNER TO tenancy_owner;
ALTER FUNCTION my_memberships() OWNER TO tenancy_owner;
REVOKE EXECUTE ON FUNCTION ensure_user(text, text), my_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_user(text, text), my_memberships() TO app_rw;

-- Agencies add client workspaces; an owner account has exactly one. Only an org-wide admin (a membership
-- not narrowed to some workspaces) may create one, since a narrowed admin can't see the rest of the org.
CREATE FUNCTION create_workspace(p_org uuid, p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w uuid; kind text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = p_org AND m.user_id = app_user()
                 AND m.role = 'admin' AND m.workspace_ids IS NULL) THEN
    RAISE EXCEPTION 'create_workspace: org-wide admin only' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_name), '') = '' OR length(p_name) > 120 THEN
    RAISE EXCEPTION 'create_workspace: a name of 1-120 characters is required' USING ERRCODE = '22023';
  END IF;
  SELECT account_type INTO kind FROM orgs WHERE id = p_org AND status = 'active';
  IF kind IS NULL THEN RAISE EXCEPTION 'create_workspace: org not active' USING ERRCODE = '42501'; END IF;
  IF kind = 'owner' AND EXISTS (SELECT 1 FROM workspaces WHERE org_id = p_org) THEN
    RAISE EXCEPTION 'create_workspace: an owner account has one workspace; upgrade to agency for more' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO workspaces (org_id, name) VALUES (p_org, btrim(p_name)) RETURNING id INTO w;
  INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES (p_org, app_user()::text, 'create', 'workspace', w::text);
  RETURN w;
END $$;
ALTER FUNCTION create_workspace(uuid, text) OWNER TO tenancy_owner;
REVOKE EXECUTE ON FUNCTION create_workspace(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_workspace(uuid, text) TO app_rw;

-- ─── the approval queue's fields ────────────────────────────────────────────
ALTER TABLE contacts ADD COLUMN company text CHECK (company IS NULL OR length(company) <= 200);
ALTER TABLE contacts ADD COLUMN title   text CHECK (title IS NULL OR length(title) <= 200);
-- Deterministic from ICP rules (Station 09); written by the enricher, shown as "ICP fit".
ALTER TABLE contacts ADD COLUMN fit_score smallint CHECK (fit_score IS NULL OR fit_score BETWEEN 0 AND 100);

-- Rejection reasons are an Auto-adjust source (SPEC Station 08), so they are kept.
ALTER TABLE drafts ADD COLUMN rejection_reason text CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 500);
GRANT UPDATE (rejection_reason) ON drafts TO app_rw;

-- The gate's findings, so the approval card can say why a draft was blocked. Written only by gate_svc,
-- cleared with the rest of the gate columns when the text changes.
ALTER TABLE drafts ADD COLUMN gate_findings jsonb CHECK (gate_findings IS NULL OR jsonb_typeof(gate_findings) = 'array');
GRANT UPDATE (gate_findings) ON drafts TO gate_svc;
CREATE OR REPLACE FUNCTION drafts_edit_voids_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subject IS DISTINCT FROM OLD.subject OR NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.gate_passed   := false;
    NEW.gate_body_sha := NULL;
    NEW.gated_at      := NULL;
    NEW.gate_findings := NULL;
    NEW.approved_by   := NULL;
    NEW.approved_at   := NULL;
    IF NEW.status IN ('review', 'approved') THEN NEW.status := 'gating'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- The inbox links a reply to the message it answers.
ALTER TABLE messages ADD CONSTRAINT messages_tenant_key UNIQUE (org_id, workspace_id, id);

-- ─── agents ─────────────────────────────────────────────────────────────────
-- A named assistant with a role prompt and a model tier. It chats and drafts; it never sends.
-- autonomous_mode lets its routines run unattended; every draft they make still needs approval.
CREATE TABLE agents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  workspace_id     uuid NOT NULL,
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  station          text NOT NULL DEFAULT 'general' CHECK (station ~ '^[a-z][a-z0-9_]{0,39}$'),
  badge            text NOT NULL DEFAULT 'SDR' CHECK (badge IN ('EXEC', 'OPS', 'TRI', 'SDR', 'HR', 'MKT', 'CS', 'FIN', 'INT')),
  model_tier       text NOT NULL DEFAULT 'flash' CHECK (model_tier IN ('flash_lite', 'flash', 'pro')),
  system_prompt    text NOT NULL DEFAULT '' CHECK (length(system_prompt) <= 8000),
  context_sources  text[] NOT NULL DEFAULT '{}' CHECK (cardinality(context_sources) <= 20),
  autonomous_mode  boolean NOT NULL DEFAULT false,
  appearance       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(appearance) = 'object' AND length(appearance::text) <= 2000),
  archived_at      timestamptz,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  UNIQUE (org_id, workspace_id, id)
);

-- Chat history is append-only: nobody edits what an agent or a person said.
CREATE TABLE agent_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  agent_id      uuid NOT NULL,
  sender        text NOT NULL CHECK (sender IN ('user', 'agent')),
  author_id     uuid REFERENCES users(id),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 32000),
  meta          jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(meta) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, agent_id) REFERENCES agents(org_id, workspace_id, id),
  CHECK ((sender = 'user') = (author_id IS NOT NULL))
);
CREATE INDEX agent_messages_by_agent ON agent_messages (agent_id, created_at);

-- Which agent produced a draft (the approval card's "agent").
ALTER TABLE drafts ADD COLUMN agent_id uuid;
ALTER TABLE drafts ADD FOREIGN KEY (org_id, workspace_id, agent_id) REFERENCES agents(org_id, workspace_id, id);
GRANT INSERT (agent_id) ON drafts TO app_rw;

-- ─── routines ───────────────────────────────────────────────────────────────
-- Scheduled jobs (briefings, triage sweeps, signal harvests, outbound drafting). A routine can only
-- create drafts or notes. paused_reason is the ops kill switch; tenants toggle `active`.
CREATE TABLE routines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  workspace_id   uuid NOT NULL,
  agent_id       uuid,
  name           text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category       text NOT NULL CHECK (category IN ('briefing', 'triage', 'outbound', 'sync')),
  schedule       text NOT NULL CHECK (length(schedule) BETWEEN 1 AND 120),
  active         boolean NOT NULL DEFAULT false,
  paused_reason  text,
  last_run_at    timestamptz,
  next_run_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, agent_id) REFERENCES agents(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id)
);

-- ─── inbox ──────────────────────────────────────────────────────────────────
-- Written only by the inbox worker (inbox_svc): Reply-To mail from reply.omnisdr.com, form webhooks,
-- LinkedIn replies. Prospect text is hostile input; the intent here can only ever move things toward
-- the safe side (suppress, stop, escalate to a human), never toward a send.
CREATE TABLE inbound_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  workspace_id       uuid NOT NULL,
  contact_id         uuid,
  message_id         uuid,             -- the outbound message this answers, when known
  channel            text NOT NULL CHECK (channel IN ('email', 'linkedin', 'form')),
  from_address       text CHECK (from_address IS NULL OR length(from_address) <= 320),
  subject            text CHECK (subject IS NULL OR length(subject) <= 998),
  body               text NOT NULL CHECK (length(body) <= 100000),
  received_at        timestamptz NOT NULL,
  intent             text NOT NULL DEFAULT 'unclassified' CHECK (intent IN (
                       'meeting_request', 'positive_inquiry', 'question', 'objection', 'referral',
                       'out_of_office', 'not_interested', 'unsubscribe', 'wrong_person', 'bounce', 'unclassified')),
  intent_confidence  real CHECK (intent_confidence IS NULL OR intent_confidence BETWEEN 0 AND 1),
  classified_by      text,
  external_id        text CHECK (external_id IS NULL OR length(external_id) <= 998),  -- Message-ID etc.; makes worker retries idempotent
  sla_due_at         timestamptz,
  handled_at         timestamptz,
  handled_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, message_id) REFERENCES messages(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id),
  UNIQUE (workspace_id, channel, external_id),
  CHECK ((handled_at IS NULL) = (handled_by IS NULL))
);
CREATE INDEX inbound_open ON inbound_messages (workspace_id, received_at) WHERE handled_at IS NULL;

-- Reply-To routing: r+<token>@reply.omnisdr.com. The worker knows only the token, not the tenant, so
-- this lookup is cross-tenant by nature. It returns ids only, never content.
CREATE FUNCTION inbox_resolve_reply(p_token_hash text)
RETURNS TABLE (org_id uuid, workspace_id uuid, message_id uuid, contact_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.org_id, m.workspace_id, m.id, e.contact_id
  FROM messages m JOIN drafts d ON d.id = m.draft_id JOIN enrollments e ON e.id = d.enrollment_id
  WHERE m.reply_token_hash = p_token_hash AND p_token_hash ~ '^[0-9a-f]{64}$'
$$;
GRANT USAGE ON SCHEMA public TO inbox_owner;
GRANT SELECT ON messages, drafts, enrollments TO inbox_owner;
CREATE POLICY inbox_all ON messages    TO inbox_owner USING (true);
CREATE POLICY inbox_all ON drafts      TO inbox_owner USING (true);
CREATE POLICY inbox_all ON enrollments TO inbox_owner USING (true);
ALTER FUNCTION inbox_resolve_reply(text) OWNER TO inbox_owner;
REVOKE EXECUTE ON FUNCTION inbox_resolve_reply(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inbox_resolve_reply(text) TO inbox_svc;

-- ─── meetings ───────────────────────────────────────────────────────────────
CREATE TABLE meetings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  workspace_id        uuid NOT NULL,
  contact_id          uuid,
  inbound_message_id  uuid,
  provider            text NOT NULL CHECK (provider IN ('native', 'calendly', 'cal_com')),
  external_id         text,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  meet_url            text CHECK (meet_url IS NULL OR (meet_url ~ '^https://[^[:space:]]+$' AND length(meet_url) <= 500)),
  status              text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'completed', 'no_show', 'canceled')),
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, inbound_message_id) REFERENCES inbound_messages(org_id, workspace_id, id),
  UNIQUE (workspace_id, provider, external_id),
  CHECK (ends_at > starts_at)
);

-- A booked meeting ends the sequence for that contact in this workspace (acceptance story step 8).
-- Enrollments a reply already stopped become 'converted' too (the meeting is the outcome); ones stopped by an
-- unsubscribe or anything else stay stopped.
CREATE FUNCTION meetings_convert_enrollments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'booked' AND NEW.contact_id IS NOT NULL THEN
    UPDATE enrollments SET state = 'converted', stop_reason = 'meeting_booked', next_run_at = NULL
      WHERE org_id = NEW.org_id AND workspace_id = NEW.workspace_id AND contact_id = NEW.contact_id
        AND (state NOT IN ('stopped', 'converted', 'completed') OR (state = 'stopped' AND stop_reason LIKE 'reply:%'));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meetings_convert_enrollments AFTER INSERT ON meetings FOR EACH ROW EXECUTE FUNCTION meetings_convert_enrollments();

-- ─── RLS: same mechanical rule as 0001 ─────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agents', 'agent_messages', 'routines', 'inbound_messages', 'meetings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
                    WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()))', t);
    EXECUTE format('CREATE POLICY ops_all ON %I TO ops USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT ALL ON %I TO ops', t);
  END LOOP;
END $$;

-- ─── grants ─────────────────────────────────────────────────────────────────
GRANT SELECT ON agents, agent_messages, routines, inbound_messages, meetings TO app_rw;
GRANT INSERT (org_id, workspace_id, name, station, badge, model_tier, system_prompt, context_sources, autonomous_mode, appearance, created_by)
  ON agents TO app_rw;
GRANT UPDATE (name, station, badge, model_tier, system_prompt, context_sources, autonomous_mode, appearance, archived_at) ON agents TO app_rw;
GRANT INSERT (org_id, workspace_id, agent_id, sender, author_id, body, meta) ON agent_messages TO app_rw;
GRANT INSERT (org_id, workspace_id, agent_id, name, category, schedule, active) ON routines TO app_rw;
GRANT UPDATE (agent_id, name, category, schedule, active) ON routines TO app_rw;
GRANT UPDATE (handled_at, handled_by) ON inbound_messages TO app_rw;
GRANT INSERT (org_id, workspace_id, contact_id, inbound_message_id, provider, external_id, starts_at, ends_at, meet_url, status, created_by)
  ON meetings TO app_rw;
GRANT UPDATE (status, starts_at, ends_at, meet_url) ON meetings TO app_rw;

-- inbox_svc: records replies and applies only safe-side effects (suppress, stop).
GRANT USAGE ON SCHEMA public TO inbox_svc;
GRANT SELECT ON workspaces, enrollments, messages TO inbox_svc;
GRANT SELECT (id, org_id, workspace_id, email) ON contacts TO inbox_svc;
GRANT SELECT, INSERT ON inbound_messages TO inbox_svc;
GRANT INSERT ON suppression, outbox TO inbox_svc;
GRANT UPDATE (state, stop_reason, next_run_at) ON enrollments TO inbox_svc;
GRANT USAGE ON SEQUENCE outbox_id_seq TO inbox_svc;
GRANT EXECUTE ON FUNCTION app_org(), app_ws(), app_user(), value_hash(text) TO inbox_svc;
