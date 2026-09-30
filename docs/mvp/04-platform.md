# 04 — Repo, environments and platform plan

**Author:** Claude (infra lane, AGENT-RAILS §4) · **Status:** proposal pending Christian's approval · 2026-09-28
**Binding inputs:** DECISIONS (prod only, no extra spend; no Workspace; Drive + GitHub; WIF), SPEC §4, INFRA §2–7, §21–22.
**Grounding:** every price or limit below cites `omni-sdr-journal/citations/<file>` or carries `[VERIFY]`.
**Nothing in this station creates a resource.** Every command in §7 is for Christian to run, or to approve for someone else to run.

## Summary
- **One GCP project** (`hip-well-509308-m9`) is prod; there's no dev project.
- **Two profiles:**
  - **Lean**, from now until the first pilot: about $8–15/month in new spend on top of what's already paid.
  - **Hardened**: INFRA's full design, switched on by a written trigger.
- **The reason for two profiles:** INFRA assumes an HA private-IP database, a load balancer, Cloud Armor and Cloud NAT. Those have monthly floors, and the smallest database tier Google offers is explicitly "not for production" (see §3).
- **Decisions for Christian:** 4, in §9.

## 1. Repo layout (INFRA §4)
Target, reached in Sprint 1 by moves, not rewrites:
```
apps/web/                 ← today's src/, public/, next.config.ts, etc. (Gemini's lane)
worker/                   ← one image, one module per service: gate, sender, sequencer, inbox, publisher,
                            intake, enricher, generator, indexer, relay, mailer (each with its own DB role)
packages/db/              ← exists: migrations + tests + withTenant/can (Claude)
packages/core/            ← shared types, errors, config loading
packages/ai/              ← model registry + prompts + evals (prompts/evals: Gemini; registry: Claude)
packages/connectors/      ← manifests + adapters (Gemini drafts; Claude reviews)
packages/events/          ← outbox topics + payload schemas
infra/terraform/          ← §7 as code, once the lean profile is approved
edge/email-worker/        ← Cloudflare Email Routing worker for reply.omnisdr.com
functions/, cloud-functions/  ← waitlist (Gemini); moves under apps/ or is retired once the app has sign-up
```
- **Workspace tool:** npm workspaces (already on npm, no new tool).
- **Move order:**
  1. `packages/*` scaffolding (Claude).
  2. `src/` → `apps/web/` (Gemini, in one PR that only moves files, so the review is a rename diff).
  3. `worker/` skeleton (Claude).

