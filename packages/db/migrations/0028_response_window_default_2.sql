-- 0028: the default first-response window is 2 minutes (Christian), was 5 in 0022.
-- Pre-pilot there are no real workspaces, so every row still at 5 is a default, not a choice: move them with the default.
-- A workspace that was given any other window keeps it. Nothing else changes: the column's CHECK (1 to 1440), ttft_by_source
-- and the grants are untouched. Nothing here sends. The send lock is unchanged.
--
-- workspaces is FORCE ROW LEVEL SECURITY and its only policy is the tenant one, so a migrator that owns the table but has neither
-- SUPERUSER nor BYPASSRLS would match ZERO rows in the UPDATE and still change the default, silently (V-29 P3-1). row_security = off
-- turns that into an error ("query would be affected by row-level security policy") for such a role, and is a no-op for one that bypasses
-- RLS; then the check at the end proves no row is left at 5. Either the backfill ran or the migration fails and rolls back.
SET LOCAL row_security = off;

ALTER TABLE workspaces ALTER COLUMN response_window_minutes SET DEFAULT 2;
UPDATE workspaces SET response_window_minutes = 2 WHERE response_window_minutes = 5;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM workspaces WHERE response_window_minutes = 5;
  IF n <> 0 THEN
    RAISE EXCEPTION '0028: % workspace(s) are still at a 5 minute window after the backfill', n;
  END IF;
END $$;
