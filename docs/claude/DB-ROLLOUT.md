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
| G1 | ~~No production migration runner~~ **built 2026-10-02:** `packages/db/src/migrate-cli.mjs` (dry run by default, `--apply` under an advisory lock, each file in its own transaction, `--check-login=omni_api`) | tests + a real Postgres 16 run, §5 | claude-cloud |
| G2 | ~~No API container~~ **built 2026-10-02:** `packages/api/Dockerfile` (Node 22 pinned by digest; the API, the refine job and the migration runner in one image) | built and run against Postgres 16, §5 | claude-cloud |
| G3 | ~~No email-worker~~ **built 2026-10-02** on `claude/email-worker`: `edge/email-worker` accepts only `r+<token>@reply.omnisdr.com`, parses MIME, posts HMAC-signed to `/internal/inbound`; if the API can't take a reply it forwards to `FALLBACK_TO` or throws so the sender retries | `edge/email-worker/test/worker.test.mjs` (end to end through the real API) | claude-cloud built; Cloudflare deploy via claude-local |
| G4 | ~~Nothing calls `decider` in production~~ **built 2026-10-02:** `packages/api/src/jobs/refine.mjs`, a Cloud Run job for Cloud Scheduler to start every 1–2 minutes; exit 1 when the decider is down | `packages/api/test/jobs.test.mjs` | claude-cloud |
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
| 4 | Create the **migration owner** login (a built-in Cloud SQL user; password straight into Secret Manager as `omni-db-owner`, never printed). It is not a superuser: §5 shows the migrations now run as one | the secret exists; the value was never echoed |
| 5 | **Backup before the first migration** (on-demand) | `gcloud sql backups list` shows it |
| 6 | Run `node packages/db/src/migrate-cli.mjs` (dry run), then `--apply`, as the owner: a one-off Cloud Run job from the G2 image | the runner prints `applied 6 of 6`; a second run prints `nothing pending` |
| 7 | Create the **API login** `omni_api` **in SQL as the owner** (`CREATE ROLE omni_api LOGIN PASSWORD …`, value from Secret Manager `omni-db-api`), not with `gcloud sql users create`: Cloud SQL makes its built-in users members of `cloudsqlsuperuser` [VERIFY]. Grant `app_rw, gate_svc, sender_svc, inbox_svc` and nothing else | `migrate-cli.mjs --check-login=omni_api` prints PASS |
| 8 | Deploy the API (G2) with `DATABASE_URL` from the secret, `OMNI_MODEL=off`, `OMNI_INBOUND_SECRET` from Secret Manager; ingress internal + the console's front end per INFRASTRUCTURE | `/healthz` returns `{"ok":true}` through the console's route |
| 9 | Deploy the refine job (G4) from the G2 image (`node packages/api/src/jobs/refine.mjs`) with `DATABASE_URL` (API login) and `OMNI_DECIDER_URL`; grant its service account `roles/run.invoker` on `decider` (IAM-only, internal ingress); a Cloud Scheduler trigger every 1–2 minutes | an execution logs `{"job":"refine","decided":1,…}` after a test reply |
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

## 5. What was proven locally (2026-10-02, claude-cloud)

On `postgres:16` in Docker, with migrations run as a **non-superuser** owner (`CREATEROLE CREATEDB`, like Cloud SQL's
built-in user):
- **Two defects found and fixed, invisible to the PGlite suite** (PGlite runs as superuser, so both checks are skipped):
  1. `0001` failed at `ALTER FUNCTION send_guard() OWNER TO guard_owner`: "must be able to SET ROLE". Postgres 16 no
     longer makes a role's creator a member of it. Fix: the runner sets `createrole_self_grant = 'set'` for its session.
  2. Then "permission denied for schema public": Postgres 15+ requires a function's new owner to hold CREATE on its
     schema. Fix: each `OWNER TO` in 0001, 0002, 0003, 0005 and 0006 is wrapped in `GRANT CREATE` / `REVOKE CREATE` on
     `public` in the same transaction. Afterwards no role but the database owner has CREATE on `public`.
     **This edits migration files: a grants change, so it needs claude-local's audit and Christian's OK (rails §6).**
- After the fix, on a clean cluster: `applied 6 of 6`, a second run `nothing pending`; 25 of 26 tables have forced
  RLS (the same two exceptions as PGlite: `users`, `schema_migrations`); security-definer functions are owned by
  `guard_owner`, `inbox_owner`, `ledger_owner`, `tenancy_owner`, `unsub_owner`.
- `--check-login=omni_api` prints PASS for exactly the four roles, and FAIL naming `ops` when it is added.
- The G2 image ran all three roles against that database: migrations, the login check, and the API
  (`/healthz` 200; a signed `/internal/inbound` 200, a bad signature 401). The refine job ran from the image.
- Not proven here: the decider call on real Postgres (no tenant data: the demo seed relies on PGlite's superuser and
  fails on real Postgres with RLS, as it should). Production's tenant #0 comes from the real sign-up flow.
- Build note: in a sandbox behind a TLS-intercepting proxy, `npm ci` inside the build needs that proxy's CA as a
  BuildKit secret. Cloud Build doesn't, so the committed Dockerfile has no CA step.

## 6. Notes for later stages

- When `decider` moves to the multilingual checkpoint (LAYA-PLAN L9), `layaDecider` reads
  `health.revisions.english` and fails every call if that key is missing (`packages/ai/src/decide.mjs`). Update it
  together with the switch.
- pgvector (the RAG store, INFRASTRUCTURE §18) isn't needed by migrations 0001–0006. Enable it when its migration
  lands.
