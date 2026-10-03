-- Omni-SDR 0017: the playbook (docs/claude/SDR-PIVOT.md §6, P3). Replies come from approved per-workspace responses,
-- one or more per category, with fields filled from what we know; a person approves, edits or discards each one. A
-- short qualification script (2-4 questions) is asked along the way.
--
--   * playbook_replies: the workspace's own words, per category. Versioned by edit (updated_at); archived, never deleted.
--   * qualification_questions: up to 4 per workspace, in order.
--   * reply_drafts: a playbook reply rendered for one conversation, waiting for a person. Approving records the final
--     text and whether it was edited; that is the autonomy counter's input (unedited approvals over the last 50 per
--     category; proposal: 95%). Nothing here sends: auto-send stays off, and the send path is a separate, audited step.
--   * A reply to a website-form address is never counted toward autonomy: anyone can type any address into a form
--     (#85 audit P3-2), so those always need a person.

CREATE TABLE playbook_replies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  category      text NOT NULL CHECK (category IN ('meeting_request', 'positive_inquiry', 'question', 'objection', 'referral',
                  'out_of_office', 'not_interested', 'wrong_person', 'unclassified')),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  subject       text CHECK (subject IS NULL OR length(subject) <= 200),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  -- Ask the next unanswered qualification question at the end of this reply.
  asks_next_question boolean NOT NULL DEFAULT false,
  archived_at   timestamptz,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  UNIQUE (org_id, workspace_id, id)
);
CREATE UNIQUE INDEX playbook_replies_name ON playbook_replies (workspace_id, category, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE qualification_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  position      smallint NOT NULL CHECK (position BETWEEN 1 AND 4),
  key           text NOT NULL CHECK (key ~ '^[a-z][a-z_]{0,39}$'),
  question      text NOT NULL CHECK (length(question) BETWEEN 1 AND 300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  UNIQUE (org_id, workspace_id, id),
  UNIQUE (workspace_id, position),
  UNIQUE (workspace_id, key)
);

CREATE TABLE reply_drafts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  workspace_id        uuid NOT NULL,
  conversation_id     uuid NOT NULL,
  inbound_message_id  uuid,
  playbook_reply_id   uuid,
  category            text NOT NULL,
  channel             text NOT NULL,
  question_key        text,
  subject             text CHECK (subject IS NULL OR length(subject) <= 200),
  body_proposed       text NOT NULL CHECK (length(body_proposed) BETWEEN 1 AND 8000),
  body_final          text CHECK (body_final IS NULL OR length(body_final) BETWEEN 1 AND 8000),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'discarded')),
  edited              boolean,
  -- Counted toward the category's autonomy: false for website-form addresses, which anyone can type.
  counts_for_autonomy boolean NOT NULL,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  decided_by          uuid REFERENCES users(id),
  decided_at          timestamptz,
  FOREIGN KEY (org_id, workspace_id, conversation_id) REFERENCES conversations(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, inbound_message_id) REFERENCES inbound_messages(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, playbook_reply_id) REFERENCES playbook_replies(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id),
  CHECK (counts_for_autonomy = false OR channel <> 'form'),
  -- A decision has who, when and (for an approval) the final text and whether it differs from the proposal.
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK ((status = 'pending') = (decided_by IS NULL)),
  CHECK (status <> 'approved' OR (body_final IS NOT NULL AND edited IS NOT NULL)),
  CHECK (status = 'approved' OR (body_final IS NULL AND edited IS NULL))
);
-- One pending draft per conversation: a new suggestion replaces the old one (the app discards it first).
CREATE UNIQUE INDEX reply_drafts_one_pending ON reply_drafts (conversation_id) WHERE status = 'pending';
CREATE INDEX reply_drafts_autonomy ON reply_drafts (workspace_id, category, decided_at DESC) WHERE status <> 'pending' AND counts_for_autonomy;

-- A decision is final, and `edited` is computed here, not taken from the app: the counter can't be talked up.
CREATE FUNCTION reply_drafts_decide() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'reply draft: already %', OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF current_user = 'app_rw' AND NEW.status <> 'pending' AND NEW.decided_by IS DISTINCT FROM app_user() THEN
    RAISE EXCEPTION 'reply draft: decided_by must be the acting user' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'approved' THEN
    NEW.edited := NEW.body_final IS DISTINCT FROM OLD.body_proposed;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reply_drafts_decide BEFORE UPDATE ON reply_drafts FOR EACH ROW EXECUTE FUNCTION reply_drafts_decide();

-- The channel comes from the conversation, and so does whether the draft counts toward autonomy; the app sets neither.
-- A new draft starts pending, whoever inserts it.
CREATE FUNCTION reply_drafts_new() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT c.channel INTO NEW.channel FROM conversations c WHERE c.id = NEW.conversation_id;
  IF NEW.channel IS NULL THEN
    RAISE EXCEPTION 'reply draft: conversation not found' USING ERRCODE = 'P0001';
  END IF;
  NEW.counts_for_autonomy := NEW.channel <> 'form';
  NEW.status := 'pending'; NEW.body_final := NULL; NEW.edited := NULL; NEW.decided_by := NULL; NEW.decided_at := NULL;
  IF current_user = 'app_rw' AND NEW.created_by IS DISTINCT FROM app_user() THEN
    RAISE EXCEPTION 'reply draft: created_by must be the acting user' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reply_drafts_new BEFORE INSERT ON reply_drafts FOR EACH ROW EXECUTE FUNCTION reply_drafts_new();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['playbook_replies', 'qualification_questions', 'reply_drafts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
                    WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()))', t);
    EXECUTE format('CREATE POLICY ops_all ON %I TO ops USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT ALL ON %I TO ops', t);
    -- A closer sees none of it (0015's rule for every org table; conversations.test checks the catalog).
    EXECUTE format('CREATE POLICY closer_scope ON %I AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
                    USING (NOT app_is_closer(org_id)) WITH CHECK (true)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON playbook_replies TO app_rw;
GRANT UPDATE (name, subject, body, asks_next_question, archived_at, updated_at) ON playbook_replies TO app_rw;
GRANT SELECT, INSERT, DELETE ON qualification_questions TO app_rw;
GRANT UPDATE (position, question) ON qualification_questions TO app_rw;
GRANT SELECT ON reply_drafts TO app_rw;
-- Not channel, counts_for_autonomy or edited: the triggers set those.
GRANT INSERT (org_id, workspace_id, conversation_id, inbound_message_id, playbook_reply_id, category, question_key,
  subject, body_proposed, created_by) ON reply_drafts TO app_rw;
GRANT UPDATE (status, body_final, decided_by, decided_at) ON reply_drafts TO app_rw;
