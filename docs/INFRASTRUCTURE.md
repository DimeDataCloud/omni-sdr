# Omni-SDR — Backend & Infrastructure Specification (v3)

2026-09-28. Restructures v2 (`archive/INFRASTRUCTURE-v2-2026-09-28.md`) into one system with no
amendment layers, and fills the gaps v2 left open. Backend and infrastructure only.
Domain: **omnisdr.com** on Cloudflare (§21.1); Omni-SDR's own outreach runs on the **try.omnisdr.com** subdomain (§21.1b).

`[VERIFY]` = a platform fact to confirm against current vendor docs before a build step depends
on it. They're all collected in §29.

**What changed from v2:**
- **One system of record: Cloud SQL Postgres.** Firestore is dropped. Sends, credits and sync
  mappings need transactions and uniqueness constraints, and a gate the database enforces needs
  CHECK constraints and column privileges. Firestore has none of these.
- **The claims gate is now a database constraint plus a send trigger**, not app logic.
- **New:**
  - a transactional outbox for events
  - an AI gateway
  - a sequence engine with the follow-up and meeting lifecycle
  - content studio + publishing as a first-class engine
  - a credits ledger
  - the domain and hostname plan
  - networking, regions, DR, observability, testing, retention, repo layout
- **Connectors run on one runtime** deployed in groups, not 40 separate services.

---

# Part A — System shape

## 1. Principles

1. **Google Cloud inside, open at every edge.** Internal services never import a vendor SDK. Every
   external system goes through the connector runtime (§19).
2. **Postgres is the truth.** Every other store (GCS, the RAG index, BigQuery, caches) is either
   content-addressed or derived and rebuildable.
3. **Invariants live in the database.** Anything that must never happen (an ungated send, a double
   send, a negative credit balance, a cross-tenant read) is a constraint, trigger, privilege or RLS
   policy, not an `if` in application code.
4. **One egress per kind.** Only `sender` can contact a person (§14). Only `publisher` can post
   publicly (§16).
5. **Every side effect is idempotent.** Retries are normal; duplicates are impossible by key (§25).
6. **Events leave through the outbox.** No service publishes to Pub/Sub directly after a DB write (§6).
7. **The browser never talks to a model, a mailbox, or a vendor API.**
8. **Customers' own accounts.** Mail, social and ad actions run through the tenant's connected
   accounts. Omni-SDR orchestrates and never sends prospect mail as itself.
9. **Fail closed.** Unknown gate result, unknown suppression status, unknown hold state: don't send.
10. **Measure the denominator.** Every check reports how many things it checked (§28).

## 2. Platform, regions, environments

| | Choice |
|---|---|
| Cloud | Google Cloud, existing console account + credits |
| Region | **`us-central1`** as the single primary region. It has the broadest Vertex AI model availability `[VERIFY]` for Gemini / Imagen / Veo / embeddings / ranking |
| Projects | `omni-dev`, `omni-prod`, plus `omni-shared` (Artifact Registry, Terraform state) |
| DNS | **Cloudflare** (registrar for omnisdr.com; Cloudflare Registrar requires Cloudflare nameservers `[VERIFY]`), managed by Terraform's Cloudflare provider. See §21.1 |
| IaC | Terraform, a module per domain, one workspace per project; nothing clicked into existence in prod |
| CI/CD | GitHub Actions → Workload Identity Federation (no JSON keys) → Artifact Registry → Cloud Run deploy; migrations run as a Cloud Run job **before** the new revision takes traffic |
| Preview | Cloud Run revision tags per PR on `omni-dev` |
| Local dev | Code runs locally; data services are the `omni-dev` project (Cloud SQL via Auth Proxy, real Pub/Sub). No local Docker stack, because this machine's Docker disk can't hold it |

## 3. Service map

All services are TypeScript on Node 22, compiled with a real build step (`tsup`), not Node's
type-stripping mode, which refuses parameter properties and enums at import time.

| Service | Kind | Ingress | Does | Holds credentials for |
|---|---|---|---|---|
| `web` | Cloud Run service | LB + Cloud Armor | Next.js UI + BFF (server actions), SSE realtime, public audit pages | — |
| `api` | Cloud Run service | LB + Cloud Armor | Public REST `/v1`, inbound webhooks `/hooks/*`, MCP `/mcp`, OAuth callbacks, inbound-mail endpoint | — |
| `sequencer` | Cloud Run service | internal | Advances enrollments, schedules steps, owns stop rules (§13) | — |
| `gate` | Cloud Run service | internal | Runs the claims gate; the only DB role that can set gate columns (§12) | — |
| `sender` | Cloud Run service | internal | **The only egress to a person**: email, SMS, LinkedIn handoff (§14) | mailbox + SMS tokens (KMS decrypt) |
| `inbox` | Cloud Run service | internal | Ingests replies, classifies, runs the follow-up + meeting lifecycle (§15) | mailbox read tokens |
| `publisher` | Cloud Run service | internal | **The only egress to a public channel**: posts, ads (§16) | social + ad account tokens |
| `intake` | Cloud Run service + jobs | internal | File intake, scan, understand, derive (§8) | — |
| `enricher` | Cloud Run service | internal | Evidence, contacts, verification, heat (§9) | data-vendor keys |
| `generator` | Workflows + Cloud Run jobs | internal | Reports, docs, images, video renders (§17) | — |
| `indexer` | Cloud Run service | internal | RAG chunk/embed/write (§18) | — |
| `connector-runtime` | Cloud Run service, deployed per group | internal | Sync, triggers and actions for every connector (§19) | connector tokens |
| `relay` | Cloud Run service | internal | Outbox → Pub/Sub publisher (§6) | — |
| `mailer` | Cloud Run service | internal | System mail from `notify.` via the Cloudflare Email Sending REST API (§21.1). Never prospect mail | Cloudflare Email Sending token |
| `ops` | Cloud Run jobs | — | Migrations, re-index, backfills, tenant delete, retention sweep | — |

Every service has its own service account (§22). "Internal" means `ingress=internal` +
IAM-authenticated invocation only.

```
  Cloudflare DNS (omnisdr.com, DNS-only) ─▶ Cloud Armor ─ HTTPS LB ─┬─ web  ─┐
  Cloudflare Email Routing (in./reply.) ─▶ Email Worker ─▶ api ─────┴─ api  ─┤
                                                                            ▼
                 ┌──────────── Cloud SQL Postgres (private IP) ─────────────┐
                 │  RLS per tenant · outbox · ledger · gate constraints     │
                 └──────┬───────────────────────────────────────────────────┘
                        │ relay (outbox → Pub/Sub "events")
         ┌──────────────┼──────────────┬──────────────┬──────────────┐
      sequencer       inbox         indexer      connector-runtime   enricher
         │              │                             │
         ▼ Cloud Tasks  ▼                             ▼ vendor APIs (via Cloud NAT static IP)
       gate ──▶ sender ──▶ Gmail / Graph / Twilio / extension queue
                publisher ──▶ LinkedIn pages+ads / Meta / YouTube / TikTok / GBP
       intake ◀─ Eventarc (GCS finalize)      generator ◀─ Workflows
       all model calls ──▶ AI gateway package ──▶ Vertex AI
```

## 4. Repository layout

```
omni-sdr/
  apps/web/                    Next.js (UI + BFF + audit pages)
  services/<name>/             one folder per §3 service, thin: HTTP/Tasks handlers only
  packages/core/               domain logic (pure, no I/O), shared types, state machines
  packages/db/                 schema, migrations, typed queries, RLS session helper
  packages/ai/                 AI gateway (§10), prompt registry
  packages/connectors/<id>/    one folder per connector: manifest, mappings, API calls, recorded fixtures
  packages/events/             event catalog + JSON Schemas (§6)
  edge/email-worker/           Cloudflare Email Worker: inbound routing only (the only non-GCP runtime; §21.1)
  infra/terraform/             modules: network, sql, run, pubsub, tasks, storage, iam, kms, lb, monitoring, cloudflare
  infra/jobs.yaml              the single registry of scheduled jobs (§7)
  tests/                       e2e, RLS matrix, gate sabotage, connector contracts
```
Rule: `services/*` may import `packages/*`; packages never import services; only
`packages/connectors` may import vendor SDKs.

