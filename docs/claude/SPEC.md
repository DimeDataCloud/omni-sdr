# Omni-SDR — Build Spec (single-file handoff)

**Version:** 1.0 · 2026-09-28 · **Owner:** Claude (docs/claude/) · **Status:** authoritative for the MVP build.
**Replaces** Gemini's `omni_sdr_master_spec.md`. The audit is in [`AUDIT-2026-09-28-gemini-master-spec.md`](AUDIT-2026-09-28-gemini-master-spec.md).
Hand this file to any build agent. It reconciles Christian's decisions, the MVP guide, the INFRA spec,
the real schema and the live platform.

---

## 0. Read this first

### 0.1 Authority, highest first
1. **`docs/claude/DECISIONS.md`**: Christian's decisions. Binding and append-only. It wins every conflict.
2. **This file.** It is those decisions applied to the build. If it contradicts #1, #1 wins; report the conflict.
3. **`packages/db/migrations/*.sql`** is the only schema. Nothing in any document outranks the SQL
   for table and column facts. To change the schema, write a migration and a test.
4. `docs/MVP-BUILD-GUIDE.md` supplies the station bodies (journeys, screens, acceptance tests), **except where §3 or §8 here override it**.
5. `docs/INFRASTRUCTURE.md` supplies backend detail (`INFRA §n`).
6. `docs/mvp/*` belongs to another agent: **proposals, not decisions**, until they appear in #1.
7. `src/` is a clickable mock (localStorage, browser-side Gemini). Use it for layout ideas only; it gets replaced.

### 0.2 Rules for every agent
The rules, lanes, workboard and audit protocol live in **`AGENT-RAILS.md`** at the project root, shared by Claude and Gemini.
They aren't repeated here, so the two can't drift apart. Every task report starts with `Rails v1.0 loaded`.

---

## 1. Product

**One sentence:** an owner-operator or an agency signs up and teaches Omni-SDR its offer and ICP.
It researches competitors and prospects, then generates a multi-channel campaign grounded in real
evidence. The user approves it and it sends from their own accounts. Every reply and follow-up is
handled through to a booked meeting, and reports and data can be exported. Everything is measured in one analytics view.

**Account types** (`orgs.account_type`): `owner` (one business) and `agency` (client workspaces). An owner can upgrade to agency.
Never use the word "solo".

**Acceptance story.** This is the guide's §2.2 with the decisions applied, and it's what Station 26 must script:

*Owner, "Maya":*
1. Signs up with Google or a magic link → chooses **Owner** → 7-day trial, card taken by Stripe Checkout.
2. Lands in the **composer**, which proactively asks one question at a time: website, offer, voice note, ICP, connections.
   She can skip every question. Anything generated while context is missing says what it lacked, with a one-click "add it".
3. ICP builder: a CSV of 12 past clients plus chat → **ICP v1** with citations. Editing it creates v2; campaigns stay pinned to v1.
4. Competitors: 3 URLs, plus 1 suggested by grounded search with its reason; she confirms → battlecards and a gap map.
5. Leads: "Find 50 Nashville dental practices" → leads with evidence and a fit score. Free checks run on every email.
   Vendor verification spends Data credits.
6. Campaign: brief → 3-step email sequence, LinkedIn drafts, company-page posts. Audit pages are built **on request**
   unless the campaign's auto toggle is on. Image and media generation stay hidden while their flags are off.
7. Approvals (Trust Dial Level 1): she swipes, edits two and approves them. Sends go from her Gmail, inside send windows and under the warm-up ramp and hard cap.
8. Inbound: replies come back through Reply-To at `reply.omnisdr.com` → classified. A meeting request starts a 2-business-hour SLA,
   escalating in-app → push → email. She books through a native slot, or the booking arrives from her Calendly or Cal.com webhook. The sequence stops.
9. Follow-up: steps 2–3 go out; an out-of-office reply snoozes to the return date; a no-show gets a reschedule draft.
10. Analytics: sends, replies, positive replies, meetings, reply rate by step, credits. **No open rate.**
11. Reports and export: campaign report (PDF + Google Doc), leads to CSV/Sheets, meetings pushed to a connected CRM
    (Shopify, GoHighLevel or Whop, whichever is connected).

*Agency, "Northside Growth" (3 staff, 4 clients):* the same journey per client workspace. The admin
creates workspaces, invites staff as operator or reviewer, and invites a client as `client_viewer`. The client
sees reports and analytics, and approves only if the admin turned on the workspace toggle. Reports carry the agency's brand on
the agency's domain (full white-label).

---

## 2. Current state (verified 2026-09-28)

