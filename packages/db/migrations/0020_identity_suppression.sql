-- 0020: identity-keyed suppression (B-5b; design note omnisdr-ops/cards/B-5a-design.md, sections 0-20).
-- Until now an opt-out suppressed ONE hash of the contact's current email (or phone). A person who opted out by LinkedIn
-- profile, or whose address was learned later, or who is the same person under a second contact, could still be sent to.
-- This migration records every identity a person is known by, closes a person's identities together, and makes the send
-- guard, the reply-draft check and the sender hand-off ask "is this PERSON suppressed", not "is this address".
-- Written in parts; each part ends in a state the previous test files still pass against.

-- ─── part 1: roles, tables, columns, policies, grants ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_owner') THEN CREATE ROLE identity_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rename_owner')   THEN CREATE ROLE rename_owner NOLOGIN; END IF;
END $$;

-- suppression gains a 'linkedin' kind (the applied 0001 constraint is not edited; this replaces it).
ALTER TABLE suppression DROP CONSTRAINT suppression_kind_check;
ALTER TABLE suppression ADD CONSTRAINT suppression_kind_check CHECK (kind IN ('email', 'phone', 'linkedin'));

-- contacts: the profile slug a contact was imported with, and the name-match hold (part 6).
ALTER TABLE contacts ADD COLUMN linkedin_slug text CHECK (linkedin_slug IS NULL OR linkedin_slug ~ '^in/[a-z0-9_%-]{2,100}$');
ALTER TABLE contacts ADD COLUMN hold_reason text;
ALTER TABLE contacts ADD COLUMN hold_cleared_by uuid;
ALTER TABLE contacts ADD COLUMN hold_cleared_at timestamptz;
ALTER TABLE contacts ADD COLUMN hold_clear_reason text;

-- Every identity a contact is known by. Written only by definer functions and triggers (identity_owner); read by the guard.
CREATE TABLE contact_identities (
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  contact_id    uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('email', 'phone', 'linkedin')),
  value_hash    text NOT NULL,
  source        text NOT NULL CHECK (source IN ('contact', 'profile_thread', 'paste', 'import', 'backfill')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, kind, value_hash),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX contact_identities_hash ON contact_identities (org_id, value_hash);

-- Who opted out ON a phone hash (a phone can be shared; an opt-out of one holder must not release the others' email).
CREATE TABLE suppression_origins (
  org_id            uuid NOT NULL,
  workspace_id      uuid NOT NULL,
  value_hash        text NOT NULL,
  origin_contact_id uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, value_hash, origin_contact_id),
  FOREIGN KEY (org_id, workspace_id, origin_contact_id) REFERENCES contacts(org_id, workspace_id, id) ON DELETE CASCADE
);

-- The per-org salt behind the name seeds. Never updated or deleted (part 6 guards it), gone only with the org.
CREATE TABLE org_salts (
  org_id      uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  salt        text NOT NULL CHECK (length(salt) >= 32),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A frozen, salted hash of the name of a person who opted out with no email on file. No FK to contacts, so renaming or
-- deleting the opted-out contact releases nothing; it goes with the org. No plaintext name is stored.
CREATE TABLE optout_name_seeds (
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name_hash       text NOT NULL,
  seed_value_hash text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, name_hash, seed_value_hash)
);

