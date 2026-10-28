-- Rep portal: pipeline is New, Demo booked, Proposed, Onboarding, Live, Lost (Christian 2026-10-27).
-- 'results_call' is the stored code for Demo booked (the booked demo and results call). The CHECK in 0001 still lists the
-- retired codes; the API no longer writes them. Rows only move forward or sideways, never lose data.
UPDATE accounts SET stage = 'new' WHERE stage = 'contacted';
UPDATE accounts SET stage = 'results_call' WHERE stage = 'audit_run';
UPDATE accounts SET stage = 'onboarding' WHERE stage = 'signed';
