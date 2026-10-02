#!/bin/bash
# A backup nobody has restored is a hope. Restores the newest dump into a scratch database on the same VM, compares
# row counts with the live database table by table, then drops the scratch copy. Run it once before pilots start
# and after any change to backup.sh; it reads, never writes, the live database.
#   BACKUP_BUCKET   gs://<bucket>
#   LIST / FETCH    default gcloud storage ls / cp; the Docker test swaps in local ones
set -euo pipefail
: "${BACKUP_BUCKET:?set BACKUP_BUCKET}"
LIST=${LIST:-gcloud storage ls}
FETCH=${FETCH:-gcloud storage cp}
newest=$($LIST "$BACKUP_BUCKET/omni-*.dump" | sort | tail -1)
[[ -n "$newest" ]] || { echo "no dump in $BACKUP_BUCKET" >&2; exit 1; }
tmp=$(mktemp /tmp/omni-restore-XXXXXX.dump); chmod 644 "$tmp"
trap 'rm -f "$tmp"; su postgres -c "dropdb --if-exists omni_restore_check" >/dev/null 2>&1 || true' EXIT
$FETCH "$newest" "$tmp" >/dev/null
su postgres -c "dropdb --if-exists omni_restore_check && createdb omni_restore_check"
# Roles live outside a dump; the restore keeps ownership and grants because the roles exist on this server.
su postgres -c "pg_restore -d omni_restore_check --exit-on-error $tmp"
counts() { su postgres -c "psql -tA -d $1 -c \"SELECT relname || '=' || n_live_tup FROM pg_stat_user_tables ORDER BY 1\""; }
q() { su postgres -c "psql -tA -d $1 -c \"$2\""; }
diffs=0; tables=0
for t in $(q omni "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1"); do
  a=$(q omni "SELECT count(*) FROM public.\\\"$t\\\""); b=$(q omni_restore_check "SELECT count(*) FROM public.\\\"$t\\\"")
  tables=$((tables + 1)); [[ "$a" == "$b" ]] || { echo "  $t: live $a, restored $b"; diffs=$((diffs + 1)); }
done
echo "restore check: $(basename "$newest"), $tables tables, $diffs differ (rows written since the dump differ by design)"
