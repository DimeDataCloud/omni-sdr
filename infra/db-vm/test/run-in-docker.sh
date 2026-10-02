#!/bin/bash
# Runs setup.sh, the migrations, backup.sh and restore-check.sh on a Debian 12 container, as on the VM.
# Needs Docker; from the repo root: bash infra/db-vm/test/run-in-docker.sh
# CA_BUNDLE: a TLS-intercepting proxy's CA, if the network has one (the cloud sandbox does).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
docker rm -f omni-dbvm >/dev/null 2>&1 || true
docker run -d --name omni-dbvm -p 127.0.0.1:55433:5432 debian:bookworm sleep infinity >/dev/null
docker cp "$ROOT/infra/db-vm" omni-dbvm:/opt/omni
if [[ -n "${CA_BUNDLE:-}" ]]; then docker cp "$CA_BUNDLE" omni-dbvm:/tmp/proxy-ca.crt; fi
docker exec omni-dbvm bash -c 'apt-get update -q >/dev/null && apt-get install -y -q ca-certificates openssl >/dev/null && if [ -f /tmp/proxy-ca.crt ]; then cp /tmp/proxy-ca.crt /usr/local/share/ca-certificates/proxy.crt && update-ca-certificates >/dev/null; fi'
GW=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
echo "== setup.sh (clients allowed from the docker gateway $GW/32 only)"
docker exec -e OMNI_OWNER_PASSWORD=ownerlocal -e ALLOW_CIDR="$GW/32" -e SKIP_SWAP=1 omni-dbvm bash /opt/omni/setup.sh 2>&1 | tail -1
echo "== setup.sh again (idempotent)"
docker exec -e OMNI_OWNER_PASSWORD=ownerlocal -e ALLOW_CIDR="$GW/32" -e SKIP_SWAP=1 omni-dbvm bash /opt/omni/setup.sh 2>&1 | tail -1
echo "== refuses an open CIDR"; docker exec -e OMNI_OWNER_PASSWORD=x -e ALLOW_CIDR=0.0.0.0/0 omni-dbvm bash /opt/omni/setup.sh 2>&1 | tail -1 || true
URL='postgres://omni_owner:ownerlocal@127.0.0.1:55433/omni'
cd "$ROOT/packages/db"
echo "== migrations over TLS from the allowed source"; DATABASE_URL="$URL?sslmode=no-verify" node src/migrate-cli.mjs --apply
echo "== without TLS (must be refused)"; DATABASE_URL="$URL?sslmode=disable" node src/migrate-cli.mjs 2>&1 | tail -1 || true
echo "== from a source outside ALLOW_CIDR (inside the VM, 127.0.0.1: must be refused)"
docker exec -e PGPASSWORD=ownerlocal omni-dbvm bash -c "su postgres -c 'psql \"host=127.0.0.1 dbname=omni user=omni_owner sslmode=require\" -c \"select 1\"' 2>&1 | tail -1" || true
echo "== backup.sh"
docker exec omni-dbvm bash -c 'mkdir -p /backups && printf "#!/bin/bash\ncat > \"\$1\"\n" > /usr/local/bin/fakeup && printf "#!/bin/bash\nls -1 \$1\n" > /usr/local/bin/fakels && chmod +x /usr/local/bin/fake*'
docker exec -e BACKUP_BUCKET=/backups -e UPLOAD=fakeup omni-dbvm bash /opt/omni/backup.sh
echo "== restore-check.sh"
docker exec -e BACKUP_BUCKET=/backups -e LIST=fakels -e FETCH=cp omni-dbvm bash /opt/omni/restore-check.sh
docker exec omni-dbvm bash -c "su postgres -c 'psql -tAc \"SELECT count(*) FROM pg_database WHERE datname = '\''omni_restore_check'\''\"'" | sed 's/^/scratch databases left behind: /'