---

# Part B — Data

## 5. System of record: Cloud SQL for PostgreSQL

**Instance:** Cloud SQL Postgres 16, Enterprise Plus edition `[VERIFY]` for PITR + near-zero-downtime
maintenance, private IP only, HA (regional) in prod, `pgvector` enabled. Scale path: read replica
for analytics exports, then AlloyDB (same SQL) if write load or vector latency requires it.

**Connection model:** Cloud Run → Direct VPC egress → private IP; a pooler (PgBouncer on a small
Cloud Run service or managed pooling `[VERIFY]`) in transaction mode; per-service DB roles.

**Tenancy + RLS:** every tenant table carries `org_id` and `workspace_id`. Each request opens a
transaction and sets `app.org_id`, `app.workspace_ids`, `app.role`. Policies filter on them.
Services connect as non-owner roles, so RLS can't be bypassed. `ops` runs as a separate role with
`BYPASSRLS`, used only by jobs.

### 5.1 Schema by domain (key tables and the constraints that matter)

**Tenancy + identity**
```sql
orgs(id, name, plan, status, hold_reason, created_at)
workspaces(id, org_id, name, timezone, trust_level smallint CHECK (trust_level BETWEEN 1 AND 3),
           hold_reason, brand_kit jsonb, voice jsonb, audit_hostname NULL)
users(id, idp_uid UNIQUE, email)
memberships(org_id, user_id, role CHECK (role IN ('owner','admin','operator','reviewer','client_viewer')),
            workspace_ids uuid[] NULL,             -- NULL = all workspaces
            PRIMARY KEY (org_id, user_id))
api_keys(id, org_id, workspace_id NULL, key_hash UNIQUE, scopes text[], revoked_at)
```

**Prospects + evidence**
```sql
accounts(id, org_id, workspace_id, name, domain, place_id, platform, city, tz,
         UNIQUE (workspace_id, domain))
contacts(id, org_id, workspace_id, account_id, name, title, email, email_status, phone,
         phone_line_type, linkedin_url, UNIQUE (workspace_id, email))
evidence(id, org_id, workspace_id, account_id, type, source_uri, fetched_at, snapshot_sha,
         snapshot_uri, facts jsonb, expires_at)
         -- trigger: UPDATE allowed only on expires_at; evidence is immutable
signals(id, workspace_id, contact_id, type, strength smallint, occurred_at, source)
external_refs(workspace_id, entity_type, entity_id, connection_id, external_id,
              UNIQUE (connection_id, external_id))   -- sync can never duplicate
```

**Outreach + follow-up**
```sql
campaigns(id, workspace_id, name, status, sequence_id, daily_cap, send_window jsonb)
sequences(id, workspace_id, version, definition jsonb, UNIQUE (id, version))  -- versions immutable
enrollments(id, workspace_id, lead_contact_id, campaign_id, sequence_id, sequence_version,
            state, step, next_run_at, heat smallint, stop_reason,
            UNIQUE (campaign_id, lead_contact_id))
drafts(id, workspace_id, enrollment_id, step, channel, subject, body, claims jsonb,
       status CHECK (status IN ('generating','gating','blocked','review','approved','discarded','superseded')),
       gate_passed boolean, gate_body_sha text, gate_version text, gated_at,
       approved_by, approved_at,
       CONSTRAINT approved_requires_gate CHECK (
         status <> 'approved' OR (gate_passed AND
           gate_body_sha = encode(sha256(convert_to(coalesce(subject,'') || E'\n' || body,'UTF8')),'hex'))))
messages(id, workspace_id, draft_id UNIQUE, channel, mailbox_id, provider_message_id,
         provider_thread_id, reply_token UNIQUE,
         state CHECK (state IN ('claimed','sent','failed','handed_off','confirmed')),
         claimed_at, sent_at, error)
         -- BEFORE INSERT trigger send_guard(): §12.3
suppression(scope_org_id NULL, value_hash, kind, reason, created_at,
            UNIQUE (scope_org_id, value_hash))    -- NULL scope = global (hard bounce, complaint)
mailboxes(id, workspace_id, provider CHECK (provider IN ('gmail','graph','smtp_imap','bridge')), address,
          domain_id, daily_cap, warmup_day, health, paused_reason, credential_id)
sending_domains(id, workspace_id, name, registrar, dns_provider, spf_ok, dkim_ok, dmarc_ok, checked_at)
send_counters(mailbox_id, day, count, PRIMARY KEY (mailbox_id, day), CHECK (count >= 0))
```

**Inbox + meetings**
```sql
threads(id, workspace_id, contact_id, channel, provider_thread_id, UNIQUE (channel, provider_thread_id))
inbound(id, workspace_id, thread_id, provider_message_id UNIQUE, received_at, body_uri,
        label, confidence, handled_state, handled_at)
meeting_requests(id, workspace_id, contact_id, inbound_id, state, sla_due_at, resolved_at)
meetings(id, workspace_id, contact_id, calendar_connection_id, external_event_id,
         starts_at, state CHECK (state IN ('proposed','booked','confirmed','held','no_show','cancelled')),
         UNIQUE (calendar_connection_id, external_event_id))
```

**Content + publishing**
```sql
channel_accounts(id, workspace_id, connection_id, kind CHECK (kind IN ('page','profile','ad_account','channel')),
                 platform, external_account_id, UNIQUE (connection_id, external_account_id))
content_items(id, workspace_id, kind, status, title, body, asset_ids uuid[], source_refs jsonb,
              gate_passed, gate_body_sha, approved_by, approved_at)   -- same approved_requires_gate CHECK
publications(id, workspace_id, content_item_id, channel_account_id, scheduled_at,
             state CHECK (state IN ('scheduled','publishing','published','failed','cancelled')),
             external_post_id, published_at, error,
             UNIQUE (content_item_id, channel_account_id))
```

**Assets + knowledge** (§8, §18)
```sql
assets(id, workspace_id, kind, mime, size_bytes, sha256, original_name, source jsonb,
       understanding jsonb, pii_state, derived_from uuid NULL, created_at)
asset_versions(asset_id, n, gcs_uri, sha256, created_by, note, PRIMARY KEY (asset_id, n))
asset_derivatives(asset_id, version_n, kind, gcs_uri)
audits(slug PRIMARY KEY, workspace_id, account_id, asset_ids uuid[], expires_at, views int)
chunks(id, org_id, workspace_id, lead_contact_id NULL, corpus, source_uri, source_sha, section,
       body, tsv tsvector, embedding vector(768), visibility jsonb, outcome, created_at, expires_at)
```

**Integrations**
```sql
connections(id, workspace_id, connector_id, status, scopes text[], credential_id,
            cursor jsonb, last_sync_at, consecutive_errors)
credentials(id, org_id, ciphertext bytea, wrapped_dek bytea, kms_key_version, expires_at)
            -- column privileges: SELECT only for sender, inbox, publisher, connector_* roles
webhook_subscriptions(id, workspace_id, url, secret_ref, event_types text[], active)
deliveries(id, subscription_id, event_id, attempt, status_code, response_ms,
           UNIQUE (subscription_id, event_id, attempt))
```

