#!/bin/bash
# Nightly dump of the omni database to Cloud Storage (omni-backup.timer), and the "backup before every migration" of
# rails §8 (run it by hand first). Runs on the VM as root; dumps as the OS `postgres` user over the local socket.
#   BACKUP_BUCKET   gs://<bucket> (the bucket's lifecycle rule deletes objects after 14 days)
#   UPLOAD          default "gcloud storage cp - "; the Docker test swaps in a local copy
# A dump is uploaded only if pg_restore can read it back; any failure exits non-zero, so the timer shows it failed.
set -euo pipefail
: "${BACKUP_BUCKET:?set BACKUP_BUCKET}"
UPLOAD=${UPLOAD:-gcloud storage cp -}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp=$(mktemp /tmp/omni-XXXXXX.dump)
trap 'rm -f "$tmp"' EXIT
su postgres -c "pg_dump -Fc -d omni" > "$tmp"
objects=$(pg_restore --list "$tmp" | grep -c ' TABLE DATA ' || true)  # every table, empty or not: proves the schema is in it
[[ "$objects" -gt 0 ]] || { echo "dump has no tables: not uploading" >&2; exit 1; }
$UPLOAD "$BACKUP_BUCKET/omni-$stamp.dump" < "$tmp"
echo "backup ok: omni-$stamp.dump, $(stat -c %s "$tmp") bytes, $objects tables"
