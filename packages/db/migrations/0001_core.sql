-- Omni-SDR schema v1: tenancy, prospects, outreach, send guard, ledger, outbox.
-- Spec: docs/INFRASTRUCTURE.md §5, §6, §12, §23, §24. Targets Postgres 16+ (Cloud SQL).
-- Invariants live here, not in application code (principle 3).

-- ─── roles ──────────────────────────────────────────────────────────────────
-- One DB role per service class. None of them owns a table, so RLS always applies.
-- Cross-tenant reads (the send guard, the ledger, ops jobs) go through dedicated roles that get
-- explicit USING (true) policies, not BYPASSRLS and not superuser: Cloud SQL has no superuser, and
-- with FORCE RLS a SECURITY DEFINER function owned by the table owner would be filtered too,
-- which would silently hide global suppression rows from the guard.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw')       THEN CREATE ROLE app_rw NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gate_svc')     THEN CREATE ROLE gate_svc NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sender_svc')   THEN CREATE ROLE sender_svc NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops')          THEN CREATE ROLE ops NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guard_owner')  THEN CREATE ROLE guard_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_owner') THEN CREATE ROLE ledger_owner NOLOGIN; END IF;
END $$;

-- ─── request context ────────────────────────────────────────────────────────
-- Every request sets app.org_id and app.workspace_ids (comma-separated) in its transaction.
-- Unset context resolves to NULL / empty, which matches nothing: fail closed.
CREATE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION app_ws() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(string_to_array(nullif(current_setting('app.workspace_ids', true), ''), ',')::uuid[], '{}') $$;

CREATE FUNCTION value_hash(v text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT encode(sha256(convert_to(lower(btrim(v)), 'UTF8')), 'hex') $$;

CREATE FUNCTION draft_sha(subject text, body text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT encode(sha256(convert_to(coalesce(subject, '') || E'\n' || coalesce(body, ''), 'UTF8')), 'hex') $$;

-- ─── tenancy ────────────────────────────────────────────────────────────────
CREATE TABLE orgs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  account_type        text NOT NULL DEFAULT 'owner' CHECK (account_type IN ('owner', 'agency')),
  stripe_customer_id  text,
  subscription_status text NOT NULL DEFAULT 'trialing' CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at       timestamptz,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleting')),
  feature_flags       jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES orgs(id),
  name                      text NOT NULL,
  custom_domain             text,
  client_approvals_enabled  boolean NOT NULL DEFAULT false,
  auto_adjust_enabled       boolean NOT NULL DEFAULT false,
  auto_adjust_sources       text[] NOT NULL DEFAULT '{}' CHECK (auto_adjust_sources <@ ARRAY[
                              'booked_meetings', 'positive_replies', 'objections', 'unsubscribes_bounces',
                              'sops', 'won_lost', 'draft_edits', 'rejections']::text[]),
  timezone                  text NOT NULL DEFAULT 'America/Chicago',
  trust_level               smallint NOT NULL DEFAULT 1 CHECK (trust_level BETWEEN 1 AND 3),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
-- A hostname routes to exactly one workspace (Station 21). Checked across tenants on purpose.
CREATE UNIQUE INDEX workspaces_custom_domain ON workspaces (lower(custom_domain)) WHERE custom_domain IS NOT NULL;

-- Global identity; tenant access is only through memberships.
CREATE TABLE users (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idp_uid  text NOT NULL UNIQUE,
  email    text NOT NULL
);

CREATE TABLE memberships (
  org_id         uuid NOT NULL REFERENCES orgs(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  role           text NOT NULL CHECK (role IN ('admin', 'operator', 'reviewer', 'client_viewer')),
  workspace_ids  uuid[],                      -- NULL = every workspace in the org
  PRIMARY KEY (org_id, user_id)
);

-- ─── prospects + evidence ───────────────────────────────────────────────────
CREATE TABLE contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  name          text,
  email         text,
  email_status  text NOT NULL DEFAULT 'unknown' CHECK (email_status IN ('unknown', 'valid', 'invalid', 'risky')),
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  UNIQUE (workspace_id, email),
  UNIQUE (org_id, workspace_id, id)
);

CREATE TABLE evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  contact_id    uuid NOT NULL,
  type          text NOT NULL,
  source_uri    text NOT NULL,
  fetched_at    timestamptz NOT NULL,
  snapshot_sha  text NOT NULL,
  facts         jsonb NOT NULL DEFAULT '{}',
  expires_at    timestamptz NOT NULL,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id)
);