**Billing** (§24), **ops** (§6, §7, §25)
```sql
credit_balances(org_id, meter CHECK (meter IN ('data','action','media')), balance bigint CHECK (balance >= 0),
                PRIMARY KEY (org_id, meter))
credit_ledger(id, org_id, meter, delta bigint, kind, ref_type, ref_id, created_at)   -- append-only
outbox(id bigserial, topic, key, payload jsonb, trace_id, created_at, published_at NULL)
idempotency(key PRIMARY KEY, scope, response jsonb, created_at)
system_mail_log(event_id UNIQUE, to_hash, template, provider_message_id, status, error, sent_at)
holds(scope_type, scope_id, reason, set_by, set_at, PRIMARY KEY (scope_type, scope_id))
audit_log(id, org_id, actor, action, entity_type, entity_id, before jsonb, after jsonb, at)
          -- REVOKE UPDATE, DELETE from every role
```

### 5.2 Realtime to the UI
Triggers `pg_notify('ws_<id>', …)` on draft, message, inbound and publication changes. `web`
holds one LISTEN connection per instance and fans out over SSE to that workspace's open sessions.
No second realtime database.

### 5.3 Analytics
**Datastream** CDC from Cloud SQL → **BigQuery** `[VERIFY]` for reporting, funnel metrics, post
metrics time series, AI-call logs and credit usage. BigQuery is read-only and derived; nothing
operational reads from it.

## 6. Events: transactional outbox

A DB write and its event must both happen or neither. Services write the event row into `outbox`
**in the same transaction** as the state change. `relay` polls
`WHERE published_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 500`, publishes to Pub/Sub
topic `events` with attributes `{type, org_id, workspace_id, event_id, trace_id}` and ordering key
= entity id, then stamps `published_at`.

**Consumers:** Pub/Sub push subscriptions per service, filtered by `type` attribute. Every
consumer is idempotent on `event_id` (§25).

**Dead letters:** every subscription has a dead-letter topic after 10 attempts. The `ops` console
lists them, shows the payload + last error, and replays one or all.

**Catalog** (`packages/events`, JSON Schema per type, versioned `type@v`):
`contact.created · evidence.captured · heat.changed · enrollment.started · draft.created ·
draft.gated · draft.approved · message.sent · message.failed · inbound.received · inbound.classified ·
meeting.requested · meeting.booked · meeting.held · meeting.no_show · enrollment.stopped ·
content.approved · publication.published · publication.failed · asset.ready · chunk.indexed ·
connection.synced · connection.failed · connector.webhook · credits.low · hold.set · hold.cleared ·
system_mail.requested` (consumed by `mailer`, which calls the Cloudflare Email Sending REST API; §21.1)

## 7. Scheduling and job registry

`infra/jobs.yaml` is the only list of scheduled work. Terraform generates Cloud Scheduler jobs
from it, and the ops status page reads it.

| Job | Cadence | Target |
|---|---|---|
| `sequencer.tick` | every 1 min | due enrollments → step tasks |
| `sender.drain` | every 1 min | approved + due drafts → send tasks (respects windows + caps) |
| `heat.score` | every 5 min | recompute heat from new signals |
| `inbox.poll` | every 2 min | mailboxes without push |
| `mail.rewatch` | daily | renew Gmail watches `[VERIFY 7-day expiry]` |
| `meetings.sla` | every 5 min | escalate `meeting_requests` past SLA |
| `meetings.reminders` | every 5 min | pre-meeting reminders, no-show follow-up |
| `publisher.drain` | every 1 min | due publications |
| `metrics.pull` | hourly | post + ad metrics |
| `breakers.evaluate` | every 15 min | §23 |
| `connectors.poll` | per connector | pull-only connectors |
| `domains.check` | daily | SPF/DKIM/DMARC per sending domain + omnisdr.com records (§21.1) |
| `retention.sweep` | daily 03:00 UTC | §27 |
| `rag.golden` | nightly | §18 |
| `relay` | continuous (min-instances 1) | outbox |

**Split of responsibilities:** Postgres (`next_run_at`, `scheduled_at`) is the schedule. Cloud
Tasks is the executor, with named tasks (`send-<draft_id>`, `step-<enrollment_id>-<step>`) so
duplicates are rejected at enqueue. Cloud Scheduler only wakes the drains.

---

# Part C — Engines

## 8. Intake and assets (any file type)

```
upload (resumable signed URL) · email-in (intake+<ws>@in.omnisdr.com) · connector pull · generator output
   → gs://omni-<env>-quarantine/<org>/<asset>
   → Eventarc finalize → intake
      1. magic-byte type sniff; allowlist per plan; size cap per plan
      2. ClamAV scan (Cloud Run, signatures refreshed daily)  — GCP has no native AV
      3. move to gs://omni-<env>-assets (object versioning on), INSERT assets + asset_versions
      4. Workflow "understand" by kind:
           document → Document AI layout → text.md; LibreOffice job → preview.pdf
           image    → thumbs; Gemini caption + labels
           video    → Transcoder → HLS + poster; Speech-to-Text transcript; shot list
           audio    → Speech-to-Text transcript + diarization
           sheet    → typed tables (feeds contact import)
      5. Sensitive Data Protection inspect → pii_state (none|found|redacted)
      6. outbox: asset.ready  → indexer (§18)
```
**Buckets:** `quarantine` (1-day lifecycle delete), `assets` (versioned), `derivatives`
(regenerable, 90-day lifecycle on unused), `snapshots` (evidence raw bytes, 90 days),
`exports`. Served only via short-lived signed URLs or Cloud CDN signed cookies on
`files.omnisdr.com`.

**Editing = new version.** Every edit path (in-app editors, Google Docs/Sheets/Slides round-trip,
Imagen mask edit, video composition render) writes `asset_versions.n+1` with `derived_from`
lineage. Nothing mutates a stored object in place.

## 9. Enrichment, evidence, heat

- **Account discovery:** CSV/Sheet import, connector pull (CRM), Google Places (store `place_id` +
  allowed fields only `[VERIFY Maps caching terms]`), licensed data vendor via connector.
- **Evidence capture:** website teardown (port `leadgen/starter.js`: browser UA first, parked-domain
  detection, `null` for unseen signals), storefront signals (platform fingerprint + public gaps),
  hiring pages, manual URL+quote. Raw bytes → `snapshots` bucket, sha stored on `evidence`.
- **Contact verification:** email verification API before any enrollment; `email_status` must be
  `valid` for the send guard to pass.
- **Heat (1–5):** the strongest recent signal sets heat (a reply beats a click beats a post
  reaction), decays one level after 14 quiet days `[tunable]`. Written to `enrollments.heat` +
  `heat.changed` event.

## 10. AI gateway (`packages/ai`)

Every model call in every service goes through this package. Nothing calls Vertex directly.

| Concern | Implementation |
|---|---|
| **Routing** | `tasks.yaml`: task → model, temperature, max tokens, response schema, timeout, fallback model. E.g. `draft.email` → Gemini Pro; `reply.classify` → Gemini Flash |
| **Prompt registry** | Prompts live in the repo, versioned; each output row stores `prompt_id@sha` + model id |
| **Structured output** | `responseSchema` on every generating call; parse failure = retry once, then `blocked` |
| **Grounding input** | Retrieved chunks and evidence are wrapped in a labelled data block; tools disabled on drafting calls (prompt-injection containment) |
| **Context caching** | Per-workspace brief (offer, voice, ICP, booking link) cached `[VERIFY TTL + min size]` |
| **Quota + retries** | Per-model token bucket; exponential backoff on 429/503; quota-increase requests filed at P0 |
| **Metering** | Every call writes tokens + cost estimate to the ledger reservation (§24) and a log row to BigQuery |
| **Media** | Imagen, Veo, TTS calls are async jobs with the same metering + reservation |
| **Evals** | `tests/ai/`: fixed input sets per task with pass criteria; run in CI on prompt or model changes |

