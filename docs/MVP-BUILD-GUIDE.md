# Omni-SDR — MVP Build Guide

**What this is:** the page you hand to an AI agent to walk the Omni-SDR MVP from first login to
final export, one station at a time, until it's ready for development. Each station tells you what
to say to the agent, what the agent must produce, and what "done" looks like before you move on.

**Who uses it:** Christian (operator) directing one build agent (Gemini, Claude, or another).
The agent works on **one station per instruction**, writes its output to `docs/mvp/`, and stops
for review. It never moves on unprompted.

> **Update 2026-09-28:** `docs/claude/SPEC.md` is the single handoff file. It applies Christian's decisions
> (`docs/claude/DECISIONS.md`) to this guide and overrides it where they differ (scope table, environments,
> sprints, integrations, LinkedIn). Read both before any station.

**Source of truth, in order:**
1. This guide (sequence and MVP scope)
2. `docs/INFRASTRUCTURE.md` (backend + infrastructure spec v3, 30 sections; cited here as `INFRA §n`)
3. `packages/db/` (the real schema, with tests that run)
4. `src/` (the existing **front-end mock**: useful for layout ideas, not for logic. It stores data
   in `localStorage` and calls Gemini from the browser, and both get replaced)

---

## Part 1 — How to run this guide

### 1.1 Rules for the agent (paste these at the start of every session)

```
You are the build agent for Omni-SDR. Rules:
1. Work on exactly ONE station per instruction. Write its outputs to docs/mvp/<NN>-<slug>.md
   (and code only if the station says so). Then stop and report.
2. Read before writing: this guide's station, the INFRA sections it cites, and every earlier
   docs/mvp/ file it depends on. Name every file you read in your report.
3. Never claim a thing exists, runs, or passes without showing the command and its output.
   Anything unverified is labelled UNVERIFIED.
4. Never invent platform facts (API limits, scopes, prices). Mark them [VERIFY] with the doc URL
   you would check.
5. List every decision you need from Christian under "Decisions needed". Offer a recommended
   default and the reason for each. Never block silently.
6. Secrets never appear in chat, docs or code. Reference them by name (e.g. CLOUDFLARE_DNS_TOKEN).
7. Next.js in this repo is v16 with breaking changes: read node_modules/next/dist/docs/ before
   writing Next code (see AGENTS.md).
8. Machine: Windows 11 ARM64, no local Docker. No dev cloud environment (decision): test locally, prod only.
```

### 1.2 The loop you run per station

