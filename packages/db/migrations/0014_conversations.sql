-- Omni-SDR 0014: conversations and the handoff to a closer (DECISIONS 2026-10-03 pivot: "the buffer between the real
-- closer and the initial outreach"; docs/claude/SDR-PIVOT.md P1).
--
-- A conversation is one person on one channel: an email thread with a contact, an Instagram DM thread, a chat. The
-- messages stay where they already live (inbound_messages, messages); each points at its conversation, so bodies,
-- retention and the hostile-input cleaning stay in one place. A handoff passes a qualified conversation to a human
-- closer, with the summary and answers that made it qualified.
--
-- A closer is a new role that sees only what was handed to them: the database enforces it with RESTRICTIVE policies on
-- conversations, handoffs and inbound_messages, on top of the API's can().

-- ─── the closer role ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('admin', 'operator', 'reviewer', 'client_viewer', 'closer'));
ALTER TABLE invites DROP CONSTRAINT invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK (role IN ('admin', 'operator', 'reviewer', 'client_viewer', 'closer'));

-- True when the acting user is a closer in this org (and so sees only their handoffs). A definer function owned by
-- tenancy_owner: the RLS policies below call it as every role, and service roles (inbox_svc, sender_svc) can't read
-- memberships themselves. It answers only about the acting user; with no app user (a service) it is false.
CREATE FUNCTION app_is_closer(p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT app_user() IS NOT NULL AND EXISTS (SELECT 1 FROM memberships m
     WHERE m.org_id = p_org AND m.user_id = app_user() AND m.role = 'closer') $$;
-- Grants before the owner change (0008a). Every role that reads these tables evaluates the policy.
REVOKE EXECUTE ON FUNCTION app_is_closer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_closer(uuid) TO app_rw, inbox_svc, sender_svc, gate_svc, ops, inbox_owner, sender_owner, guard_owner, unsub_owner, verify_owner;
GRANT CREATE ON SCHEMA public TO tenancy_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION app_is_closer(uuid) OWNER TO tenancy_owner;
REVOKE CREATE ON SCHEMA public FROM tenancy_owner;

-- ─── channels ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Instagram and Facebook comments and DMs, and website chat, join email, LinkedIn (paste-in) and forms.
ALTER TABLE inbound_messages DROP CONSTRAINT inbound_messages_channel_check;
ALTER TABLE inbound_messages ADD CONSTRAINT inbound_messages_channel_check
  CHECK (channel IN ('email', 'linkedin', 'form', 'instagram', 'facebook', 'chat'));

-- ─── conversations ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  workspace_id     uuid NOT NULL,
  contact_id       uuid,                 -- known for email; a social or chat thread may start without one
  channel          text NOT NULL CHECK (channel IN ('email', 'linkedin', 'form', 'instagram', 'facebook', 'chat')),
  -- The channel's own thread identity: `contact:<uuid>` for email, the platform's thread or comment id otherwise.
  thread_key       text NOT NULL CHECK (length(thread_key) BETWEEN 1 AND 500),
  state            text NOT NULL DEFAULT 'open'
                   CHECK (state IN ('open', 'qualifying', 'qualified', 'handed_off', 'closed', 'spam')),
  category         text CHECK (category IS NULL OR category IN (
                     'meeting_request', 'positive_inquiry', 'question', 'objection', 'referral',
                     'out_of_office', 'not_interested', 'unsubscribe', 'wrong_person', 'bounce', 'unclassified')),
  closer_id        uuid REFERENCES users(id),   -- set when handed off
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id),
  UNIQUE (workspace_id, channel, thread_key),
  UNIQUE (org_id, workspace_id, id),
  CHECK (state <> 'handed_off' OR closer_id IS NOT NULL)
);
CREATE INDEX conversations_queue ON conversations (workspace_id, state, last_inbound_at DESC);
CREATE INDEX conversations_closer ON conversations (closer_id, state) WHERE closer_id IS NOT NULL;

ALTER TABLE inbound_messages ADD COLUMN conversation_id uuid;
ALTER TABLE inbound_messages ADD CONSTRAINT inbound_messages_conversation_fk
  FOREIGN KEY (org_id, workspace_id, conversation_id) REFERENCES conversations(org_id, workspace_id, id);
CREATE INDEX inbound_by_conversation ON inbound_messages (conversation_id, received_at) WHERE conversation_id IS NOT NULL;
ALTER TABLE messages ADD COLUMN conversation_id uuid;
ALTER TABLE messages ADD CONSTRAINT messages_conversation_fk
  FOREIGN KEY (org_id, workspace_id, conversation_id) REFERENCES conversations(org_id, workspace_id, id);
CREATE INDEX messages_by_conversation ON messages (conversation_id) WHERE conversation_id IS NOT NULL;