## 11. Evidence-bound drafting

`sequencer` → Cloud Task `draft.generate` → AI gateway with: workspace brief (cached) + retrieved
exemplars (§18) + this contact's evidence facts → JSON `{subject, body, claims[{text, evidence_id, fact_key}]}`
→ `drafts` row `status='gating'` → `draft.created`.

## 12. Claims gate (database-enforced)

### 12.1 The check (`gate` service, deterministic, fails closed)
1. every `claims[].evidence_id` belongs to this contact's account and is unexpired
2. every `fact_key` exists on that evidence, and every number in the claim text equals the fact value
3. every sentence in the body containing a digit, `$`, `%` or a superlative maps to a claim
4. banned phrases (implied prior contact, generic filler), no competitor names
5. revenue-loss figures only from the named formula with its inputs attached, never from the model
6. tenant claims (case-study numbers, prices) count only if sourced from a tenant-approved asset

### 12.2 Why nobody can switch it off
- Only DB role `gate_svc` has `UPDATE (gate_passed, gate_body_sha, gate_version, gated_at)` on
  `drafts` and `content_items`. No other role, including `web`, can set them.
- `approved_requires_gate` (§5.1) makes an approved-but-ungated or edited-after-gating draft
  impossible to store. Editing the body changes the sha, so approval fails until it's re-gated.

### 12.3 `send_guard()`: BEFORE INSERT ON messages
Rejects the insert (so the sender never reaches the provider) unless **all** hold:
- the draft is `approved` and its sha still matches (re-checked here)
- no row in `holds` for the org, workspace, campaign or mailbox
- the contact's email/phone hash is not in `suppression` (org scope or global)
- `contacts.email_status = 'valid'` for email
- the mailbox isn't paused and today's `send_counters.count < daily_cap` (incremented in the same txn)
- the workspace trust level permits it: level 1 requires `approved_by`; levels 2–3 require heat ≥ 4 and the §23 conditions
- `UNIQUE (draft_id)` stops a second insert, so exactly-once is structural

**Sabotage suite:** `tests/gate/` seeds known-bad drafts (invented number, wrong evidence id, edited
after approval, suppressed contact, paused mailbox, cap exceeded, held workspace) and asserts every
one is refused, printing `refused N of N` with N = the seeded count.

## 13. Sequence engine (outreach + follow-up)

### 13.1 Definition (immutable, versioned JSON)
```json
{ "steps": [
    { "id": "e1", "channel": "email", "wait": { "business_days": 0 }, "prompt": "draft.email.first_touch" },
    { "id": "e2", "channel": "email", "wait": { "business_days": 3 }, "when": "no_reply", "prompt": "draft.email.bump" },
    { "id": "l1", "channel": "linkedin_assist", "wait": { "business_days": 1 }, "when": "heat>=4" },
    { "id": "e3", "channel": "email", "wait": { "business_days": 4 }, "when": "no_reply", "prompt": "draft.email.breakup" }
  ],
  "stop_on": ["any_reply", "meeting_booked", "unsubscribe", "hard_bounce", "crm_stage_changed", "suppressed"] }
```
An enrollment pins `sequence_version`, so edits apply only to new enrollments.

### 13.2 States
`active → waiting → drafting → awaiting_approval → scheduled → sent → waiting … → completed`
with side exits `paused(hold)`, `snoozed(until)`, `stopped(reason)`, `converted(meeting)`.

### 13.3 Mechanics
- `sequencer.tick`: `SELECT … FROM enrollments WHERE state='waiting' AND next_run_at <= now()
  FOR UPDATE SKIP LOCKED LIMIT 200` → evaluate `when` → enqueue `draft.generate` or skip → set next state.
- **Send windows:** computed in the **contact's** timezone as UTC instants; random offset inside
  the window; never weekends/holidays per workspace calendar.
- **Stop rules are events:** `inbound.received`, `meeting.booked`, suppression inserts and CRM
  stage changes each stop matching enrollments in one transaction, and cancel their named tasks.

## 14. Sender (the only egress to a person)

**Adapters** (`packages/connectors`, called only from `sender`):
| Adapter | Scope / API | Notes |
|---|---|---|
| `gmail` | `gmail.send` (+ read scopes in `inbox`) | Stage A internal Workspace app; public stages per §29 |
| `graph` | Microsoft Graph `Mail.Send` | Outlook / M365 tenants |
| `smtp_imap` | SMTP send + IMAP IDLE/poll read, app password or OAuth | Any other provider (Zoho, Fastmail, cPanel hosts). No Google verification involved; credentials in the same KMS envelope |
| `bridge` | Hosted mailbox provider behind the same interface | Optional, until own OAuth verification lands; swappable |
| `sms` | Twilio | Post-reply only; requires a consent event on the contact |
| `linkedin_assist` | Extension queue | `messages.state='handed_off'` → extension confirms → `confirmed`; the human clicks send |

**Send path:** Cloud Task `send-<draft_id>` → txn: `INSERT messages(state='claimed')` (the guard
runs) → commit → provider call with idempotency header where supported → `UPDATE state='sent',
provider_message_id` + outbox `message.sent`. Provider failure → `failed` + retry policy per error
class. A retry reuses the same `messages` row, so a second insert can't happen.

**Reply routing (Stage B):** when the mailbox has no read scope, the message carries
`Reply-To: r+<reply_token>@reply.omnisdr.com`. The Email Worker (§21.1) maps the token →
`messages.reply_token`, posts to `api /hooks/email`, and forwards the original to the tenant's
real inbox.

**Mail hygiene:** `List-Unsubscribe` + one-click POST header pointing at `u.omnisdr.com`, the
tenant's postal address, thread headers for follow-ups, no open-tracking pixel, links only to the
tenant's own domain or its audit page.

## 15. Inbox, follow-up and meeting lifecycle

- **Ingest:** Gmail push (Pub/Sub watch) or poll; Graph change notifications; Twilio webhook;
  Email Worker (Reply-To route); bridge webhook. Dedup by `provider_message_id`. Stop enrollments
  first, then classify.
- **Classify** (AI gateway, Flash, fixed labels): `meeting_request · question · objection_price ·
  objection_timing · referral · out_of_office · not_interested · unsubscribe · other`, with
  confidence < 0.8 → human queue.
- **`unsubscribe` / `not_interested`** write suppression before anything else.
- **Follow-up actions** (all drafts, gated, human-approved at every trust level):
  `question/objection` → retrieval-grounded answer draft; `referral` → new contact + enrollment;
  `out_of_office` → parse the return date, snooze to it; `objection_timing` → snooze to the stated date.
- **Meeting lifecycle (the part that leaks today):**
  1. `meeting_request` creates `meeting_requests` with `sla_due_at` = 2 business hours `[tunable]`.
  2. Auto-drafted reply with the booking link or 3 slots from Calendar free/busy.
  3. `meetings.sla` escalates past-SLA requests: push notification → chat → email to the operator.
  4. The calendar connector webhook → `meeting.booked` → stops the enrollment → confirmation + reminders.
  5. After `starts_at`: mark `held` (calendar attendance or operator click) or `no_show` → a
     reschedule draft.
  6. Every state change is written to the CRM connector if one is connected.

## 16. Content studio and publishing (the only egress to a public channel)

- **Pipeline:** `idea → draft → review → approved → scheduled → published | failed`. Sources: campaign
  findings, RAG, uploaded assets, manual. Generation via §17; claims gate applies to anything with a
  number or a named business.
- **Scheduling:** `publications.scheduled_at` per channel account; `publisher.drain` claims due rows
  with `SKIP LOCKED`; `UNIQUE (content_item_id, channel_account_id)` stops double posting.