1. **You:** "Run Station N." (paste the station's *Say to the agent* block).
2. **Agent:** writes `docs/mvp/NN-*.md` with the station's sections filled in, plus a
   *Decisions needed* list.
3. **You:** answer the decisions in one message. The agent records them in
   `docs/mvp/DECISIONS.md` (date · decision · alternatives · why).
4. **You:** check the station's **Exit criteria**. If any line fails, say "Fix: <line>".
5. Move to the next station.

### 1.3 Every station file uses this template

```markdown
# NN — <Station name>
## Summary (5 lines max)
## User journey (numbered steps the user takes)
## Screens (name · route · purpose · key components · empty/loading/error states)
## Frontend (components, state, data fetching, forms, validation, accessibility)
## Backend (services/modules, endpoints or server actions, jobs, events)
## Data (tables/columns added or used; migrations needed; RLS notes)
## AI (model tasks, prompts, inputs, outputs, schema, guardrails, cost per run)
## Multimodal (inputs accepted, outputs produced)
## Integrations (external systems touched)
## Acceptance tests (Given/When/Then, runnable in the MVP)
## Decisions needed (question · options · recommended default · why)
## Out of MVP scope (explicitly deferred)
```

---

## Part 2 — What the MVP is

### 2.1 One-sentence definition
An owner-operator or an agency signs up, teaches Omni-SDR its offer and ICP, researches
competitors and prospects, generates a multi-channel, multi-format campaign grounded in real
evidence, approves it, sends it from their own Gmail, handles every reply and follow-up through to
a booked meeting, and exports reports and data. Everything is measured in one analytics view.

### 2.2 The end-to-end journey the MVP must support (the acceptance story)

**Owner: "Maya, freelance web consultant"**
1. Signs up with Google → chooses **Owner** → names her workspace → picks a plan (trial).
2. Onboarding: pastes her website URL, **speaks** a 2-minute voice note about her offer, uploads
   two case-study PDFs → Omni-SDR drafts her brand kit, voice profile and offer summary. She edits and confirms.
3. **ICP builder:** uploads a CSV of 12 past clients plus a chat about who buys → gets a versioned ICP (firmographics, pains, triggers, disqualifiers).
4. **Competitor research:** enters 3 competitor URLs (+1 suggested) → gets a battlecard per
   competitor and a positioning gap summary.
5. **Lead sourcing:** "Find 50 Nashville dental practices matching my ICP" → leads with evidence (website gaps, reviews/rating, booking flow), a fit score and verified emails.
6. **Campaign studio:** "Create a campaign" → a strategy brief → a 3-step email sequence, 4
   LinkedIn company-page posts, 2 generated images, and a per-prospect audit page + PDF one-pager. Every claim is tied to evidence.
7. **Approval queue:** swipes through drafts, edits two, approves → the sequence runs from her connected Gmail inside send windows.
8. **Inbound:** replies land in the unified inbox, classified. A "meeting request" pages her; she books from a suggested slot, and the sequence stops for that lead.
9. **Follow-up:** no-replies get step 2 and 3; an out-of-office is snoozed to its return date; a no-show gets a reschedule draft.
10. **Analytics:** sends, replies, meetings, reply rate by step, top-performing messages, content performance, credits used.
11. **Reports + export:** generates a campaign report (PDF + Google Doc), exports leads to CSV/Google Sheets, and pushes booked meetings to HubSpot.

**Agency: "Northside Growth, 3 staff, 4 clients"**
- Same journey per **client workspace**. The agency owner creates workspaces, invites staff as
  operator/reviewer, invites a client as `client_viewer` to approve drafts and see reports, and
  exports a monthly client report per workspace.

### 2.3 MVP scope

| In the MVP | Deferred (post-MVP) |
|---|---|
| Google + email-link sign-in; Owner and Agency account types; roles; invites | Microsoft sign-in, SSO/SAML |
| Workspaces (1 for Owner, up to 5 for Agency), client viewer role | White-label domains, custom audit domains |
| Multimodal **input**: text, voice (speech-to-text), files (PDF, DOCX, XLSX/CSV, images, audio, video up to size cap), URLs | Live screen capture |
| Multimodal **output**: copy, images (Imagen), PDF, Google Docs/Sheets/Slides, audit web pages, CSV | **Generated video** (post-MVP stretch; needs a Remotion license + credit caps; INFRA §17) |
| Knowledge base (RAG) over uploads + website + past messages | Notion/Confluence/Dropbox sync |
| ICP builder, competitor research, lead sourcing (CSV + Google Places + website evidence), email verification | Licensed contact database, Skool |
| Campaign studio (email sequence + social posts + images + audit page + one-pager) | Ads (LinkedIn Matched Audiences / Message Ads) |
| Approval queue, Trust Dial level 1 (manual); level 2 behind a flag | Level 3 full autonomy |
| Sending from connected **Gmail** (Stage A internal app for tenant #0; external testing app for pilots) | Outlook/Graph, SMTP/IMAP, bridge provider, SMS |
| LinkedIn **assist** (copy + open profile; human sends) | Chrome extension queue |
| Unified inbox (Gmail replies + web form webhook), classification, follow-up, meeting lifecycle, Google Calendar booking | Calendly/Cal.com, Zoom |
| Social publishing: **LinkedIn company page** scheduling | Meta, YouTube, TikTok, X, GBP |
| Reports: campaign, client-monthly, competitor, ICP; export PDF/Docs/CSV/Sheets | Scheduled report emails to external recipients |
| Analytics dashboard (Postgres views) | BigQuery warehouse, cohort analysis |
| Integrations: Google Calendar, Google Sheets/Drive export, HubSpot (push contacts/meetings), outbound webhooks | Salesforce, GoHighLevel, Shopify, Zapier app, public MCP server |
| Credits (3 meters), Stripe subscription | Usage-based overage purchases UI |

**Rule for the agent:** anything not in the left column is out of scope unless Christian moves it
in writing in `DECISIONS.md`.

### 2.4 MVP deployment shape (simplifies INFRA §3 without breaking its boundaries)
INFRA lists 14 services. For the MVP they ship as **3 deployables**, with the boundaries kept as code modules:

| Deployable | Contains (modules) | Why |
|---|---|---|
| `web` (Cloud Run) | Next.js UI + server actions + `/api/*` routes (webhooks, OAuth callbacks, audit pages, unsubscribe) | One public surface |
| `worker` (Cloud Run, internal) | sequencer, gate, sender, inbox, publisher, intake, enricher, generator, indexer, relay, mailer. Each is a module with its own DB role and handler path | One image, many entrypoints; split later without rewriting |
| `email-worker` (Cloudflare) | Inbound mail routing only | INFRA §21.1 |

The database roles (`app_rw`, `gate_svc`, `sender_svc`, …) stay separate even though the code
shares an image. The guarantees live in Postgres, not in how the code is deployed.

---

## Part 3 — The stations

Stations 0–4 set the frame. Stations 5–22 follow the user's path from login to export. Stations
23–27 are cross-cutting and lead to "ready to build".

---

### Station 0 — Kickoff and context load

**Say to the agent:**
> Station 0. Read docs/MVP-BUILD-GUIDE.md fully, docs/INFRASTRUCTURE.md sections 1–7 and 29–30,
> packages/db/migrations/0001_core.sql, and list the routes in src/app. Write docs/mvp/00-context.md
> containing: a 10-line product summary in your own words, a glossary (tenant, org, workspace,
> enrollment, draft, gate, evidence, heat, fit, trust dial, hold, outbox, credit meter), a table
> of what exists today (mock UI routes, db package, spec) with what each is worth reusing, and
> the open questions you have. Run `npm test` in packages/db and paste the summary lines.

**Exit criteria:**
- [ ] Glossary covers every term listed.
- [ ] The "exists today" table separates **reusable** (layout ideas, db schema + tests) from **replace** (localStorage store, browser-side Gemini, mock data).
- [ ] The test output shows `pass 20`, `fail 0`, `refused 15 of 15`, `18 of 18 tables` and `16` tenant FKs checked (or whatever the suite prints now, pasted, not paraphrased).

---

### Station 1 — Personas, account types, plans

**Say to the agent:**
> Station 1. Define personas, account types and plan limits. Write docs/mvp/01-accounts-and-plans.md.

**Must cover:**
- **Personas:**
  - Owner-operator (business owner, freelancer or consultant)
  - Agency owner
  - Agency operator
  - Reviewer
  - Client viewer
- **Account types:** `owner` (1 workspace, 1–2 seats) and `agency` (N client workspaces, staff seats, client viewers). The type is stored on `orgs.account_type` and changeable owner → agency.
- **Roles × permissions matrix:** owner, admin, operator, reviewer, client_viewer × every action (billing, connect mailbox, create campaign, approve, send, view reports, export, invite, delete).
- **Plan table (placeholders, marked for Christian):** seats, workspaces, connected mailboxes, sends/day cap, credits per meter, features gated. Reference: the GTM benchmark numbers are in INFRA §16 of the v2 archive. Don't copy prices; list them as decisions.
- **Trial rules:** length, what's limited, what happens at expiry (read-only, no sends).

**Data:** add `orgs.account_type`, `orgs.plan`, `orgs.trial_ends_at`, `plan_limits` (config table or code constant; recommend a code constant + DB check at enforcement points).

**Exit criteria:**
- [ ] Every role × action cell is filled with allow/deny.
- [ ] Every plan limit names the exact code point that enforces it (e.g. "connected mailboxes: server action `connectMailbox` + DB check").
- [ ] Prices appear only under *Decisions needed*.

---

### Station 2 — Information architecture and screen inventory

**Say to the agent:**
> Station 2. Produce the full screen inventory and navigation for the MVP.
> Write docs/mvp/02-ia-and-screens.md with a site map, a route table, and per-screen specs.

**Required route map (the agent may refine names, not remove areas):**
```
/                         → redirect to /app or /login
/login  /signup  /invite/[token]
/onboarding/(account-type|workspace|brand|connect|knowledge|icp)
/app/[ws]/home            → today: approvals waiting, replies needing you, meetings, alerts
/app/[ws]/create          → the universal composer (Station 7)
/app/[ws]/knowledge       → sources, uploads, website, voice notes
/app/[ws]/icp             → ICP versions
/app/[ws]/competitors     → competitor list + battlecards
/app/[ws]/leads           → table, filters, lead detail drawer (evidence, timeline)
/app/[ws]/campaigns       → list · /new · /[id] (brief, sequence, assets, schedule, results)
/app/[ws]/approvals       → swipe queue + table view
/app/[ws]/inbox           → unified inbox, classified threads
/app/[ws]/meetings        → requests (SLA timers), upcoming, held/no-show
/app/[ws]/content         → social posts calendar + library
/app/[ws]/assets          → every file/image/doc, versions
/app/[ws]/reports         → generated reports, templates, exports
/app/[ws]/analytics       → dashboard
/app/[ws]/settings/(workspace|brand|mailboxes|integrations|team|trust)
/app/org/(workspaces|billing|members|usage)      → owner/admin only
/a/[slug]                 → public audit page (served on audit.omnisdr.com)
/u/[token]                → unsubscribe
```
- **Per screen:** purpose, primary action, components, data it reads, empty/loading/error states, and which roles see it.
- **Global UI:**
  - workspace switcher (Agency)
  - command palette (⌘K)
  - global **Create** button opening the composer
  - notifications tray
  - credit meter chip
  - hold banner (a red bar when any hold is active)

**Exit criteria:**
- [ ] Every MVP capability in §2.3 maps to at least one screen.
- [ ] Every screen lists its three non-happy states.
- [ ] The client_viewer path is explicitly scoped (sees approvals + reports + analytics only).

---

### Station 3 — Design system and frontend architecture

**Say to the agent:**
> Station 3. Define the design system and frontend architecture. Write docs/mvp/03-frontend.md.
> Read node_modules/next/dist/docs first and cite what changed in Next 16 that affects us.

**Must cover:**
- **Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 (already in the repo). A component primitives choice (recommend Radix-based primitives) is a decision for Christian.
- **Tokens:** color (light/dark), type scale, spacing, radius, motion. **Accessibility:** WCAG 2.2 AA, keyboard paths for the approval queue.
- **Data layer:**
  - Server Components for reads.
  - **Server actions** for mutations. Every action sets the RLS context (`app.org_id`, `app.workspace_ids`) from the session inside one transaction (`packages/db` helper).
  - **SSE** for realtime (drafts, inbox, jobs), fed by `pg_notify` (INFRA §5.2).
  - No client-side data store as source of truth.
- **Forms:** schema validation shared client/server (recommend Zod), optimistic UI only for reversible actions.
- **Long jobs** (research, generation, imports): a job card component subscribed to job status over SSE, cancellable, with the credit reservation visible.
- **Component inventory (MVP):**
  - `Composer`
  - `ApprovalCard`
  - `EvidenceChip` (click shows source + snapshot)
  - `LeadTable`
  - `SequenceEditor`
  - `ThreadView`
  - `MeetingRequestCard` (with SLA countdown)
  - `ReportViewer`
  - `AssetViewer` (PDF/image/video/audio/doc previews)
  - `ChartCard`
  - `CreditChip`
  - `HoldBanner`
  - `JobCard`
- **What to keep from the mock:** layout and visual ideas from `SwipeCardQueue`, `TrustDialSwitch`, `KPICards`, `Navbar`. **Delete:** `src/lib/store.ts` (localStorage), `src/lib/gemini.ts` (browser Gemini), and the `data/*.json` files as runtime data.

**Exit criteria:**
- [ ] The Next 16 differences are cited from the local docs, not from memory.
- [ ] Every component in the inventory has props, states, and the screens using it.
- [ ] A written rule: no model, mailbox or vendor call from the browser (INFRA principle 7).

---

### Station 4 — Repo, environments and platform plan

**Say to the agent:**
> Station 4. Plan the monorepo move and the platform setup. Write docs/mvp/04-platform.md. No
> cloud resources are created in this station, only the plan and the Terraform module list.

**Must cover:**
- **Target layout** (INFRA §4):
  - `apps/web` (move the current Next app here)
  - `worker/` with module folders
  - `packages/{core,db,ai,connectors,events}`
  - `infra/terraform`
  - `edge/email-worker`
  - A workspace tool choice (npm workspaces recommended, since npm is already in use).
- **Environments:** `omni-dev`, `omni-prod` on GCP `us-central1`; `dev.omnisdr.com`, `app.omnisdr.com` (INFRA §2, §21.1).
- **P0 resource list:** VPC, Cloud SQL Postgres 16 (private IP, pgvector), Cloud Run `web` + `worker`, Pub/Sub, Cloud Tasks, Scheduler, KMS keyrings, Secret Manager, Artifact Registry, LB + Cloud Armor, Cloudflare DNS records via Terraform.
- **CI:** GitHub Actions with Workload Identity Federation; migrations as a job before deploy; `packages/db` tests on every PR.
- **Secrets inventory by name only** (DB URLs, Cloudflare tokens, Google OAuth client, Stripe, HubSpot app), with where each lives.
- **Workspace/Cloud-org decision** (INFRA §21.1b): with vs without Google Workspace, and its effect on the Gmail OAuth app type.

**Exit criteria:**
- [ ] Every resource maps to an INFRA section.
- [ ] Every secret has an owner service account.
- [ ] A cost line per resource marked [VERIFY], with the monthly floor total.

---

### Station 5 — Sign-up, login, account creation

**Say to the agent:**
> Station 5. Specify authentication and account creation end to end. Write docs/mvp/05-auth.md.

**User journey:**
1. `/signup` → Continue with Google or email link → verify.
2. Choose **Owner** or **Agency**.
3. Name the org (Agency) and the first workspace.
4. Choose a plan / start the trial (Stripe Checkout or a trial without a card; decision).
5. Land in onboarding (Station 6).
- **Invites:** owner/admin invites by email + role (+ workspace scope) → `/invite/[token]` → sign in → membership created.
- **Login:** `/login` → session → last-used workspace. Agency users with several workspaces see the switcher.

**Backend:**
- **Identity Platform** (Google + email link) (INFRA §20).
- **Session cookie** scoped to `app.omnisdr.com`, httpOnly, SameSite=Lax, rotated.
- **Server-side session → membership lookup** → `app.org_id` / `app.workspace_ids` set per request.
- **Invite tokens:** single-use, hashed at rest, 7-day expiry.
- **Every sign-in and role change** written to `audit_log`.

**Data:** `users`, `memberships` (exist), plus `invites(id, org_id, email_hash, role, workspace_ids, token_hash, expires_at, accepted_at)`, `orgs.account_type`, `sessions` (if server-stored; decision).

**Acceptance tests:**
- A user with no membership lands on account-type selection, never on another tenant's data.
- An invited reviewer can approve but can't connect a mailbox (403 + audit row).
- A client_viewer can open only the workspace in their scope.
- An expired or used invite token is refused.

**Exit criteria:**
- [ ] Sequence diagrams for sign-up, invite accept and login.
- [ ] RLS context-setting code path named (file + function).
- [ ] Account deletion and org transfer listed (even if post-MVP).

---

### Station 6 — Workspace onboarding: brand, voice, offer, connections

**Say to the agent:**
> Station 6. Specify the onboarding wizard. Write docs/mvp/06-onboarding.md.

**User journey:**
1. **Brand:** paste website URL → crawl + extract logo, colors, fonts, tagline → editable brand kit.
2. **Voice and offer:** type, **record voice**, or upload docs → Gemini drafts the offer summary, proof points (only from uploaded sources), voice rules (do/don't, sample sentences) → user edits and confirms.
3. **Connect:** Gmail mailbox (OAuth; shows scopes in plain English), Google Calendar, optional HubSpot.
4. **Knowledge:** drop files and links for the knowledge base (Station 8).
5. **ICP:** quick start or skip to Station 9.
- **Progress** is saved per step; the user can resume anywhere.

**Backend:**
- **Website crawl:** fetch + readability + screenshot (headless Chrome job) → asset + evidence snapshot.
- **Voice note:** upload → Speech-to-Text → transcript asset.
- **Workspace brief:** a typed JSON (`workspaces.brief`) used for AI context caching (INFRA §10).
- **Gmail OAuth:** credential stored KMS-encrypted (INFRA §9, §22).

**Data:** `workspaces.brand_kit`, `workspaces.voice`, `workspaces.brief`, `connections`, `credentials`, `mailboxes`, `assets`.

**AI:**
- **`brand.extract`**
  - Input: HTML + screenshot.
  - Output: `{colors[], fonts[], logo_asset_id, tagline}`.
- **`offer.draft`**
  - Input: transcript + docs.
  - Output: `{offer, audience, outcomes[], proof[{claim, source_asset_id}]}`.
  - Guardrail: proof items must cite a source.

**Acceptance tests:**
- A voice note of 60–120 s becomes a transcript and an offer draft in under 60 s.
- A proof point without a source is shown as "needs source" and is excluded from the brief.
- A revoked Gmail grant flips the mailbox to `reauth` with a banner.

---

### Station 7 — The universal composer (multimodal input)

**Say to the agent:**
> Station 7. Specify the Composer: one input surface used everywhere. Write docs/mvp/07-composer.md.

**What it is:** a single component (global **Create** button, and embedded in ICP, research,
campaigns and reports) accepting **text, voice (hold-to-talk), file drop (any type), URL paste,
image paste, and screenshots**, plus an intent picker: *Research competitors · Build ICP · Find
leads · Create campaign · Write post · Make report · Ask my data*.

**Backend:**
- **Every attachment** goes to the intake pipeline (INFRA §8): quarantine → scan → understand → asset.
- **The composer submits** `{intent, text, asset_ids[], urls[], workspace_id}` → server action → job.
- **Intent routing** is explicit (a user choice, or a classifier with confirmation). A model never silently picks an expensive job.
- **Credit estimate** shown before running (INFRA §24 reserve).

**Acceptance tests:**
- A 20 MB PDF + a URL + a voice note in one submission all reach `asset.ready`, and the job starts.
- An unsupported file type is refused with the allowed list shown.
- "Ask my data" answers with citations or says "not in your knowledge base".

---

### Station 8 — Knowledge base (RAG)

**Say to the agent:**
> Station 8. Specify the knowledge layer for the MVP. Write docs/mvp/08-knowledge.md. Follow
> INFRA §18.

**Must cover:**
- **Corpora in the MVP:** uploads, website pages, voice notes, sent messages with outcomes, reply threads, evidence.
- **Pipeline:** chunking rules per type, context headers, dedupe, embeddings model [VERIFY], `chunks` table (new migration `0002_knowledge.sql` with pgvector + tsvector + RLS).
- **Retrieval:** hybrid (vector + keyword, reciprocal-rank fusion), rerank, citations.
- **UI:** `/knowledge` list with status (processing, ready, failed, excluded for PII), a source preview, "exclude from AI" toggle, and delete (propagates to chunks).
- **Golden set:** 30 answerable + 10 not-found questions generated at onboarding; the nightly score shows on the knowledge page.

**Acceptance tests:**
- Deleting a source removes its chunks (count before/after shown).
- Tenant A's query never returns tenant B's chunks (added to the RLS matrix).

---

### Station 9 — ICP builder

**Say to the agent:**
> Station 9. Specify the ICP builder. Write docs/mvp/09-icp.md.

**User journey:**
1. **Inputs (any mix):**
   - a chat or voice interview (8–10 guided questions)
   - an uploaded list of past or best customers (CSV/XLSX)
   - won/lost notes
   - the offer from Station 6
2. Omni-SDR enriches the customer list (company size, industry, location, website signals).
3. Omni-SDR proposes an **ICP document**:
   - firmographics (industry, size, geography, revenue band)
   - technographics / website signals
   - buyer roles
   - pains + triggers
   - disqualifiers
   - message angles
   - **evidence for each item**, from the customer list or the knowledge base
4. The user edits, saves as **ICP v1**, and can keep several ICPs per workspace. Campaigns pin an ICP version.

**Backend:** new tables `icps(id, org_id, workspace_id, name, current_version)`,
`icp_versions(icp_id, n, doc jsonb, sources jsonb, created_by, created_at)`. **Fit score** = a
deterministic scoring function from the ICP rules (not a model call per lead), stored on
`contacts.fit_score` with the matched rules.

**AI:**
- `icp.interview` (next-question generation)
- `icp.propose` (structured ICP JSON with a `source_refs` per field)
- `icp.rules` (compile the ICP to machine-checkable rules for fit scoring)

**Report:** "ICP summary" PDF/Doc export (Station 21).

**Acceptance tests:**
- An ICP generated from a 12-row CSV cites which rows support each firmographic claim.
- Editing the ICP creates v2; existing campaigns keep v1 until switched.
- The fit score is reproducible: the same lead and ICP version always give the same score.

---

### Station 10 — Competitor research

**Say to the agent:**
> Station 10. Specify competitor research. Write docs/mvp/10-competitors.md.

**User journey:**
1. Enter competitor URLs/names, or ask "find my competitors" (suggestions, each with a reason, to confirm).
2. Omni-SDR researches each one:
   - site crawl: positioning, offers, pricing pages, proof, CTAs
   - public reviews summary (Places rating/count only; no review text stored, INFRA §0 #3)
   - content cadence (blog/social URLs)
   - tech signals
3. Output per competitor: a **battlecard**:
   - who they target
   - claims
   - pricing (if public)
   - strengths / weaknesses
   - where we win
   - objection handlers
4. Output across all competitors: a **positioning gap map**.
5. All of it feeds campaigns and reply handling through the knowledge base.

**Backend:**
- Research job (Workflow): crawl N pages per competitor (cap), snapshot each page (sha + GCS), extract with Gemini into a structured battlecard.
- Web discovery via Gemini with Google Search grounding [VERIFY cost/quotas], or a search API. Decision for Christian.

**Data:** `competitors(id, org_id, workspace_id, name, domain, status)`,
`competitor_snapshots(competitor_id, url, fetched_at, sha, gcs_uri)`,
`battlecards(competitor_id, version, doc jsonb, source_refs jsonb)`.

**Guardrail:** every battlecard statement cites a snapshot URL + date. Anything uncited is dropped.

**Acceptance tests:**
- A battlecard with 3 competitors completes under the credit estimate shown, and each claim links to its snapshot.
- A re-run 7 days later shows what changed (diff of battlecard versions).

---

### Station 11 — Lead sourcing, enrichment, evidence, scoring

**Say to the agent:**
> Station 11. Specify leads end to end. Write docs/mvp/11-leads.md. Follow INFRA §9.

**User journey:**
1. **Sources:**
   - CSV/XLSX import (column mapping, dedupe preview)
   - "Find leads" (Google Places by category + area)
   - HubSpot import
   - manual add
   - Chrome copy (post-MVP)
2. **Enrichment job per lead:**
   - website teardown (port `leadgen/starter.js`)
   - Places rating/hours
   - contact discovery (site contact pages; a licensed vendor is post-MVP)
   - **email verification**
3. **Lead table:** fit score, heat, evidence chips, email status, owner, campaign.
4. **Lead drawer:** evidence with snapshots, timeline (every touch, reply, meeting), notes.

**Backend:** `accounts`, `contacts`, `evidence`, `signals` (INFRA §5.1), plus `imports(id, …,
status, row_count, error_count)`. Evidence is immutable with 30-day expiry. Dedupe by
`(workspace_id, email)` and `(workspace_id, domain)`.

**Acceptance tests:**
- Importing a 500-row CSV with 20 duplicates and 15 invalid emails reports exactly those numbers, and only valid rows become enrollable.
- "Find 50 dental practices in Nashville" returns ≤ 50, each with ≥ 1 evidence item or marked "no evidence found".
- An unverified email can't be enrolled (the DB guard already refuses the send; the UI blocks earlier).

---

### Station 12 — Campaign studio (multi-channel, multi-format generation)

**Say to the agent:**
> Station 12. Specify the campaign studio. Write docs/mvp/12-campaigns.md. Follow INFRA §11–13, §17.

**User journey:**
1. **New campaign:** pick ICP version + audience (a lead filter or list) + goal (meetings, audits, replies) + channels.
2. **Strategy brief** (generated, editable):
   - angle(s)
   - offer framing
   - proof to use
   - competitor positioning to lean on (Station 10)
   - cadence
3. **Assets generated from the brief:**
   - **Email sequence:** 3 steps + a breakup, with personalization slots bound to evidence.
   - **LinkedIn assist notes** for heat ≥ 4.
   - **Social posts:** 4 company-page posts with images.
   - **Images:** Imagen with the brand kit; text as an overlay layer.
   - **Per-prospect audit page** (`/a/[slug]`) + **PDF one-pager**.
   - **Landing copy** (optional).
4. **Preview per lead:** see the exact email Maya's prospect will get, with evidence highlighted.
5. **Schedule:** send windows (prospect time zone), daily cap per mailbox, start date.
6. **Launch** → drafts are generated per lead and gated → Approvals (Station 13).

**Backend:**
- `campaigns`, `sequences` (versioned JSON, INFRA §13.1), `enrollments`, `drafts`, `content_items`, `assets`, `audits`.
- **Claims gate** (INFRA §12) runs on every draft and content item.
- **Generation jobs** reserve credits.

**AI tasks:**
- `campaign.brief`
- `sequence.plan`
- `draft.email` (per lead, evidence-bound JSON with claims)
- `post.write`
- `image.generate`
- `audit.compose`
- `onepager.compose`

Each task has an input/output schema and a cost estimate in the station file.

**Multimodal outputs in the MVP:** text, images, PDF, web page, Google Doc. **Video:** listed as
post-MVP with its pipeline sketch (INFRA §17) so the data model already supports it
(`assets.kind='video'`).

**Acceptance tests:**
- A campaign for 50 leads produces 50 × 4 drafts; each draft's claims map to evidence, and the gate blocks a seeded invented claim.
- Editing the brief regenerates only unsent drafts, and never touches approved ones without re-gating.
- The audit page renders without contact PII, carries `noindex`, and expires on schedule.

---

### Station 13 — Approvals and the Trust Dial

**Say to the agent:**
> Station 13. Specify approvals. Write docs/mvp/13-approvals.md. Follow INFRA §12, §23.

**UI:**
- **Swipe queue** (approve / edit / discard / skip, keyboard shortcuts A/E/D/S) and a table view with bulk approve.
- **Each card shows:** lead, evidence chips, the draft, the gate result (pass, warnings), heat/fit, step, scheduled time.
- **Client viewers** can approve in their workspace if the workspace allows it (setting).
- **Trust Dial** setting: level 1 (default) and level 2 behind a feature flag, with its written conditions shown.

**Backend:**
- Approve is a server action setting `status='approved', approved_by, approved_at`. The DB constraint refuses it if the gate didn't pass on the current text (already built: `packages/db`).
- Edit → gate voided → re-gated automatically (already built as a trigger).
- **Signed single-use approval links** for email/Slack approvals are post-MVP.

**Acceptance tests (several already run in `packages/db`):**
- Approving an ungated draft fails at the DB.
- An edit after approval voids approval.
- A reviewer can approve; a client_viewer can only approve when the workspace setting allows it.

---

### Station 14 — Outbound execution: mailboxes, sending, deliverability

**Say to the agent:**
> Station 14. Specify sending. Write docs/mvp/14-outbound.md. Follow INFRA §4 (email), §13–14, §23.

**Must cover:**
- **Mailbox connect:**
  - Gmail OAuth (scopes shown).
  - Domain checks (SPF/DKIM/DMARC) with the missing record named.
  - Warmup ramp table (day → cap).
  - Health status.
- **Sequencer:** tick every minute; `SKIP LOCKED`; stop rules (reply, meeting, unsubscribe, bounce, CRM stage).
- **Sender:** named Cloud Task per draft → `INSERT messages` (the guard runs: already built) → Gmail send → record provider id.
- **Unsubscribe:** header + link to `/u/[token]` → suppression first.
- **Breakers** → holds → the UI HoldBanner shows what tripped and who can clear it.
- **LinkedIn assist:** copy + open profile + "I sent it" confirmation → `messages.state='confirmed'`.
- **Gmail app stages:**
  - Stage A internal (tenant #0)
  - external **testing** (up to 100 pilot users, weekly re-auth) [VERIFY]
  - verification later (INFRA §29 #1)

**Acceptance tests:**
- A forced hard bounce trips the breaker, and the next send is refused with "on hold".
- The daily cap is respected across concurrent workers (the DB counter; already built).
- A reply stops the enrollment before its next step is sent.

---

### Station 15 — Inbound: unified inbox and lead capture

**Say to the agent:**
> Station 15. Specify inbound. Write docs/mvp/15-inbound.md. Follow INFRA §15.

**Sources in the MVP:**
- Gmail replies (watch/poll)
- website form webhook (`/api/hooks/form/[ws]`, signed)
- audit page views (a signal)
- LinkedIn assist replies logged manually

**Inbox UI:** threads grouped by lead, label chips, confidence, suggested next action, and a
reply composer grounded in the knowledge base (drafts only; gated; approved before send).

**Classification labels:** meeting_request, question, objection_price, objection_timing,
referral, out_of_office, not_interested, unsubscribe, other. Confidence < 0.8 → "needs you".

**Inbound leads:** a form submission creates a contact + lead with source=inbound → enrichment →
routed to a campaign or an owner.

**Acceptance tests:**
- An unsubscribe reply writes suppression before classification finishes.
- A form post with a bad signature is refused; a valid one creates exactly one contact on re-delivery.

---

### Station 16 — Follow-up and meetings

**Say to the agent:**
> Station 16. Specify follow-up and the meeting lifecycle. Write docs/mvp/16-meetings.md.

**Must cover:**
- **The meeting request lifecycle, with a 2-business-hour SLA:**
  - a suggested reply with 3 slots from Google Calendar free/busy, or the booking link
  - escalation (in-app → push → email)
  - booked → the sequence stops → confirmation + reminders
  - held / no-show → a reschedule draft
- **Snoozes:** out-of-office (parse the return date), timing objection (parse the date).
- **Meetings page:** requests with countdown, upcoming, history, outcomes.
- **Tables:** `meeting_requests`, `meetings` (INFRA §5.1). **Calendar connector:** Google Calendar (events.insert, free/busy; scopes [VERIFY]).

**Acceptance tests:**
- A meeting request left unanswered for the SLA sends one escalation, not repeats.
- Booking through the suggested slot creates the calendar event and stops the sequence in one transaction plus events.

---

### Station 17 — Social content and publishing (MVP: LinkedIn company page)

**Say to the agent:**
> Station 17. Specify content and publishing. Write docs/mvp/17-content.md. Follow INFRA §16.

**Must cover:**
- **Content calendar:** drafts from campaigns or composer → review → approve → schedule.
- **Media checks** before scheduling.
- **Publishing:** LinkedIn company page via the official API [VERIFY app access; apply at P0]. Unique `(content_item, channel_account)` prevents double posting.
- **Metrics pull** (impressions, reactions, comments, clicks) → analytics.
- **Other platforms** listed as post-MVP with their app-review lead times.

**Acceptance tests:**
- Scheduling the same post twice to the same page is refused by the DB.
- A post with a number or a named business passes the claims gate first.

---

### Station 18 — Assets and file handling

**Say to the agent:**
> Station 18. Specify the asset library and file pipeline. Write docs/mvp/18-assets.md. Follow INFRA §8.

**Must cover:**
- **Supported types + size caps per plan.**
- **Pipeline:** quarantine, malware scan, understanding per type (Document AI, Speech-to-Text, Gemini captions), PII scan.
- **Assets:** versions + lineage, previews (PDF, image, audio waveform, video poster).
- **Editing in the MVP:** docs via Google Docs round-trip, images via crop/overlay + Imagen mask edit, text assets inline.
- **Access and download:** signed URLs only; download/export of any asset.

**Acceptance tests:**
- The EICAR test file is quarantined and never reaches `assets`.
- Every edit creates a new version, and the previous version stays downloadable.

---

### Station 19 — Internal analytics

**Say to the agent:**
> Station 19. Specify the analytics dashboard. Write docs/mvp/19-analytics.md.

**Metrics (each with an exact SQL definition in the station file):**
- **Outreach funnel per campaign/step:** leads → enrolled → sent → replied → positive → meeting requested → booked → held.
- **Reply rate and positive rate** by step, angle, ICP version and mailbox.
- **Deliverability:** bounces, complaints, holds.
- **Speed:** reply → first response time, meeting-request SLA hit rate.
- **Content:** posts published, engagement, leads engaging.
- **Research usage + credits** by meter.
- **Agency roll-up** across workspaces.
- **No open-rate metric** (INFRA §16.2 #4: no tracking pixel).

**Build:** Postgres views/materialized views refreshed on a schedule for the MVP; BigQuery later.
Charts are `ChartCard` components; every number links to the rows behind it.

**Acceptance tests:**
- The dashboard numbers equal counts from raw tables on a seeded dataset (a test compares them).
- A client_viewer sees only their workspace's numbers.

---

### Station 20 — Integrations (MVP set)

**Say to the agent:**
> Station 20. Specify MVP integrations. Write docs/mvp/20-integrations.md. Follow INFRA §19.

**MVP connectors:**
- Gmail (Station 14)
- Google Calendar (Station 16)
- Google Drive/Docs/Sheets (export)
- HubSpot (push contacts, notes for every reply/stop/meeting; pull contacts for import)
- LinkedIn company page (Station 17)
- Stripe (billing)
- **outbound webhooks** (signed HMAC) for `lead.created`, `reply.received`, `meeting.booked`, `report.generated`

**Must cover:**
- The connector manifest per connector.
- Scopes + [VERIFY] links.
- Field mapping.
- Idempotency via `external_refs`.
- The `reauth` flow.
- **Recorded real payloads for contract tests:** fetch one real payload each and note the absent fields.

**Acceptance tests:**
- A HubSpot push of 100 contacts twice creates 100, not 200.
- A revoked HubSpot token shows `reauth` within one sync cycle.

---

### Station 21 — Reports and exports (the last outcome)

**Say to the agent:**
> Station 21. Specify reports and exports. Write docs/mvp/21-reports.md. Follow INFRA §17.

**Report types in the MVP:**
- **Campaign report:** results, top messages, learnings, next steps.
- **Client monthly report** (Agency): per workspace, branded.
- **Competitor report:** battlecards + gap map.
- **ICP summary.**
- **Prospect audit / one-pager.**
- **Custom report from the composer** ("Make report" intent over chosen data + knowledge).

**Pipeline:** gather data (SQL) + retrieve (RAG) → Gemini section JSON → claims gate on every
figure → template → **PDF** (headless Chrome), **Google Doc/Slides**, **web view**. Every number
cites its query or source.

**Exports:**
- **Leads/contacts:** CSV, XLSX, Google Sheet.
- **Messages + replies:** CSV.
- **Assets:** ZIP.
- **Workspace data export** (JSON + files) for portability.
- **CRM push** (HubSpot).
- **Webhooks.**

**Acceptance tests:**
- A campaign report's numbers match the analytics view for the same period.
- A report with a figure the data can't support is blocked with the failing claim shown.
- An export of 10,000 leads completes as a job and downloads via a signed URL that expires.

---

### Station 22 — Billing, credits, notifications, admin

**Say to the agent:**
> Station 22. Specify billing, credits, system notifications and the admin/ops console.
> Write docs/mvp/22-billing-notify-admin.md. Follow INFRA §21.1 (notify.), §23–24.

**Must cover:**
- **Stripe:** subscription per org, plan → limits, webhooks → `credit_ledger` grants, trial expiry → read-only.
- **Credits:** three meters, reserve/settle/release (already built in `packages/db`), estimates shown before jobs, and a low-balance banner.
- **Notifications:**
  - in-app tray
  - web push (FCM)
  - email via `notify.omnisdr.com` (Cloudflare Email Sending REST API from the `mailer` module)
  - Types: approvals waiting, meeting SLA, holds, reauth, job done/failed, credits low.
- **Admin/ops** (Christian only): orgs list, holds across tenants, dead-letter queue replay, job registry status, feature flags per org.

**Acceptance tests:**
- A generation job that fails refunds its reservation (already a DB test; add the job-level test).
- A trial past expiry can view but can't send or generate.

---

### Station 23 — Security, privacy, compliance

**Say to the agent:**
> Station 23. Produce the MVP security and compliance checklist. Write docs/mvp/23-security.md.
> Follow INFRA §9, §21–22, §27.

**Must cover:**
- A threat model (STRIDE) per surface: web, API/webhooks, audit pages, email worker, connectors, AI prompts (injection via prospect content).
- OAuth token custody (KMS envelope) and least-privilege roles.
- The RLS matrix (built; extended per new table).
- CAN-SPAM requirements (postal address, unsubscribe, honoring within the required time [VERIFY]).
- Google API Limited Use disclosure, privacy policy + terms URLs (needed for app reviews).
- Data retention table, deletion jobs, audit log.
- The sending model: all mail from the customer's own accounts.
- Out of MVP: SMS/TCPA, SOC 2 (state as "not yet" honestly).

**Exit criteria:**
- [ ] Every threat has a control and a test or a stated gap.
- [ ] Privacy policy and terms are drafted as documents for Christian's legal review.

---

### Station 24 — AI layer: tasks, prompts, evals, costs

**Say to the agent:**
> Station 24. Consolidate every AI task from Stations 6–22 into one registry.
> Write docs/mvp/24-ai.md. Follow INFRA §10.

**Must cover:**
- **A task table:** name, model [VERIFY ids], input schema, output schema, grounding (brief / RAG / evidence), gate applies (y/n), max tokens, estimated cost, fallback.
- **Prompt registry rules:** versioned files, hash stored on outputs.
- **Evals per task:** 10–30 fixed cases with pass criteria, run in CI on prompt or model change.
- **Injection containment:** retrieved content in labelled data blocks, no tools during drafting.
- **Cost model:** a per-campaign estimate for 50 leads (research + drafts + images + report) in credits and dollars [VERIFY pricing].

**Exit criteria:**
- [ ] No AI task mentioned in any station is missing from the registry.
- [ ] Every generating task has an eval set outline.

---

### Station 25 — Data model consolidation and migrations plan

**Say to the agent:**
> Station 25. Merge every table from Stations 1–24 into one migration plan.
> Write docs/mvp/25-data-model.md and the ordered list of migrations after 0001_core.sql.

**Must cover:**
- An ERD (Mermaid).
- Per new table: columns, constraints, indexes, RLS policy, which DB roles get which grants.
- The migration order (`0002_knowledge`, `0003_icp_competitors`, `0004_inbox_meetings`, `0005_content_assets`, `0006_reports_exports`, `0007_billing`, …).
- **Test additions per migration:** the RLS matrix picks up new tables automatically. Confirm each new table is seeded in `test/helpers.mjs` so the matrix isn't vacuous.

**Exit criteria:**
- [ ] Every table named in any station appears exactly once.
- [ ] Every tenant table has `org_id`, and the mechanical RLS test will cover it.

---

### Station 26 — Test strategy and the MVP acceptance script

**Say to the agent:**
> Station 26. Write docs/mvp/26-testing.md: the test pyramid and the full end-to-end acceptance
> script for the Maya (owner) and Northside (agency) journeys in §2.2.

**Must cover:**
- **Suites:** unit, DB (exists), RLS matrix (exists), gate sabotage (exists), connector contracts, AI evals, RAG golden, e2e (Playwright on `dev.omnisdr.com`).
- **The acceptance script:** every numbered step in §2.2 as an executable e2e step with the exact assertion.
- **Release gate:** any failure or any zero-denominator report blocks deploy (INFRA §28).

---

### Station 27 — Ready-for-development review

**Say to the agent:**
> Station 27. Audit docs/mvp/00–26 for gaps and contradictions, then write docs/mvp/27-ready.md:
> the build plan as ordered sprints, each with scope, stations covered, and a demo at the end.

**Suggested sprint order** (the agent adjusts with reasons):

| Sprint | Build | Demo |
|---|---|---|
| 1 | Monorepo move, P0 platform on omni-dev, auth + account types + workspaces, RLS context helper | Sign up as Owner and as Agency; invite a reviewer |
| 2 | Onboarding (brand, voice, offer), composer, intake pipeline, asset library | Voice note + PDF + URL become a confirmed brief |
| 3 | Knowledge base, ICP builder | ICP v1 from a CSV with citations |
| 4 | Competitor research, lead import/find, enrichment, evidence, fit score | 50 enriched leads with evidence + 3 battlecards |
| 5 | Campaign studio (email + images + audit page + one-pager), claims gate service, approvals | A 50-lead campaign in the approval queue |
| 6 | Gmail connect, sequencer, sender, unsubscribe, breakers | Tenant #0 sends real sequences from `try.omnisdr.com` |
| 7 | Inbox, classification, follow-up, meetings, Google Calendar | A real reply → meeting booked → sequence stopped |
| 8 | LinkedIn company page publishing, analytics, reports + exports, HubSpot, webhooks | Campaign report PDF + Doc; CSV/Sheets export; HubSpot push |
| 9 | Billing/credits/Stripe, notifications, admin, security checklist, e2e acceptance script green | The full Maya + Northside journeys pass end to end |

**Ready-for-development checklist (all must be true before Sprint 1 starts):**
- [ ] `docs/mvp/00–26` exist, and each station's exit criteria are ticked by Christian.
- [ ] `DECISIONS.md` has no open item marked blocking.
- [ ] Every [VERIFY] needed by Sprints 1–2 is resolved with a link.
- [ ] Platform applications submitted: Google OAuth app (testing), LinkedIn page API access, Vertex quota requests.
- [ ] Domains: `omnisdr.com` DNS in Terraform plan; `notify.` onboarding in Cloudflare Email Sending started.
- [ ] Accounts: GCP projects exist with billing; Workspace decision made; Stripe account in test mode.
- [ ] Secrets inventory complete (names + owners), and **no secret values in any doc**.
- [ ] `packages/db` suite green, with the output pasted in `27-ready.md`.
- [ ] The Sprint 1 task list is written as issues, each ≤ 1 day, each with its acceptance test.

---

## Part 4 — Reference

### 4.1 What already exists (verified 2026-09-28)

| Item | Path | State |
|---|---|---|
| Backend + infrastructure spec v3 | `docs/INFRASTRUCTURE.md` | 30 sections; domains `omnisdr.com` + `try.omnisdr.com` |
| Schema v1 | `packages/db/migrations/0001_core.sql` | 18 tenant tables with forced RLS; composite tenant FKs; versioned ICPs; claims-gate constraint; `send_guard()` trigger; credits ledger; outbox; audit log |
| DB tests | `packages/db/test/*.test.mjs` (`npm test` in `packages/db`) | 20 pass / 0 fail; send guard refuses 15 of 15 seeded bad sends; RLS matrix 18 of 18 tables; 16 tenant FKs carry org_id |
| Front-end mock | `src/app/*`, `src/components/*` | Clickable prototype: localStorage state, browser-side Gemini, mock data. Layout reference only |
| Gemini master spec (rewritten 2026-09-28 21:40) | `~/.gemini/antigravity-ide/brain/.../omni_sdr_master_spec.md` | Superseded by `docs/claude/SPEC.md`; audit in `docs/claude/AUDIT-2026-09-28-gemini-master-spec.md` |

### 4.2 Decision log format (`docs/mvp/DECISIONS.md`)
```
## YYYY-MM-DD — <decision>
Station: NN · Decided by: Christian
Options: A (…), B (…), C (…)
Chosen: B — because …
Revisit when: …
```

### 4.3 Open decisions already known (the agent starts `DECISIONS.md` with these)

> **Update 2026-09-28:** Christian answered the station walk-through. His decisions are in
> **`docs/claude/DECISIONS.md`**, which is binding and **overrides this guide wherever they differ**
> (e.g. owner/agency naming, admin role, LinkedIn automation, Shopify/GoHighLevel/Whop instead of
> HubSpot, full white-label, all generation pipelines built but disabled). Of the nine items below,
> only #1 (prices) is still open. Every agent reads that file before any station.
1. Plan prices and limits (Station 1).
2. Trial with or without a card (Station 5).
3. Google Workspace for the Cloud organization and `try.` mailboxes, or none (INFRA §21.1b).
4. Component primitives library (Station 3).
5. Competitor discovery: Gemini Search grounding vs a search API (Station 10).
6. Whether client viewers can approve by default (Station 13).
7. Whether Trust Dial level 2 ships in the MVP behind a flag (Station 13).
8. Whether video generation moves into the MVP (§2.3; default: no).
9. Whether LinkedIn personal-profile automation is ever built (INFRA §16.4 of the v2 archive; default: no, assist only).

### 4.4 Handing a station to a fresh agent (copy-paste)
```
Context: Omni-SDR. Read docs/MVP-BUILD-GUIDE.md Part 1 rules and follow them.
Task: Run Station <NN> exactly as written in Part 3.
Inputs you must read first: <list from the station> plus docs/mvp/DECISIONS.md.
Output: docs/mvp/<NN>-<slug>.md using the template in §1.3, then stop.
Report back: files read, file written, decisions needed, anything UNVERIFIED.
```