-- Evidence is a snapshot: only its expiry can move.
CREATE FUNCTION evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'expires_at') IS DISTINCT FROM (to_jsonb(OLD) - 'expires_at') THEN
    RAISE EXCEPTION 'evidence is immutable; only expires_at may change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_immutable BEFORE UPDATE ON evidence FOR EACH ROW EXECUTE FUNCTION evidence_immutable();

-- ─── outreach ───────────────────────────────────────────────────────────────
-- Station 09: several ICPs per workspace (one lineage each), every edit a new immutable version.
-- Campaigns pin a version row, so what a campaign targeted can never change under it.
CREATE TABLE icps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  lineage_id    uuid NOT NULL DEFAULT gen_random_uuid(),
  name          text NOT NULL DEFAULT 'ICP',
  version       int NOT NULL DEFAULT 1 CHECK (version >= 1),
  data          jsonb NOT NULL DEFAULT '{}',
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  UNIQUE (workspace_id, lineage_id, version),
  UNIQUE (org_id, workspace_id, id)
);

CREATE FUNCTION icps_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'archived_at') IS DISTINCT FROM (to_jsonb(OLD) - 'archived_at') THEN
    RAISE EXCEPTION 'icp versions are immutable; insert a new version' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER icps_immutable BEFORE UPDATE ON icps FOR EACH ROW EXECUTE FUNCTION icps_immutable();

CREATE TABLE campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  workspace_id        uuid NOT NULL,
  name                text NOT NULL,
  icp_id              uuid,
  auto_audit_enabled  boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, icp_id) REFERENCES icps(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id)
);

CREATE TABLE enrollments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  campaign_id   uuid NOT NULL,
  contact_id    uuid NOT NULL,
  state         text NOT NULL DEFAULT 'waiting'
                CHECK (state IN ('waiting', 'drafting', 'awaiting_approval', 'scheduled', 'sent',
                                 'paused', 'snoozed', 'stopped', 'converted', 'completed')),
  step          int NOT NULL DEFAULT 0,
  heat          smallint NOT NULL DEFAULT 1 CHECK (heat BETWEEN 1 AND 5),
  next_run_at   timestamptz,
  stop_reason   text,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, campaign_id) REFERENCES campaigns(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id),
  UNIQUE (campaign_id, contact_id),
  UNIQUE (org_id, workspace_id, id)
);

CREATE TABLE drafts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  workspace_id   uuid NOT NULL,
  enrollment_id  uuid NOT NULL,
  step           int NOT NULL DEFAULT 0,
  channel        text NOT NULL CHECK (channel IN ('email', 'sms', 'linkedin_assist')),
  subject        text,
  body           text NOT NULL,
  claims         jsonb NOT NULL DEFAULT '[]',
  status         text NOT NULL DEFAULT 'gating'
                 CHECK (status IN ('generating', 'gating', 'blocked', 'review', 'approved', 'discarded', 'superseded')),
  gate_passed    boolean NOT NULL DEFAULT false,
  gate_body_sha  text,
  gate_version   text,
  gated_at       timestamptz,
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, enrollment_id) REFERENCES enrollments(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id),
  -- §12.2: an approved draft must carry a gate pass over exactly its current text.
  CONSTRAINT approved_requires_gate CHECK (
    status <> 'approved' OR (gate_passed AND gate_body_sha = draft_sha(subject, body)))
);

-- Editing the text voids the gate and the approval, so an edited draft goes back through both.
CREATE FUNCTION drafts_edit_voids_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subject IS DISTINCT FROM OLD.subject OR NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.gate_passed   := false;
    NEW.gate_body_sha := NULL;
    NEW.gated_at      := NULL;
    NEW.approved_by   := NULL;
    NEW.approved_at   := NULL;
    IF NEW.status IN ('review', 'approved') THEN NEW.status := 'gating'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drafts_edit_voids_gate BEFORE UPDATE ON drafts FOR EACH ROW EXECUTE FUNCTION drafts_edit_voids_gate();

CREATE TABLE mailboxes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  workspace_id   uuid NOT NULL,
  provider       text NOT NULL CHECK (provider IN ('gmail', 'graph', 'smtp_imap', 'bridge')),
  address        text NOT NULL,
  daily_cap      int NOT NULL DEFAULT 5 CHECK (daily_cap > 0),
  paused_reason  text,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  UNIQUE (workspace_id, address),
  UNIQUE (org_id, workspace_id, id),
  UNIQUE (org_id, id)
);

CREATE TABLE send_counters (
  org_id      uuid NOT NULL,
  mailbox_id  uuid NOT NULL,
  day         date NOT NULL,
  count       int NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (mailbox_id, day),
  FOREIGN KEY (org_id, mailbox_id) REFERENCES mailboxes(org_id, id)
);

