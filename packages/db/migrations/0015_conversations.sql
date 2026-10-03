-- Omni-SDR 0015: conversations and the handoff to a closer (DECISIONS 2026-10-03 pivot: "the buffer between the real
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
-- Grants before the owner change (0008a). Exactly the roles the closer_scope policies below apply to.
REVOKE EXECUTE ON FUNCTION app_is_closer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_closer(uuid) TO app_rw, gate_svc, sender_svc, inbox_svc;
GRANT CREATE ON SCHEMA public TO tenancy_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION app_is_closer(uuid) OWNER TO tenancy_owner;
REVOKE CREATE ON SCHEMA public FROM tenancy_owner;

-- ─── channels ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Instagram and Facebook comments and DMs, and website chat, join email, LinkedIn (paste-in) and forms.
ALTER TABLE inbound_messages DROP CONSTRAINT inbound_messages_channel_check;
ALTER TABLE inbound_messages ADD CONSTRAINT inbound_messages_channel_check
  CHECK (channel IN ('email', 'linkedin', 'form', 'chat', 'instagram_comment', 'instagram_dm', 'facebook_comment', 'messenger'));

-- ─── conversations ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  workspace_id     uuid NOT NULL,
  contact_id       uuid,                 -- known for email; a social or chat thread may start without one
  channel          text NOT NULL CHECK (channel IN ('email', 'linkedin', 'form', 'chat', 'instagram_comment', 'instagram_dm', 'facebook_comment', 'messenger')),
  -- The channel's own thread identity: `contact:<uuid>` for email, the platform's thread or comment id otherwise.
  thread_key       text NOT NULL CHECK (length(thread_key) BETWEEN 1 AND 500),
  state            text NOT NULL DEFAULT 'open'
                   CHECK (state IN ('open', 'qualifying', 'qualified', 'handed_off', 'closed', 'spam')),
  category         text CHECK (category IS NULL OR category IN (
                     'meeting_request', 'positive_inquiry', 'question', 'objection', 'referral',
                     'out_of_office', 'not_interested', 'unsubscribe', 'wrong_person', 'bounce', 'unclassified')),
  closer_id        uuid REFERENCES users(id),   -- set when handed off
  -- Why it is closed: an opt-out or a bounce ends it for good; a handoff outcome closes it until they write again.
  closed_reason    text CHECK (closed_reason IN ('unsubscribe', 'bounce', 'outcome')),
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id),
  UNIQUE (workspace_id, channel, thread_key),
  UNIQUE (org_id, workspace_id, id),
  CHECK (state <> 'handed_off' OR closer_id IS NOT NULL),
  CHECK ((state = 'closed') = (closed_reason IS NOT NULL))
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
  outcome          text CHECK (outcome IS NULL OR outcome IN ('won', 'lost', 'no_show', 'not_a_fit', 'reassigned')),
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
GRANT EXECUTE ON FUNCTION app_closer_owns(uuid) TO app_rw, gate_svc, sender_svc, inbox_svc;
GRANT CREATE ON SCHEMA public TO tenancy_owner;
ALTER FUNCTION app_closer_owns(uuid) OWNER TO tenancy_owner;
REVOKE CREATE ON SCHEMA public FROM tenancy_owner;

-- A closer's view of the rest of the tenant (#87 audit P2): the contact of a conversation handed to them, that contact's
-- enrollments, and the drafts and sent messages of those enrollments (the outbound half of the thread). Definer helpers
-- owned by tenancy_owner, like app_closer_owns; they run under the tenant policy of the request (app.org_id/workspace_ids).
CREATE FUNCTION app_closer_contact(p_contact uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT p_contact IS NOT NULL AND app_user() IS NOT NULL
     AND EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id = p_contact AND c.closer_id = app_user()) $$;
