-- Omni-SDR 0008a: put the EXECUTE grants on the SECURITY DEFINER functions where the migrations meant them to be.
--
-- 0002-0008 ran `ALTER FUNCTION ... OWNER TO <x>_owner` and only then `REVOKE EXECUTE ... FROM PUBLIC` and
-- `GRANT EXECUTE ... TO <role>`. After the owner change the migration role is no longer the grantor, and it can only
-- SET ROLE to the owner (createrole_self_grant = 'set'), not inherit its rights, so on a real Postgres the REVOKE and
-- the GRANT were silent no-ops: every one of these functions stayed executable by PUBLIC, cross-tenant ones
-- (inbox_wake_snoozed, inbox_sla_due, sender_due_workspaces) included. The tests run PGlite as superuser, where the
-- same statements work, so nothing caught it (found on postgres:16, 2026-10-02; 0001's credit functions grant first
-- and were right). test/definer-acl.test.mjs now migrates as a non-superuser owner and checks every ACL.
--
-- The fix acts as each owner, which the migration role may SET ROLE to (it created them). The grants are exactly the
-- ones the earlier migrations wrote; the two send_guard functions are trigger-only and need no grant (a trigger fires
-- whatever its function's EXECUTE privilege).

SET ROLE tenancy_owner;
REVOKE EXECUTE ON FUNCTION create_org_with_admin(text, text, text), accept_invite(text), ensure_user(text, text),
  my_memberships(), create_workspace(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_org_with_admin(text, text, text), accept_invite(text), ensure_user(text, text),
  my_memberships(), create_workspace(uuid, text) TO app_rw;
RESET ROLE;

SET ROLE unsub_owner;
REVOKE EXECUTE ON FUNCTION unsubscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unsubscribe(text) TO app_rw;
RESET ROLE;

SET ROLE inbox_owner;
REVOKE EXECUTE ON FUNCTION inbox_resolve_reply(text), inbox_undecided(int), inbox_wake_snoozed(timestamptz, int),
  inbox_sla_due(timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inbox_resolve_reply(text), inbox_undecided(int), inbox_wake_snoozed(timestamptz, int),
  inbox_sla_due(timestamptz, int) TO inbox_svc;
RESET ROLE;

SET ROLE sender_owner;
REVOKE EXECUTE ON FUNCTION sender_due_workspaces(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sender_due_workspaces(int) TO sender_svc;
RESET ROLE;

SET ROLE guard_owner;
REVOKE EXECUTE ON FUNCTION send_guard(), send_guard_enrollment() FROM PUBLIC;
RESET ROLE;