- **Per-platform adapters:** LinkedIn company pages + ads (Matched Audiences, Message Ads, Thought
  Leader Ads, Lead Gen Forms → webhook), Meta (Facebook + Instagram), YouTube, TikTok, X, Google
  Business Profile. Each has its own rate-limit bucket and media spec (aspect ratio, duration, size),
  checked **before** scheduling, not at publish time.
- **Media transforms** per platform (crop, transcode, caption burn-in) are `generator` jobs producing
  derivatives. The approved item stays one asset.
- **Metrics:** `metrics.pull` hourly → BigQuery; post engagement from a known contact feeds heat.
- **Ads spend** runs on the tenant's own ad account. Omni-SDR never holds media money.

## 17. Generation pipelines

Each output is a Workflow with a job row the UI subscribes to. Credits are **reserved before
start** and settled or released at the end (§24).

| Output | Steps |
|---|---|
| Report / audit / proposal | retrieve → Gemini section JSON → gate → HTML template → headless Chrome PDF (Cloud Run job) and/or Docs API doc → asset → optional `audits` page on `audit.omnisdr.com` |
| Deck | outline → gate → Slides API from the workspace master → PPTX export |
| Image | Imagen with brand kit; text + logo as code-rendered overlay layers; mask edits = new version |
| Video | script → gate → TTS → site screenshots/capture (headless Chrome) + optional Veo clips → Remotion composition → render job → Transcoder renditions |
| Batch personalization | one template × N contacts, fan-out render jobs, capped by reserved credits |
| Sheets / exports | typed rows → XLSX/CSV/Sheets |

Render jobs are Cloud Run jobs (x64) with task parallelism; outputs go straight to `derivatives`
and register as assets.

**Audit pages:** slug = `<business>-<8 random base32>`, `noindex`, no contact PII, 60-day expiry,
views write a signal (bots filtered by UA + JS beacon).

## 18. Knowledge layer (RAG)

- **Corpora:** workspace knowledge (offer, case studies, voice, SOPs), proven messages labelled with
  outcome, prospect knowledge (evidence, pages, transcripts, threads; expires with evidence), CRM +
  commerce history, bulk archives (ZIP, mbox/PST, CSV, recordings).
- **Never indexed:** Places review text, PII-restricted assets, suppressed contacts' content.
- **Indexer:** normalize (Document AI layout) → structure-aware chunks (headings 300–800 tokens,
  tables whole, transcripts as ~2-minute speaker windows, one email per chunk) → one-line context
  header per chunk → sha dedupe (unchanged chunks skipped) → Vertex embeddings (batch)
  `[VERIFY model id + dims]` → `chunks` row + tsvector.
- **Store:** the same Cloud SQL instance, `chunks` table, HNSW on `embedding`, GIN on `tsv`, RLS.
  Split into its own instance only when vector load competes with transactional load.
- **Retrieve:** query rewrite (Flash) → vector top-50 + keyword top-50 → reciprocal-rank fusion →
  scope/visibility/expiry filter → Vertex ranking API → top k with near-duplicates dropped →
  citations (chunk → source_uri + sha + section).
- **Efficiency:** workspace brief in context cache (no retrieval), per-query-hash cache 10 min,
  k + token budgets per task.
- **Learning loop:** `chunks.outcome` updated on reply/meeting; drafting retrieves the closest
  exemplars that got replies.
- **Quality gate:** per-workspace golden set (30 answerable + 10 must-return-not-found), nightly
  recall@8 + citation accuracy; regressions past the measured noise floor block retrieval-config deploys.
- **Deletion:** follows source: asset delete, suppression, tenant delete, Shopify redact.

## 19. Integration fabric

### 19.1 Connector contract (`packages/connectors/<id>/manifest.ts`)
```ts
{ id, auth: 'oauth2'|'apiKey'|'basic', scopes, rateLimit: { perSecond, perDay },
  triggers: [{ event, mode: 'webhook'|'poll', cursor? }],
  actions:  [{ name, input: JSONSchema, output: JSONSchema, idempotent: boolean }],
  sync:     { objects: ['contact','company','deal','event','file','product','order'], direction },
  mapping:  defaultFieldMap,            // overridable per workspace
  webhookVerify(req): boolean }
```

### 19.2 Runtime
- One `connector-runtime` image; deployed as **groups** (`crm`, `calendar`, `commerce`, `storage`,
  `social`, `chat`, `data`) so one vendor's outage or rate limit can't starve the rest. Each group
  has its own Cloud Tasks queue with vendor-matched rate limits.
- **Outbound calls** leave via Cloud NAT with a reserved static IP, which can be given to vendors
  that allowlist IPs.
- **Inbound webhooks** land on `api.omnisdr.com/hooks/<connector>/<connection_id>`, verified by the
  manifest, written to `outbox` as `connector.webhook`, acked fast, processed async.
- **OAuth callbacks** use one redirect base, `https://api.omnisdr.com/oauth/<connector>/callback`,
  registered once per vendor app.
- **Sync:** upsert by `external_refs (connection_id, external_id)`; per-field system-of-record flags
  per workspace; conflicts → `sync.conflict` event, never silent overwrite.
- **Tokens:** `credentials` envelope-encrypted (KMS-wrapped DEK); refresh centrally; a refresh
  failure sets `connections.status='reauth'` and notifies.
- **Contract tests:** each connector ships recorded **real** payloads (fetched once, secrets
  scrubbed) and asserts mapping on them, including the fields that are absent.

### 19.3 Reach
| Tier | Mechanism |
|---|---|
| Native | Calendars (Google, Outlook, Calendly, Cal.com) · CRMs (HubSpot, GoHighLevel, Salesforce, Pipedrive, Zoho, Close, Attio, Dime Data CRM via its `/mcp`) · Mail (Gmail, Graph, bridge) · Sales tools (Instantly, Smartlead, Apollo) · Data (Apollo, Clay, verification) · Commerce (Shopify first; WooCommerce, BigCommerce, Square, Wix, Squarespace) · Social/ads (LinkedIn pages+ads, Meta, YouTube, TikTok, X, GBP) · Storage (Drive, Dropbox, OneDrive, Box, Notion) · Chat (Slack, Google Chat, Teams) · Meetings (Meet, Zoom) · Payments (Stripe) · Forms (Typeform, Tally, Google Forms) |
| Open | Public REST `api.omnisdr.com/v1` (OpenAPI 3.1, API keys + OAuth apps), signed outbound webhooks (HMAC-SHA256 + timestamp, retries via Tasks, `deliveries` log), MCP server `api.omnisdr.com/mcp` (`search_knowledge`, `get_contact`, `create_contact`, `enroll`, `list_drafts`, `approve_draft`, `generate`) |
| Marketplace | Zapier / Make / n8n apps built on the Open tier |
| Enterprise | Google Application Integration connectors, per customer need `[VERIFY pricing]` |

### 19.4 Shopify specifics
Admin GraphQL API; bulk operations for full syncs; mandatory privacy webhooks
(`customers/data_request`, `customers/redact`, `shop/redact`) wired to §27 deletion;
`app/uninstalled` revokes + deletes; protected-customer-data fields requested one by one; HMAC on
every webhook; one internal `commerce` shape (product, customer, order) that every commerce
connector maps into `[VERIFY all]`.

---

# Part D — Cross-cutting

## 20. Identity and access

- **Humans:** Identity Platform (Google sign-in, Microsoft sign-in, email link) on
  `auth.omnisdr.com` as the custom auth domain `[VERIFY]`; the session cookie is scoped to
  `app.omnisdr.com` only, and `web`/`api` set the RLS context from it.
- **Roles:** `owner` (billing, delete), `admin` (connections, members), `operator` (campaigns,
  approve), `reviewer` (approve/edit only), `client_viewer` (read one workspace).