-- ─── handoffs ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE handoffs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  workspace_id     uuid NOT NULL,
  conversation_id  uuid NOT NULL,
  closer_id        uuid NOT NULL REFERENCES users(id),
  reason           text NOT NULL CHECK (reason IN ('qualified', 'meeting_request', 'asked_for_human', 'escalation')),
  summary          text NOT NULL CHECK (length(summary) BETWEEN 1 AND 4000),
  answers          jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object' AND length(answers::text) <= 8000),
  created_by       uuid REFERENCES users(id),  -- NULL: Omni handed it off on its own (an earned category)
  created_at       timestamptz NOT NULL DEFAULT now(),
  accepted_at      timestamptz,
  outcome          text CHECK (outcome IS NULL OR outcome IN ('won', 'lost', 'no_show', 'not_a_fit')),
  outcome_at       timestamptz,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, conversation_id) REFERENCES conversations(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id),
  CHECK ((outcome IS NULL) = (outcome_at IS NULL))
);
-- One open handoff per conversation: a second is refused until the first has an outcome.
CREATE UNIQUE INDEX handoffs_one_open ON handoffs (conversation_id) WHERE outcome IS NULL;
CREATE INDEX handoffs_closer ON handoffs (closer_id, created_at DESC);

-- The closer must be someone in this org who can take it (a closer, an operator or an admin) and whose membership
-- covers the workspace; and the app may only write a handoff in its own name.
CREATE FUNCTION handoffs_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.closer_id
                   AND m.role IN ('closer', 'operator', 'admin')
                   AND (m.workspace_ids IS NULL OR NEW.workspace_id = ANY (m.workspace_ids))) THEN
    RAISE EXCEPTION 'handoff: the closer is not a closer, operator or admin of this workspace' USING ERRCODE = 'P0001';
  END IF;
  IF current_user = 'app_rw' AND NEW.created_by IS DISTINCT FROM app_user() THEN
    RAISE EXCEPTION 'handoff: created_by must be the acting user' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER handoffs_check BEFORE INSERT ON handoffs FOR EACH ROW EXECUTE FUNCTION handoffs_check();

-- Whether a conversation is handed to the acting user. A definer function (owner tenancy_owner) so the policy on
-- inbound_messages needs no grant on conversations from the many roles that read inbound messages.
CREATE FUNCTION app_closer_owns(p_conversation uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT p_conversation IS NOT NULL AND app_user() IS NOT NULL
     AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = p_conversation AND c.closer_id = app_user()) $$;
GRANT SELECT (id, closer_id, org_id, workspace_id) ON conversations TO tenancy_owner;
REVOKE EXECUTE ON FUNCTION app_closer_owns(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_closer_owns(uuid) TO app_rw, inbox_svc, sender_svc, gate_svc, ops, inbox_owner, sender_owner, guard_owner, unsub_owner, verify_owner;
GRANT CREATE ON SCHEMA public TO tenancy_owner;
ALTER FUNCTION app_closer_owns(uuid) OWNER TO tenancy_owner;
REVOKE CREATE ON SCHEMA public FROM tenancy_owner;

-- ─── row-level security ──────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversations', 'handoffs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
                    WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()))', t);
    EXECUTE format('CREATE POLICY ops_all ON %I TO ops USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT ALL ON %I TO ops', t);
  END LOOP;
END $$;
-- A closer sees only the conversations handed to them, their handoffs, and those conversations' messages. RESTRICTIVE:
-- ANDed with every other policy, so no permissive policy can widen it. Service roles have no app user, so they pass.
CREATE POLICY closer_scope ON conversations AS RESTRICTIVE
  USING (NOT app_is_closer(org_id) OR closer_id = app_user());
CREATE POLICY closer_scope ON handoffs AS RESTRICTIVE
  USING (NOT app_is_closer(org_id) OR closer_id = app_user());
CREATE POLICY closer_scope ON inbound_messages AS RESTRICTIVE
  USING (NOT app_is_closer(org_id) OR app_closer_owns(conversation_id));

-- ─── grants ──────────────────────────────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON conversations TO app_rw;
GRANT UPDATE (state, category, closer_id, updated_at) ON conversations TO app_rw;
GRANT SELECT ON handoffs TO app_rw;
GRANT INSERT (org_id, workspace_id, conversation_id, closer_id, reason, summary, answers, created_by) ON handoffs TO app_rw;
GRANT UPDATE (accepted_at, outcome, outcome_at) ON handoffs TO app_rw;
-- Inbound threading: the inbox service finds or opens a conversation for each reply it records.
GRANT SELECT, INSERT ON conversations TO inbox_svc;
GRANT UPDATE (state, category, last_inbound_at, updated_at) ON conversations TO inbox_svc;
