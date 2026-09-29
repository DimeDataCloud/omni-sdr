-- Omni-SDR 0003: unsubscribe (CAN-SPAM; INFRA §14; guide Station 14 "suppression first").
-- Grounding: omni-sdr-journal/citations/email-compliance-can-spam.md. Opt-outs must be honored
-- within 10 business days and the mechanism must work for ≥30 days after sending. Here suppression
-- is written in the same transaction as the click, and tokens never expire.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unsub_owner') THEN CREATE ROLE unsub_owner NOLOGIN; END IF;
END $$;

-- One token per outbound message. Only its hash is stored; the raw token is in the
-- List-Unsubscribe header and the /u/<token> link of that message.
CREATE TABLE unsubscribe_tokens (
  token_hash    text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  org_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  contact_id    uuid NOT NULL,
  channel       text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz,
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id)
);

ALTER TABLE unsubscribe_tokens ENABLE ROW LEVEL SECURITY;  ALTER TABLE unsubscribe_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON unsubscribe_tokens USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()));

-- The sender issues a token for each message it sends; nobody else writes them, and nobody updates them.
GRANT INSERT (token_hash, org_id, workspace_id, contact_id, channel) ON unsubscribe_tokens TO sender_svc;
GRANT ALL ON unsubscribe_tokens TO ops;
CREATE POLICY ops_all ON unsubscribe_tokens TO ops USING (true) WITH CHECK (true);

-- unsubscribe(): called by the public /u/<token> route and the RFC 8058 one-click POST, with no
-- session, as app_rw. The answer is the same for a valid, reused or unknown token, so the route
-- can't be used to probe tokens. Returns true only so tests can observe it; the route must not
-- show the difference.
CREATE FUNCTION unsubscribe(p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t unsubscribe_tokens%ROWTYPE; c contacts%ROWTYPE; h text;
BEGIN
  SELECT * INTO t FROM unsubscribe_tokens
    WHERE token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO c FROM contacts WHERE id = t.contact_id AND org_id = t.org_id;

  IF t.channel = 'email' AND c.email IS NOT NULL THEN
    h := value_hash(c.email);
    INSERT INTO suppression (scope_org_id, value_hash, kind, reason)
      VALUES (t.org_id, h, 'email', 'unsubscribe') ON CONFLICT DO NOTHING;
    -- Stop every live enrollment for this address anywhere in the org, not only this campaign.
    UPDATE enrollments e SET state = 'stopped', stop_reason = 'unsubscribe', next_run_at = NULL
      FROM contacts k
      WHERE e.contact_id = k.id AND e.org_id = t.org_id AND k.org_id = t.org_id
        AND k.email IS NOT NULL AND value_hash(k.email) = h
        AND e.state NOT IN ('stopped', 'converted', 'completed');
  ELSIF t.channel = 'sms' AND c.phone IS NOT NULL THEN
    h := value_hash(c.phone);
    INSERT INTO suppression (scope_org_id, value_hash, kind, reason)
      VALUES (t.org_id, h, 'phone', 'unsubscribe') ON CONFLICT DO NOTHING;
    UPDATE enrollments e SET state = 'stopped', stop_reason = 'unsubscribe', next_run_at = NULL
      FROM contacts k
      WHERE e.contact_id = k.id AND e.org_id = t.org_id AND k.org_id = t.org_id
        AND k.phone IS NOT NULL AND value_hash(k.phone) = h
        AND e.state NOT IN ('stopped', 'converted', 'completed');
  END IF;

  UPDATE unsubscribe_tokens SET used_at = coalesce(used_at, now()) WHERE token_hash = t.token_hash;
  INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id)
    VALUES (t.org_id, 'recipient', 'unsubscribe', 'contact', t.contact_id::text);
  RETURN true;
END $$;

GRANT USAGE ON SCHEMA public TO unsub_owner;
GRANT SELECT ON unsubscribe_tokens, contacts TO unsub_owner;
GRANT UPDATE (used_at) ON unsubscribe_tokens TO unsub_owner;
GRANT SELECT, INSERT ON suppression TO unsub_owner;
GRANT SELECT, UPDATE (state, stop_reason, next_run_at) ON enrollments TO unsub_owner;
GRANT INSERT ON audit_log TO unsub_owner;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO unsub_owner;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['unsubscribe_tokens', 'contacts', 'suppression', 'enrollments', 'audit_log'] LOOP
    EXECUTE format('CREATE POLICY unsub_all ON %I TO unsub_owner USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

ALTER FUNCTION unsubscribe(text) OWNER TO unsub_owner;
REVOKE EXECUTE ON FUNCTION unsubscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unsubscribe(text) TO app_rw;