- **Machines:** API keys (hashed, scoped, per workspace); OAuth 2.1 + PKCE for add-ons, extension,
  MCP clients.
- **Signed action tokens:** approvals from email/chat/extension carry a single-use token bound to
  `draft_id` + `gate_body_sha`; approving a since-edited draft is refused.

## 21. Network, domains and perimeter

### 21.1 omnisdr.com

**DNS stays on Cloudflare** (the registrar requires it `[VERIFY]`), managed only by Terraform with
a scoped API token (Zone:DNS:Edit on this zone only) stored in `~/.halo-keys/`, never in the repo
or transcript. Records point at Google in **DNS-only (grey-cloud) mode**, so Google's load balancer
terminates TLS with Google-managed certificates and Cloud Armor is the single WAF. Proxying through
Cloudflare as well would put two TLS terminations and two sets of rate limits in the path.

| Hostname | Points to | Purpose |
|---|---|---|
| `omnisdr.com`, `www` | (marketing; out of scope here) | — |
| `app.omnisdr.com` | Google LB → `web` | Product UI; the only host with session cookies |
| `api.omnisdr.com` | Google LB → `api` | `/v1`, `/hooks/*`, `/oauth/*`, `/mcp` |
| `audit.omnisdr.com` | Google LB → `web` (audit route only) | Public audit pages; cookieless, separate origin from the app |
| `files.omnisdr.com` | Google LB → Cloud CDN → `assets`/`derivatives` buckets | Signed asset delivery |
| `u.omnisdr.com` | Google LB → `api` | One-click unsubscribe endpoints |
| `auth.omnisdr.com` | Identity Platform custom domain | Sign-in |
| `status.omnisdr.com` | Status page | Uptime of public endpoints |
| `in.omnisdr.com` | MX → Cloudflare Email Routing → Email Worker | `intake+<ws>@in.omnisdr.com` file/lead intake |
| `reply.omnisdr.com` | MX → Cloudflare Email Routing → Email Worker | Stage B `r+<token>@` reply routing |
| `notify.omnisdr.com` | Cloudflare Email Sending (SPF + DKIM set by Cloudflare) | System mail: invites, alerts, digests, meeting-SLA escalations |
| `dev.` / `*.dev.omnisdr.com` | `omni-dev` LB | Dev environment mirror of the above |

**Mail rules for the product's own domain:**
- The **root `omnisdr.com` never sends prospect mail**. Tenants send from their own domains
  (principle 8). System mail goes out only from `notify.omnisdr.com`.
- Root DMARC starts at `p=none` with reporting, then moves to `p=reject` once `notify.` aligns.
  Root SPF is `v=spf1 -all` unless root mail is added later.
- `in.` and `reply.` accept mail only. Their Email Worker checks the recipient token format,
  size-caps the message, and posts it to `api` with an HMAC signature. It's the only non-GCP
  runtime, is kept stateless and small, and has no secrets beyond that HMAC key.

