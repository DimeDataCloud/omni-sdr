-- Fake local data for wrangler dev only. Never apply to the remote database.
-- wrangler d1 execute omnisdr-rep --local --file tests/fixtures/rep-seed.sql
INSERT OR IGNORE INTO reps (email, name, role, active, created_at) VALUES ('dev-rep@example.test', 'Dev Rep', 'admin', 1, '2026-10-27T00:00:00Z');
INSERT OR IGNORE INTO accounts (id, owner_email, business, niche, phone, city, state, signal, stage, source, created_at, updated_at) VALUES
 ('seed-1', 'dev-rep@example.test', 'Ridge Line Roofing (sample)', 'Roofer', '615-555-0101', 'Franklin', 'TN', 'Web form unanswered after 6 hours', 'new', 'seed', '2026-10-20T15:00:00Z', '2026-10-20T15:00:00Z'),
 ('seed-2', 'dev-rep@example.test', 'Cumberland Comfort HVAC (sample)', 'HVAC', '615-555-0102', 'Nashville', 'TN', 'Missed call went to a full voicemail', 'results_call', 'seed', '2026-10-15T15:00:00Z', '2026-10-15T15:00:00Z'),
 ('seed-3', 'dev-rep@example.test', 'Harpeth Kitchen and Bath (sample)', 'Remodeler', '615-555-0103', 'Bellevue', 'TN', 'Quote form, no reply in 2 days', 'proposed', 'seed', '2026-10-10T15:00:00Z', '2026-10-10T15:00:00Z');
INSERT OR IGNORE INTO contacts (id, account_id, name, role, phone, email, is_primary, created_at) VALUES ('seed-c1', 'seed-1', 'Sam Owner (sample)', 'Owner', '615-555-0101', NULL, 1, '2026-10-20T15:00:00Z');
