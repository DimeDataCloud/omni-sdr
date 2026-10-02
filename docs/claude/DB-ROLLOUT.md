# Production database and reply path: rollout runbook (prepared, not run)

Status: **proposal**, written 2026-10-02 by claude-cloud. Nothing here has run. Every step that creates a cloud
resource, spends money, deploys or migrates prod needs Christian's explicit go in the conversation where it happens
(rails §3.1–3.3). claude-local runs those steps, because they need gcloud and Christian's credentials.

Goal: a real reply reaches production, is recorded, gets a first verdict from the rules, and is then refined by
`decider` (Laya). Pilots start when the Station 26 acceptance script passes in prod (DECISIONS 2026-09-29).

## 0. What a database alone does not fix

Approving Cloud SQL is necessary but not enough. Read from the code on master 1139134, the reply path still has these
gaps. None needs an approval to *build*; each needs one to *deploy*.

| # | Gap | Evidence | Owner to build |
|---|---|---|---|
| G1 | **No production migration runner.** `packages/db/src/migrate.mjs` exports `migrate(db)`; only `packages/api/src/dev.mjs` calls it, against PGlite | `grep -rn "migrate(" packages` | claude-cloud |
| G2 | **No API container.** `packages/api` has a `start` script and no Dockerfile; Cloud Run can build it from source, but the base image and Node version aren't pinned | `ls packages/api` | claude-cloud |
| G3 | **No email-worker.** Nothing receives mail for `reply.omnisdr.com` and calls `POST /internal/inbound` | API.md §7 item 4 | claude-cloud builds; Cloudflare deploy via claude-local |
| G4 | **Nothing calls `decider` in production.** `layaDecider` exists in `packages/ai/src/decide.mjs`, but `server.mjs` never constructs it, and no job runs `refinePending()` | `grep -rn refinePending packages` | claude-cloud |
| G5 | **Sign-in.** The API verifies Identity Platform ID tokens (`OMNI_FIREBASE_PROJECT`); per SPEC §2 the Identity Platform API isn't enabled | SPEC §2 table (dated, re-check) | claude-local checks; Christian approves enabling |
| G6 | **Station 26 acceptance script** isn't written yet | SPEC, Station 26 | either session, after G1–G4 |

Recommended order: build G1, G2 and G4 now (code plus tests, no approval needed), so the database approval turns into a
working path the same day. G3 can follow; until it exists, test replies can be posted to `/internal/inbound` with the
HMAC secret.

## 1. Decisions to take first (Christian)

1. **Instance size.** INFRASTRUCTURE §5 says Enterprise Plus; SPEC §4 says the smallest tier with no extra spend.
   Proposal: start at the smallest Enterprise-edition shared-core or 1 vCPU tier, with automated backups and
   point-in-time recovery on, and resize when pilots show load (a resize is a short restart, not a migration).
   Prices: claude-local quotes them from the live pricing page before approval. [VERIFY]
   https://cloud.google.com/sql/pricing
2. **Networking.** Proposal for pilots: public IP with **no authorized networks**, so it is reachable only through the
   Cloud SQL connectors (IAM-authenticated, TLS). Private IP, VPC, Serverless VPC egress and NAT (INFRASTRUCTURE §21)
   come later, when the sender needs a static egress IP. This saves cost and setup now, and changes nothing in the
   schema. [VERIFY] that the Cloud Run → Cloud SQL connector works without private IP:
   https://cloud.google.com/sql/docs/postgres/connect-run
3. **Region:** `us-central1`, the same as `decider`.

## 2. Steps (claude-local, each after Christian's go)

Every command below is the shape, not a tested command line. Names in `<angle brackets>` are placeholders; secret
values never appear in commands, logs or chat (rails §3.6).

