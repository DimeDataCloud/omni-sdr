-- 0029: an index for the form intake cap (S2L-2d/2e). POST /v1/hooks/:id counts a workspace's `form` inbound_messages in the last
-- 24 hours before it accepts anything; with no index that is a sequential scan of the whole table on every public submission
-- (measured on 200,000 rows: 42.9 ms, 4,652 buffers; with this index 1.4 ms, 44 buffers). Partial on channel = 'form' so it stays small.
-- Plain CREATE INDEX, not CONCURRENTLY: the migrator wraps each file in one transaction and CONCURRENTLY cannot run in one. The build
-- holds a SHARE lock (blocks writes to inbound_messages, not reads) for as long as it takes, a fraction of a second at pilot size.
-- Nothing else changes. Nothing here sends. The send lock is unchanged.

CREATE INDEX IF NOT EXISTS inbound_form_recent ON inbound_messages (workspace_id, received_at) WHERE channel = 'form';
