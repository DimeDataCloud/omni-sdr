-- 0028: the default first-response window is 2 minutes (Christian), was 5 in 0022.
-- Pre-pilot there are no real workspaces, so every row still at 5 is a default, not a choice: move them with the default.
-- A workspace that was given any other window keeps it. Nothing else changes: the column's CHECK (1 to 1440), ttft_by_source
-- and the grants are untouched. Nothing here sends. The send lock is unchanged.

ALTER TABLE workspaces ALTER COLUMN response_window_minutes SET DEFAULT 2;
UPDATE workspaces SET response_window_minutes = 2 WHERE response_window_minutes = 5;
