-- 0018: the inbox service writes the audit row of a message a person recorded by hand (SDR-PIVOT P7, #91 audit P3-2).
-- A pasted LinkedIn message is recorded as inbox_svc; its audit row (who pasted it) now goes in the same transaction,
-- so a message is never recorded without one. audit_log stays append-only (0001 trigger) and org-scoped by RLS.
GRANT INSERT ON audit_log TO inbox_svc;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO inbox_svc;