| Item | State | Evidence |
|---|---|---|
| Schema `packages/db/migrations/0001_core.sql` | 18 tenant tables, forced RLS, composite tenant FKs, claims-gate constraint, `send_guard()`, credits, outbox, audit log, versioned ICPs | `npm test` → **20 pass, 0 fail**; guard refuses 15/15; RLS matrix 18/18; 16 tenant FKs checked |
| Cloud SQL | **Does not exist**; the Cloud SQL Admin API isn't enabled | `gcloud sql instances list` |
| GCP project | `hip-well-509308-m9` (name `omni-sdr`) is **prod**; there is no other project. Enabled: Run, Pub/Sub, Vertex AI, Storage. Not enabled: Cloud SQL Admin, Cloud Tasks, KMS, Secret Manager, Identity Platform | `gcloud services list --enabled` |
| GitHub repo `DimeDataCloud/omni-sdr` | Private; bootstrap commit `559df2d` on `master`. Journal repo `omni-sdr-journal` beside it | `gh repo view`, `git log` |
| `omnisdr.com` | Live on Cloudflare (Pages): a waitlist landing page Gemini built. **Not an approved decision** (marketing deferred) | HTTP 200, `server: cloudflare` |
| Waitlist ingest `omni-waitlist-api` (Cloud Function gen2) | Writes signups to `gs://omnisdr-leads/leads/`. **P0: the public GET leaks every signup.** Patched locally, not deployed (§14) | See the audit |
| `try.omnisdr.com` | Not live | curl: no response |
| Front-end `src/` | Mock prototype | — |

---

## 3. MVP scope (reconciled; replaces guide §2.3)

| In the MVP | Built and tested, **flag OFF** until Christian enables it | Later |
|---|---|---|
| Google + magic-link sign-in; owner/agency; 4 roles; invites | — | Microsoft sign-in, SSO/SAML |
| Workspaces (owner: 1; agency: N [VERIFY plan limit]); client_viewer | — | — |
| Composer-first home, proactive and skippable onboarding | — | — |
| Multimodal **input**: text, voice, files, URLs, images | — | Live screen capture |
| Text generation: drafts, briefs, reports (**always on**) | **Imagen images, Veo video, audio/voice, document/PDF generation**: each has its own per-org flag | — |
| Knowledge base (RAG) | Auto-adjust learning (off by default; the **admin** enables it per workspace) | Notion/Confluence/Dropbox |
| Multiple versioned ICPs; competitor research (Gemini + Search grounding) | — | — |
| Leads: CSV, Google Places, website evidence; free email checks + vendor verification (customer credit) | — | Licensed contact DB, **Skool** |
| Campaign studio; audit pages on request + a per-campaign auto toggle | — | Ads |
| Approvals, Trust Dial Level 1 | Trust Dial Level 2 (**ops-only** flag per workspace) | Level 3 |
| Sending from the customer's **Gmail** (`gmail.send`); **smtp_imap** fallback while Google verification is pending | — | Outlook/Graph, bridge provider |
| Built-in warm-up ramp (on by default, customizable); 3rd-party warm-up/email services as connectors | — | — |
| **LinkedIn full automation**: official API (page posts, comments) + provider lane (DMs, replies, connections, drips, generated replies), opt-in, with consent | — | Chrome extension queue |
| Unified inbox (Reply-To via `reply.omnisdr.com`, form webhook, LinkedIn); classification; follow-up; meetings: native + **Calendly/Cal.com** | — | Zoom |
| Reports + exports; **full agency white-label with custom domains** (Cloudflare for SaaS) | — | Scheduled external report emails |
| Analytics (Postgres views); **no open tracking** | — | BigQuery |
| Integrations: Gmail, Google Calendar, Drive/Docs/Sheets export, **Shopify, GoHighLevel, Whop**, Stripe, signed outbound webhooks, **MCP two-way** | Connection modules shown as "set up now, activates later": **SMS** (collects A2P 10DLC details, no sending), **other social**, **2-way CRM (HubSpot)** | HubSpot activation, Salesforce, Zapier |
| Credits (3 meters), Stripe subscription, 7-day card-required trial | — | Overage purchase UI |
| Notifications: in-app, **FCM web push**, email via `notify.omnisdr.com` | — | — |

Anything missing from this table is out of scope until Christian adds it to DECISIONS.md.

---

## 4. Architecture and platform

