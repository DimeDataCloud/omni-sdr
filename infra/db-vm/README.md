# Production Postgres on one e2-micro VM

Christian, 2026-10-02: the database runs on Google's always-free e2-micro in us-central1, **no external IP**, nightly
dumps to Cloud Storage. claude-local creates the cloud resources after Christian's go (approvals 1–6 in its plan);
these scripts are what runs on the VM.

| File | Runs | Does |
|---|---|---|
| `setup.sh` | once, as root, on Debian 12 | Postgres 16 (PGDG), memory for 1 GB, swap, TLS, `pg_hba` locked to one CIDR, non-superuser owner `omni_owner`, database `omni` |
| `backup.sh` | nightly (`omni-backup.timer`), and by hand **before every migration** (rails §8) | `pg_dump -Fc`, readable-check, upload to `gs://<bucket>/omni-<UTC>.dump` |
| `restore-check.sh` | once before pilots, and after any backup change | restores the newest dump into a scratch database, compares row counts per table, drops it |
| `omni-backup.service`, `.timer` | systemd | 08:15 UTC nightly (3:15 a.m. Chicago), catches up after downtime |
| `test/run-in-docker.sh` | anywhere with Docker | all of the above on Debian 12 + the real migrations; see the PR for the last run |

Install on the VM: copy this folder to `/opt/omni`, run `setup.sh`, put `BACKUP_BUCKET=gs://<bucket>` in
`/etc/omni-backup.env`, copy the two units to `/etc/systemd/system/`, `systemctl enable --now omni-backup.timer`.

Connection string for Cloud Run (Direct VPC egress into the VM's network):
`postgres://omni_api:<from Secret Manager>@<vm-internal-ip>:5432/omni?sslmode=no-verify`. The certificate is
self-signed: traffic is encrypted, the server isn't verified. Moving to `verify-ca` means shipping
`omni-server.crt` to the services. The owner login is the same with `omni_owner`.