| Step | What | Check that it worked |
|---|---|---|
| 1 | Enable the Cloud SQL Admin API (and Secret Manager if not on) in project `omni-sdr` | `gcloud services list --enabled` lists them |
| 2 | Create the instance: Postgres 16, `us-central1`, the size from §1.1, backups + PITR on, deletion protection on | `gcloud sql instances describe <instance>` shows `RUNNABLE`, backups enabled |
| 3 | Create database `omni` | `gcloud sql databases list` |
| 4 | Create the **migration owner** login (built-in user; password straight into Secret Manager as `omni-db-owner`, never printed) | the secret exists; the value was never echoed |
| 5 | **Backup before the first migration** (on-demand) | `gcloud sql backups list` shows it |
| 6 | Run migrations 0001–0006 as the owner via the G1 runner (a one-off Cloud Run job using the connector) | `schema_migrations` has 6 rows; the runner prints `ran: 6` |
| 7 | Create the **API login** `omni_api` (password into Secret Manager as `omni-db-api`) and grant it membership of `app_rw`, `gate_svc`, `sender_svc`, `inbox_svc` **and nothing else** (API.md "Database login") | the role check in §3 passes |
| 8 | Deploy the API (G2) with `DATABASE_URL` from the secret, `OMNI_MODEL=off`, `OMNI_INBOUND_SECRET` from Secret Manager; ingress internal + the console's front end per INFRASTRUCTURE | `/health` returns 200 through the console's route |
| 9 | Grant the API's service account `roles/run.invoker` on `decider` (it is IAM-only, internal ingress) and set `OMNI_DECIDER_URL` (G4) | one `refinePending` pass on a test reply logs `decided: 1` |
| 10 | Deploy the email-worker (G3) for `reply.omnisdr.com` and its MX/DNS (DNS is a deploy: rails §3.1) | a test mail lands in `inbound` with a rules verdict, then a model verdict |

## 3. Checks before anyone says "live"

Run against prod, in tenant #0 only (SPEC, Station 26: no dev environment, so prod is tested with the house tenant).

- **Role isolation:** connected as `omni_api`, `SELECT rolname FROM pg_roles WHERE pg_has_role(current_user, oid, 'member')`
  returns exactly `omni_api, app_rw, gate_svc, sender_svc, inbox_svc`; `rolsuper`, `rolbypassrls` and table ownership
  are all false. Owner and API passwords are different secrets.
- **RLS:** the `packages/db` RLS matrix, run against the instance through the owner, with a throwaway org pair
  created and deleted in one transaction. This needs a pg-backed test runner: part of G1.
- **Guard:** `send_guard()` refuses the 15 cases from the db test suite on the real instance.
- **Reply path:** a scripted test reply for each of the 9 labels goes through `/internal/inbound`, then
  `refinePending`. Expected: an unsubscribe reply suppresses the address and stops the sequence; an out-of-office
  reply does neither; a meeting request starts the SLA clock.
- **Backups:** a point-in-time restore *to a new instance* works and is then deleted. Restoring costs the instance
  time while it exists: Christian's go.

## 4. Rollback

- **Migration failed:** each file runs in one transaction (`migrate.mjs`), so a failure leaves nothing half-applied.
  Fix forward with a new migration. Never edit an applied file.
- **Bad data after go-live:** point-in-time restore to a new instance, then repoint `DATABASE_URL`.
- **API or worker bad:** Cloud Run traffic back to the previous revision; the email-worker rolls back with its previous
  Cloudflare version (claude-local has done the same for the console Worker).
- **Abandon:** deletion protection stays on. Deleting the instance is Christian's call alone.

## 5. Notes for later stages

- When `decider` moves to the multilingual checkpoint (LAYA-PLAN L9), `layaDecider` reads
  `health.revisions.english` and fails every call if that key is missing (`packages/ai/src/decide.mjs`). Update it
  together with the switch.
- pgvector (the RAG store, INFRASTRUCTURE §18) isn't needed by migrations 0001–0006. Enable it when its migration
  lands.