CREATE FUNCTION app_closer_enrollment(p_enrollment uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT p_enrollment IS NOT NULL AND app_user() IS NOT NULL
     AND EXISTS (SELECT 1 FROM enrollments e JOIN conversations c ON c.contact_id = e.contact_id
                 WHERE e.id = p_enrollment AND c.closer_id = app_user()) $$;
CREATE FUNCTION app_closer_draft(p_draft uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT p_draft IS NOT NULL AND app_user() IS NOT NULL
     AND EXISTS (SELECT 1 FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN conversations c ON c.contact_id = e.contact_id
                 WHERE d.id = p_draft AND c.closer_id = app_user()) $$;
GRANT SELECT (contact_id) ON conversations TO tenancy_owner;
GRANT SELECT (id, contact_id) ON enrollments TO tenancy_owner;
GRANT SELECT (id, enrollment_id) ON drafts TO tenancy_owner;
REVOKE EXECUTE ON FUNCTION app_closer_contact(uuid), app_closer_enrollment(uuid), app_closer_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_closer_contact(uuid), app_closer_enrollment(uuid), app_closer_draft(uuid) TO app_rw, gate_svc, sender_svc, inbox_svc;
GRANT CREATE ON SCHEMA public TO tenancy_owner;
ALTER FUNCTION app_closer_contact(uuid) OWNER TO tenancy_owner;
ALTER FUNCTION app_closer_enrollment(uuid) OWNER TO tenancy_owner;
ALTER FUNCTION app_closer_draft(uuid) OWNER TO tenancy_owner;
REVOKE CREATE ON SCHEMA public FROM tenancy_owner;

-- conversations.closer_id follows the open handoff (#87 audit Q2): it can only be set to that handoff's closer, and
-- cleared only when none is open. Reassigning = close the open handoff with outcome 'reassigned', then hand off again,
-- so the record shows who had it and when. A new conversation has no handoff yet, so it starts with no closer.
CREATE FUNCTION conversations_closer_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.closer_id IS NOT NULL THEN
      RAISE EXCEPTION 'conversation: closer_id follows the open handoff; hand it off instead' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.closer_id IS DISTINCT FROM OLD.closer_id THEN
    IF NEW.closer_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM handoffs h WHERE h.conversation_id = NEW.id AND h.outcome IS NULL) THEN
        RAISE EXCEPTION 'conversation: closer_id follows the open handoff; close it first' USING ERRCODE = 'P0001';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.conversation_id = NEW.id AND h.outcome IS NULL AND h.closer_id = NEW.closer_id) THEN
      RAISE EXCEPTION 'conversation: closer_id follows the open handoff; hand it off instead' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversations_closer_check BEFORE INSERT OR UPDATE OF closer_id ON conversations FOR EACH ROW EXECUTE FUNCTION conversations_closer_check();

-- The conversation follows its handoffs (#87 audit P2-1). A new handoff hands it off. An outcome settles it:
--   reassigned            back to open with no closer, to be handed off again (not by a closer: an operator decides);
--   won                   closed, and the closer keeps it (the customer is theirs);
--   lost/no_show/not_a_fit closed, and the closer stops seeing it.
-- A closed-by-outcome conversation opens again when the person writes again (threadFor). A definer (owner
-- tenancy_owner, no EXECUTE grant: trigger-only) because a closer recording an outcome can't write a row they will no
-- longer see; it still runs under the request's tenant policy.
CREATE FUNCTION handoffs_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE conversations SET state = 'handed_off', closed_reason = NULL, closer_id = NEW.closer_id, updated_at = now()
     WHERE id = NEW.conversation_id;
  ELSIF OLD.outcome IS NULL AND NEW.outcome IS NOT NULL THEN
    IF NEW.outcome = 'reassigned' AND app_is_closer(NEW.org_id) THEN
      RAISE EXCEPTION 'handoff: a closer can''t reassign' USING ERRCODE = '42501';
    END IF;
    UPDATE conversations SET
        state = CASE WHEN NEW.outcome = 'reassigned' THEN 'open' ELSE 'closed' END,
        closed_reason = CASE WHEN NEW.outcome = 'reassigned' THEN NULL ELSE 'outcome' END,
        closer_id = CASE WHEN NEW.outcome = 'won' THEN closer_id ELSE NULL END,
        updated_at = now()
     WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END $$;
-- The trigger first: creating it needs EXECUTE, which the REVOKE below takes from the migration owner.
CREATE TRIGGER handoffs_sync AFTER INSERT OR UPDATE OF outcome ON handoffs FOR EACH ROW EXECUTE FUNCTION handoffs_sync();
GRANT SELECT (id, state, closed_reason, closer_id) ON conversations TO tenancy_owner;
GRANT UPDATE (state, closed_reason, closer_id, updated_at) ON conversations TO tenancy_owner;
GRANT SELECT (conversation_id, closer_id, outcome) ON handoffs TO tenancy_owner;
REVOKE EXECUTE ON FUNCTION handoffs_sync() FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO tenancy_owner;
ALTER FUNCTION handoffs_sync() OWNER TO tenancy_owner;
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
-- ANDed with every other policy, so no permissive policy can widen it. It applies to the roles a request can act as
-- with an app user set (app_rw, gate_svc, sender_svc, inbox_svc); service roles with no app user pass. Not to every role: the migration owner,
-- the definer owners and ops would then need EXECUTE on the helpers too, and a later migration's FK validation
-- against these tables (run as the owner, under FORCE RLS) failed with "permission denied for function
-- app_is_closer" (found by definer-acl.test as a non-superuser owner, 2026-10-03).
CREATE POLICY closer_scope ON conversations AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id) OR closer_id = app_user());
CREATE POLICY closer_scope ON handoffs AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id) OR closer_id = app_user());
CREATE POLICY closer_scope ON inbound_messages AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id) OR app_closer_owns(conversation_id));
-- A closer never creates a handoff (#87 audit P3-1). Without this, closer_scope's USING doubles as the insert check: a
-- closer could hand themselves a conversation they can't see (the FK check bypasses RLS), and that open handoff would
-- then block the real one. Conversations need no such policy: closer_scope's check wants closer_id = the closer, and
-- conversations_closer_check wants a new conversation's closer_id NULL, so a closer can't insert one either.
CREATE POLICY closer_no_insert ON handoffs AS RESTRICTIVE FOR INSERT TO app_rw, gate_svc, sender_svc, inbox_svc
  WITH CHECK (NOT app_is_closer(org_id));
-- The rest of the tenant (#87 audit P2): the conversation's contact and its outbound thread; their own membership; the
-- workspace and org rows (settings). Every other table with an org_id: nothing, from the catalog as it stands here.
-- The loop runs once; a table added by a later migration is not covered by it. What catches that is conversations.test,
-- which fails for any org table without closer_scope (the catalog, not a hand list). WITH CHECK (true): a
-- closer's writes (an audit row on accept) are still bounded by grants, the tenant policy and can().
CREATE POLICY closer_scope ON contacts AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id) OR app_closer_contact(id)) WITH CHECK (true);
CREATE POLICY closer_scope ON enrollments AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id) OR app_closer_contact(contact_id)) WITH CHECK (true);
CREATE POLICY closer_scope ON drafts AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id) OR app_closer_enrollment(enrollment_id)) WITH CHECK (true);
CREATE POLICY closer_scope ON messages AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id) OR app_closer_owns(conversation_id) OR app_closer_draft(draft_id)) WITH CHECK (true);
CREATE POLICY closer_scope ON memberships AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id) OR user_id = app_user()) WITH CHECK (true);
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
             AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
             AND c.relname NOT IN ('conversations', 'handoffs', 'inbound_messages', 'contacts', 'enrollments', 'drafts', 'messages',
                                   'memberships', 'workspaces')
           ORDER BY 1 LOOP
    EXECUTE format('CREATE POLICY closer_scope ON %I AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
                    USING (NOT app_is_closer(org_id)) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ─── grants ──────────────────────────────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON conversations TO app_rw;
GRANT UPDATE (state, closed_reason, category, closer_id, updated_at) ON conversations TO app_rw;
GRANT SELECT ON handoffs TO app_rw;
GRANT INSERT (org_id, workspace_id, conversation_id, closer_id, reason, summary, answers, created_by) ON handoffs TO app_rw;
GRANT UPDATE (accepted_at, outcome, outcome_at) ON handoffs TO app_rw;
-- Inbound threading: the inbox service finds or opens a conversation for each reply it records.
GRANT SELECT, INSERT ON conversations TO inbox_svc;
GRANT UPDATE (state, closed_reason, category, last_inbound_at, updated_at) ON conversations TO inbox_svc;
