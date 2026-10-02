# Handoff from claude-cloud to claude-local: merge, then deploy the reply path

Written 2026-10-02 by claude-cloud, after Christian asked for a report claude-local can push and deploy from.
**Every deploy, cloud change and spend below needs Christian's explicit go in claude-local's conversation**
(rails §3.1–3.3); this document asks for those approvals, and gives none. Secret values never appear in commands,
logs or chat (§3.6): set them from Secret Manager or `~/.halo-keys`.

Goal: a real reply to a pilot's email reaches production, is classified on cleaned text, and is refined by
`decider`. With the console's real sign-in and API adapter (§5), this is what the Station 26 acceptance script needs.

## 1. Merge (Christian approves each PR; claude-local reviews first, rails §5.6)

Every branch below merges cleanly onto master 1139134 in this order, all together. On the combined tree:
db 54/54, API 55/55, ai 8/8, email-worker 6/6, console tsc + build clean, sign-in Worker 15/15 (claude-cloud ran
these 2026-10-02; the console gate run is in the task report).

| Order | PR / branch | What | Review focus |
|---|---|---|---|
| 1 | #27 `claude/rails-v1.3` | Rails v1.3: Gemini retired, the two sessions review each other | Christian's wording |
| 2 | #28 `claude/gates-fonts-preview` | Fonts gate counts real bytes; the preview server can't be orphaned or impersonated | Windows paths (taskkill, netstat): untested on Windows |
| 3 | #29 `claude/amazing-maxwell-876zb2` | UI: panes fill the window (Approve bar was below the fold), Studio Generate docked, phone tab fade; design notes (proposal) | Screens; PR #26's baselines need re-capturing after this (Studio desktop moves 1–1.5%) |
| 4 | #30 `claude/db-rollout` | Migration runner, API image, refine job; **migrations wrapped in GRANT/REVOKE CREATE** so they run without superuser | **Grants change: audit it (rails §6)** |
| 5 | #31 `claude/reply-cleaning` | Clean replies before the rules and Laya; a bare STOP is an opt-out again | The cleaner must never drop an opt-out |
| 6 | #32 `claude/email-worker` | The email-worker for `reply.omnisdr.com` (stacked on 5) | HMAC, recipient check, never drop a reply |

PR #25 (Laya training) and PR #26 (baselines) are claude-local's own. Order of #26 against 3: merge 3 first, then
re-capture, or the visual gate fails on Studio.

## 2. Approvals to ask Christian for, in one sitting

| # | Approval | Cost (claude-local's quote, [VERIFY] in the console) |
|---|---|---|
| A | Cloud SQL Postgres 16, db-g1-small, us-central1, backups + PITR, deletion protection | ~$28/month |
| B | Enable the Cloud SQL Admin API (and Secret Manager if off) | none |
| C | Deploy the API (Cloud Run), the migration job and the refine job + its Cloud Scheduler trigger | inside the free tier at pilot volume [VERIFY] |
| D | `api.omnisdr.com` → the API (Cloud Run domain mapping + DNS record) | none |
| E | Deploy the email-worker, MX for `reply.omnisdr.com` (Email Routing) and a catch-all rule to the worker | Workers Paid already active ($5/month) |
| F | The fallback mailbox: one verified Email Routing destination (e.g. a Google Workspace address Christian reads) | none |

## 3. Steps (claude-local, each after its approval)

Shapes, not tested command lines. `<…>` are placeholders.

1. **Database (A, B).** Follow `docs/claude/DB-ROLLOUT.md` §2 steps 1–5: instance, database `omni`, owner login
   with its password in Secret Manager as `omni-db-owner`, an on-demand backup.
2. **Image.** `docker build -f packages/api/Dockerfile -t <region>-docker.pkg.dev/<project>/omni/api:<git-sha> .`
   from the repo root (or `gcloud builds submit` with the same Dockerfile), push to Artifact Registry.
   No Docker on Christian's machine (rails §8): use Cloud Build.
3. **Migrations (C).** A Cloud Run job from the image:
   `node packages/db/src/migrate-cli.mjs` (dry run, read its list), then the same with `--apply`, with
   `DATABASE_URL` from `omni-db-owner` and the Cloud SQL connection attached. Expect `applied 6 of 6`.
4. **API login.** As the owner, in SQL (not `gcloud sql users create`, which adds `cloudsqlsuperuser` [VERIFY]):
   `CREATE ROLE omni_api LOGIN PASSWORD …` (value from Secret Manager `omni-db-api`), then
   `GRANT app_rw, gate_svc, sender_svc, inbox_svc TO omni_api`. Check:
   `migrate-cli.mjs --check-login=omni_api` must print PASS.
5. **API (C, D).** Cloud Run service from the image, default command. Env: `DATABASE_URL` (API login),
   `OMNI_FIREBASE_PROJECT`, `OMNI_CORS_ORIGINS=https://suite.omnisdr.com`, `OMNI_INBOUND_SECRET` (Secret Manager,
   new random value), `OMNI_TRUST_PROXY=1`, `OMNI_MODEL=off`. Ingress: all (the email-worker on Cloudflare must
   reach `/internal/inbound`; every route is authenticated by token or HMAC). Map `api.omnisdr.com`.
   Check: `curl https://api.omnisdr.com/healthz` → `{"ok":true}`; an unsigned POST to `/internal/inbound` → 401.
