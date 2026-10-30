-- Agency deals (Christian 2026-10-30): deals can close at level 4 (Agency). The level check moves from (1,2,3) to (1,2,3,4).
-- SQLite cannot ALTER a CHECK; the table is rebuilt.
CREATE TABLE deals_new (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  rep_email       TEXT NOT NULL REFERENCES reps(email),
  level           INTEGER NOT NULL CHECK (level IN (1, 2, 3, 4)),
  price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
  price_is_draft  INTEGER NOT NULL CHECK (price_is_draft IN (0, 1)),
  notes           TEXT NOT NULL DEFAULT '',
  closed_at       TEXT NOT NULL,
  mix             TEXT
);
INSERT INTO deals_new (id, account_id, rep_email, level, price_cents, price_is_draft, notes, closed_at, mix)
  SELECT id, account_id, rep_email, level, price_cents, price_is_draft, notes, closed_at, mix FROM deals;
DROP TABLE deals;
ALTER TABLE deals_new RENAME TO deals;
