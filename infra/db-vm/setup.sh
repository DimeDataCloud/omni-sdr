#!/bin/bash
# Omni-SDR production Postgres on one e2-micro VM (Christian 2026-10-02: the always-free tier, no external IP).
# Run once as root on a fresh Debian 12 VM, by claude-local after Christian's go (rails §3.2). Idempotent: safe to
# run again after a fix.
#
#   OMNI_OWNER_PASSWORD   the migration owner's password (from Secret Manager `omni-db-owner`; never echoed)
#   ALLOW_CIDR            the only source allowed to connect: Cloud Run's Direct VPC egress subnet range
#   SKIP_INSTALL=1        config only (Postgres 16 already installed)
#   SKIP_SWAP=1           no swap file (containers: infra/db-vm/test/run-in-docker.sh)
#
# What it sets, and why:
#   - Postgres 16 from the PostgreSQL apt repo: the version the migrations were audited on (PR #30).
#   - Memory for 1 GB of RAM, plus a 1 GB swap file so a burst slows down instead of being OOM-killed.
#   - TLS on (self-signed: traffic stays inside the VPC, but the password never crosses it in clear).
#   - pg_hba: local socket for the OS `postgres` user only; database `omni` over TLS with scram-sha-256 from
#     ALLOW_CIDR only; everything else rejected. The firewall rule (5432 from the same range) is the outer wall.
#   - The owner login `omni_owner` is NOT a superuser (LOGIN CREATEROLE CREATEDB), like Cloud SQL's built-in user, so
#     the migrations run exactly as they were tested.
set -euo pipefail
: "${OMNI_OWNER_PASSWORD:?set OMNI_OWNER_PASSWORD}"
: "${ALLOW_CIDR:?set ALLOW_CIDR (the Cloud Run egress subnet, e.g. 10.8.0.0/26)}"
[[ "$ALLOW_CIDR" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]] || { echo "ALLOW_CIDR must be an IPv4 CIDR" >&2; exit 2; }
[[ "$ALLOW_CIDR" != "0.0.0.0/0" ]] || { echo "refusing ALLOW_CIDR=0.0.0.0/0" >&2; exit 2; }

if [[ "${SKIP_INSTALL:-}" != 1 ]]; then
  apt-get update -q
  apt-get install -y -q curl ca-certificates gnupg
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -q
  apt-get install -y -q postgresql-16 unattended-upgrades
  # Swap: 1 GB, once. (SKIP_SWAP=1 in a container, which can't own swap.)
  if [[ "${SKIP_SWAP:-}" != 1 ]] && ! swapon --show | grep -q /swapfile; then
    fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi

PGDATA_CONF=${PGDATA_CONF:-/etc/postgresql/16/main}
mkdir -p "$PGDATA_CONF/conf.d"
cat > "$PGDATA_CONF/conf.d/omni.conf" <<CONF
# Omni-SDR: e2-micro (2 shared vCPU, 1 GB RAM). Managed by infra/db-vm/setup.sh.
listen_addresses = '*'
max_connections = 40
shared_buffers = 128MB
effective_cache_size = 512MB
work_mem = 4MB
maintenance_work_mem = 64MB
wal_compression = on
ssl = on
ssl_cert_file = '$PGDATA_CONF/omni-server.crt'
ssl_key_file = '$PGDATA_CONF/omni-server.key'
password_encryption = scram-sha-256
log_connections = on
log_min_duration_statement = 1000
CONF
grep -q "^include_dir = 'conf.d'" "$PGDATA_CONF/postgresql.conf" || echo "include_dir = 'conf.d'" >> "$PGDATA_CONF/postgresql.conf"

if [[ ! -f "$PGDATA_CONF/omni-server.key" ]]; then
  openssl req -new -x509 -days 3650 -nodes -subj "/CN=omni-db" -keyout "$PGDATA_CONF/omni-server.key" -out "$PGDATA_CONF/omni-server.crt" 2>/dev/null
  chown postgres:postgres "$PGDATA_CONF"/omni-server.*; chmod 600 "$PGDATA_CONF/omni-server.key"
fi

cat > "$PGDATA_CONF/pg_hba.conf" <<HBA
# Managed by infra/db-vm/setup.sh. First match wins.
local   all   postgres                    peer
local   all   all                         reject
hostssl omni  omni_owner,omni_api  $ALLOW_CIDR  scram-sha-256
host    all   all   0.0.0.0/0             reject
host    all   all   ::/0                  reject
HBA

if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then systemctl restart postgresql; else pg_ctlcluster 16 main restart 2>/dev/null || pg_ctlcluster 16 main start; fi

# Owner login and database. The password goes in over stdin, never on a command line or in a log.
su postgres -c "psql -v ON_ERROR_STOP=1 -q" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omni_owner') THEN
    CREATE ROLE omni_owner LOGIN CREATEROLE CREATEDB NOSUPERUSER;
  END IF;
END \$\$;
ALTER ROLE omni_owner PASSWORD '$(printf '%s' "$OMNI_OWNER_PASSWORD" | sed "s/'/''/g")';
SQL
su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname = 'omni'\"" | grep -q 1 || su postgres -c "createdb -O omni_owner omni"
# PG15+: only the database owner may create in public; keep it that way (the migrations rely on it).
su postgres -c "psql -q -d omni -c 'REVOKE CREATE ON SCHEMA public FROM PUBLIC'"
echo "setup done: Postgres $(su postgres -c 'psql -tAc "SHOW server_version"'), database omni owned by omni_owner, TLS on, clients from $ALLOW_CIDR only"