- **Cloud:** GCP `us-central1`, the single project `hip-well-509308-m9` = prod (DECISIONS calls it "omni-prod"; it's the same project).
  **No dev project, no extra spend.** Size everything at the smallest tier; the Cloud SQL tier is [VERIFY].
- **Deployables (guide §2.4):** `web` (Cloud Run: Next 16 UI, server actions, `/api/*` webhooks, OAuth callbacks, audit pages, unsubscribe),
  `worker` (Cloud Run, internal: sequencer, gate, sender, inbox, publisher, intake, enricher, generator, indexer, relay, mailer,
  each a module with its own DB role), `email-worker` (Cloudflare: inbound routing for `reply.omnisdr.com`).
- **Data:** Cloud SQL Postgres 16 (private IP, pgvector), GCS (assets, snapshots), Pub/Sub, Cloud Tasks, Scheduler, KMS, Secret Manager (INFRA §5–7, §22).
- **Identity:** Identity Platform (Google + email link) [VERIFY free MAU tier]. The GCP org is Cloud Identity Free on `omnisdr.com`; no Workspace.
- **OAuth:** an External consent app. Sign-in scopes are non-sensitive, so no review. `gmail.send` is sensitive: submit verification early (brand, privacy policy, demo video; no CASA).
  Until approved: testing mode (≤100 named users, weekly re-auth) plus the smtp_imap fallback. **No Gmail read scopes**: replies return via Reply-To.
- **Domains:** `app.omnisdr.com` (app), `audit.omnisdr.com` (audit pages), `reply.omnisdr.com` (inbound), `notify.omnisdr.com` (transactional),
  `try.omnisdr.com` (Omni-SDR's own marketing, deferred), agency custom hostnames via Cloudflare for SaaS [VERIFY price per hostname; bill it to the agency].
- **Repo + CI:** the private repo `DimeDataCloud/omni-sdr` (created and pushed 2026-09-28). The working tree also stays in Drive, with git data kept outside Drive in `~/.halo-git/omni-sdr`. The grounding journal is `DimeDataCloud/omni-sdr-journal` (sibling folder). GitHub Actions → Cloud Run via **Workload Identity Federation**.
  **Service-account key files are never created.** CI runs the `packages/db` tests on every PR. Migrations run as a job before deploy, after a backup.
- **Target layout (INFRA §4):** `apps/web`, `worker/`, `packages/{core,db,ai,connectors,events}`, `infra/terraform`, `edge/email-worker`; npm workspaces.
- **Browser rule:** no model, mailbox or vendor call ever leaves the browser (INFRA principle 7).

---

## 5. Safety invariants (the product's spine; each one is enforced in code and tested)

| # | Invariant | Enforced by | Test |
|---|---|---|---|
| S1 | A tenant sees and writes only its own rows | Forced RLS on every tenant table; `app.org_id`/`app.workspace_ids` set per request | `rls.test.mjs` (mechanical + matrix) |
| S2 | A tenant can't reference another tenant's rows | Composite `(org_id, workspace_id, id)` FKs on every tenant-to-tenant FK | `tenancy.test.mjs` (mechanical, from the catalog) |
| S3 | Only evidence-backed text can be approved | `claims` + gate columns; `approved_requires_gate` CHECK; only `gate_svc` writes gate columns | `gate.test.mjs` |
| S4 | Editing voids the gate and the approval | `drafts_edit_voids_gate` trigger | `gate.test.mjs` |
| S5 | Nothing reaches a person unless `send_guard()` passes: approved + current gate, trust level, holds, verified email, suppression, the mailbox in the same workspace, the daily cap (atomic) | `BEFORE INSERT ON messages`, owned by `guard_owner`; only `sender_svc` inserts messages | 15/15 sabotage suite |
| S6 | Each draft is sent at most once | `messages.draft_id UNIQUE` | gate suite |
| S7 | Trust Level 2+ and generation flags can't be self-served | The app role has no UPDATE on `orgs` or `workspaces.trust_level`; ops only | `tenancy.test.mjs` |
| S8 | Evidence and ICP versions are immutable snapshots | Triggers (evidence: only `expires_at` may change; ICPs: only `archived_at`) | integrity + tenancy tests |
| S9 | Money moves only through the ledger | `credit_reserve`/`credit_release` owned by `ledger_owner`; balance ≥ 0 | integrity tests |
| S10 | History can't be rewritten | `audit_log` append-only trigger | integrity test |
| S11 | Every side effect is published once | Transactional `outbox` + relay (INFRA §6) | Station 25/26 |
| S12 | Warm-up never lifts the hard cap | `mailboxes.daily_cap` enforced in the guard, whatever the ramp says | add in Station 14 |
| S13 | LinkedIn automation obeys the same spine | **Not built yet.** The `linkedin` channel, caps, suppression and restriction breakers go into `send_guard` (Station 17) | add in Station 17 |
| S14 | No open tracking | No pixel anywhere; the funnel uses replies and meetings | review check |
| S15 | Public endpoints never return tenant, prospect or signup data without auth | Route review + tests per public route | Station 23 (and the waitlist P0) |

A change that weakens any row needs a DECISIONS entry from Christian.

---

## 6. Data model

### 6.1 What exists (0001_core.sql; read the file for columns)
`orgs` (account_type, billing status, `trial_ends_at`, `feature_flags` jsonb, **ops-writable only**) · `workspaces` (timezone, `trust_level` 1–3,
`client_approvals_enabled`, `auto_adjust_enabled`, `auto_adjust_sources` limited to 8 values, `custom_domain` globally unique) · `users` (global) ·
`memberships` (role `admin|operator|reviewer|client_viewer`, `workspace_ids` NULL = all) · `contacts` (`email_status unknown|valid|invalid|risky`) ·
`evidence` (immutable, expiring) · `icps` (`lineage_id` + `version`; insert-only; campaigns pin a version row) · `campaigns` (`icp_id`, `auto_audit_enabled`) ·
`enrollments` (state machine, `heat` 1–5) · `drafts` (`claims`, gate columns, statuses) · `mailboxes` (`provider gmail|graph|smtp_imap|bridge`, `daily_cap`) ·
`send_counters` · `suppression` (hashed; global or per org) · `holds` · `messages` · `credit_balances` / `credit_ledger` (meters `data|action|media`) · `outbox` · `audit_log`.

**Conventions:**
- Tenant tables carry `org_id` (+ `workspace_id`).
- Every FK to another tenant table is composite and includes `org_id`.
- RLS is enabled **and** forced.
- Each DB role gets explicit, narrow grants.
- Status fields use CHECK lists, not free text.

### 6.2 Planned migrations (Station 25 finalizes this list; the table names come from the guide's stations)
| Migration | Adds | Notes from decisions |
|---|---|---|
| `0002_access` | `invites`, `sessions` (if server-stored), column-level UPDATE grants on the workspace settings an **admin** may change (`client_approvals_enabled`, `auto_adjust_*`, `timezone`), `plan` on orgs | Role checks run in server actions; the DB still refuses anything `trust_level`/`feature_flags` |
| `0003_knowledge` | `chunks` (pgvector + tsvector), sources | Delete propagates to chunks |
| `0004_research` | `competitors`, `competitor_snapshots`, `battlecards`, `accounts`, `signals`, `imports`, `contacts.fit_score` | Battlecard claims cite a snapshot |
| `0005_connectors` | `connections`, `credentials` (KMS envelope), `external_refs`, connector manifests | One manifest per module (§9) |
| `0006_outbound` | warm-up ramp config per mailbox, domain checks, sequences (versioned) | The ramp can't exceed `daily_cap` |
| `0007_linkedin` | `linkedin_accounts` (provider, consent timestamp + version, restriction state), `drafts.channel` gains `linkedin`, the guard's LinkedIn branch, `send_counters` per channel | Consent is required before the first automated action |
| `0008_inbox_meetings` | `threads`, `inbound_messages`, `meeting_requests` (SLA due, escalation step), `meetings` (`provider native|calendly|cal_com`) | One escalation per step, never repeated |
| `0009_content_assets` | `assets` (versions, kinds including video), `content_items`, `channel_accounts`, `render_jobs`, `audits` | Unique `(content_item, channel_account)` |
| `0010_learning` | `auto_adjust_events` (source event → change, revert pointer) | Never crosses workspaces |
| `0011_reports_billing_notify` | `reports`, `exports`, `webhook_endpoints`, `notifications`, `push_tokens`, Stripe mirror columns | Trial expiry → read-only |

---

## 7. Roles and permissions

The tiers are cumulative: each role includes everything below it, except client_viewer, which sits outside the account.
Cells marked "default" are recommendations Christian hasn't confirmed; confirm them in Station 1.

| Action | admin | operator | reviewer | client_viewer |
|---|---|---|---|---|
| Billing, plan, delete org/workspace | ✅ | ❌ | ❌ | ❌ |
| Invite/remove members, set roles | ✅ | ❌ | ❌ | ❌ |
| Connect mailboxes and integrations; LinkedIn consent | ✅ | ❌ (default) | ❌ | ❌ |
| Workspace settings: client-approval toggle, Auto-adjust + sources, warm-up ramp, SLA hours | ✅ | ❌ | ❌ | ❌ |
| Research, ICPs, leads, campaigns, content, composer jobs | ✅ | ✅ | ❌ | ❌ |
| Approve/edit/discard drafts | ✅ | ✅ | ✅ | only if the workspace toggle is on |
| Inbox: read and draft replies | ✅ | ✅ | read-only (default) | ❌ |
| Clear a hold | ✅ | ❌ (default) | ❌ | ❌ |
| Reports and analytics | ✅ | ✅ | ✅ | ✅ (own workspace) |
| Export leads/messages (PII) | ✅ | ✅ | ❌ | ❌ |
| Trust Dial Level 2, generation flags | **ops only** (Christian) | — | — | — |

---

## 8. Stations (0–27)

Run them in order, one per instruction, using the guide's template (§1.3). For each station below: **deliverable ·
binding decisions to apply · deltas vs the guide · acceptance additions.** Everything else comes from the guide's station body.

- **00 Context:** `00-context.md`. Paste the test summary, which now reads `pass 20` / `refused 15 of 15` / `18 of 18 tables` / `16 tenant FKs`.
- **01 Accounts and plans:** roles are `admin/operator/reviewer/client_viewer` on both account types (§7). Prices and limits are **TBD placeholders**; decide before Station 22.
  7-day trial, card required, auto-converts; read-only at expiry.
- **02 IA:** `/app/[ws]/home` **is the composer**, with today-queue cards (approvals, replies, meeting SLAs) beside or below it.
  The `/onboarding/*` routes become composer steps that write the same data. The client_viewer sees reports + analytics (+ approvals when toggled).
- **03 Frontend:** shadcn/ui on Radix; Christian's palette (`docs/claude/brand-palette.md`) exactly: sand `#F7F5F0`, white glass, text `#1A1A1A`,
  green `#A3FFB4` / mint `#7BFF93` **as fills only**, with `#1A1A1A` text on them. Derive `--accent-ink` (≥4.5:1 on sand and white) for links, success text and focus rings.
  Honor `prefers-reduced-transparency` (opaque cards). Propose a dark mode for approval. Responsive; approvals, inbox and meeting requests are designed mobile-first.
- **04 Platform:** **prod only** (§4). There's no `omni-dev` and no `dev.omnisdr.com`: delete them from the guide's version. Include a backup-before-migration runbook,
  the WIF setup, the secrets inventory by name, and a cost floor [VERIFY].
- **05 Auth:** Google + magic link. Stripe Checkout with a 7-day trial at sign-up, on the **existing Dime Data Stripe account**. Invites are hashed, single-use and valid 7 days.
- **06 Onboarding:** a conversation inside the composer. The minimum required input is **nothing**. There are **8 separate, skippable connection modules**, each also available in Settings:
  Gmail · Google Calendar · email send + routing · LinkedIn · other social · 2-way CRM · MCP two-way · SMS. Each is one manifest (§9).
- **07 Composer:** cheap, reversible jobs (draft, summarize, rewrite, ask-my-data) run immediately. **Every** job shows an inline live
  estimate (credits by meter, rough time), NotebookLM-style, with no modal. Costlier jobs start when the user presses the run button that shows the estimate:
  the press is the consent. Credits are reserved at press time; if the balance is short, the button says so. **The composer never sends or publishes**; that goes through Approvals.
- **08 Knowledge + Auto-adjust:** RAG per the guide. **Auto-adjust**: off by default; the admin enables it per workspace and picks its sources
  (booked meetings, positive replies, objections, unsubscribes/bounces, SOPs, won/lost notes, draft edits, rejection reasons). It adjusts drafting examples,
  angle ranking and ICP message angles only, never guardrails, the gate or suppression. A "what Auto-adjust learned" log lists every change, and each is traceable and revertible.
- **09 ICP:** several ICPs per workspace, each versioned (already in SQL: `lineage_id` + `version`, insert-only; this replaces the guide's two-table design).
  The fit score is deterministic from ICP rules.
- **10 Competitors:** discovery via **Gemini + Google Search grounding** [VERIFY price/quota]. Each suggestion shows its reason and needs the user's confirmation before credits are spent.
- **11 Leads:** free syntax/MX/disposable/role checks on every lead. Vendor verification runs only when a **Data credit** is spent [VERIFY vendor + price].
  Only `email_status='valid'` can be sent to (the guard already enforces it). The guide's "HubSpot import" becomes Shopify/GHL/Whop import.
- **12 Campaigns:** audit pages (`/a/[slug]`, noindex, expiring, no contact PII) are built **on request** by default; "Auto audit pages" is a per-campaign toggle that shows its estimate.
  All media generators are built and tested with their flag forced on in tests, and **off in prod**. The UI shows no dead buttons (hide the action, or offer upload/pick).
- **13 Approvals:** Level 1 for everyone; Level 2 behind an **ops-only** per-workspace flag. Client-viewer approvals are off by default (the workspace toggle).
- **14 Outbound:** Gmail (`gmail.send`) + the smtp_imap fallback. **Warm-up**: a built-in slow ramp, on by default, that the admin can customize (start, step, max) or disable;
  third-party warm-up and email services connect as modules. The hard cap and breakers **always** apply. The integration screen warns that reply-network warm-up
  risks the customer's mailbox. Unsubscribe = header + `/u/[token]`, and suppression is written first.
- **15 Inbound:** replies arrive via Reply-To at `reply.omnisdr.com` (Cloudflare Email Routing → email-worker), plus the signed form webhook,
  LinkedIn replies from the provider, and audit-page views as signals. Guide labels and the "needs you" threshold below 0.8.
- **16 Meetings:** native (3 slots from free/busy + an Omni-SDR booking page) **and** Calendly/Cal.com webhooks into the same `meetings` table.
  SLA default is 2 business hours in the workspace time zone, admin-adjustable. Escalation goes in-app → FCM push → email, **once each**.
- **17 Content + LinkedIn:** the official API for company-page (and member) posts and company-page comments [VERIFY Community Management API access].
  DMs, replies, connection requests and handling, drip sequences and generated replies go through a **third-party provider** (Unipile-type) on the customer's own account,
  **paid by the customer as a per-account add-on** [VERIFY provider, price, terms]. The customer opts in per account on a **consent screen** stating that this breaks
  LinkedIn's User Agreement and the account may be restricted; store the consent version and time. Every automated action is a gated draft under the Trust Dial,
  with channel caps [VERIFY safe limits], suppression and restriction breakers → hold. **A lawyer reviews this before paid launch.**
- **18 Assets + pipelines:** build the full pipeline (intake, scan, previews, versions, render framework, metering). **Every** generator (Imagen, Veo, audio, document/PDF)
  gets its own per-org flag, default OFF. Each has an end-to-end test with the flag forced on. Text generation stays on.
- **19 Analytics:** the guide's funnel, with **no open rate**. Every number links to its rows. The agency roll-up is included.
- **20 Integrations:** Gmail, Calendar, Drive/Docs/Sheets, **Shopify** (GraphQL Admin, mandatory privacy webhooks; a custom/unlisted app is fine for the MVP [VERIFY]),
  **GoHighLevel** (OAuth marketplace app; sub-accounts ↔ client workspaces [VERIFY approval]), **Whop** (memberships, customers, payments in; notes/tags out [VERIFY API]),
  Stripe, signed webhooks, **MCP two-way** (Omni-SDR exposes its own MCP endpoint and connects out to customers' MCP servers). HubSpot goes to the roadmap.
  Contract tests use real recorded payloads, noting absent fields.
- **21 Reports + white-label:** the guide's report types. **Full white-label**: agency logo, colors and name on reports, audit pages and client-facing notify emails,
  with no Omni-SDR mention anywhere a client can see. Custom domains go through Cloudflare for SaaS, with the cost passed to the agency. A hostname maps to one workspace (the DB enforces this).
- **22 Billing, notify, admin:** Stripe (existing Dime Data account), credits, FCM, `notify.omnisdr.com`. The ops console (Christian only) lists orgs,
  holds across tenants, the DLQ, jobs, **per-org feature flags** (generators, Level 2) and prices (decide here).
- **23 Security + compliance:** the guide's STRIDE list, plus the LinkedIn provider surface, MCP inbound, custom domains and the waitlist endpoint.
  **Postal address:** `713 Harpeth Knoll Court, Nashville, Tennessee 37221` appears **only** in: Omni-SDR's own commercial marketing email footers;
  the Terms "Notices" clause and the Privacy Policy controller section (at the end); the Stripe business profile. It must **not** appear in the app UI,
  the site footer, audit pages, reports or notify transactional mail [VERIFY CAN-SPAM transactional exemption]. **Customer outreach carries
  the customer's own postal address** (collected in onboarding, enforced by the gate). Everywhere else uses `legal@`/`support@omnisdr.com`.
- **24 AI layer:** routing per §10. Every task gets a tier, a fallback tier and an eval that justifies the tier choice.
- **25 Data model:** finalize §6.2 as ordered migrations. Every new table is seeded in `helpers.mjs` so the RLS matrix and FK rule aren't vacuous.
- **26 Tests + acceptance:** the §1 story as an executable e2e. **With no dev environment**, e2e runs locally against the full stack and then **in prod against tenant #0**.
  The release gate: any failure or zero-denominator report blocks deploy.
- **27 Ready review:** the audit of 00–26 and the sprint plan (§13). **Pilots start when the Station 26 acceptance script passes end to end in prod.** There's no date.

---

## 9. Connectors

**Manifest contract** (one per module; adding a module is data, not a new screen): `id`, `category` (mail, calendar, social, crm, commerce, mcp, sms, warmup, booking, export),
`auth` (oauth, api_key, app_password, provider), `scopes` + a plain-English explanation of each, `capabilities` (`in`/`out` per object), `webhooks` (signed? how verified),
`reauth` detection, `activation` (`live` or `later`), `cost_owner` (`omni` or `customer`), `consent` (text version, required?), and the `[VERIFY]` links.

| Module | Activation | Notes |
|---|---|---|
| Gmail (`gmail.send`) | live | Verification pending → testing mode + smtp_imap |
| smtp_imap | live | App passwords; the fallback lane |
| Google Calendar | live | free/busy + events.insert [VERIFY scopes] |
| Email routing (`reply.omnisdr.com`) | live | Cloudflare Email Routing; no Gmail read scopes |
| Calendly / Cal.com | live | Webhooks → `meetings` |
| LinkedIn official | live | Posts, comments [VERIFY access] |
| LinkedIn provider | live, opt-in | Customer-paid; consent; caps; breakers |
| Shopify · GoHighLevel · Whop | live | Two-way |
| Drive/Docs/Sheets | live | Exports |
| Stripe | live | Billing (Omni-SDR's own) |
| Outbound webhooks | live | HMAC-signed |
| MCP | live | Two-way |
| 3rd-party warm-up / email services | live | Count against the hard cap |
| Other social · HubSpot · SMS | later | Set up now, activates later; SMS collects A2P 10DLC details only |

---

## 10. AI layer

| Tier | Use for |
|---|---|
| **Flash-Lite** | classification, labels, dedupe hints, short extractions, intent routing, snooze-date parsing |
| **Flash** (default) | per-lead drafts, replies, summaries, posts, ask-my-data |
| **Pro** | ICP proposal, battlecards, reports, campaign briefs, sequence planning, and any strict-schema task Flash fails its eval on |

Model IDs on Vertex are [VERIFY]. Rules (INFRA §10):
- Prompts are versioned files, and the prompt hash is stored on every output.
- Retrieved and prospect content goes in labelled data blocks; no tools run during drafting (injection containment).
- Every generating task has 10–30 eval cases, run in CI on any prompt or model change.
- Costs are estimated per task and shown inline (Station 7).

---

## 11. Compliance and risk register

| Risk | Control | Owner |
|---|---|---|
| LinkedIn automation breaks their User Agreement; LinkedIn has sued vendors | Provider lane, customer consent, customer-paid, caps/breakers, **lawyer review before paid launch** | Christian |
| CAN-SPAM on customer outreach | Unsubscribe, the customer's postal address, suppression first [VERIFY honor window] | gate + Station 23 |
| Google OAuth verification for `gmail.send` | Submit early; testing mode + smtp_imap meanwhile [VERIFY timeline] | Christian |
| Shopify/GHL app reviews | Custom/unlisted app for pilots [VERIFY] | Station 20 |
| SMS (TCPA, A2P 10DLC) | Not sending in the MVP | — |
| Warm-up reply networks | Warning + hard cap | Station 14 |
| Privacy/Terms drafts | Drafted in Station 23 for legal review | Christian |

---

## 12. Design system (binding summary)
The palette is in `docs/claude/brand-palette.md`: sand `#F7F5F0` base with backdrop blur, frosted white `rgba(255,255,255,0.65)` cards, satin black `#1A1A1A` text,
pastel neon green `#A3FFB4` for CTAs and success fills, electric mint `#7BFF93` for hover, pale sand `#E8E4D9` for borders. Inter or Roboto; semi-bold headers.
Soft shadows `0 8px 32px rgba(0,0,0,0.04)`. Accessibility: green is a fill only; `--accent-ink` for text, links and focus rings (2px + offset); raise glass opacity
when contrast drops below 4.5:1; WCAG 2.2 AA; keyboard shortcuts in the approval queue (A/E/D/S).

---

## 13. Build order (sprints; an order of work, not a calendar)

The guide's 9 sprints assumed a dev environment, HubSpot, LinkedIn assist-only and no white-label. With the decisions applied it becomes 10
(Christian can merge sprints back to 9; nothing else depends on the count).

| # | Build | Demo |
|---|---|---|
| 1 | Create the repo; monorepo move; enable the P0 APIs in the prod project (Cloud SQL, Tasks, KMS, Secret Manager, Identity Platform); WIF CI; auth; account types; workspaces; roles; RLS context helper; Stripe trial checkout | Sign up as owner and as agency with a card-on-file trial; invite a reviewer |
| 2 | Composer shell + proactive onboarding; intake pipeline; assets; connector manifest framework (8 modules listed, skippable) | Voice note + PDF + URL → a confirmed brief, every step skippable |
| 3 | Knowledge base; ICP builder (lineage versions); fit score | ICP v1 → v2 with citations; the campaign stays on v1 |
| 4 | Competitor research (grounding); lead import/find; enrichment; evidence; free checks + vendor-credit verification | 50 leads with evidence + 3 battlecards |
| 5 | Campaign studio; claims gate service; approvals; audit pages (on request + auto); all generators built, flag-off | A 50-lead campaign in the approval queue; generators pass with flags forced on in tests |
| 6 | Gmail connect (testing mode) + smtp_imap; sequencer; sender; warm-up ramp; unsubscribe; breakers | Tenant #0 sends real sequences under the ramp and cap |
| 7 | Reply-To inbox via `reply.omnisdr.com`; classification; follow-up; meetings (native + Calendly/Cal.com); SLA + FCM | Real reply → meeting booked → sequence stopped |
| 8 | LinkedIn: official API posting/comments + the provider lane with consent, caps, breakers, guard branch; analytics | A consented account runs a drip under caps; a restriction signal → hold |
| 9 | Shopify, GHL, Whop; MCP two-way; webhooks; Drive exports; reports; white-label + custom domains | Branded client report on an agency domain; records synced both ways |
| 10 | Billing/credits/notify/ops console (flags, Level 2, prices); security checklist; acceptance script green in prod | The full Maya + Northside journeys pass in prod → pilots |

---

## 14. Christian's action list (these aren't agent work)

1. **P0: close the waitlist data leak.** The fix is already in `cloud-functions/waitlist-ingest/index.js` (the public GET is removed).
   Deploy it (this keeps the POST that the landing page uses):
   `gcloud functions deploy omni-waitlist-api --gen2 --region=us-central1 --runtime=nodejs22 --source=cloud-functions/waitlist-ingest --entry-point=waitlistIngest --trigger-http --allow-unauthenticated --project=hip-well-509308-m9`
   then check: `curl -s -o /dev/null -w "%{http_code}" "https://omni-waitlist-api-eb7lrmqqwa-uc.a.run.app?format=csv"` → `405`.
   To export signups from now on: `gcloud storage cat "gs://omnisdr-leads/leads/*.json"`.
2. The waitlist form's edge fallback told users "your spot is secured" when nothing was saved. **Fixed in source** (`functions/api/waitlist.ts` now returns 502 and the page shows the error),
   but the deployed `dist-pages/_worker.js` still has the old code. There's no build/deploy script, because Gemini built `dist-pages/` by hand: rebuild the worker and redeploy Pages.
3. Move the waitlist function off the default compute service account onto `omni-waitlist-writer` (give it object-create on that one bucket only).
4. Delete `projects/omni-sdr/secrets/` (an empty `gcs-key.json`; WIF means no key file should exist).
5. ~~Create the private repo~~ Done 2026-09-28.
6. Submit Google OAuth verification for `gmail.send` early. Apply for LinkedIn Community Management API access.
7. Set prices and plan limits before Station 22.
8. Book the LinkedIn automation lawyer review before paid launch.

---

## 15. Open items

**Decision still open:** plan prices and limits (Station 1 → decide by Station 22). Everything else in guide §4.3 is answered in DECISIONS.md.

**[VERIFY] register** (each gets resolved with a doc link in its station):
Cloud Identity Free limits · Identity Platform free MAU · `gmail.send` verification timeline · Gemini Search grounding price and quota ·
email-verification vendor and unit price · Cloudflare for SaaS hostname allowance and price · Community Management API access ·
LinkedIn provider (who, price, terms) and safe daily limits · Shopify app review for public listing · GHL marketplace approval · Whop API scope ·
Calendar scopes · Vertex model IDs · CAN-SPAM transactional exemption and unsubscribe window · A2P 10DLC timeline and fees · GDPR Art. 13 need for a US-only launch ·
Cloud SQL smallest-tier cost.

---

## 16. Handoff prompt (copy-paste to a fresh agent)
```
You are a build agent for Omni-SDR. Read, in order: AGENT-RAILS.md, omni-sdr-journal/WORKBOARD.md, docs/claude/DECISIONS.md, docs/claude/SPEC.md
(sections 0, 3, 5, 6, 7 and the station you're given in section 8), then that station in
docs/MVP-BUILD-GUIDE.md and the INFRA sections it cites. Claim your paths on the workboard first.
Task: Run Station <NN>. Write docs/mvp/<NN>-<slug>.md using the guide's template (§1.3), applying every
SPEC §8 override for this station. List decisions needed with a recommended default. Then stop and report
which files you read and the output of `npm test` in packages/db.
```
