-- Omni-SDR 0013: email verification (DECISIONS 2026-09-28 "Email verification: free checks + vendor verification as a
-- customer-paid credit": `email_status = 'valid'` needs a vendor pass; the send guard (0001) refuses anything else).
--
-- Until now any app_rw statement could write 'valid' (table-level UPDATE on contacts), so the guard trusted a value the
-- database didn't protect. From here:
--   * 'valid' is written only by app_email_verified(), a narrow definer function, one verdict per Data credit its job
--     still holds in this org (the customer paid for each check), and only for the address the contact still has;
--   * every vendor answer is kept, insert-only, in email_verifications;
--   * changing a contact's address takes 'valid' away (a new address hasn't been checked).
-- Free checks (syntax, MX, disposable) may still mark an address 'invalid' or leave it 'unknown'; they cost nothing.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verify_owner') THEN CREATE ROLE verify_owner NOLOGIN; END IF;
END $$;

CREATE TABLE email_verifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  contact_id    uuid NOT NULL,
  email         text NOT NULL CHECK (length(email) <= 254),
  verdict       text NOT NULL CHECK (verdict IN ('valid', 'invalid', 'risky', 'unknown')),
  vendor        text NOT NULL CHECK (vendor ~ '^[a-z0-9_-]{1,40}$'),
  job           text NOT NULL CHECK (length(job) BETWEEN 1 AND 100),
  checked_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id) ON DELETE CASCADE,
  UNIQUE (org_id, workspace_id, id)
);
CREATE INDEX email_verifications_contact ON email_verifications (contact_id, checked_at DESC);
ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON email_verifications USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()));
CREATE POLICY ops_all ON email_verifications TO ops USING (true) WITH CHECK (true);
GRANT ALL ON email_verifications TO ops;
GRANT SELECT ON email_verifications TO app_rw;   -- read only: rows come from app_email_verified()

-- The check that holds a contact right now, so a second press doesn't pay for the same address twice (#47 audit P2-2
-- pattern). Cleared when the check ends; a claim older than its lease (a crashed run) may be taken over.
ALTER TABLE contacts ADD COLUMN verify_job uuid;
ALTER TABLE contacts ADD COLUMN verify_at timestamptz;
ALTER TABLE contacts ADD CONSTRAINT contacts_verify_claim CHECK ((verify_job IS NULL) = (verify_at IS NULL));

-- ─── who may write 'valid' ──────────────────────────────────────────────────────────────────────────────────────
-- current_user inside app_email_verified() is verify_owner. ops (support) and a superuser (tests, the demo seed) may
-- too. Everyone else gets 'valid' refused, and an address change drops a 'valid' it carried.
CREATE FUNCTION contacts_email_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('verify_owner', 'ops') OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.email IS DISTINCT FROM OLD.email AND NEW.email_status = 'valid' AND OLD.email_status = 'valid' THEN
    NEW.email_status := 'unknown';
  END IF;
  IF NEW.email_status = 'valid' AND (TG_OP = 'INSERT' OR OLD.email_status IS DISTINCT FROM 'valid') THEN
    RAISE EXCEPTION 'email_status valid needs a vendor verification' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contacts_email_status_guard BEFORE INSERT OR UPDATE OF email, email_status ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_email_status_guard();

CREATE FUNCTION app_email_verified(p_contact uuid, p_email text, p_verdict text, p_vendor text, p_job text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; held bigint; used bigint;
BEGIN
  IF app_org() IS NULL THEN RAISE EXCEPTION 'no tenant' USING ERRCODE = 'P0001'; END IF;
  IF p_verdict NOT IN ('valid', 'invalid', 'risky', 'unknown') THEN RAISE EXCEPTION 'bad verdict' USING ERRCODE = 'P0001'; END IF;
  -- The customer paid for this check: one verdict per Data credit the job still holds (reserved minus released), so
  -- a refunded job writes nothing and a job can't write more verdicts than it paid for (#59 audit P2-1). The lock
  -- makes two calls for one job count in turn.
  PERFORM pg_advisory_xact_lock(hashtext('email_verify:' || p_job));
  SELECT coalesce(-sum(delta), 0) INTO held FROM credit_ledger WHERE org_id = app_org() AND meter = 'data'
    AND ref_type = 'email_verify' AND ref_id = p_job AND kind IN ('reserve', 'release');
  SELECT count(*) INTO used FROM email_verifications WHERE org_id = app_org() AND job = p_job;
  IF held <= used THEN
    RAISE EXCEPTION 'verification needs a data credit reservation for its job (held %, used %)', held, used USING ERRCODE = 'P0001';
  END IF;
  -- RLS (tenant policy) decides which contacts are visible: only this org's, in this request's workspaces.
  SELECT id, org_id, workspace_id, email INTO c FROM contacts WHERE id = p_contact FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact not found' USING ERRCODE = 'P0001'; END IF;
  -- The verdict is for the address that was checked: if it changed meanwhile, it isn't this contact's verdict.
  IF c.email IS DISTINCT FROM lower(btrim(p_email)) THEN RAISE EXCEPTION 'the address changed since it was checked' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO email_verifications (org_id, workspace_id, contact_id, email, verdict, vendor, job)
    VALUES (c.org_id, c.workspace_id, c.id, c.email, p_verdict, p_vendor, p_job);
  UPDATE contacts SET email_status = p_verdict WHERE id = c.id;
  RETURN p_verdict;
END $$;

GRANT SELECT (id, org_id, workspace_id, email, email_status), UPDATE (email_status) ON contacts TO verify_owner;
GRANT SELECT, INSERT ON email_verifications TO verify_owner;
GRANT SELECT (org_id, meter, delta, ref_type, ref_id, kind) ON credit_ledger TO verify_owner;
CREATE POLICY verify_read ON credit_ledger TO verify_owner USING (org_id = app_org());
GRANT EXECUTE ON FUNCTION app_org(), app_ws() TO verify_owner;
-- Grants before the owner change (0008a: after it, the migration role is no longer the grantor and they'd be no-ops).
REVOKE EXECUTE ON FUNCTION app_email_verified(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_email_verified(uuid, text, text, text, text) TO app_rw;
GRANT CREATE ON SCHEMA public TO verify_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION app_email_verified(uuid, text, text, text, text) OWNER TO verify_owner;
REVOKE CREATE ON SCHEMA public FROM verify_owner;