6. **Refine job (C).** Cloud Run job from the image, command `node packages/api/src/jobs/refine.mjs`, env
   `DATABASE_URL` (API login), `OMNI_DECIDER_URL` (the decider's URL). Grant the job's service account
   `roles/run.invoker` on `decider`. Cloud Scheduler every 2 minutes. Check: an execution logs
   `{"job":"refine","decided":0,"failed":0,"skipped":0}` and exits 0.
7. **Email-worker (E, F).** In `edge/email-worker`: `npm ci`, `npx wrangler secret put INBOUND_SECRET` (the same
   value as step 5), set `FALLBACK_TO` in `wrangler.jsonc` vars to the verified address, `npx wrangler deploy`.
   Then in Cloudflare: Email Routing on `reply.omnisdr.com` (adds its MX), catch-all → "Send to a Worker" →
   `omnisdr-email-worker`.
8. **End to end, in tenant #0.** Send one real email from a pilot mailbox to an address Christian controls,
   reply to it from that address, quoting the original. Expect within ~2 minutes: a row in `inbound_messages`
   with the right intent, not suppressed, then `decided_at` set by the refine job. Reply "STOP" to a second
   one: the address lands in `suppression`.

## 3b. The database is the e2-micro VM (Christian 2026-10-02), not Cloud SQL

This replaces approval A and steps 1, 3 and 4 above. The VM scripts are in `infra/db-vm` (README there), tested
end to end on Debian 12 + Postgres 16.15 by `infra/db-vm/test/run-in-docker.sh`.

- **Setup.** After claude-local's approvals 1–6, copy `infra/db-vm` to the VM over the IAP tunnel and run
  `setup.sh` with `OMNI_OWNER_PASSWORD` piped in from Secret Manager and `ALLOW_CIDR` = the Cloud Run
  Direct VPC egress subnet. It refuses `0.0.0.0/0`.
- **Backup before migrating:** run `backup.sh` once by hand first, then `restore-check.sh` (it must report
  0 differing tables).
- **Migrations and the API login:** the same as steps 3–4, from a Cloud Run job with Direct VPC egress
  (claude-local's approval 7). `DATABASE_URL=…@<vm-internal-ip>:5432/omni?sslmode=no-verify`.
  `migrate-cli.mjs --check-login=omni_api` must print PASS.

Five points on the plan as written (claude-cloud's review):
1. **Patching.** With no external IP and only Private Google Access, the VM reaches Google APIs but not
   `deb.debian.org` or `apt.postgresql.org`, so `unattended-upgrades` can't fetch security fixes. Proposal: a
   monthly patch window that attaches the temporary IP for ~15 minutes, inside the free hour, and runs
   `apt-get upgrade`. Cloud NAT is the alternative, but it isn't free. [VERIFY] cloud.google.com/nat/pricing
2. **Backup permissions:** give the VM's service account `storage.objectCreator` and `storage.objectViewer`
   (the restore check lists and reads), not `objectAdmin`. Add a 14-day bucket retention policy, unlocked, so a
   compromised VM can't delete the backups it wrote. The lifecycle rule still removes them after 14 days.
3. **Passwords don't need to live on the VM.** `setup.sh` takes the owner password once, piped over IAP; the
   VM needs no Secret Manager access.
4. **RPO is 24 hours.** WAL archiving to the same bucket (`archive_command` with `gcloud storage cp`) would bring
   that to minutes for roughly the same storage. It's a later step, not needed for pilots.
5. **The $0 rule and images:** the API image is ~330 MB uncompressed. It goes to the same Artifact Registry
   repository as the decider's image, so check the free storage allowance before keeping more than one version.
   [VERIFY] cloud.google.com/artifact-registry/pricing

## 4. Rollback

- API, jobs: Cloud Run traffic to the previous revision; jobs simply aren't run.
- Email-worker: `wrangler rollback`, or switch the catch-all rule to "Send to an email" (the fallback mailbox)
  so no reply is lost while it's fixed.
- Database: point-in-time restore to a new instance, repoint `DATABASE_URL` (DB-ROLLOUT §4).

## 5. Still not built (so pilots aren't unblocked by these steps alone)

- **G5 sign-in.** The API verifies Identity Platform ID tokens; the console signs in with its own Worker
  (suite.omnisdr.com) and runs on demo data. Identity Platform needs enabling (an approval), and the console needs
  its real API adapter wired to `api.omnisdr.com`. Owner: either session; this is the next build.
- **Mail sending.** The sender worker loop and mailbox connect (API.md §7 items 1–2) aren't built, so step 8's
  first email goes out by hand for now.
- **G6 Station 26 acceptance script.** After G5.

## 6. What claude-cloud could not check

- Anything on Windows (the gates' `taskkill`/`netstat` paths), Cloud SQL's actual role behaviour, Cloudflare's
  handling of a thrown Email Worker error ([VERIFY] runtime API docs), prices.
- The decider call against real Postgres with real tenant data (proven on PGlite only).
