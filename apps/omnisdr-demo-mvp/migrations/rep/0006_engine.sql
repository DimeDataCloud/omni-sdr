-- Admin Lead Engine: sweep and scan jobs, and the leads they stage. Staged leads are never accounts until an admin adds them.
-- Sweeps run on GitHub Actions (private engine repo) and POST their results to /engine/ingest with a shared secret.
CREATE TABLE engine_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('sweep', 'scan')),
  zip TEXT,
  niche TEXT,
  url TEXT,
  cap INTEGER NOT NULL DEFAULT 25,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  summary TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX engine_jobs_created ON engine_jobs (created_at);

CREATE TABLE engine_results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES engine_jobs (id),
  phone TEXT NOT NULL,
  lead TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'staged' CHECK (state IN ('staged', 'added', 'dismissed')),
  account_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (job_id, phone)
);
CREATE INDEX engine_results_job ON engine_results (job_id, state);
