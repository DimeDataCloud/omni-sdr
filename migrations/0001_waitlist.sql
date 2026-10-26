-- Waitlist signups for omnisdr.com. Written only by functions/api/waitlist.ts (binding WAITLIST_DB); there is no read route.
-- One row per lowercased email, so a repeat signup is a no-op that returns the same access code.
CREATE TABLE IF NOT EXISTS waitlist (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  account_type TEXT    NOT NULL DEFAULT 'owner' CHECK (account_type IN ('owner', 'agency')),
  company      TEXT,
  phone        TEXT,
  location     TEXT,
  access_code  TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'omnisdr.com',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
