-- Order Forms (Christian 2026-10-29, via Halo): the guided deal flow saves one record per account deal, numbered by the
-- portal in order with no gaps. A number is taken when the draft is created and never reused: a dropped draft is voided,
-- never deleted. `data` is JSON keyed by src/rep/orderform.js SECTIONS (package, client, services, term, signing).
CREATE TABLE order_forms (
  id              TEXT PRIMARY KEY,
  number          INTEGER NOT NULL UNIQUE,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  owner_email     TEXT NOT NULL REFERENCES reps(email),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'client_review', 'filed', 'void')),
  data            TEXT NOT NULL DEFAULT '{}',
  signed_at       TEXT,                                 -- the signing date written on the form (YYYY-MM-DD)
  filed_location  TEXT,                                 -- where the signed copy is kept; no e-signature here
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX order_forms_account ON order_forms(account_id, created_at);

-- The next Order Form number. One row; bumped in the same batch as the insert that takes it.
CREATE TABLE order_form_counter (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  next  INTEGER NOT NULL
);
INSERT INTO order_form_counter (id, next) VALUES (1, 1);

-- Client fill-in links: one-time, unguessable, expiring (7 days), revocable. Only the SHA-256 of the token is stored, so a
-- database read cannot rebuild a link. A client's answers wait in `submission` until the rep accepts or rejects them.
CREATE TABLE client_links (
  token_hash      TEXT PRIMARY KEY,
  order_form_id   TEXT NOT NULL REFERENCES order_forms(id),
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  submitted_at    TEXT,
  submission      TEXT,
  reviewed_at     TEXT,
  hits            INTEGER NOT NULL DEFAULT 0,
  posts           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX client_links_form ON client_links(order_form_id);

-- Requests to the public fill-in page per visitor per day (key = hashed IP + date), for its rate limit.
CREATE TABLE public_hits (
  key  TEXT PRIMARY KEY,
  n    INTEGER NOT NULL DEFAULT 0
);