-- scope_org_id NULL = global (hard bounces, complaints) and is never visible to tenants.
CREATE TABLE suppression (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_org_id  uuid REFERENCES orgs(id),
  value_hash    text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('email', 'phone')),
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (scope_org_id, value_hash)
);

CREATE TABLE holds (
  org_id      uuid NOT NULL REFERENCES orgs(id),
  scope_type  text NOT NULL CHECK (scope_type IN ('org', 'workspace', 'campaign', 'mailbox')),
  scope_id    uuid NOT NULL,
  reason      text NOT NULL,
  set_by      text NOT NULL,
  set_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  workspace_id         uuid NOT NULL,
  draft_id             uuid NOT NULL UNIQUE,   -- exactly once, structurally
  mailbox_id           uuid,
  channel              text NOT NULL,
  state                text NOT NULL DEFAULT 'claimed'
                       CHECK (state IN ('claimed', 'sent', 'failed', 'handed_off', 'confirmed')),
  provider_message_id  text,
  claimed_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  error                text,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, draft_id) REFERENCES drafts(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, mailbox_id) REFERENCES mailboxes(org_id, workspace_id, id)
);

-- §12.3: the last gate before anything reaches a provider. Runs as the table owner so it can see
-- global suppression and every hold regardless of the caller's RLS scope.
CREATE FUNCTION send_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d  drafts%ROWTYPE;
  e  enrollments%ROWTYPE;
  c  contacts%ROWTYPE;
  w  workspaces%ROWTYPE;
  mb mailboxes%ROWTYPE;
  n  int;
BEGIN
  SELECT * INTO d FROM drafts WHERE id = NEW.draft_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_guard: draft not found' USING ERRCODE = 'P0001'; END IF;
  IF d.org_id <> NEW.org_id OR d.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'send_guard: draft belongs to another tenant' USING ERRCODE = 'P0001';
  END IF;
  IF d.status <> 'approved' OR NOT d.gate_passed OR d.gate_body_sha IS DISTINCT FROM draft_sha(d.subject, d.body) THEN
    RAISE EXCEPTION 'send_guard: draft not approved with a current gate pass' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.channel <> d.channel THEN
    RAISE EXCEPTION 'send_guard: channel mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO e FROM enrollments WHERE id = d.enrollment_id;
  SELECT * INTO c FROM contacts WHERE id = e.contact_id;
  -- The FKs already bind these to the draft's workspace; the guard re-checks rather than trust them.
  IF e.workspace_id IS DISTINCT FROM d.workspace_id OR c.workspace_id IS DISTINCT FROM d.workspace_id THEN
    RAISE EXCEPTION 'send_guard: enrollment or contact belongs to another tenant' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO w FROM workspaces WHERE id = d.workspace_id;

  -- Trust dial: level 1 needs a human; 2–3 may auto-send only hot leads.
  IF d.approved_by IS NULL AND NOT (w.trust_level >= 2 AND e.heat >= 4) THEN
    RAISE EXCEPTION 'send_guard: trust level % requires human approval', w.trust_level USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM holds h WHERE
       (h.scope_type = 'org' AND h.scope_id = d.org_id) OR
       (h.scope_type = 'workspace' AND h.scope_id = d.workspace_id) OR
       (h.scope_type = 'campaign' AND h.scope_id = e.campaign_id) OR
       (h.scope_type = 'mailbox' AND h.scope_id = NEW.mailbox_id)) THEN
    RAISE EXCEPTION 'send_guard: on hold' USING ERRCODE = 'P0001';
  END IF;

  IF d.channel = 'email' THEN
    IF c.email IS NULL OR c.email_status <> 'valid' THEN
      RAISE EXCEPTION 'send_guard: contact email not verified' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM suppression s WHERE s.value_hash = value_hash(c.email)
               AND (s.scope_org_id IS NULL OR s.scope_org_id = d.org_id)) THEN
      RAISE EXCEPTION 'send_guard: contact suppressed' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO mb FROM mailboxes WHERE id = NEW.mailbox_id;
    IF NOT FOUND OR mb.workspace_id <> d.workspace_id THEN
      RAISE EXCEPTION 'send_guard: mailbox not in this workspace' USING ERRCODE = 'P0001';
    END IF;
    IF mb.paused_reason IS NOT NULL THEN
      RAISE EXCEPTION 'send_guard: mailbox paused (%)', mb.paused_reason USING ERRCODE = 'P0001';
    END IF;

    -- Take one unit of today's cap in the same transaction; no row back = cap reached.
    INSERT INTO send_counters AS sc (org_id, mailbox_id, day, count)
      VALUES (d.org_id, mb.id, (now() AT TIME ZONE 'UTC')::date, 1)
      ON CONFLICT (mailbox_id, day) DO UPDATE SET count = sc.count + 1 WHERE sc.count < mb.daily_cap
      RETURNING count INTO n;
    IF n IS NULL THEN
      RAISE EXCEPTION 'send_guard: mailbox daily cap reached' USING ERRCODE = 'P0001';
    END IF;
  ELSIF d.channel = 'sms' AND (c.phone IS NULL OR EXISTS (
        SELECT 1 FROM suppression s WHERE s.value_hash = value_hash(c.phone)
        AND (s.scope_org_id IS NULL OR s.scope_org_id = d.org_id))) THEN
    RAISE EXCEPTION 'send_guard: phone missing or suppressed' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;
