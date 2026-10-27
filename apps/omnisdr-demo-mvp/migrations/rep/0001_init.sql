-- Rep sales portal store (D1 omnisdr-rep). Design: omnisdr-pivot/DESIGN-rep-portal.md.
-- One account per business, prospect to live. Every write lands in audit. Times are ISO-8601 UTC text.

CREATE TABLE reps (
  email       TEXT PRIMARY KEY,                       -- lower-cased, the Access identity
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'rep' CHECK (role IN ('rep', 'admin')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL
);

CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  owner_email     TEXT NOT NULL REFERENCES reps(email),
  business        TEXT NOT NULL,
  niche           TEXT NOT NULL DEFAULT '',
  website         TEXT, phone TEXT, email TEXT,
  address         TEXT, city TEXT, state TEXT, zip TEXT,
  signal          TEXT NOT NULL DEFAULT '',             -- why this business is worth a call
  stage           TEXT NOT NULL DEFAULT 'new'
                  CHECK (stage IN ('new','contacted','audit_run','results_call','proposed','signed','onboarding','live','lost')),
  next_step       TEXT NOT NULL DEFAULT '',
  next_action_at  TEXT,
  last_touch_at   TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',       -- manual, csv, referral
  notes           TEXT NOT NULL DEFAULT '',
  onboarding      TEXT NOT NULL DEFAULT '{}',           -- JSON: hours, services, lead sources, booking link, handoff level, A2P details
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX accounts_owner_stage ON accounts(owner_email, stage);
CREATE INDEX accounts_next_action ON accounts(next_action_at);

CREATE TABLE contacts (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  phone       TEXT, email TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at  TEXT NOT NULL
);
CREATE INDEX contacts_account ON contacts(account_id);

-- Call Room log (DimeData CRM crm_calls). History survives an archived account.
CREATE TABLE calls (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  rep_email    TEXT NOT NULL REFERENCES reps(email),
  outcome      TEXT NOT NULL
               CHECK (outcome IN ('no_answer','voicemail','callback_scheduled','interested','not_interested','text_sent','email_sent')),
  note         TEXT NOT NULL DEFAULT '',
  callback_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX calls_rep_day ON calls(rep_email, created_at);
CREATE INDEX calls_account ON calls(account_id);

CREATE TABLE activities (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rep_email   TEXT REFERENCES reps(email),              -- null for rule-made entries
  kind        TEXT NOT NULL CHECK (kind IN ('note','call','email','text','demo','stage','import','deal')),
  body        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX activities_account ON activities(account_id, created_at);

-- Follow-ups, callbacks, demos. auto_key makes a rule idempotent: one open task per (rule, account).
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  rep_email   TEXT NOT NULL REFERENCES reps(email),
  kind        TEXT NOT NULL DEFAULT 'follow_up' CHECK (kind IN ('follow_up','callback','demo','onboarding')),
  title       TEXT NOT NULL,
  due_at      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  auto_key    TEXT,
  created_at  TEXT NOT NULL,
  done_at     TEXT
);
CREATE UNIQUE INDEX tasks_auto_open ON tasks(auto_key) WHERE auto_key IS NOT NULL AND status = 'open';
CREATE INDEX tasks_rep_due ON tasks(rep_email, status, due_at);

CREATE TABLE deals (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  rep_email       TEXT NOT NULL REFERENCES reps(email),
  level           INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
  price_is_draft  INTEGER NOT NULL CHECK (price_is_draft IN (0, 1)),
  notes           TEXT NOT NULL DEFAULT '',
  closed_at       TEXT NOT NULL
);

-- Append-only. No route updates or deletes rows here.
CREATE TABLE audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT NOT NULL,                            -- rep email, or 'rule:<name>'
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  before      TEXT,
  after       TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX audit_entity ON audit(entity, entity_id);
