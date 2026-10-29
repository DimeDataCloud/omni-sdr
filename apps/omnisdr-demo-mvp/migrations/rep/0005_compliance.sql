-- Calling compliance: per-number line type and DNC scrub date, an internal do-not-call flag kept apart from "not a fit".
-- Unknown line type is treated as wireless: such a number is dialable only with a scrub under 31 days old.
ALTER TABLE accounts ADD COLUMN line_type TEXT NOT NULL DEFAULT 'unknown' CHECK (line_type IN ('landline', 'wireless', 'voip', 'unknown'));
ALTER TABLE accounts ADD COLUMN scrubbed_at TEXT;
ALTER TABLE accounts ADD COLUMN dnc INTEGER NOT NULL DEFAULT 0 CHECK (dnc IN (0, 1));
ALTER TABLE accounts ADD COLUMN dnc_at TEXT;
ALTER TABLE accounts ADD COLUMN flag TEXT NOT NULL DEFAULT '' CHECK (flag IN ('', 'closed', 'already_covered', 'not_fit'));
ALTER TABLE accounts ADD COLUMN flag_at TEXT;
