-- Omni-SDR 0009: text generation (SPEC §1 acceptance step 6; Stations 7, 12, 24).
-- 1. Credits for the app, tenant-bound. credit_reserve/credit_release (0001) take an org id and are ops-only; granting
--    them to app_rw would let any tenant spend or refund another org's balance. These wrappers take the org from the
--    session (app_org()), cap one call, and only ever touch the caller's own org. The ledger rules stay in 0001's
--    functions: balance >= 0 (overspend refused atomically) and a release never exceeds what the job still holds.
-- 2. Where a generated draft came from: model, tier, prompt id and the sha of the prompt text (SPEC §10: the prompt
--    hash is stored on every output). Provenance only: the gate still decides what can be approved.

CREATE FUNCTION app_credit_reserve(p_meter text, p_amount bigint, p_ref_type text, p_ref_id text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_org() IS NULL THEN RAISE EXCEPTION 'no tenant' USING ERRCODE = 'P0001'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000 THEN RAISE EXCEPTION 'reserve amount must be 1..10000' USING ERRCODE = 'P0001'; END IF;
  IF p_ref_type IS NULL OR p_ref_type !~ '^[a-z_]{1,40}$' OR p_ref_id IS NULL OR length(p_ref_id) > 200 THEN
    RAISE EXCEPTION 'reserve needs a job reference' USING ERRCODE = 'P0001';
  END IF;
  RETURN credit_reserve(app_org(), p_meter, p_amount, p_ref_type, p_ref_id);
END $$;

CREATE FUNCTION app_credit_release(p_meter text, p_amount bigint, p_ref_type text, p_ref_id text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_org() IS NULL THEN RAISE EXCEPTION 'no tenant' USING ERRCODE = 'P0001'; END IF;
  RETURN credit_release(app_org(), p_meter, p_amount, p_ref_type, p_ref_id);
END $$;

GRANT CREATE ON SCHEMA public TO ledger_owner;  -- PG15+: a new owner needs CREATE on the schema (no superuser on Cloud SQL)
ALTER FUNCTION app_credit_reserve(text, bigint, text, text) OWNER TO ledger_owner;
ALTER FUNCTION app_credit_release(text, bigint, text, text) OWNER TO ledger_owner;
REVOKE CREATE ON SCHEMA public FROM ledger_owner;
REVOKE EXECUTE ON FUNCTION app_credit_reserve(text, bigint, text, text), app_credit_release(text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_credit_reserve(text, bigint, text, text), app_credit_release(text, bigint, text, text) TO app_rw;
-- ledger_owner calls app_org() inside the wrapper.
GRANT EXECUTE ON FUNCTION app_org() TO ledger_owner;

ALTER TABLE drafts ADD COLUMN generated jsonb
  CHECK (generated IS NULL OR (jsonb_typeof(generated) = 'object' AND length(generated::text) <= 2000));
GRANT INSERT (generated) ON drafts TO app_rw;