## 2. Environments
| | Now → first pilot (**lean**) | Hardened (**trigger:** revenue covers it, or customer #1 signs; DECISIONS "Environments") |
|---|---|---|
| GCP projects | `hip-well-509308-m9` only | + a dev project (HALO recommendation at customer #1) |
| Local | PGlite + `packages/db` suite; Next dev server; emulators (Pub/Sub, Firestore not used) | same |
| Prod data safety | manual backup before every migration (§6) | automated backups + PITR, HA |

## 3. Database sizing: the SLA collision
- `db-f1-micro` / `db-g1-small` are the cheapest instances (about $8–11/month compute) **but** Google says: "aren't included in the Cloud SQL SLA … designed to provide low-cost test and development instances only. Don't use them for production instances." (`citations/gcp-platform-costs.md`)
- **Before any customer data exists, the missing SLA costs nothing.** Once a pilot's data is in it, it does.
- **Proposal:**
  - Run `db-f1-micro` (Enterprise edition, PG 16, public IP, no authorized networks, IAM DB auth, 10 GB SSD, daily backups) until the Station 26 acceptance script is green.
  - Move to the smallest dedicated-core Enterprise shape **before the first pilot tenant is created** [VERIFY price: likely tens of dollars/month; it's a restart, not a migration].
  - Decision D1.

## 4. Networking and edge (INFRA §21, simplified for lean)
| Concern | INFRA (hardened) | Lean proposal | Why lean is acceptable until the trigger |
|---|---|---|---|
| DB connectivity | private IP + Direct VPC egress + PgBouncer | **Cloud Run's built-in Cloud SQL connector** to a public-IP instance with **no authorized networks** and IAM DB auth | Google's connector is encrypted and IAM-gated; no VPC, NAT or pooler costs. Pooler: not needed at pilot volume [VERIFY connection limit of f1-micro] |
| Custom domains | global external ALB (~$18/mo) + Cloud Armor ($5/policy + $1/rule) | **Cloudflare in front** (Workers Paid, already paid): a Worker on `app.`/`audit.` proxies to the `run.app` URLs and adds a shared-secret header that Cloud Run checks | Cloud Run domain mapping is preview and "not recommended for production"; Firebase Hosting rewrites have a request timeout that would cut SSE streams [VERIFY]. Cloudflare's WAF/rate limiting covers what Armor would, and Cloudflare for SaaS custom hostnames (100 free) sits on the same edge (`citations/cloudflare-for-saas.md`) |
| Egress static IP | Cloud NAT | none | nothing needs an allowlisted IP yet; add NAT when a vendor requires it |
| Inbound mail | Cloudflare Email Routing → Worker | same | free (INFRA §21) |

**Risk (one line):** with a Worker proxy, the `run.app` URL is still public. Cloud Run must reject any request without the edge secret header, or the edge WAF can be bypassed. That check is a Sprint 1 acceptance test.

## 5. Service accounts, DB roles, secrets (INFRA §22)
**One service account per deployable. None of them has a key file (WIF for CI; attached identities at runtime).**
| Service account | Runs | Postgres login (IAM DB auth) → role it may `SET ROLE` to | GCP roles (minimum) |
|---|---|---|---|
| `omni-web@` | Cloud Run `web` | `omni_web` → `app_rw` | Cloud SQL Client, Secret Accessor (web secrets only), Pub/Sub Publisher (outbox relay topics) |
| `omni-worker@` | Cloud Run `worker` | `omni_worker` → `gate_svc`, `sender_svc`, `ops` (per module) | Cloud SQL Client, Secret Accessor (worker secrets), Pub/Sub Sub/Pub, Cloud Tasks Enqueuer, Vertex AI User |
| `omni-migrate@` | Cloud Run **job** `migrate` | `omni_migrate` owns the schema | Cloud SQL Client (runs only from CI after a backup) |
| `omni-deploy@` | GitHub Actions via WIF | none | Run Admin (on these services), Service Account User (on the three above), Artifact Registry Writer |
| `omni-waitlist-writer@` (exists) | waitlist function | none | Storage Object Creator on `omnisdr-leads` only. **Today the function runs as the default compute SA** (P0 list, SPEC §14 #3) |

**Secrets inventory (names only; values live in Secret Manager, never in the repo or Drive):**
| Secret | Used by | Station |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_SECRET` | web | 05, 14, 16 |
| `SESSION_SECRET` | web | 05 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | web | 05, 22 |
| `CLOUDFLARE_EMAIL_SENDING_TOKEN` (Email Sending: Edit only) | worker (mailer) | 22 |
| `CLOUDFLARE_SAAS_TOKEN` (custom hostnames only) | worker | 21 |
| `EDGE_SHARED_SECRET` | edge Worker + web | 04 (§4) |
| `LINKEDIN_CLIENT_SECRET` | web/worker | 17 |
| `LINKEDIN_PROVIDER_API_KEY` [VERIFY per-account vs platform key] | worker | 17 |
| `SHOPIFY_API_SECRET`, `GHL_CLIENT_SECRET`, `WHOP_API_KEY` | worker | 20 |
| `EMAIL_VERIFY_VENDOR_KEY` | worker (enricher) | 11 |
| Customer OAuth tokens, webhook signing keys | DB, KMS-envelope encrypted per tenant (INFRA §22), never Secret Manager | 06, 20 |
FCM and Vertex use the service account identity: no secret.

## 6. Migrations runbook (DECISIONS "Environments": backup before every migration)
1. The PR carries the migration plus tests, and `npm test` in `packages/db` passes locally (CI once GitHub billing is fixed).
2. **Backup:** `gcloud sql backups create --instance=<prod> --description="pre-<migration>"`, and record the backup id in the journal.
3. **Apply:** the `migrate` Cloud Run job runs `packages/db/src/migrate.mjs` against prod. Migrations are transactional and recorded in `schema_migrations`, so a failure rolls back and nothing is recorded.
4. **Verify:** run the read-only smoke queries (RLS enabled/forced on every tenant table; the function owners) and paste them in the journal.
5. **Restore path**, if needed: restore the backup from step 2 to a new instance, repoint, then investigate. Never hand-edit prod.

## 7. P0 resource list (lean) and cost floor
Each line is Christian's to create (AGENT-RAILS §3.2); Terraform comes after approval.
| Resource | INFRA § | New monthly cost | Source |
|---|---|---|---|
| Enable APIs: Cloud SQL Admin, Cloud Tasks, Secret Manager, KMS, Identity Toolkit, Artifact Registry, IAM Credentials, Cloud Scheduler | 2 | $0 | — |
| Cloud SQL PG16 `db-f1-micro`, 10 GB SSD, backups | 5 | ~$8–11 compute + storage/backups [VERIFY] | gcp-platform-costs.md |
| Cloud Run `web`, `worker`, job `migrate` | 3 | ~$0 at pilot volume (scale to zero) [VERIFY free tier] | — |
| Pub/Sub, Cloud Tasks, Scheduler (≤3 jobs) | 6–7 | ~$0 (free tiers) [VERIFY] | — |
| Secret Manager (~15 secrets) | 22 | ~$1 [VERIFY per-version price] | — |
| KMS keyring + 1 key (token envelope) | 22 | ~$0.06/key version [VERIFY] | — |
| Artifact Registry (images) | 4 | ~$0 up to free storage [VERIFY] | — |
| Identity Platform | 20 | $0 to 49,999 MAU | gcp-platform-costs.md |
| Cloudflare Workers Paid | 21 | $0 new (already paid) | builds note |
| Vertex AI (Gemini) usage | 10 | usage-based; metered to tenants by credits | gemini-models-and-grounding.md |
| **Floor** | | **≈ $10–15/month new** [VERIFY] | |
| *Hardened adds:* ALB ~$18, Armor $5 + rules, NAT, HA database, dev project | | *≈ +$60–150/month* [VERIFY] | gcp-platform-costs.md |

## 8. CI/CD with Workload Identity Federation
- **CI, now (PR #3):** `db-tests` on every PR. **Blocked:** GitHub refuses to start jobs until the account's billing is fixed.
- **Deploy workflow, later (not written until D3 is approved):** on push to `master`:
  1. Build one image per deployable, tagged with the git sha, and push it to Artifact Registry.
  2. Wait for manual approval (GitHub environment `production`, reviewer Christian).
  3. Take the backup and run the `migrate` job (§6).
  4. `gcloud run deploy` web + worker with `--no-traffic`.
  5. Smoke test.
  6. Shift traffic.
- **Auth:** `google-github-actions/auth` with WIF. The provider's attribute condition pins `assertion.repository == 'DimeDataCloud/omni-sdr'` **and** `assertion.ref == 'refs/heads/master'`, so a branch or fork can't obtain deploy credentials.

## Acceptance tests (for Sprint 1)
- A request straight to the `run.app` URL without the edge secret gets 403; the same request through `app.omnisdr.com` gets 200.
- `SELECT current_user` from `web` is `omni_web`. `SET ROLE ops` from web fails, and `SET ROLE app_rw` succeeds.
- The migrate job refuses to run unless the backup id for this sha appears in the job's input.
- A WIF token request from a non-`master` ref is denied (check the auth step's log output).

## 9. Decisions needed
| # | Question | Options | Recommended default | Why |
|---|---|---|---|---|
| D1 | Database tier until the first pilot | A `db-f1-micro` (no SLA) now, dedicated core before pilot 1 · B dedicated core now | **A** | No customer data yet; saves the dedicated-core cost for months; the switch is a restart |
| D2 | Edge until the trigger | A Cloudflare Worker proxy (already paid) · B ALB + Armor (~$25+/mo) · C Cloud Run domain mapping (preview) | **A** | $0 new spend; Cloudflare WAF; the same edge serves agency custom hostnames. C is "not recommended for production" |
| D3 | DB connectivity | A built-in connector + public IP, no authorized networks, IAM auth · B private IP + VPC egress | **A** | No VPC/NAT; IAM-gated and encrypted; revisit with the hardened profile |
| D4 | Who runs §7 | A Christian runs the commands · B Christian approves each and Claude runs it | **B** | Same approval point, fewer steps for Christian; every run is logged to the journal |

## Out of scope for this station
Terraform code (after approval), the dev project (at the trigger), a pooler, NAT, and HA.