**Cloudflare email plan (checked 2026-09-28 against Cloudflare's pricing docs):**
| Direction | Plan | Cost |
|---|---|---|
| Inbound: Email Routing → Email Worker (`in.`, `reply.`) | Free or Paid | Routing unlimited; the Worker is billed at standard Workers rates |
| Outbound: Email Sending (`notify.`) | **Workers Paid only** (beta) | 3,000/month included per account, then $0.35 per 1,000; hard bounces count, suppression-blocked sends don't |

**Decision: Workers Paid. Active on the account as of 2026-09-28 ($5/month, per Christian).** It's one account-level subscription covering system mail and the
inbound Worker, and 3,000 included sends/month covers system mail well past the first tenants.
- **The send path: REST API from a `mailer` service on Cloud Run.** Services never call
  Cloudflare directly. They write a `system_mail.requested` outbox event, and `mailer` (Pub/Sub
  push, internal ingress) calls Cloudflare's Email Sending REST API and writes the provider
  message id or error back to `system_mail_log` in the same service. That gives a direct success or
  failure per message, with no second hop to report results back.
  - **Worker binding: rejected** for outbound. It needs no token, but GCP would have to call a
    Worker, and the Worker would have to report results back. That's two hops and a second place
    for sends to fail silently. The Email Worker stays **inbound only**.
  - **SMTP relay: rejected.** It exists for libraries that only speak SMTP, and it reports
    failures less precisely than the REST API.
  - **Token:** a Cloudflare API token with **Email Sending: Edit only**, stored in Secret Manager
    and readable only by `mailer-sa`. It's separate from the DNS token, so a leak of one can't
    touch the other.
  - **Idempotency:** `system_mail_log(event_id UNIQUE, …)`. A redelivered event finds its row and
    doesn't send twice.
- **Budget and failure:** system mail has its own budget alert at 80% of the included 3,000.
  If a send fails, the escalation chain in §15 falls back to push notification + chat.
- **Prospect mail never goes through Cloudflare.** It leaves only from the tenant's own mailbox
  via `sender` (principle 8). Cloudflare Email Sending is for Omni-SDR's own notices.
- **Fallback if the beta changes:** Gmail API from a Workspace account on `notify.`, behind the
  same outbox event.

**Hardening:** DNSSEC on; registrar lock on; CAA records allowing only `pki.goog` (Google-managed
certs) plus whatever `notify.`'s provider needs; Cloudflare account on hardware-key 2FA with
the token scoped per zone.

**Tenant custom domains (later):** `audit.<tenant>.com` → CNAME to `audit.omnisdr.com`, with
certificates issued through **Google Certificate Manager** DNS authorization on the same load
balancer. `workspaces.audit_hostname` routes it.

### 21.1b Go-to-market subdomain: try.omnisdr.com

Omni-SDR's own marketing outreach (outbound and its replies) runs on **`try.omnisdr.com`**
(decided by Christian, 2026-09-28). The root domain and every other product hostname never send
cold mail.

**Known trade-off:** mailbox providers weigh reputation at the organizational domain as well as
per subdomain, and blocklists can list a parent domain for a subdomain's behavior. So a
cold-mail problem on `try.` can still reach `omnisdr.com`. The design below narrows that blast
radius; it can't make it zero. If `try.` is ever blocklisted, the fallback is moving outreach to a
separately registered domain, which only needs new DNS + mailboxes because of the tenant-#0 model below.

| Record / use | Setting |
|---|---|
| DNS | Cloudflare, `omnisdr.com` zone, same Terraform module |
| MX (`try.`) | Google Workspace, with `try.omnisdr.com` added as a secondary domain; replies land in real mailboxes |
| Mailboxes | 2–3 Workspace users `@try.omnisdr.com` (e.g. `christian@try.omnisdr.com`), connected to Omni-SDR like any tenant mailbox |
| SPF (`try.`) | Its own record: `v=spf1 include:_spf.google.com -all`. The root's `-all` stays untouched |
| DKIM | Its own Google Workspace key for `try.`, a separate selector from `notify.` |
| DMARC | Its own `_dmarc.try.omnisdr.com` record (`p=none` with reporting during warmup → `quarantine` → `reject`), so its policy and reports are separate from the root's. The root record's `sp=` doesn't govern `try.` once `try.` has its own |
| Links in cold mail | **Only** `try.omnisdr.com` (landing page + unsubscribe at `try.omnisdr.com/u/<token>`, same `api` handler). `app.`, `audit.`, `u.` and the bare root never appear in a cold email, so link-domain reputation stays on `try.` too |
| Web (`try.`) | Landing page (marketing; out of scope here); its sign-up button goes to `app.omnisdr.com` |
| Caps | Tighter than tenants because the parent is shared: 5/day/mailbox ramping to **20**, never 30. The same breakers (§23), plus a **domain-level hold**: any spam complaint or blocklist hit on `try.` pauses all `try.` mailboxes at once |
| Monitoring | Google Postmaster Tools verified for `try.omnisdr.com` **and** `omnisdr.com` separately; `domains.check` adds a daily blocklist lookup for both; a root-domain reputation drop pages immediately |

**How it runs:** Omni-SDR sells itself as **tenant #0**: an `omni-gtm` org inside the product,
with the `try.` mailboxes connected through the normal `gmail` adapter. It gets no special code
path, and it's the first real test of the whole outreach + follow-up system (P3).

**Workspace + Cloud organization (this unlocks Stage A):** run one Google Workspace with
`omnisdr.com` as the primary domain and `try.omnisdr.com` as a secondary domain. Create the Google
Cloud **organization** from that Workspace and move `omni-dev`/`omni-prod` under it. Then the Gmail
OAuth app can be **Internal**, which needs no Google verification and no security assessment, for
every `try.` mailbox. A mailbox in a different Workspace (e.g. Dime Data's) isn't covered by an
internal app; it needs the external app in testing mode or the §29 #1 stages.

**Without Workspace (supported, costs more work):** GCP projects run without an organization,
under the owner's account. The Gmail OAuth app is then **External in testing mode**: up to 100 test
users, and refresh tokens for Gmail scopes expire after 7 days `[VERIFY]`, so each `@gmail.com`
mailbox re-authorizes weekly until the app is verified. For `try.` mailboxes on another provider,
use the `smtp_imap` adapter (§14). **Never send cold mail through Cloudflare Email Sending:** it's
built for transactional mail `[VERIFY terms]`, and it shares an account with the DNS and `notify.`,
so one abuse action would take down all three.

**Hostname map:**
| Hostname | Carries | Never carries |
|---|---|---|
| `omnisdr.com` root + `app.` `api.` `audit.` `files.` `u.` `auth.` | Product, API, customer data, audit pages | Any cold mail, any link inside cold mail |
| `notify.` | System mail only (Cloudflare Email Sending) | Marketing or cold mail |
| `in.` `reply.` | Inbound routing only | Outbound |
| `try.` | Omni-SDR's own outbound + replies, marketing landing | Product login, API, customer data |
| Tenant domains | Each customer's own outreach | Anything of ours |

### 21.2 Network
- Global external HTTPS load balancer with host rules per §21.1 → serverless NEGs for `web` and
  `api`, backend bucket for `files.`; **Cloud Armor** (OWASP rules, per-IP rate limits on `/hooks`,
  `/v1`, auth routes; geo policy per plan).
- All other services `ingress=internal`, invoked via IAM (Pub/Sub push, Tasks, Scheduler,
  Workflows use OIDC tokens).
- VPC with Direct VPC egress from Cloud Run; Cloud SQL on private IP; Cloud NAT with a static IP.
- VPC Service Controls perimeter around Storage, Vertex AI, Cloud SQL Admin, BigQuery once in
  production with tenants `[VERIFY service support]`.

## 22. Secrets, keys, service accounts

| Service account | Grants (least privilege) |
|---|---|
| `web-sa`, `api-sa` | Cloud SQL client (role `app_rw`), Tasks enqueuer, Storage object creator on `quarantine`, Vertex user |
| `gate-sa` | Cloud SQL client (role `gate_svc`) |
| `mailer-sa` | Cloud SQL client (role `mailer_svc`: `system_mail_log` only), Secret access on the Email Sending token, Pub/Sub subscriber |
| `sender-sa` | Cloud SQL client (role `sender_svc`), KMS decrypt on `credentials-mail`, `credentials-sms` |
| `inbox-sa` | KMS decrypt on `credentials-mail`, Pub/Sub subscriber |
| `publisher-sa` | KMS decrypt on `credentials-social` |
| `connector-<group>-sa` | KMS decrypt on `credentials-<group>` |
| `intake-sa`, `generator-sa`, `indexer-sa` | Storage on their buckets, Vertex user, Document AI, DLP |
| `ops-sa` | Cloud SQL role `ops` (BYPASSRLS), job-only, no HTTP ingress |

Keyrings: one per credential class, so `web` compromised ≠ any mailbox or social account
compromised. App secrets live in Secret Manager, mounted as env at deploy, and rotation is
documented per secret. The Cloudflare DNS token, Email Sending token (`mailer-sa` only) and Email Worker HMAC key live in Secret Manager
for CI and in `~/.halo-keys/` locally.

## 23. Autonomy controls

| Trust level | Enforced in `send_guard()` / publisher |
|---|---|
| 1 Manual | `approved_by` required on every draft and content item |
| 2 Guarded | Auto-approve only when: gate passed with no warnings, heat ≥ 4, ≥ 2 evidence items, mailbox past warmup, workspace has ≥ 50 manual sends at < 2% bounce |
| 3 Full | Level 2 + owner re-confirmation within 30 days + weekly sample review queue |

**Breakers** (`breakers.evaluate`) write `holds` rows, and only a human deletes them:
hard bounce > 3% over the last 50 sends → mailbox hold; any spam complaint → mailbox hold + workspace
to level 1; unsubscribe/negative > 5% over 100 → campaign hold; connector 401 streak → connection
`reauth`; publish failures ×3 → channel-account hold. Every hold emits `hold.set` and notifies.

## 24. Metering and credits ledger

- Three meters: **data** (enrichment, verification, reveals, Places), **action** (drafts,
  classifications, bookings, assisted touches, publishes), **media** (Imagen, Veo, TTS, renders).
  Sends cost nothing.
- **Reserve → settle → release:** before any metered job, one transaction decrements
  `credit_balances` (the `CHECK (balance >= 0)` refuses overspend) and appends a `reserve` ledger
  row. On completion, `settle` adjusts to the actual cost; on failure, `release` refunds.
- Plan grants are `grant` rows on the billing cycle. Stripe events (via connector) write `purchase`
  rows. The ledger is append-only; balances are a cache verifiable by `SUM(delta)`, checked nightly.

## 25. Reliability

- **Idempotency:** named Cloud Tasks; `UNIQUE` on every "exactly once" fact (`messages.draft_id`,
  `publications(content_item_id, channel_account_id)`, `inbound.provider_message_id`,
  `external_refs`); `idempotency` table for public API `Idempotency-Key`; consumers dedupe on `event_id`.
- **Retries:** Tasks + Pub/Sub exponential backoff; error classes (retryable / auth / permanent)
  per adapter; permanent → `failed` + event, never infinite retry.
- **Backpressure:** per-vendor queues with rate limits; drains claim with `SKIP LOCKED LIMIT n`.
- **Backups / DR:** Cloud SQL automated backups + PITR (RPO ≤ 5 min), cross-region backup copy;
  GCS `assets` versioned, dual-region for prod `[VERIFY cost]`; RTO target 4 h via a documented
  restore runbook, rehearsed quarterly on `omni-dev`. DNS is in Terraform, so records are restorable
  from code.
- **Deploys:** Cloud Run gradual traffic (10% → 100%) with automatic rollback on error-rate SLO
  burn; migrations expand → deploy → contract, never breaking in one step.

## 26. Observability

- OpenTelemetry in every service → Cloud Trace + Logging + Monitoring. `trace_id` propagates
  through outbox rows, Pub/Sub attributes and Task headers, so a send can be traced from tick to
  provider response.
- Structured logs only; tenant ids as labels; secrets and message bodies never logged. Bodies are
  referenced by id.
- Uptime checks on `app.`, `api.`, `audit.`, `u.` and the inbound-mail path (a synthetic message to
  `in.` every 15 min must reach `asset.ready`).

| SLO | Target |
|---|---|
| Approved draft sent inside its window | 99% |
| Inbound reply → classified + enrollment stopped | p95 < 2 min |
| Meeting request → operator notified | p95 < 5 min |
| Document intake → `asset.ready` | p95 < 5 min (≤ 50 MB) |
| Scheduled publication posted | 99% within 5 min of `scheduled_at` |
| `/v1` availability | 99.9% |

Alerts on SLO burn, DLQ depth > 0 for 15 min, outbox lag > 2 min, any `hold.set`, credential
`reauth` spikes, and `domains.check` failures on omnisdr.com records. Routed to push
notifications + chat.

## 27. Data lifecycle

| Data | Retention |
|---|---|
| Evidence facts | 30 days, unless the contact is actively enrolled |
| Evidence raw snapshots | 90 days |
| Messages + inbound bodies | 24 months |
| Audit log | 24 months minimum |
| Suppression | forever; never touched by sweeps |
| Chunks | follow their source |
| Places data | `place_id` only; display re-fetched |
| Quarantine objects | 1 day |
| Audit pages | 60 days |

**Deletion** is an `ops` job keyed by scope (asset, contact, workspace, org, Shopify redact). It
walks every table with that key, GCS prefixes and chunks, revokes OAuth grants, and writes an
audit row with counts per table. The table list is **derived from the catalog** (every table with
`org_id`), not hand-maintained.

## 28. Testing and release gates

| Suite | Runs | Asserts |
|---|---|---|
| Unit (`packages/core`) | every PR | state machines, gate rules, heat |
| DB | every PR, against a real Postgres | constraints, triggers, `send_guard`, ledger |
| **RLS matrix** | every PR | for **every table with `org_id` (count printed)**, tenant A reads 0 rows of tenant B |
| **Gate sabotage** | every PR | `refused N of N` seeded bad drafts |
| Connector contracts | every PR touching a connector | mapping on recorded real payloads |
| AI evals | on prompt/model change | per-task pass thresholds |
| RAG golden | nightly | recall@8, citation accuracy, not-found rate vs noise floor |
| E2E new-customer walk | before each prod deploy, on `dev.omnisdr.com` | sign up → connect Gmail (test workspace) → import → enroll → approve → send → reply → meeting booked → enrollment stopped |

A deploy is blocked if any suite fails **or reports a zero denominator**.

---

# Part E — Constraints and order

## 29. Platform constraints register (confirm before the dependent phase)

| # | Constraint | Design response | Phase |
|---|---|---|---|
| 1 | Gmail read scopes are restricted (verification + annual security assessment); `gmail.send` is sensitive | Stage A internal app → Stage B send-only + `reply.omnisdr.com` routing or `bridge` → Stage C full | P3 / P8 |
| 2 | Gmail watch expires ~7 days | `mail.rewatch` daily | P3 |
| 3 | Places API: few reviews per place, no reliable owner replies, caching restricted | No review-text evidence; `place_id` only | P2 |
| 4 | No API for personal-profile LinkedIn invites/DMs | `linkedin_assist` lane (human clicks) + sanctioned pages/ads APIs | P4 |
| 5 | LinkedIn Marketing API access is an application; Matched Audiences have a minimum size; Message Ads region limits | Apply at P0; segment-level targeting | P0 / P4 |
| 6 | Meta, TikTok, YouTube, X publishing apps need review; each needs a privacy policy + terms URL on the domain | Apply at P0 with `omnisdr.com/privacy` + `/terms` live | P0 / P4 |
| 7 | Twilio A2P 10DLC per brand (ISV model); TCPA consent | SMS post-reply only; consent event required by guard | P9 |
| 8 | Shopify: GraphQL-only, privacy webhooks, protected data approval, app review | §19.4 | P6 |
| 9 | Vertex model availability + quotas per region; context-cache minimums | `us-central1`; quota requests at P0 | P0 |
| 10 | Remotion company license for commercial use | License before selling video features | P7 |
| 11 | Datastream → BigQuery support for this Cloud SQL edition | Fallback: scheduled exports | P1 |
| 12 | Cloudflare Registrar requires Cloudflare nameservers; Identity Platform custom auth domain; Google-managed certs need DNS-only records | §21.1 | P0 |
| 13 | Registrar API for tenant-managed sending domains | Pick registrar; Cloud DNS or tenant DNS for their zones | P8 |
| 14 | Cloudflare Email Sending is beta and Workers Paid only; inbound routing is free | Workers Paid **active 2026-09-28**; `notify.` still needs onboarding in Email Sending (domain verification); outbox-fronted so the provider can be swapped (§21.1) | P0 |
| 15 | An Internal OAuth app only covers users of the Workspace that owns the Cloud organization | One Workspace (`omnisdr.com` primary, `try.omnisdr.com` secondary) owns the Cloud org (§21.1b) | P0 |

## 30. Backend build order

Each phase is done only when its line passes on `dev.omnisdr.com` as a real account would use it.

| Phase | Builds | Done when |
|---|---|---|
| **P0 Platform** | Terraform (network, SQL, Run, Pub/Sub, Tasks, KMS, LB, Armor, Cloudflare records), CI/WIF, schema v1 + RLS, outbox + relay, AI gateway, job registry, observability baseline, `notify.` sending domain, Workspace (`omnisdr.com` + `try.omnisdr.com`) + Cloud organization, `try.` DNS (own SPF/DKIM/DMARC) + Postmaster Tools + mailbox warmup start; submit platform applications (#5, #6, #9) | `app.`/`api.` serve with Google-managed certs; RLS matrix passes over all tables with the count printed; an outbox event reaches a test consumer exactly once under forced retries |
| **P1 Assets + knowledge** | Intake pipeline, buckets, `files.` CDN, `in.` Email Worker, understanding, versions, indexer, retrieval, golden harness, BigQuery export | 20 mixed real files (upload + emailed to `in.`) reach `asset.ready`; EICAR quarantined; golden set runs with a measured noise floor |
| **P2 Evidence + gate** | Enricher (starter.js port, storefront, verification, heat), gate service, DB gate constraint, `send_guard()`, sabotage suite | 50 real businesses enriched; sabotage `refused N of N` |
| **P3 Outreach + follow-up** | Sequencer, drafting, sender (`gmail` Stage A), `u.` unsubscribe, inbox + classification, meeting lifecycle, Google Calendar connector, breakers, holds | Tenant #0 (`omni-gtm` on `try.omnisdr.com`) runs a live sequence: replies stop enrollments < 2 min, a meeting request pages the operator < 5 min, a booked meeting stops the sequence, a forced bounce trips the breaker |
| **P4 Content + publishing** | Content pipeline, publisher, LinkedIn pages + ads, Meta, YouTube, GBP adapters, platform media checks, metrics pull | One gated post published per approved platform; a duplicate schedule is refused by the DB |
| **P5 Generation** | Report/doc/deck/image workflows, `audit.` pages, credits ledger with reserve/settle/release | A report with every figure cited; a job failure refunds its reservation |
| **P6 Integrations** | Connector runtime groups, CRM + calendar + Shopify + storage connectors, public API, webhooks, MCP | Two-way HubSpot sync of 100 records with 0 duplicates; Shopify privacy webhooks delete end to end |
| **P7 Video** | Transcode/transcribe intake, Remotion render jobs, teardown video workflow, batch personalization caps | A 60-second video renders with gated on-screen claims; a batch past its cap is refused at enqueue |
| **P8 Multi-tenant hardening** | Public OAuth verification (Stage B + `reply.` routing), Graph + bridge adapters, managed sending domains, client workspaces, tenant custom audit domains, VPC-SC, DR rehearsal | A second org runs isolated end to end; restore from PITR rehearsed |
| **P9 Remaining** | Remaining connectors, SMS (10DLC), Stage C mailbox scopes | Per connector: contract tests + 100-record round-trip |
