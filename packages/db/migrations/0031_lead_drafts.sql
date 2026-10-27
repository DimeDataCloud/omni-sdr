-- 0031 (3a): lead_drafts, the reply drafted for a lead that has no enrollment (a web form, an inbound email, a call).
--
-- drafts.enrollment_id is NOT NULL and every invariant around drafts (the gate, approved_requires_gate, the closer policy,
-- send_guard) assumes an enrollment. A lead from a form has none, and a nullable column would weaken all of it, so a lead's
-- reply gets its own table with the same gate discipline: approved only over a gate pass on exactly its current text,
-- gate columns written by gate_svc alone, an edit voids the gate and the approval.
--
-- This migration is the review half only. Nothing here can send: messages and send_guard are untouched (3b adds
-- messages.lead_draft_id and the guard's lead branch), so an approved lead draft has nowhere to go yet. The send lock is unchanged.
--
-- Scope per row: one live draft per lead and purpose (a race of two generators yields one row, not two replies).
-- A closer sees none of it: a lead is not part of a handed-off thread (0015's catalog rule, closer_scope below).

CREATE TABLE lead_drafts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  workspace_id        uuid NOT NULL,
  contact_id          uuid NOT NULL,
  lead_event_id       uuid NOT NULL,             -- the lead this answers
  inbound_message_id  uuid,                      -- the wrapped inbound row when the lead has one (a call has none)
  channel             text NOT NULL CHECK (channel IN ('email', 'sms')),
  purpose             text NOT NULL DEFAULT 'first_response'
                      CHECK (purpose IN ('first_response', 'followup', 'booking_confirm', 'payment_followup')),
  subject             text,
  body                text NOT NULL,
  claims              jsonb NOT NULL DEFAULT '[]',
  status              text NOT NULL DEFAULT 'gating'
                      CHECK (status IN ('generating', 'gating', 'blocked', 'review', 'approved', 'discarded', 'superseded')),
  gate_passed         boolean NOT NULL DEFAULT false,
  gate_body_sha       text,
  gate_version        text,
  gated_at            timestamptz,
  gate_findings       jsonb CHECK (gate_findings IS NULL OR jsonb_typeof(gate_findings) = 'array'),
  rejection_reason    text CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 500),
  agent_id            uuid,
  approved_by         uuid REFERENCES users(id),
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, workspace_id, contact_id) REFERENCES contacts(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, lead_event_id) REFERENCES lead_events(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, inbound_message_id) REFERENCES inbound_messages(org_id, workspace_id, id),
  FOREIGN KEY (org_id, workspace_id, agent_id) REFERENCES agents(org_id, workspace_id, id),
  UNIQUE (org_id, workspace_id, id),
  -- §12.2 again: an approved lead draft carries a gate pass over exactly its current text.
  CONSTRAINT lead_drafts_approved_requires_gate CHECK (
    status <> 'approved' OR (gate_passed AND gate_body_sha = draft_sha(subject, body))),
  -- Approval is a person's act: a row cannot be approved with nobody named.
  CONSTRAINT lead_drafts_approved_has_approver CHECK (status <> 'approved' OR approved_by IS NOT NULL)
);
CREATE UNIQUE INDEX lead_drafts_one_live ON lead_drafts (lead_event_id, purpose)
  WHERE status NOT IN ('discarded', 'superseded');
CREATE INDEX lead_drafts_queue ON lead_drafts (workspace_id, status, created_at);

CREATE FUNCTION lead_drafts_edit_voids_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subject IS DISTINCT FROM OLD.subject OR NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.gate_passed   := false;
    NEW.gate_body_sha := NULL;
    NEW.gated_at      := NULL;
    NEW.gate_findings := NULL;
    NEW.approved_by   := NULL;
    NEW.approved_at   := NULL;
    IF NEW.status IN ('review', 'approved') THEN NEW.status := 'gating'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_drafts_edit_voids_gate BEFORE UPDATE ON lead_drafts FOR EACH ROW EXECUTE FUNCTION lead_drafts_edit_voids_gate();

-- What a draft is about never changes: a gate pass or an approval on one lead cannot be carried to another by an UPDATE.
CREATE FUNCTION lead_drafts_keys_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.org_id, NEW.workspace_id, NEW.contact_id, NEW.lead_event_id, NEW.inbound_message_id, NEW.channel, NEW.purpose, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.workspace_id, OLD.contact_id, OLD.lead_event_id, OLD.inbound_message_id, OLD.channel, OLD.purpose, OLD.created_at) THEN
    RAISE EXCEPTION 'lead_drafts: what a draft answers cannot change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_drafts_keys_immutable BEFORE UPDATE ON lead_drafts FOR EACH ROW EXECUTE FUNCTION lead_drafts_keys_immutable();

-- ─── RLS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE lead_drafts ENABLE ROW LEVEL SECURITY;  ALTER TABLE lead_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON lead_drafts USING (org_id = app_org() AND workspace_id = ANY (app_ws()))
  WITH CHECK (org_id = app_org() AND workspace_id = ANY (app_ws()));
CREATE POLICY ops_all ON lead_drafts TO ops USING (true) WITH CHECK (true);
GRANT ALL ON lead_drafts TO ops;
CREATE POLICY closer_scope ON lead_drafts AS RESTRICTIVE TO app_rw, gate_svc, sender_svc, inbox_svc
  USING (NOT app_is_closer(org_id)) WITH CHECK (true);

-- ─── grants ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- app_rw (the console and the drafting job): text and approval, never the gate columns.
GRANT SELECT ON lead_drafts TO app_rw;
GRANT INSERT (org_id, workspace_id, contact_id, lead_event_id, inbound_message_id, channel, purpose, subject, body, claims, status, agent_id)
  ON lead_drafts TO app_rw;
GRANT UPDATE (subject, body, status, approved_by, approved_at, rejection_reason) ON lead_drafts TO app_rw;
-- gate_svc: reads what it checks, the only role that writes the gate columns.
GRANT SELECT ON lead_drafts TO gate_svc;
GRANT UPDATE (gate_passed, gate_body_sha, gate_version, gated_at, gate_findings, status) ON lead_drafts TO gate_svc;
