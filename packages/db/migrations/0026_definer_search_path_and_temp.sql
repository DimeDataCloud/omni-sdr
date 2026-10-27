-- 0026: a temp table cannot shadow a definer's lookup. From the V audit of #131 (P3-1).
--
-- Every SECURITY DEFINER function here was created with `SET search_path = public`. Postgres searches pg_temp FIRST for
-- relations unless pg_temp is named in the path, so a role that may create temp tables could `CREATE TEMP TABLE messages (...)`
-- and the definer would read the caller's fake table instead of the real one. The verifier's repro: inbox_svc shadowing
-- `messages` made record_first_touch answer 'recorded' for a claimed (unsent) message.
--
-- Two fixes, both here:
--  1. Every SECURITY DEFINER function gets `SET search_path = public, pg_temp`: pg_temp last, so public always wins (pg_temp is
--     never searched for functions and operators unless named). Each function is altered by its owner, as in 0019 to 0025.
--  2. TEMP is revoked on the database from PUBLIC and from every service role, so a tenant-facing role cannot create a temp
--     table at all. (Defense in depth: 1 alone already stops the shadowing.)
-- Future SECURITY DEFINER functions must say `SET search_path = public, pg_temp`; a catalog test fails the build for any that do not.
--
-- NOT a first touch: a message in state 'handed_off' (0024 accepts only 'sent' and 'confirmed'). Stated here because 0024 is
-- applied and is not edited; the behavior is tested in lead-events.test.mjs (S2L-2a).

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS fn, pg_get_userbyid(p.proowner) AS owner
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosecdef
            ORDER BY p.oid::regprocedure::text
  LOOP
    EXECUTE format('SET ROLE %I', r.owner);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.fn);
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;

DO $$
DECLARE r text;
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  FOREACH r IN ARRAY ARRAY['app_rw', 'gate_svc', 'inbox_svc', 'sender_svc', 'ops', 'guard_owner', 'identity_owner', 'inbox_owner',
                           'lead_owner', 'ledger_owner', 'rename_owner', 'sender_owner', 'tenancy_owner', 'unsub_owner', 'verify_owner']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), r);
    END IF;
  END LOOP;
END $$;