CREATE TRIGGER send_guard BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION send_guard();

-- ─── credits ────────────────────────────────────────────────────────────────
CREATE TABLE credit_balances (
  org_id   uuid NOT NULL REFERENCES orgs(id),
  meter    text NOT NULL CHECK (meter IN ('data', 'action', 'media')),
  balance  bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  PRIMARY KEY (org_id, meter)
);

CREATE TABLE credit_ledger (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES orgs(id),
  meter       text NOT NULL,
  delta       bigint NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('grant', 'purchase', 'reserve', 'settle', 'release')),
  ref_type    text,
  ref_id      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Reserve before a metered job; the balance CHECK refuses overspend atomically.
CREATE FUNCTION credit_reserve(p_org uuid, p_meter text, p_amount bigint, p_ref_type text, p_ref_id text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance bigint;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'reserve amount must be positive' USING ERRCODE = 'P0001'; END IF;
  UPDATE credit_balances SET balance = balance - p_amount
    WHERE org_id = p_org AND meter = p_meter RETURNING balance INTO new_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'no % balance for org', p_meter USING ERRCODE = 'P0001'; END IF;
  INSERT INTO credit_ledger (org_id, meter, delta, kind, ref_type, ref_id)
    VALUES (p_org, p_meter, -p_amount, 'reserve', p_ref_type, p_ref_id);
  RETURN new_balance;
END $$;

-- Undo a reservation (job failed) or return the unused part of one (job cost less).
CREATE FUNCTION credit_release(p_org uuid, p_meter text, p_amount bigint, p_ref_type text, p_ref_id text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance bigint;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'release amount must be positive' USING ERRCODE = 'P0001'; END IF;
  IF p_amount > coalesce((SELECT -sum(delta) FROM credit_ledger WHERE org_id = p_org AND meter = p_meter
                            AND ref_type = p_ref_type AND ref_id = p_ref_id
                            AND kind IN ('reserve', 'settle', 'release')), 0) THEN
    RAISE EXCEPTION 'release exceeds what this job still holds' USING ERRCODE = 'P0001';
  END IF;
  UPDATE credit_balances SET balance = balance + p_amount
    WHERE org_id = p_org AND meter = p_meter RETURNING balance INTO new_balance;
  INSERT INTO credit_ledger (org_id, meter, delta, kind, ref_type, ref_id)
    VALUES (p_org, p_meter, p_amount, 'release', p_ref_type, p_ref_id);
  RETURN new_balance;
END $$;

-- ─── ops ────────────────────────────────────────────────────────────────────
CREATE TABLE outbox (
  id            bigserial PRIMARY KEY,
  org_id        uuid NOT NULL REFERENCES orgs(id),
  topic         text NOT NULL,
  key           text NOT NULL,
  payload       jsonb NOT NULL,
  trace_id      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES orgs(id),
  actor        text NOT NULL,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  at           timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- ─── row-level security ─────────────────────────────────────────────────────
-- Mechanical rule, checked by test/rls.test.mjs: every table with org_id or scope_org_id has
-- RLS enabled AND forced. Workspace-scoped tables also match app.workspace_ids.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'evidence', 'icps', 'campaigns', 'enrollments', 'drafts', 'mailboxes', 'messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
                    WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['memberships', 'send_counters', 'holds', 'credit_balances', 'credit_ledger', 'outbox', 'audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (org_id = app_org()) WITH CHECK (org_id = app_org())', t);
  END LOOP;
END $$;

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;  ALTER TABLE orgs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON orgs USING (id = app_org());

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;  ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON workspaces USING (org_id = app_org() AND id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND id = ANY (app_ws()));

-- Tenants see their own suppression rows; global rows stay invisible (the guard reads them).
ALTER TABLE suppression ENABLE ROW LEVEL SECURITY;  ALTER TABLE suppression FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON suppression USING (scope_org_id = app_org()) WITH CHECK (scope_org_id = app_org());

-- ─── privileges ─────────────────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_rw, gate_svc, sender_svc, ops;
GRANT ALL ON ALL TABLES IN SCHEMA public TO ops;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_rw, sender_svc, gate_svc, ops;

-- app_rw (web/api): reads its tenant; writes prospects, campaigns, approvals, suppression, holds.
GRANT SELECT ON orgs, workspaces, users, memberships, contacts, evidence, icps, campaigns, enrollments,
               drafts, mailboxes, send_counters, suppression, holds, messages, credit_balances,
               credit_ledger, audit_log TO app_rw;
GRANT INSERT, UPDATE ON contacts, campaigns, enrollments, mailboxes TO app_rw;
GRANT INSERT ON icps TO app_rw;
GRANT UPDATE (archived_at) ON icps TO app_rw;
GRANT INSERT ON evidence, suppression, holds, outbox, audit_log TO app_rw;
GRANT DELETE ON holds TO app_rw;   -- a human clears a hold; breakers only ever set them
-- Drafts: app_rw may write text and approval, never gate columns (§12.2).
GRANT INSERT (org_id, workspace_id, enrollment_id, step, channel, subject, body, claims, status) ON drafts TO app_rw;
GRANT UPDATE (subject, body, status, approved_by, approved_at) ON drafts TO app_rw;

-- gate_svc: reads what it checks; the ONLY role that can write gate columns.
GRANT SELECT ON workspaces, contacts, evidence, enrollments, drafts TO gate_svc;
GRANT UPDATE (gate_passed, gate_body_sha, gate_version, gated_at, status) ON drafts TO gate_svc;
GRANT INSERT ON outbox TO gate_svc;

-- sender_svc: the only role that can create a message (principle 4).
GRANT SELECT ON workspaces, drafts, mailboxes, messages TO sender_svc;
GRANT INSERT ON messages, outbox TO sender_svc;
GRANT UPDATE (state, provider_message_id, sent_at, error) ON messages TO sender_svc;

GRANT EXECUTE ON FUNCTION app_org(), app_ws(), value_hash(text), draft_sha(text, text)
  TO app_rw, gate_svc, sender_svc, ops, guard_owner, ledger_owner;
REVOKE EXECUTE ON FUNCTION credit_reserve(uuid, text, bigint, text, text), credit_release(uuid, text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_reserve(uuid, text, bigint, text, text), credit_release(uuid, text, bigint, text, text) TO ops;

-- ─── cross-tenant roles: explicit, narrow, testable ─────────────────────────
-- guard_owner owns send_guard(): reads everything the guard checks, writes only counters.
GRANT SELECT ON drafts, enrollments, contacts, workspaces, holds, suppression, mailboxes, send_counters TO guard_owner;
GRANT INSERT, UPDATE ON send_counters TO guard_owner;
GRANT CREATE ON SCHEMA public TO guard_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION send_guard() OWNER TO guard_owner;
REVOKE CREATE ON SCHEMA public FROM guard_owner;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['drafts', 'enrollments', 'contacts', 'workspaces', 'holds', 'suppression', 'mailboxes', 'send_counters'] LOOP
    EXECUTE format('CREATE POLICY guard_all ON %I TO guard_owner USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ledger_owner owns the credit functions: balances and ledger only.
GRANT SELECT, UPDATE ON credit_balances TO ledger_owner;
GRANT SELECT, INSERT ON credit_ledger TO ledger_owner;
GRANT USAGE ON SEQUENCE credit_ledger_id_seq TO ledger_owner;
GRANT CREATE ON SCHEMA public TO ledger_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION credit_reserve(uuid, text, bigint, text, text) OWNER TO ledger_owner;
REVOKE CREATE ON SCHEMA public FROM ledger_owner;
GRANT CREATE ON SCHEMA public TO ledger_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION credit_release(uuid, text, bigint, text, text) OWNER TO ledger_owner;
REVOKE CREATE ON SCHEMA public FROM ledger_owner;
CREATE POLICY ledger_all ON credit_balances TO ledger_owner USING (true) WITH CHECK (true);
CREATE POLICY ledger_all ON credit_ledger   TO ledger_owner USING (true) WITH CHECK (true);

-- ops (jobs only: relay, retention, deletion): every RLS table, by policy.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity LOOP
    EXECUTE format('CREATE POLICY ops_all ON %I TO ops USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
