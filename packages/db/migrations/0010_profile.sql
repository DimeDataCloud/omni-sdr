-- Omni-SDR 0010: what the composer has learned about the business (SPEC §1 acceptance step 2; Station 06/07).
-- Onboarding asks one question at a time and every question can be skipped (DECISIONS 2026-09-28: the minimum
-- required input is nothing). Answers live here, one row per workspace; a skip is recorded so the composer doesn't
-- ask again, and anything generated while an answer is missing says so. The customer's postal address stays on
-- workspaces (0004), admin-only.
CREATE TABLE workspace_profiles (
  org_id        uuid NOT NULL,
  workspace_id  uuid PRIMARY KEY,
  website       text CHECK (website IS NULL OR (website ~ '^https://[^[:space:]]+$' AND length(website) <= 300)),
  offer         text CHECK (offer IS NULL OR length(btrim(offer)) BETWEEN 3 AND 2000),
  voice_sample  text CHECK (voice_sample IS NULL OR length(btrim(voice_sample)) BETWEEN 3 AND 4000),
  skipped       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(skipped) <= 16),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES users(id),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id)
);
ALTER TABLE workspace_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON workspace_profiles USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()));
CREATE POLICY ops_all ON workspace_profiles TO ops USING (true) WITH CHECK (true);
GRANT ALL ON workspace_profiles TO ops;
GRANT SELECT, INSERT ON workspace_profiles TO app_rw;
GRANT UPDATE (website, offer, voice_sample, skipped, updated_at, updated_by) ON workspace_profiles TO app_rw;
