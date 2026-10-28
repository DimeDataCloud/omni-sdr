-- Rep portal: the pre-demo audit (research plus the one-time call and form test) for each account.
-- JSON keyed by toolkit.js AUDIT_FIELDS; the API drops unknown keys.
ALTER TABLE accounts ADD COLUMN audit TEXT NOT NULL DEFAULT '{}';
