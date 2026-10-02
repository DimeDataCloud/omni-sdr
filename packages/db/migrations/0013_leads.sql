-- Omni-SDR 0013: lead finding (SPEC §1 acceptance step 5; Station 11). "Find 50 Nashville dental practices" asks a
-- places search for businesses, then reads each one's own homepage for evidence and a contact address.
--
-- What is kept from the places search is its place id and nothing else it returned (INFRASTRUCTURE §9 and §11:
-- "place_id only; display re-fetched" [VERIFY Maps caching terms]). The website, the company name and the email
-- come from the business's own homepage as we fetched it, which is our observation, like any evidence (0001).
-- `fit` is the deterministic fit score's working: which ICP version, which traits matched (Station 9).
ALTER TABLE contacts ADD COLUMN place_id text CHECK (place_id IS NULL OR (place_id ~ '^[A-Za-z0-9_-]+$' AND length(place_id) BETWEEN 8 AND 300));
ALTER TABLE contacts ADD COLUMN website text CHECK (website IS NULL OR (website ~ '^https?://' AND length(website) <= 300));
ALTER TABLE contacts ADD COLUMN fit jsonb CHECK (fit IS NULL OR (jsonb_typeof(fit) = 'object' AND length(fit::text) <= 4000));
-- One lead per business per workspace, however often it is found again.
CREATE UNIQUE INDEX contacts_ws_place ON contacts (workspace_id, place_id) WHERE place_id IS NOT NULL;
-- app_rw already holds table-level INSERT, UPDATE on contacts (0001), which covers the new columns.
