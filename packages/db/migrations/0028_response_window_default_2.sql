-- 0028: the default first-response window is 2 minutes (Christian), was 5 in 0022.
-- Pre-pilot there are no real workspaces, so every row still at 5 is a default, not a choice: move them with the default.
-- A workspace that was given any other window keeps it. Nothing else changes: the column's CHECK (1 to 1440), ttft_by_source
-- and the grants are untouched. Nothing here sends. The send lock is unchanged.
--
-- workspaces is FORCE ROW LEVEL SECURITY and its tenant policy admits nothing without a tenant context, so a migrator that owns the table
-- but has neither SUPERUSER nor BYPASSRLS (the Neon shape) would match ZERO rows in the UPDATE and still change the default, silently
-- (V-29 P3-1). So the backfill and its check run as `ops`, which has an explicit USING (true) policy on every RLS table (0001 ops_all) and
-- GRANT ALL on them, and see every row. A migrator that cannot SET ROLE ops fails here, loudly, and the migration rolls back; the check
-- raises if any workspace is still at 5.
ALTER TABLE workspaces ALTER COLUMN response_window_minutes SET DEFAULT 2;

DO $$
BEGIN
  EXECUTE 'SET LOCAL ROLE ops';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '0028: the migration login must be a member of ops (able to SET ROLE ops) to backfill workspaces under row level security; grant it and rerun'
    USING ERRCODE = 'insufficient_privilege';
END $$;
UPDATE workspaces SET response_window_minutes = 2 WHERE response_window_minutes = 5;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM workspaces WHERE response_window_minutes = 5;
  IF n <> 0 THEN
    RAISE EXCEPTION '0028: % workspace(s) are still at a 5 minute window after the backfill', n;
  END IF;
END $$;
RESET ROLE;