-- Forced RLS on all four. The tenant policy is the shape every org table has; no application role gets a write grant, so
-- it only serves the mechanical catalog tests. ops sees and may delete (retention); closer_scope keeps closers out.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contact_identities', 'suppression_origins'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
                    WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()))', t);
    EXECUTE format('CREATE POLICY ops_all ON %I TO ops USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY guard_read ON %I FOR SELECT TO guard_owner USING (true)', t);
    EXECUTE format('CREATE POLICY identity_all ON %I TO identity_owner USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY closer_scope ON %I AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
                    USING (NOT app_is_closer(org_id)) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, DELETE ON %I TO ops', t);
    EXECUTE format('GRANT SELECT ON %I TO guard_owner', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO identity_owner', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['org_salts', 'optout_name_seeds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    -- Inert for the application roles (they hold no grant on these two); present because the catalog tests require the
    -- tenant shape on every org table, and the grant, pinned in identity-suppression.test.mjs, is the real barrier.
    EXECUTE format('CREATE POLICY tenant ON %I USING (org_id = app_org()) WITH CHECK (org_id = app_org())', t);
    EXECUTE format('CREATE POLICY ops_select ON %I FOR SELECT TO ops USING (true)', t);
    EXECUTE format('CREATE POLICY identity_all ON %I TO identity_owner USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY closer_scope ON %I AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
                    USING (NOT app_is_closer(org_id)) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT ON %I TO ops', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO identity_owner', t);
  END LOOP;
END $$;
-- The org's own deletion cascades through the seeds and the salt; identity_owner needs DELETE only if a function ever
-- deletes them, which none does. ops deletes the org row, and the cascade is done by the table owner (the FK).

-- identity_owner: the definer that writes identities and suppression. Mirrors unsub_owner (0003): role-bound policies.
GRANT USAGE ON SCHEMA public TO identity_owner;
GRANT SELECT ON contacts, enrollments, conversations, suppression, orgs, memberships, workspaces TO identity_owner;
GRANT SELECT, INSERT ON suppression TO identity_owner;
GRANT UPDATE (state, stop_reason, next_run_at) ON enrollments TO identity_owner;
GRANT UPDATE (hold_reason, hold_cleared_by, hold_cleared_at, hold_clear_reason) ON contacts TO identity_owner;
GRANT INSERT ON audit_log TO identity_owner;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO identity_owner;
GRANT EXECUTE ON FUNCTION app_org(), app_ws(), app_user(), app_is_admin(uuid, uuid), value_hash(text) TO identity_owner, rename_owner;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'enrollments', 'conversations', 'suppression', 'orgs', 'memberships', 'workspaces', 'audit_log'] LOOP
    EXECUTE format('CREATE POLICY identity_all ON %I TO identity_owner USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- guard_owner reads the identities, origins, seeds and salts (granted above, org-scoped by policy) and the hold columns.
-- Contacts already carries guard_all.

-- ─── contacts: narrow the table-level INSERT/UPDATE grant (so no role can write hold_* or created_at) ────────────
-- A column-level REVOKE does not remove a table-level grant, so the table grant goes and explicit lists come back. The lists
-- are the pre-0020 effective column privileges minus the deliberate narrowing: id and created_at are not client-writable
-- on INSERT, and id, org_id, workspace_id, created_at are not client-writable on UPDATE (no route writes them; the
-- snapshot test in identity-suppression.test.mjs pins both lists). hold_* is writable by nobody but the definer functions.
DO $$
DECLARE other text;
BEGIN
  SELECT string_agg(DISTINCT grantee, ', ') INTO other FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'contacts' AND privilege_type IN ('INSERT', 'UPDATE')
      AND grantee NOT IN ('app_rw', 'ops') AND grantee <> current_user;
  IF other IS NOT NULL THEN
    RAISE EXCEPTION '0020: unexpected table-level INSERT/UPDATE on contacts for %: list it in this migration first', other;
  END IF;
END $$;
REVOKE INSERT, UPDATE ON contacts FROM app_rw, ops;
GRANT INSERT (org_id, workspace_id, name, email, email_status, phone, company, title, fit_score, place_id, website, fit,
              verify_job, verify_at, linkedin_slug) ON contacts TO app_rw;
GRANT UPDATE (name, email, email_status, phone, company, title, fit_score, place_id, website, fit, verify_job, verify_at,
              linkedin_slug) ON contacts TO app_rw;
-- ops (jobs: retention, deletion, seeding) keeps every column it had except the hold columns.
GRANT INSERT (id, org_id, workspace_id, name, email, email_status, phone, created_at, company, title, fit_score, place_id,
              website, fit, verify_job, verify_at, linkedin_slug) ON contacts TO ops;
GRANT UPDATE (id, org_id, workspace_id, name, email, email_status, phone, created_at, company, title, fit_score, place_id,
              website, fit, verify_job, verify_at, linkedin_slug) ON contacts TO ops;

-- A new definer owner needs CREATE on the schema to take ownership of its functions (PG15+, as in 0001/0003/0017). It is
-- lent here and revoked at the end of this file, so no owner keeps it.
GRANT CREATE ON SCHEMA public TO identity_owner, rename_owner, guard_owner;

-- ─── part 2: canonical forms, one place (design section 2) ─────────────────────────────────────────────────────
CREATE FUNCTION normalize_name(p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT btrim(regexp_replace(lower(coalesce(p_name, '')), '[^[:alnum:]]+', ' ', 'g')) $$;

-- Tokens in the normalized name; the hold and the seeds apply to two or more.
CREATE FUNCTION name_tokens(p_name text) RETURNS int LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN normalize_name(p_name) = '' THEN 0 ELSE array_length(string_to_array(normalize_name(p_name), ' '), 1) END $$;

-- digits only; +1 for 10 digits; 11 digits starting 1; an explicit + keeps its country code (7 to 15 digits); else NULL.
CREATE FUNCTION canon_phone(p_phone text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_phone IS NULL THEN NULL
    WHEN btrim(p_phone) ~ '^\+' THEN
      CASE WHEN length(regexp_replace(p_phone, '\D', '', 'g')) BETWEEN 7 AND 15 THEN '+' || regexp_replace(p_phone, '\D', '', 'g') END
    WHEN length(regexp_replace(p_phone, '\D', '', 'g')) = 10 THEN '+1' || regexp_replace(p_phone, '\D', '', 'g')
    WHEN length(regexp_replace(p_phone, '\D', '', 'g')) = 11 AND regexp_replace(p_phone, '\D', '', 'g') ~ '^1' THEN '+' || regexp_replace(p_phone, '\D', '', 'g')
  END $$;

-- The one canonical LinkedIn person slug, `in/<slug>`. Accepts a profile URL, `in/<slug>` or a `profile:in/<slug>` thread key.
-- Lower-case; strip scheme/host (any locale subdomain), query, fragment, trailing slash; percent-decode ONLY unreserved
-- characters to a fixpoint (cap 3 passes), lower-casing after every pass; refuse %00 %2f %3f %23 at any pass; the result must
-- be `in/` plus 2 to 100 of [a-z0-9_%-]. Anything else raises (company pages are not people). NULL in, NULL out.
CREATE FUNCTION canon_linkedin_slug(p_in text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; nxt text; m text; ch text; i int := 0;
BEGIN
  IF p_in IS NULL THEN RETURN NULL; END IF;
  s := lower(btrim(p_in));
  s := regexp_replace(s, '^profile:', '');
  s := regexp_replace(s, '^(https?://)?([a-z0-9-]+\.)*linkedin\.com/', '');
  s := split_part(split_part(s, '#', 1), '?', 1);
  s := regexp_replace(s, '/+$', '');
  LOOP
    IF s ~ '%(00|2f|3f|23)' THEN RAISE EXCEPTION 'linkedin slug refused: reserved escape' USING ERRCODE = '22023'; END IF;
    nxt := regexp_replace(s, '%25(?=[0-9a-f]{2})', '%', 'g');  -- a double-encoded escape unwraps one layer per pass
    FOR m IN SELECT DISTINCT (regexp_matches(s, '%([0-9a-f]{2})', 'g'))[1] LOOP
      ch := chr(('x' || m)::bit(8)::int);
      IF ch ~ '^[A-Za-z0-9._~-]$' THEN nxt := replace(nxt, '%' || m, ch); END IF;
    END LOOP;
    nxt := lower(nxt);
    EXIT WHEN nxt = s;
    i := i + 1;
    IF i > 3 THEN RAISE EXCEPTION 'linkedin slug refused: nested escapes' USING ERRCODE = '22023'; END IF;
    s := nxt;
  END LOOP;
  IF s !~ '^in/[a-z0-9_%-]{2,100}$' THEN RAISE EXCEPTION 'linkedin slug refused: not a person profile' USING ERRCODE = '22023'; END IF;
  RETURN s;
END $$;

CREATE FUNCTION linkedin_hash(p_slug text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT value_hash('linkedin:' || canon_linkedin_slug(p_slug)) $$;

-- The advisory-lock key of an org (global suppression rows use 0). An opt-out takes it exclusive, the guard shared.
CREATE FUNCTION org_lock_key(p_org uuid) RETURNS bigint LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN p_org IS NULL THEN 0::bigint ELSE hashtextextended(p_org::text, 74062111) END $$;

-- ─── part 3: fill triggers, the closure, the org lock ────────────────────────────────────────────────────────────
-- BEFORE: the stored slug is always the canonical one, so JS and SQL can never disagree about which profile it is.
CREATE FUNCTION contacts_canon_slug() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.linkedin_slug IS NOT NULL THEN NEW.linkedin_slug := canon_linkedin_slug(NEW.linkedin_slug); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contacts_a_canon_slug BEFORE INSERT OR UPDATE OF linkedin_slug ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_canon_slug();

-- AFTER: an identity is recorded the moment it is learned. Never deleted when an address changes.
CREATE FUNCTION contacts_fill_identities() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
  SELECT NEW.org_id, NEW.workspace_id, NEW.id, v.kind, v.h, 'contact'
  FROM (VALUES ('email',    CASE WHEN btrim(coalesce(NEW.email, '')) <> '' THEN value_hash(NEW.email) END),
               ('phone',    value_hash(canon_phone(NEW.phone))),
               ('linkedin', CASE WHEN NEW.linkedin_slug IS NOT NULL THEN value_hash('linkedin:' || NEW.linkedin_slug) END)) AS v(kind, h)
  WHERE v.h IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER contacts_fill_identities AFTER INSERT OR UPDATE OF email, phone, linkedin_slug ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_fill_identities();

-- A profile thread carries its contact's profile identity (ingestPasted opens `profile:in/<slug>` threads).
CREATE FUNCTION conversations_fill_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.channel = 'linkedin' AND NEW.contact_id IS NOT NULL AND NEW.thread_key LIKE 'profile:in/%' THEN
    INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
    VALUES (NEW.org_id, NEW.workspace_id, NEW.contact_id, 'linkedin', linkedin_hash(NEW.thread_key), 'profile_thread')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER conversations_fill_identity AFTER INSERT OR UPDATE OF contact_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_fill_identity();

-- close_component: the person (all contacts linked by an email or linkedin identity, transitively; phone never links)
-- gets every identity suppressed and every live enrollment stopped. One recursive CTE and bulk inserts, idempotent: it
-- only inserts what is missing, so the statement triggers it causes find nothing to do and the recursion stops (depth 3).
-- A phone hash it creates records its holder as an origin (a shared line must not release the holder's email, part 5).
-- Bounce rows and global rows never seed it; manual rows do.
CREATE FUNCTION close_component(p_org uuid, p_contacts uuid[], p_hashes text[], p_only_if_suppressed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comp uuid[]; seed text;
BEGIN
  WITH RECURSIVE c(contact_id) AS (
    SELECT contact_id FROM (
      SELECT contact_id FROM contact_identities WHERE org_id = p_org AND contact_id = ANY (coalesce(p_contacts, '{}'))
      UNION
      SELECT contact_id FROM contact_identities WHERE org_id = p_org AND kind IN ('email', 'linkedin') AND value_hash = ANY (coalesce(p_hashes, '{}'))
    ) s
    UNION
    SELECT b.contact_id FROM c
      JOIN contact_identities a ON a.org_id = p_org AND a.contact_id = c.contact_id AND a.kind IN ('email', 'linkedin')
      JOIN contact_identities b ON b.org_id = p_org AND b.kind = a.kind AND b.value_hash = a.value_hash
  ) SELECT array_agg(contact_id) INTO comp FROM c;
  IF comp IS NULL THEN RETURN; END IF;

  IF p_only_if_suppressed AND NOT EXISTS (
       SELECT 1 FROM contact_identities i JOIN suppression s ON s.scope_org_id = p_org AND s.value_hash = i.value_hash AND s.reason <> 'bounce'
       WHERE i.org_id = p_org AND i.contact_id = ANY (comp) AND i.kind IN ('email', 'linkedin')) THEN
    RETURN;
  END IF;

  seed := coalesce(p_hashes[1], (SELECT value_hash FROM contact_identities WHERE org_id = p_org AND contact_id = ANY (coalesce(p_contacts, '{}'))
                                  AND kind IN ('email', 'linkedin') ORDER BY value_hash LIMIT 1), '');
  WITH ids AS (
    SELECT i.workspace_id, i.contact_id, i.kind, i.value_hash FROM contact_identities i WHERE i.org_id = p_org AND i.contact_id = ANY (comp)
  ), ins AS (
    INSERT INTO suppression (scope_org_id, value_hash, kind, reason)
    SELECT DISTINCT p_org, value_hash, kind, 'identity_closure:' || substr(seed, 1, 12) FROM ids
    ON CONFLICT DO NOTHING RETURNING value_hash
  )
  INSERT INTO suppression_origins (org_id, workspace_id, value_hash, origin_contact_id)
  SELECT p_org, ids.workspace_id, ids.value_hash, ids.contact_id FROM ids JOIN ins USING (value_hash) WHERE ids.kind = 'phone'
  ON CONFLICT DO NOTHING;

  UPDATE enrollments SET state = 'stopped', stop_reason = 'unsubscribe', next_run_at = NULL
   WHERE org_id = p_org AND contact_id = ANY (comp) AND state NOT IN ('stopped', 'converted', 'completed');
END $$;

-- Trigger A: a propagating suppression row (org-scoped, not a bounce, not a phone seed) closes its person.
CREATE FUNCTION suppression_close_person() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT scope_org_id AS org, array_agg(value_hash) AS hashes FROM new_rows
           WHERE scope_org_id IS NOT NULL AND reason <> 'bounce' AND kind IN ('email', 'linkedin') GROUP BY scope_org_id LOOP
    PERFORM close_component(r.org, NULL, r.hashes, false);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER suppression_close_person AFTER INSERT ON suppression
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION suppression_close_person();

-- Trigger B: a new identity of a person who is already suppressed (an address learned later, a bridge between two
-- people) closes the person at once.
CREATE FUNCTION identities_close_person() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT org_id AS org, array_agg(DISTINCT contact_id) AS contacts FROM new_rows GROUP BY org_id LOOP
    PERFORM close_component(r.org, r.contacts, NULL, true);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER identities_close_person AFTER INSERT ON contact_identities
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION identities_close_person();

-- An opt-out in flight (suppression row, closure) holds the org lock exclusively until commit, so a send waits for it.
-- Row-level, because a statement trigger does not see the org. Definer, so the advisory REVOKE (part 9) cannot break it.
CREATE FUNCTION suppression_org_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(org_lock_key(NEW.scope_org_id));
  RETURN NEW;
END $$;
CREATE TRIGGER suppression_a_org_lock BEFORE INSERT ON suppression
  FOR EACH ROW EXECUTE FUNCTION suppression_org_lock();

-- ACLs first, ownership last: once the function belongs to identity_owner the (non-superuser) migrator can no longer REVOKE or GRANT on it (0008a).
REVOKE EXECUTE ON FUNCTION close_component(uuid, uuid[], text[], boolean), contacts_fill_identities(), conversations_fill_identity(),
  suppression_close_person(), identities_close_person(), suppression_org_lock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_component(uuid, uuid[], text[], boolean) TO identity_owner;
ALTER FUNCTION contacts_fill_identities() OWNER TO identity_owner;
ALTER FUNCTION conversations_fill_identity() OWNER TO identity_owner;
ALTER FUNCTION close_component(uuid, uuid[], text[], boolean) OWNER TO identity_owner;
ALTER FUNCTION suppression_close_person() OWNER TO identity_owner;
ALTER FUNCTION identities_close_person() OWNER TO identity_owner;
ALTER FUNCTION suppression_org_lock() OWNER TO identity_owner;

-- ─── part 4: name seeds and the salt (design sections 16-17) ───────────────────────────────────────────────────────
-- THE ONE FORMULA: name_hash = value_hash(org_salt || ':name:' || normalize_name(name)). Only this function computes it; the
-- opt-out writer, the hold trigger and the backfill all call it. NULL for a name of fewer than two tokens. With p_create the
-- org's salt is made on first use (INSERT ... ON CONFLICT DO NOTHING, then re-read, so concurrent first use yields one salt).
-- Without it, an org that has seeds but no salt raises, never silently stops matching.
CREATE FUNCTION name_seed_hash(p_org uuid, p_name text, p_create boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text;
BEGIN
  IF name_tokens(p_name) < 2 THEN RETURN NULL; END IF;
  SELECT salt INTO s FROM org_salts WHERE org_id = p_org;
  IF s IS NULL THEN
    IF p_create THEN
      INSERT INTO org_salts (org_id, salt) VALUES (p_org, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
        ON CONFLICT (org_id) DO NOTHING;
      SELECT salt INTO s FROM org_salts WHERE org_id = p_org;
    ELSIF EXISTS (SELECT 1 FROM optout_name_seeds WHERE org_id = p_org) THEN
      RAISE EXCEPTION 'name_seed_hash: org has name seeds but no salt' USING ERRCODE = 'P0001';
    ELSE
      RETURN NULL;
    END IF;
  END IF;
  RETURN value_hash(s || ':name:' || normalize_name(p_name));
END $$;

-- A salt is never changed or removed, by anyone, ops included; it goes only when its org does (the FK cascade, when the
-- parent row is already gone). Losing a salt would silently release every seed of the org.
CREATE FUNCTION org_salts_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'org_salts is immutable' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM orgs WHERE id = OLD.org_id) THEN RAISE EXCEPTION 'org_salts is immutable' USING ERRCODE = 'P0001'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER org_salts_immutable BEFORE UPDATE OR DELETE ON org_salts FOR EACH ROW EXECUTE FUNCTION org_salts_immutable();

-- ─── part 5: the opt-out writers (design section 6) ──────────────────────────────────────────────────────────────
-- _suppress_person: the single writing API. Records the contact's identities, suppresses every one of them (plus the legacy
-- raw email and phone hashes), lets trigger A spread to the person, and, for a person known only by profile (no email), freezes
-- the name seed and holds same-name contacts that already exist (order 2). A phone hash gets the contact as an origin only
-- when this call created the row or the row already has an origin (p_origins false for backfilled legacy opt-outs).
-- No tenant EXECUTE: only suppress_person (below, which checks the caller's org) and unsubscribe() (which took the org from the token).
CREATE FUNCTION _suppress_person(p_contact uuid, p_org uuid, p_reason text, p_origins boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contacts%ROWTYPE; nh text; has_email boolean; has_profile boolean;
BEGIN
  SELECT * INTO c FROM contacts WHERE id = p_contact AND org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION '_suppress_person: contact not found' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
  SELECT p_org, c.workspace_id, c.id, v.kind, v.h, 'contact'
  FROM (VALUES ('email',    CASE WHEN btrim(coalesce(c.email, '')) <> '' THEN value_hash(c.email) END),
               ('phone',    value_hash(canon_phone(c.phone))),
               ('linkedin', CASE WHEN c.linkedin_slug IS NOT NULL THEN value_hash('linkedin:' || c.linkedin_slug) END)) AS v(kind, h)
  WHERE v.h IS NOT NULL
  ON CONFLICT DO NOTHING;
  INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
  SELECT p_org, c.workspace_id, c.id, 'linkedin', linkedin_hash(v.thread_key), 'profile_thread'
  FROM conversations v WHERE v.org_id = p_org AND v.contact_id = c.id AND v.channel = 'linkedin' AND v.thread_key LIKE 'profile:in/%'
  ON CONFLICT DO NOTHING;

  WITH hs AS (
    SELECT kind, value_hash FROM contact_identities WHERE org_id = p_org AND contact_id = c.id
    UNION SELECT 'email', value_hash(c.email) WHERE btrim(coalesce(c.email, '')) <> ''
    UNION SELECT 'phone', value_hash(c.phone) WHERE btrim(coalesce(c.phone, '')) <> ''
  ), ins AS (
    INSERT INTO suppression (scope_org_id, value_hash, kind, reason)
    SELECT p_org, value_hash, kind, p_reason FROM hs ON CONFLICT DO NOTHING RETURNING value_hash
  )
  INSERT INTO suppression_origins (org_id, workspace_id, value_hash, origin_contact_id)
  SELECT p_org, c.workspace_id, hs.value_hash, c.id FROM hs
  WHERE p_origins AND hs.kind = 'phone'
    AND (hs.value_hash IN (SELECT value_hash FROM ins)
         OR EXISTS (SELECT 1 FROM suppression_origins o WHERE o.org_id = p_org AND o.value_hash = hs.value_hash))
  ON CONFLICT DO NOTHING;

  -- Spread to the whole person even when every row already existed, and stop the live enrollments of all of them.
  PERFORM close_component(p_org, ARRAY[c.id], NULL, false);

  SELECT EXISTS (SELECT 1 FROM contact_identities WHERE org_id = p_org AND contact_id = c.id AND kind = 'email') INTO has_email;
  SELECT EXISTS (SELECT 1 FROM contact_identities WHERE org_id = p_org AND contact_id = c.id AND kind = 'linkedin') INTO has_profile;
  IF has_profile AND NOT has_email AND name_tokens(c.name) >= 2 THEN
    nh := name_seed_hash(p_org, c.name, true);
    INSERT INTO optout_name_seeds (org_id, name_hash, seed_value_hash)
    SELECT p_org, nh, value_hash FROM contact_identities WHERE org_id = p_org AND contact_id = c.id AND kind = 'linkedin'
    ON CONFLICT DO NOTHING;
    -- Order 2: a same-name contact that exists already (it may be enrolled) is held now.
    WITH held AS (
      UPDATE contacts k SET hold_reason = 'name_match:seed:' || substr(nh, 1, 12)
      WHERE k.org_id = p_org AND k.id <> c.id AND k.hold_reason IS NULL AND k.hold_cleared_at IS NULL
        AND name_seed_hash(p_org, k.name) = nh
        AND NOT EXISTS (SELECT 1 FROM contact_identities a JOIN contact_identities b ON a.kind = b.kind AND a.value_hash = b.value_hash AND a.kind IN ('email', 'linkedin')
                        WHERE a.contact_id = k.id AND b.contact_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM contact_identities i JOIN suppression s ON s.scope_org_id = p_org AND s.value_hash = i.value_hash
                        WHERE i.contact_id = k.id AND i.kind IN ('email', 'linkedin'))
      RETURNING k.id
    )
    UPDATE enrollments SET state = 'stopped', stop_reason = 'name_hold', next_run_at = NULL
    WHERE org_id = p_org AND contact_id IN (SELECT id FROM held) AND state NOT IN ('stopped', 'converted', 'completed');
  END IF;
END $$;

-- The tenant-facing wrapper: the caller's own org and workspace only. A foreign or unknown contact raises, writing nothing.
CREATE FUNCTION suppress_person(p_contact uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_org() IS NULL OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'suppress_person: no tenant or bad reason' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact AND org_id = app_org() AND workspace_id = ANY (app_ws())) THEN
    RAISE EXCEPTION 'suppress_person: contact not in this workspace' USING ERRCODE = 'P0001';
  END IF;
  PERFORM _suppress_person(p_contact, app_org(), p_reason, true);
END $$;

-- record_identity: the one case a trigger cannot see (a paste with BOTH a profile and an address, where the thread's contact
-- and the address contact differ). LinkedIn only, caller's org and workspace only, the slug in its lower-case `in/<slug>` form.
CREATE FUNCTION record_identity(p_contact uuid, p_slug text, p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contacts%ROWTYPE;
BEGIN
  IF app_org() IS NULL OR p_slug IS NULL OR p_slug !~ '^in/[a-z0-9_%-]{2,100}$' OR p_source NOT IN ('paste', 'import') THEN
    RAISE EXCEPTION 'record_identity: refused' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM contacts WHERE id = p_contact AND org_id = app_org() AND workspace_id = ANY (app_ws());
  IF NOT FOUND THEN RAISE EXCEPTION 'record_identity: contact not in this workspace' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
  VALUES (c.org_id, c.workspace_id, c.id, 'linkedin', linkedin_hash(p_slug), p_source)
  ON CONFLICT DO NOTHING;
END $$;

-- ─── part 6: the name hold, its audited clear, and the rename block (design sections 7, 16, 17) ─────────────────────
-- BEFORE INSERT / UPDATE OF name, row-level. Overwrites the hold columns from its own computation on INSERT (a client cannot
-- insert a pre-cleared contact); on UPDATE keeps them. Holds a contact whose name hash is a seed of an opted-out person it shares
-- no identity with. A hold already set or cleared is never re-set. No live contact is read.
CREATE FUNCTION contacts_name_hold() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h text; own text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.hold_reason := NULL; NEW.hold_cleared_by := NULL; NEW.hold_cleared_at := NULL; NEW.hold_clear_reason := NULL;
  ELSE
    NEW.hold_reason := OLD.hold_reason; NEW.hold_cleared_by := OLD.hold_cleared_by;
    NEW.hold_cleared_at := OLD.hold_cleared_at; NEW.hold_clear_reason := OLD.hold_clear_reason;
    IF OLD.hold_reason IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  h := name_seed_hash(NEW.org_id, NEW.name);
  IF h IS NULL THEN RETURN NEW; END IF;
  own := ARRAY(SELECT value_hash(NEW.email) WHERE btrim(coalesce(NEW.email, '')) <> ''
               UNION SELECT value_hash(canon_phone(NEW.phone)) WHERE canon_phone(NEW.phone) IS NOT NULL
               UNION SELECT value_hash('linkedin:' || NEW.linkedin_slug) WHERE NEW.linkedin_slug IS NOT NULL
               UNION SELECT value_hash FROM contact_identities WHERE org_id = NEW.org_id AND contact_id = NEW.id);
  IF EXISTS (SELECT 1 FROM optout_name_seeds s WHERE s.org_id = NEW.org_id AND s.name_hash = h AND NOT (s.seed_value_hash = ANY (own))) THEN
    NEW.hold_reason := 'name_match:seed:' || substr(h, 1, 12);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contacts_b_name_hold BEFORE INSERT OR UPDATE OF name ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_name_hold();

-- The authorization for a hold clear and for an audited rename: an admin, or a member who holds both build and approve (the
-- operator role, permissions.mjs), whose membership covers the workspace. Enforced here as well as in the route.
CREATE FUNCTION can_resolve_hold(p_org uuid, p_ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = p_org AND m.user_id = app_user() AND m.role IN ('admin', 'operator')
                    AND (m.workspace_ids IS NULL OR p_ws = ANY (m.workspace_ids))) $$;

CREATE FUNCTION clear_name_hold(p_contact uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contacts%ROWTYPE;
BEGIN
  IF app_org() IS NULL OR app_user() IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'clear_name_hold: a reason of at least 10 characters and a signed-in user are required' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM contacts WHERE id = p_contact AND org_id = app_org() AND workspace_id = ANY (app_ws());
  IF NOT FOUND THEN RAISE EXCEPTION 'clear_name_hold: contact not in this workspace' USING ERRCODE = 'P0001'; END IF;
  IF NOT can_resolve_hold(c.org_id, c.workspace_id) THEN RAISE EXCEPTION 'clear_name_hold: not allowed' USING ERRCODE = '42501'; END IF;
  IF c.hold_reason IS NULL OR c.hold_cleared_at IS NOT NULL THEN
    RAISE EXCEPTION 'clear_name_hold: no active hold on this contact' USING ERRCODE = 'P0001';
  END IF;
  UPDATE contacts SET hold_cleared_by = app_user(), hold_cleared_at = now(), hold_clear_reason = btrim(p_reason) WHERE id = c.id;
  INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES (c.org_id, app_user()::text, 'clear_hold', 'contact', c.id::text);
END $$;

-- Whether a contact has a propagating (non-bounce) opt-out on any identity. The rename block asks it; the invoker trigger
-- cannot read suppression itself.
CREATE FUNCTION contact_opted_out(p_contact uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (
     SELECT 1 FROM contacts c JOIN suppression s ON s.scope_org_id = c.org_id AND s.reason <> 'bounce'
     WHERE c.id = p_contact AND (s.value_hash IN (SELECT value_hash FROM contact_identities i WHERE i.contact_id = c.id)
                                 OR s.value_hash IN (value_hash(c.email), value_hash(c.phone)))) $$;

-- The rename block. SECURITY INVOKER, so current_user is the real caller; the only role that passes is rename_owner, which
-- owns rename_opted_out_contact and nothing else. No GUC (a tenant can set one), no role an app role can SET ROLE into.
CREATE FUNCTION contacts_rename_block() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name AND current_user <> 'rename_owner' AND contact_opted_out(OLD.id) THEN
    RAISE EXCEPTION 'contact is opted out: a rename goes through the audited route' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contacts_c_rename_block BEFORE UPDATE OF name ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_rename_block();

CREATE FUNCTION rename_opted_out_contact(p_contact uuid, p_name text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contacts%ROWTYPE;
BEGIN
  IF app_org() IS NULL OR app_user() IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(p_reason) > 500
     OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'rename_opted_out_contact: a name, a reason of at least 10 characters and a signed-in user are required' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM contacts WHERE id = p_contact AND org_id = app_org() AND workspace_id = ANY (app_ws());
  IF NOT FOUND THEN RAISE EXCEPTION 'rename_opted_out_contact: contact not in this workspace' USING ERRCODE = 'P0001'; END IF;
  IF NOT can_resolve_hold(c.org_id, c.workspace_id) THEN RAISE EXCEPTION 'rename_opted_out_contact: not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE contacts SET name = btrim(p_name) WHERE id = c.id;
  INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id) VALUES (c.org_id, app_user()::text, 'rename_opted_out', 'contact', c.id::text);
END $$;

-- ─── part 7: person_suppressed, the guard, the reply-draft check, the sender hand-off (design section 5) ────────────
-- True when the person behind a contact must not be contacted on p_channel (NULL = every hit counts, as reply drafting does):
-- (a) any email/linkedin identity of the contact is suppressed (org or global), on every channel; (b) the contact's raw email,
-- raw phone or canonical phone hash is suppressed; (c) an uncleared name hold. A PHONE hit blocks every channel, unless the
-- check is for email and the line is only SHARED: the hash has at least one origin, this contact is not an origin of any
-- hash, and it is not in an origin's person. A row with no origin blocks every holder on every channel for good.
CREATE FUNCTION person_suppressed(p_contact uuid, p_channel text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c contacts%ROWTYPE; h text; shared boolean;
BEGIN
  SELECT * INTO c FROM contacts WHERE id = p_contact;
  IF NOT FOUND THEN RETURN false; END IF;
  IF c.hold_reason IS NOT NULL AND c.hold_cleared_at IS NULL THEN RETURN true; END IF;

  IF EXISTS (SELECT 1 FROM contact_identities i JOIN suppression s ON s.value_hash = i.value_hash
             AND (s.scope_org_id = c.org_id OR s.scope_org_id IS NULL)
             WHERE i.contact_id = c.id AND i.kind IN ('email', 'linkedin')) THEN RETURN true; END IF;
  IF btrim(coalesce(c.email, '')) <> '' AND EXISTS (SELECT 1 FROM suppression s WHERE s.value_hash = value_hash(c.email)
             AND (s.scope_org_id = c.org_id OR s.scope_org_id IS NULL)) THEN RETURN true; END IF;

  FOR h IN SELECT value_hash FROM contact_identities WHERE contact_id = c.id AND kind = 'phone'
           UNION SELECT value_hash(c.phone) WHERE btrim(coalesce(c.phone, '')) <> ''
           UNION SELECT value_hash(canon_phone(c.phone)) WHERE canon_phone(c.phone) IS NOT NULL LOOP
    IF EXISTS (SELECT 1 FROM suppression s WHERE s.value_hash = h AND (s.scope_org_id = c.org_id OR s.scope_org_id IS NULL)) THEN
      shared := coalesce(p_channel = 'email', false)   -- NULL channel must be false, not NULL: NOT NULL would skip the block
        AND EXISTS (SELECT 1 FROM suppression_origins o WHERE o.org_id = c.org_id AND o.value_hash = h)
        AND NOT EXISTS (SELECT 1 FROM suppression_origins o WHERE o.org_id = c.org_id AND o.origin_contact_id = c.id)
        AND NOT EXISTS (
          WITH RECURSIVE comp(contact_id) AS (
            SELECT c.id
            UNION
            SELECT b.contact_id FROM comp
              JOIN contact_identities a ON a.contact_id = comp.contact_id AND a.kind IN ('email', 'linkedin')
              JOIN contact_identities b ON b.org_id = c.org_id AND b.kind = a.kind AND b.value_hash = a.value_hash)
          SELECT 1 FROM suppression_origins o JOIN comp ON comp.contact_id = o.origin_contact_id
          WHERE o.org_id = c.org_id AND o.value_hash = h);
      IF NOT shared THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END $$;

-- The sender's last look before the provider call. It derives the contact and channel from the message itself (the sender
-- cannot name another id), looks the message up in the caller's org only, takes the org lock shared as its own FIRST
-- statement (so a later statement gets a fresh snapshot that sees an opt-out committed while it waited, hence VOLATILE), and
-- answers false for anything it cannot place: another org's message, an unknown id, no tenant.
CREATE FUNCTION message_handoff_ok(p_message uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := app_org(); v_contact uuid; v_channel text;
BEGIN
  IF v_org IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock_shared(org_lock_key(v_org));
  SELECT e.contact_id, m.channel INTO v_contact, v_channel
    FROM messages m JOIN drafts d ON d.id = m.draft_id JOIN enrollments e ON e.id = d.enrollment_id
   WHERE m.id = p_message AND m.org_id = v_org;
  IF v_contact IS NULL THEN RETURN false; END IF;
  RETURN NOT person_suppressed(v_contact, v_channel);
END $$;

GRANT SELECT ON messages TO guard_owner;
CREATE POLICY guard_all ON messages TO guard_owner USING (true) WITH CHECK (true);

-- ─── ownership and execute grants ────────────────────────────────────────────────────────────────────────────────
-- ACLs first, ownership last: once the function belongs to identity_owner the (non-superuser) migrator can no longer REVOKE or GRANT on it (0008a).
REVOKE EXECUTE ON FUNCTION name_seed_hash(uuid, text, boolean), org_salts_immutable(), _suppress_person(uuid, uuid, text, boolean),
  suppress_person(uuid, text), record_identity(uuid, text, text), contacts_name_hold(), can_resolve_hold(uuid, uuid),
  clear_name_hold(uuid, text), contact_opted_out(uuid), rename_opted_out_contact(uuid, text, text),
  person_suppressed(uuid, text), message_handoff_ok(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION name_seed_hash(uuid, text, boolean) TO identity_owner;
GRANT EXECUTE ON FUNCTION _suppress_person(uuid, uuid, text, boolean) TO identity_owner;
GRANT EXECUTE ON FUNCTION suppress_person(uuid, text), record_identity(uuid, text, text) TO inbox_svc;
GRANT EXECUTE ON FUNCTION clear_name_hold(uuid, text), rename_opted_out_contact(uuid, text, text) TO app_rw;
GRANT EXECUTE ON FUNCTION can_resolve_hold(uuid, uuid) TO identity_owner, rename_owner;
GRANT EXECUTE ON FUNCTION contact_opted_out(uuid) TO app_rw, rename_owner, ops;
GRANT EXECUTE ON FUNCTION person_suppressed(uuid, text) TO app_rw;
GRANT EXECUTE ON FUNCTION message_handoff_ok(uuid) TO sender_svc;
GRANT EXECUTE ON FUNCTION app_org(), app_ws(), app_user(), value_hash(text) TO guard_owner;
GRANT EXECUTE ON FUNCTION _suppress_person(uuid, uuid, text, boolean) TO unsub_owner;

ALTER FUNCTION name_seed_hash(uuid, text, boolean) OWNER TO identity_owner;
ALTER FUNCTION org_salts_immutable() OWNER TO identity_owner;
ALTER FUNCTION _suppress_person(uuid, uuid, text, boolean) OWNER TO identity_owner;
ALTER FUNCTION suppress_person(uuid, text) OWNER TO identity_owner;
ALTER FUNCTION record_identity(uuid, text, text) OWNER TO identity_owner;
ALTER FUNCTION contacts_name_hold() OWNER TO identity_owner;
ALTER FUNCTION can_resolve_hold(uuid, uuid) OWNER TO identity_owner;
ALTER FUNCTION clear_name_hold(uuid, text) OWNER TO identity_owner;
ALTER FUNCTION contact_opted_out(uuid) OWNER TO guard_owner;
ALTER FUNCTION rename_opted_out_contact(uuid, text, text) OWNER TO rename_owner;
ALTER FUNCTION person_suppressed(uuid, text) OWNER TO guard_owner;
ALTER FUNCTION message_handoff_ok(uuid) OWNER TO guard_owner;

-- rename_owner owns only rename_opted_out_contact: the name column, the membership check, the audit row.
GRANT USAGE ON SCHEMA public TO rename_owner, guard_owner;
GRANT SELECT ON contacts, memberships TO rename_owner;
GRANT UPDATE (name) ON contacts TO rename_owner;
GRANT INSERT ON audit_log TO rename_owner;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO rename_owner;
CREATE POLICY rename_all ON contacts TO rename_owner USING (org_id = app_org()) WITH CHECK (org_id = app_org());
CREATE POLICY rename_all ON memberships FOR SELECT TO rename_owner USING (org_id = app_org());
CREATE POLICY rename_all ON audit_log FOR INSERT TO rename_owner WITH CHECK (org_id = app_org());
-- identity_owner's functions read memberships; the audit rows are written under its policy.

-- ─── part 8: send_guard, app_contact_suppressed and unsubscribe() learn the person (design sections 5, 6) ─────────
-- send_guard is guard_owner's and only its owner may replace it, so, as in 0019, this acts as that role (CREATE OR REPLACE
-- keeps owner and ACL). The text is 0019's with three additions, each marked: the org lock (shared) and the isolation check
-- as the first statements, and the person check before the channel branch. The email branch's own address check stays.
GRANT EXECUTE ON FUNCTION org_lock_key(uuid) TO guard_owner, unsub_owner;
SET ROLE guard_owner;

CREATE OR REPLACE FUNCTION send_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d  drafts%ROWTYPE;
  e  enrollments%ROWTYPE;
  c  contacts%ROWTYPE;
  w  workspaces%ROWTYPE;
  mb mailboxes%ROWTYPE;
  n  int;
BEGIN
  -- (0020) An opt-out in flight holds this lock exclusively until it commits, so this insert waits for it and then reads a
  -- fresh snapshot. A snapshot taken before the lock would miss it, so only READ COMMITTED is accepted.
  PERFORM pg_advisory_xact_lock_shared(org_lock_key(NEW.org_id));
  PERFORM pg_advisory_xact_lock_shared(org_lock_key(NULL));
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'send_guard: sends need a READ COMMITTED transaction' USING ERRCODE = 'P0001';
  END IF;

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

  -- (0020) The person, not the address: any identity of this contact opted out, or an uncleared name hold, on any channel.
  IF person_suppressed(c.id, NEW.channel) THEN
    RAISE EXCEPTION 'send_guard: contact suppressed' USING ERRCODE = 'P0001';
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
  ELSE
    -- Fail closed (SPEC S5, S13). 'sms' and 'linkedin_assist' have no send path yet, and the checks they will need
    -- (caps, suppression, restriction breakers) are not written. Whoever builds a channel adds its branch above and
    -- a test that sabotages each check, in the same migration that lets it through.
    RAISE EXCEPTION 'send_guard: channel % has no send path', d.channel USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

-- 0017's reply-drafting check now asks the same question as the guard, over every channel, for a contact in the caller's org.
CREATE OR REPLACE FUNCTION app_contact_suppressed(p_contact uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM contacts c WHERE c.id = p_contact AND c.org_id = app_org()) AND person_suppressed(p_contact, NULL) $$;

RESET ROLE;

-- unsubscribe(): the recipient's token now opts out the person. The org came from the token, never from a caller.
GRANT CREATE ON SCHEMA public TO unsub_owner;
SET ROLE unsub_owner;

CREATE OR REPLACE FUNCTION unsubscribe(p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t unsubscribe_tokens%ROWTYPE; c contacts%ROWTYPE;
BEGIN
  SELECT * INTO t FROM unsubscribe_tokens
    WHERE token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO c FROM contacts WHERE id = t.contact_id AND org_id = t.org_id;

  IF (t.channel = 'email' AND c.email IS NOT NULL) OR (t.channel = 'sms' AND c.phone IS NOT NULL) THEN
    PERFORM _suppress_person(c.id, t.org_id, 'unsubscribe', true);
  END IF;

  UPDATE unsubscribe_tokens SET used_at = coalesce(used_at, now()) WHERE token_hash = t.token_hash;
  INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id)
    VALUES (t.org_id, 'recipient', 'unsubscribe', 'contact', t.contact_id::text);
  RETURN true;
END $$;

RESET ROLE;

-- ─── part 9: backfill (design section 15) ────────────────────────────────────────────────────────────────────────
-- One definer function owned by identity_owner, run once and dropped. It reads inbound_messages, which identity_owner has
-- not needed until now.
GRANT SELECT ON inbound_messages TO identity_owner;
CREATE POLICY identity_all ON inbound_messages TO identity_owner USING (true) WITH CHECK (true);

CREATE FUNCTION _backfill_0020() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; bad int := 0;
BEGIN
  -- A legacy profile thread key that cannot be canonicalised would abort the fill trigger later; name them now instead.
  FOR r IN SELECT thread_key FROM conversations WHERE channel = 'linkedin' AND contact_id IS NOT NULL AND thread_key LIKE 'profile:in/%' LOOP
    BEGIN
      PERFORM canon_linkedin_slug(r.thread_key);
    EXCEPTION WHEN SQLSTATE '22023' THEN bad := bad + 1;
    END;
  END LOOP;
  IF bad > 0 THEN
    RAISE EXCEPTION '0020 backfill: % linkedin profile thread key(s) fail canon_linkedin_slug; fix or close them first', bad;
  END IF;

  INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
  SELECT org_id, workspace_id, id, 'email', value_hash(email), 'contact' FROM contacts WHERE btrim(coalesce(email, '')) <> ''
  ON CONFLICT DO NOTHING;
  INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
  SELECT org_id, workspace_id, id, 'phone', value_hash(canon_phone(phone)), 'contact' FROM contacts WHERE canon_phone(phone) IS NOT NULL
  ON CONFLICT DO NOTHING;
  INSERT INTO contact_identities (org_id, workspace_id, contact_id, kind, value_hash, source)
  SELECT org_id, workspace_id, contact_id, 'linkedin', linkedin_hash(thread_key), 'profile_thread'
  FROM conversations WHERE channel = 'linkedin' AND contact_id IS NOT NULL AND thread_key LIKE 'profile:in/%'
  ON CONFLICT DO NOTHING;

  -- Phone rows were hashed over the raw text; the canonical form is the new key. No origin: a legacy line blocks every holder.
  INSERT INTO suppression (scope_org_id, value_hash, kind, reason)
  SELECT DISTINCT s.scope_org_id, value_hash(canon_phone(c.phone)), 'phone', s.reason
  FROM contacts c JOIN suppression s ON s.kind = 'phone' AND s.value_hash = value_hash(c.phone)
                                    AND (s.scope_org_id IS NULL OR s.scope_org_id = c.org_id)
  WHERE canon_phone(c.phone) IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Opt-outs that only ever lived in a message or a stop reason (a LinkedIn or form reply): make them real.
  FOR r IN SELECT i.org_id, i.contact_id FROM inbound_messages i
            WHERE i.contact_id IS NOT NULL AND i.channel IN ('linkedin', 'form') AND i.intent = 'unsubscribe'
           UNION
           SELECT e.org_id, e.contact_id FROM enrollments e WHERE e.stop_reason = 'linkedin:unsubscribe' LOOP
    PERFORM _suppress_person(r.contact_id, r.org_id, 'backfill', false);
  END LOOP;

  -- Close every person who has a propagating opt-out on an email or profile identity, once per org.
  FOR r IN SELECT i.org_id, array_agg(DISTINCT i.contact_id) AS cs
             FROM contact_identities i JOIN suppression s ON s.scope_org_id = i.org_id AND s.value_hash = i.value_hash AND s.reason <> 'bounce'
            WHERE i.kind IN ('email', 'linkedin') GROUP BY i.org_id LOOP
    PERFORM close_component(r.org_id, r.cs, NULL, false);
  END LOOP;
END $$;
ALTER FUNCTION _backfill_0020() OWNER TO identity_owner;
SELECT _backfill_0020();
DROP FUNCTION _backfill_0020();

-- ─── part 10: advisory locks are not for tenants, and the schema lends end here ─────────────────────────────────────
-- The org lock only means something if no application role can take it. Every acquiring form is revoked from PUBLIC and
-- granted to the definers that use it and to the migrator (migrate-cli takes its own lock).
DO $$
DECLARE f record; owners text;
BEGIN
  -- Every role that owns a definer function today may take the lock (0013's app_email_verified does); no application role does.
  SELECT string_agg(DISTINCT quote_ident(r.rolname), ', ') INTO owners
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public' AND p.prosecdef;
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'pg_catalog' AND p.proname ~ '^pg_(try_)?advisory_(xact_)?lock(_shared)?$' LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO identity_owner, guard_owner, unsub_owner, rename_owner, %s, %I', f.sig, owners, current_user);
  END LOOP;
END $$;

REVOKE CREATE ON SCHEMA public FROM identity_owner, rename_owner, guard_owner, unsub_owner;
