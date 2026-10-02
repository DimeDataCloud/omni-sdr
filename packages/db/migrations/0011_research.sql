-- Omni-SDR 0011: competitor research (SPEC §1 acceptance step 4; Station 10; DECISIONS 2026-09-28 "Competitor
-- discovery: Gemini with Google Search grounding": every suggestion shows a reason and needs the user's confirm
-- before research spends credits).
-- Snapshots and battlecards are insert-only, like evidence (S8): a re-run writes a new snapshot and the next
-- battlecard version, so "what changed" is a diff of versions. Every battlecard statement cites a snapshot
-- (the Station 10 guardrail; enforced in the API, which drops a statement whose quote isn't in its snapshot).

CREATE TABLE competitors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  domain        text NOT NULL CHECK (domain ~ '^[a-z0-9.-]+\.[a-z]{2,63}$' AND length(domain) <= 253),
  status        text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested', 'confirmed', 'dismissed')),
  source        text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'suggested')),
  reason        text CHECK (reason IS NULL OR length(reason) <= 500),
  suggested_sources jsonb CHECK (suggested_sources IS NULL OR (jsonb_typeof(suggested_sources) = 'array' AND jsonb_array_length(suggested_sources) <= 10)),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  UNIQUE (workspace_id, domain),
  UNIQUE (org_id, workspace_id, id),
  CHECK (source = 'user' OR reason IS NOT NULL)   -- a suggestion always says why
);

CREATE TABLE competitor_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  workspace_id   uuid NOT NULL,
  competitor_id  uuid NOT NULL,
  url            text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 500),
  fetched_at     timestamptz NOT NULL,
  sha            text NOT NULL CHECK (sha ~ '^[0-9a-f]{64}$'),
  text           text NOT NULL CHECK (length(text) <= 20000),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, competitor_id) REFERENCES competitors(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id)
);

CREATE TABLE battlecards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  workspace_id   uuid NOT NULL,
  competitor_id  uuid NOT NULL,
  version        int NOT NULL CHECK (version >= 1),
  doc            jsonb NOT NULL CHECK (jsonb_typeof(doc) = 'object' AND length(doc::text) <= 60000),
  source_refs    jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  generated      jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, competitor_id) REFERENCES competitors(org_id, workspace_id, id),
  UNIQUE (competitor_id, version)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['competitors', 'competitor_snapshots', 'battlecards'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
                    WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()))', t);
    EXECUTE format('CREATE POLICY ops_all ON %I TO ops USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT ALL ON %I TO ops', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO app_rw', t);
  END LOOP;
END $$;
-- Only a competitor's status and name move; snapshots and battlecards have no UPDATE or DELETE for the app (S8).
GRANT UPDATE (status, name) ON competitors TO app_rw;
