# Omni-SDR — Claude spec: decisions

Owner: Claude (this spec). Only Claude writes in docs/claude/. The other agent's notes live in docs/mvp/ and are proposals until they appear here.
Every entry below was decided by Christian in the 2026-09-28 station walk-through. Append-only; format in MVP-BUILD-GUIDE.md §4.2.


## 2026-09-28 — Account types: owner + agency at launch
Station: 01 · Decided by: Christian
Options: A (owner + agency), B (owner only), C (agency only)
Chosen: A. The org → workspaces schema already supports both; the cost is mostly UI.
Naming: account types and UI tags are `owner` and `agency`, never "solo". `orgs.account_type IN ('owner','agency')`; the upgrade path is owner → agency.

## 2026-09-28 — Roles: four tiers, same on owner and agency accounts
Station: 01 · Decided by: Christian
The top role is `admin` (renamed from `owner` to end the clash with the account type).
1. `admin`: billing, members, connections, delete, everything below.
2. `operator`: builds and runs campaigns, research, content, inbox.
3. `reviewer`: the account's own side (agency staff, or an owner's team). Views, comments, approves drafts.
4. `client_viewer`: outside the account (the agency's client, or an owner's partner/stakeholder). Reports + analytics; approvals only when the workspace toggle is on.
Migration impact: memberships.role CHECK becomes ('admin','operator','reviewer','client_viewer'). 0001_core.sql currently allows 'owner' and the seed uses it, so update both and re-run the suite.

## 2026-09-28 — Pricing: undecided, placeholders only
Station: 01 · Decided by: Christian
Options: A (base + credits), B (flat), C (undecided)
Chosen: C. Plan limits and trial credit amounts get written as TBD; decide before Station 22 (billing). The credits ledger stays in the schema either way.

## 2026-09-28 — Trial: 7 days, card required
Station: 01/05 · Decided by: Christian
Chosen: 7 days, card captured at sign-up, auto-converts at expiry.
Implication: 7 days is shorter than mailbox warm-up, so the trial must deliver value through research, ICP, drafts and approvals before sending volume ramps. Station 5/6 make that the first-week path.
Revisit when: trial → paid conversion data exists.

## 2026-09-28 — Client viewer approvals: off by default, per-workspace toggle
Station: 01/13 · Decided by: Christian
Options: A (off + toggle), B (view only), C (on by default)
Chosen: A. The admin enables it per workspace. Overrides the "Review & Approve" default in docs/mvp/DECISIONS.md.

## 2026-09-28 — Landing: composer first, proactive and skippable
Station: 02 · Decided by: Christian
Options: A (today queue), B (analytics), C (composer first)
Chosen: C, modified. The composer is home and it drives.
- New users don't know what the product can do, so the composer proactively asks setup questions (brand, offer, ICP, connections) one at a time.
- Every question can be skipped.
- Once setup is done, the composer offers next actions (research competitors, build a campaign, review approvals) instead of an empty box.
Implication: Station 6 onboarding runs inside the composer as a conversation, not a separate wizard. The /onboarding routes become composer-driven steps with the same data writes. The today queue (approvals, replies, meeting SLAs) shows as cards beside or under the composer.
Revisit when: skip-rate data shows people bail.

## 2026-09-28 — UI primitives: shadcn/ui on Radix
Station: 03 · Decided by: Christian

## 2026-09-28 — Visual system: Translucent Sand + Pastel Neon Green (glass)
Station: 03 · Decided by: Christian
Spec: docs/mvp/brand-palette.md (verbatim from Christian, plus binding accessibility constraints).
Constraint: #A3FFB4 on #F7F5F0 is about 1.2:1 contrast, so green is a fill with #1A1A1A text on it, never text, an icon-only signal or a focus ring alone. Links, focus rings and success text use a dark green `--accent-ink` token (≥4.5:1). Dark mode: the agent proposes one in Station 3.

## 2026-09-28 — Mobile: responsive; approvals, inbox and meeting requests mobile-first
Station: 03 · Decided by: Christian

## 2026-09-28 — Code home: new private repo DimeDataCloud/omni-sdr
Station: 04 · Decided by: Christian
Its own GitHub repo, out of the Drive-synced Halo folder. GitHub Actions → Cloud Run via Workload Identity Federation (no service-account keys).

## 2026-09-28 — No Google Workspace; OAuth plan approved
Station: 04 · Decided by: Christian
- GCP organization: Cloud Identity Free on omnisdr.com ($0, no Gmail) [VERIFY current limits].
- OAuth consent: External app. An Internal app only works for your own staff, never customers, so Workspace would not have solved customer OAuth.
  - Sign-in scopes (openid, email, profile) are non-sensitive, so they publish to production with no review.
  - gmail.send is a sensitive scope: Google verification (brand, privacy policy, demo video; no CASA). Submit early [VERIFY timeline].
  - Replies come back through Reply-To → reply.omnisdr.com (Cloudflare Email Routing). No restricted Gmail read scopes, so no CASA in the MVP.
- Until gmail.send is verified: testing mode (≤100 named users, weekly re-auth) plus the smtp_imap adapter (app passwords) as the no-review fallback.



## 2026-09-28 — Environments: no extra spend; prod only
Station: 04 · Decided by: Christian
Chosen: no dev environment and no extra paid resources. One GCP project (omni-prod), sized at the smallest tier. All building and testing happen locally (PGlite + emulators).
Rules that come with it:
- Every migration runs against local PGlite and the full packages/db suite before it touches prod.
- Prod gets a manual backup/export before every migration.
- Revisit when: revenue covers a second database, or customer #1 signs (HALO recommends adding dev at that point).

## 2026-09-28 — Separate Claude spec
Decided by: Christian
docs/claude/ is this Claude session's spec and decision record. Only Claude writes here. docs/mvp/ belongs to the other agent (Gemini). Where they disagree, docs/claude/DECISIONS.md holds Christian's answers.

## 2026-09-28 — Sign-in: Google + email magic link
Station: 05 · Decided by: Christian
No passwords stored. Identity Platform (INFRA §20) [VERIFY free-tier MAU limit]. Microsoft sign-in deferred.

## 2026-09-28 — Billing account: existing Dime Data Stripe account
Station: 05 · Decided by: Christian
Omni-SDR is a product line on the Dime Data Stripe account (sole prop, existing EIN). The 7-day card-required trial uses Stripe Checkout with a trial period. Revisit if Omni-SDR is ever spun out.

## 2026-09-28 — Onboarding minimum: nothing; every step skippable
Station: 06 · Decided by: Christian
The proactive composer asks, and the user may skip all of it. Consequence the agent must design for: with no website, offer or ICP, early outputs are generic, so every generated item shows what context it lacked and a one-click "add it" prompt.

## 2026-09-28 — Onboarding connections: separate, skippable modules
Station: 06 · Decided by: Christian
Each is its own module the composer offers and the user can skip, and each stays available later in Settings:
1. Gmail (send, customer's own mailbox)
2. Google Calendar
3. Email send + routing (Reply-To via reply.omnisdr.com, forwarding, domain checks)
4. LinkedIn (company page publishing + Lane B assist; never unattended personal-profile automation)
5. Other social media accounts
6. Two-way CRM (HubSpot first)
7. MCP, two-way: Omni-SDR exposes its own MCP endpoint, and connects out to customers' MCP servers
8. SMS onboarding
Build rule: one connector manifest per module (INFRA connector contract), so adding a module is data, not a new wizard screen.
Scope note (HALO): SMS sending, and social platforms other than LinkedIn, are outside the MVP send scope (guide §2.3). Their modules ship as "set up now, activates later". SMS needs A2P 10DLC brand and campaign registration, which takes weeks and has fees [VERIFY], so the module collects the registration details and doesn't send. Christian can pull SMS into the MVP as a separate decision.

## 2026-09-28 — Composer run rule: auto-run cheap jobs; estimates displayed, never a wall
Station: 07 · Decided by: Christian
- Cheap, reversible jobs (draft, summarize, ask-my-data, rewrite) run immediately.
- Every job shows its estimated usage inline, in the style of Gemini/NotebookLM: a small live estimate beside the input and on the job card (credits by meter, rough time). There is no modal and no "are you sure" dialog.
- Costlier jobs (research, image/media generation, bulk enrichment) start only when the user presses the run button that shows the estimate. The press is the consent, so no second dialog.
- Anything that leaves the building (sends, publishes) still goes through Approvals (Station 13). The composer never sends.
- The credit reservation (INFRA §24) happens at press time. If the balance is short, the button says so instead of failing mid-job.

## 2026-09-28 — "Auto-adjust": learning loop off by default, source-selectable
Station: 08 · Decided by: Christian
Name in UI: **Auto-adjust**. Off by default; an admin turns it on per workspace and ticks which sources it may learn from:
- booked meetings
- positive replies
- negative replies / objections
- unsubscribes and bounces
- SOPs and playbooks the user uploads
- won/lost notes
- the user's own edits to drafts (what they changed before approving)
- approval rejections and their reasons
What it adjusts: drafting examples, angle ranking and ICP message angles. It never adjusts guardrails, the claims gate or suppression.
Every adjustment is visible: a "what Auto-adjust learned" log per workspace, each item traceable to its source events and revertible. It never crosses workspaces or tenants.

## 2026-09-28 — Competitor discovery: Gemini with Google Search grounding
Station: 10 · Decided by: Christian
Billed to GCP credits, no new vendor [VERIFY grounding price per 1k queries and quota]. Suggestions always show a reason and need the user's confirm before research spends credits.

## 2026-09-28 — ICPs: multiple per workspace, versioned
Station: 09 · Decided by: Christian
Campaigns pin an ICP version; editing creates a new version.

## 2026-09-28 — Email verification: free checks + vendor verification as a customer-paid credit
Station: 11 · Decided by: Christian
Free on every lead: syntax, MX lookup, disposable/role-address lists. Full mailbox verification goes through a vendor and runs only when the customer spends a Data credit, so Omni-SDR never carries the cost [VERIFY vendor + unit price]. `email_status='valid'` needs a vendor pass; the send guard already refuses anything else.

## 2026-09-28 — Audit pages: on request by default; optional auto mode
Station: 12 · Decided by: Christian
- The per-prospect audit page (/a/[slug], noindex, expiring, no contact PII) exists in the MVP.
- Default: never built automatically. A user requests one per lead (from the lead drawer, the composer or a campaign step) and can add input or notes that shape it.
- "Auto audit pages" is a toggle (per campaign, default off) that builds one for every enrolled lead, and it shows the estimated credit usage inline (see the composer run rule).

## 2026-09-28 — Trust Dial: Level 1 at launch, Level 2 behind a flag
Station: 13 · Decided by: Christian
Every draft is human-approved. Level 2 (auto-send for heat ≥ 4) can be enabled per workspace through a feature flag only Christian/ops controls. Admins can't self-serve it in the MVP.

## 2026-09-28 — Warm-up: built-in slow ramp, on by default, customizable, pluggable
Station: 14 · Decided by: Christian
- The built-in ramp is on by default: the cap starts low and rises with healthy sends. It uses no warm-up network.
- Admins can disable it or customize the ramp (start cap, step, max).
- The hard daily cap and breakers still apply. The send guard's `daily_cap` is enforced whatever the ramp says.
- Admins can connect third-party warm-up services and other email providers/sending services as connector modules (same manifest contract as onboarding).
- HALO note: some warm-up services use reply networks that break Gmail's terms. The integration screen states that the customer's mailbox bears that risk, and those services still count against the hard cap.

## 2026-09-28 — Meeting booking: native by default, Calendly/Cal.com connectable
Station: 16 · Decided by: Christian
Native: 3 suggested slots from Google Calendar free/busy plus an Omni-SDR booking page that creates the event. Alternatively the workspace connects an existing Calendly or Cal.com link, and bookings arrive through their webhook into the same `meetings` table, so SLA and analytics work for both.

## 2026-09-28 — Meeting-request SLA: 2 business hours default, admin-adjustable
Station: 16 · Decided by: Christian
Business hours from the workspace time zone. Escalation: in-app → web push → email, once each.

## 2026-09-28 — No email open tracking
Station: 19 · Decided by: Christian
No tracking pixel. The funnel measures replies, positive replies, meetings.

## 2026-09-28 — LinkedIn: full automation (DMs, replies, connections, drip sequences, generated replies)
Station: 17 (+14, 15) · Decided by: Christian
This reverses the guide's default ("Lane C never built") and closes open decision #9.
Scope Christian requires:
- automated DMs
- automated replies
- new-connection handling (auto-accept options, welcome DM)
- connection requests
- drip sequences on LinkedIn
- custom AI-generated responses
Implementation HALO recommends (Christian may overrule):
- Official API wherever it exists: company page + member posting, and comments on company-page posts (Community Management API [VERIFY access]).
- DMs, connections and invitations have no official API for normal apps. They go through a third-party LinkedIn provider (Unipile-type) that drives the customer's own logged-in account, not a scraper Omni-SDR builds and maintains [VERIFY provider, pricing, contract terms].
- The provider cost is a per-LinkedIn-account add-on the customer pays (no extra spend for Omni-SDR).
- Opt-in per account, with a written consent screen: this automation breaks LinkedIn's User Agreement and LinkedIn may restrict the account.
- Same safety spine as email:
  - every automated DM/reply is a draft through the claims gate
  - Trust Dial applies (Level 1 means human-approved)
  - the send guard enforces channel='linkedin' daily caps [VERIFY safe limits, e.g. connection requests/day]
  - breakers on restriction signals put a hold on that account
  - suppression applies
- Replies from LinkedIn land in the unified inbox with the same classification labels.
Risk (HALO, one line): LinkedIn has sued automation vendors, not just banned accounts. Using a provider and customer consent reduces Omni-SDR's exposure but doesn't remove it. Revisit with a lawyer before paid launch.

## 2026-09-28 — MVP commerce/CRM connectors: Shopify, GoHighLevel, Whop
Station: 20 · Decided by: Christian
Two-way in the MVP:
1. Shopify: GraphQL Admin API, mandatory privacy webhooks. Customers/orders in as leads and signals; tags/notes out. A custom/unlisted app is fine for the MVP; the public App Store listing needs Shopify review [VERIFY].
2. GoHighLevel: OAuth marketplace app [VERIFY approval process]. Sub-accounts map to Omni-SDR client workspaces. Contacts/opportunities/notes two-way.
3. Whop: memberships, customers and payments in as leads and signals; notes/tags out where the API allows [VERIFY API scope].
HubSpot was not chosen, so it moves to the roadmap (the guide listed it as MVP). The connector manifest keeps adding it cheap.
Still in the MVP, unchanged: Gmail, Google Calendar, Google Drive/Docs/Sheets export, Stripe billing, LinkedIn, Calendly/Cal.com (booking), signed outbound webhooks, MCP two-way.

## 2026-09-28 — Agency reports: full white-label
Station: 21 · Decided by: Christian
- Agency logo, colors and name on reports, audit pages and client-facing emails from notify. No Omni-SDR mention anywhere a client can see it.
- This pulls custom domains into the MVP, e.g. reports.agency.com and audit pages on the agency's domain. Plan: Cloudflare for SaaS custom hostnames on omnisdr.com [VERIFY free allowance and per-hostname price on Workers Paid].
- If there's a per-hostname cost, it's billed to the agency (no extra spend).

## 2026-09-28 — Media pipeline built; generation disabled
Station: 12/18 · Decided by: Christian
- Build the full media pipeline: video/image/audio intake, storage, previews, versions, the asset kinds, the render job framework and credit metering.
- Generation (Veo video, and any generation marked expensive) ships behind a feature flag, off for every org. The UI shows no dead buttons.
- Imagen stills for campaign images stay on, since Station 12 needs them. Christian can flag them off too.
Closes open decision #8.

## 2026-09-28 — Web push: Firebase Cloud Messaging
Station: 22 · Decided by: Christian

## 2026-09-28 — All generation pipelines built and functional, all disabled until Christian enables them
Station: 12/18/24 · Decided by: Christian
Supersedes the "Imagen stays on" note above.
- Every generation pipeline gets fully built and passes its tests: Imagen images, Veo video, audio/voice, document/PDF, and any other media generator.
- Each is behind its own per-org feature flag, default OFF for all orgs. Christian turns each one on (ops console, Station 22) when ready.
- With a flag off, the UI hides the action or shows the non-generative path (upload, pick from assets). No dead buttons.
- Acceptance: each pipeline has a test that runs it end to end with the flag forced on in the test environment.
- Text generation (drafts, briefs, reports) isn't a media pipeline and stays on, since the product can't function without it.

## 2026-09-28 — Postal address: Dime Data home address, shown only where the law requires
Station: 23 · Decided by: Christian
Address: 713 Harpeth Knoll Court, Nashville, Tennessee 37221.
Where it appears (and nowhere else):
1. Footers of Omni-SDR's own *commercial* marketing emails (try.omnisdr.com), since CAN-SPAM requires a valid postal address in commercial email.
2. The Terms of Service "Notices / contact" clause and the Privacy Policy controller-identity section (GDPR Art. 13 identity and contact details of the controller [VERIFY need given the US-only launch]), placed at the end, not in headers.
3. Stripe business profile (invoices/receipts) as Stripe requires.
Where it does NOT appear:
- the site footer, the app UI, audit pages, reports
- notify.omnisdr.com transactional emails: CAN-SPAM's address rule applies to commercial messages, not transactional ones [VERIFY]
- customer outreach, which carries the *customer's* address, collected in onboarding and enforced by the gate
Contact everywhere else: a role email (e.g. legal@ / support@omnisdr.com via Cloudflare routing).
Revisit when: a virtual mailbox becomes affordable; swap the one config value.

## 2026-09-28 — Models: Flash-Lite, Flash, Pro, each routed by task
Station: 24 · Decided by: Christian
- Flash-Lite: extremely simple, fast tasks: classification, labels, dedupe hints, short extractions, intent routing, snooze-date parsing.
- Flash: the default middle. Per-lead drafts, replies, summaries, post writing, ask-my-data answers.
- Pro: large generations and exact-to-spec precision: ICP proposal, battlecards, reports, campaign briefs, sequence planning, anything with a strict output schema that Flash fails its eval on.
The registry (Station 24) assigns each task a tier, with a fallback tier and an eval that justifies the choice [VERIFY model IDs on Vertex].

## 2026-09-28 — No launch date; quality first
Station: 27 · Decided by: Christian
Pilot customers start when the MVP acceptance script (Station 26) passes end to end in prod. The 9 sprints stay as an order of work, not a calendar.

## 2026-09-29 — The AI Studio Fleet Console is the product floor; Claude builds the backend
Station: 02/03 (IA, frontend) and 05–16 (backend) · Decided by: Christian
Christian: "use this as your grand floor on what the product will look like. i want you to build the actual backend while me and gemini continue working on the design"
- The AI Studio app "Omni SDR - Autonomous Fleet Console" (export audited in AUDIT-2026-09-29-ai-studio-fleet-console.md) is the baseline for the product's screens: agents with chat threads, approvals, inbound replies with SLA, meetings, routines, capacity, analytics, connections, settings.
- Lanes for this work: **Claude builds the backend** (API server, services, migrations, workers). **Christian and Gemini own the design** (UI). This moves "API routes and server actions" from Gemini's lane (Rails §4) to Claude's; the rails lane table needs the matching edit (proposed on the backend PR).
- Not decided by this entry: the app's Firestore data layer and its browser-side Gmail sending stay out (audit P0s); every backend path runs on Postgres with RLS, the gate and send_guard.

## 2026-09-29 — Build the web app interface and put it on an omnisdr.com subdomain for phone testing
Station: 03 (frontend) · 23 (security) · Decided by: Christian
Christian: "using all of the information available to you create the Omni sdr web app interface and design … Run a multi stage design development review revise system until you all gates are passed … When done put this on and omnisdr.com subdomain so I can test it on my phone. Verify the domains security before completing and create the login for me to securely access the suite"
- Claude builds the interface (apps/console) to docs/design/DESIGN.md, and deploys it to one omnisdr.com subdomain behind a login for Christian. This is Christian's explicit approval for that one deploy (Rails §3.1).
- It runs on demo data in the browser (fictional, the same story as the dev seed), since there is no production database yet (Station 04 decisions pending). The real API adapter is built alongside and switched on later.

## 2026-09-30 — Claude is the main worker; Gemini does exacting tasks
Station: all · Decided by: Christian
Christian: "you are the main worker, i am using gemini agent to do exacting tasks"
- Claude builds the product end to end by default, the web app included. Gemini takes narrow, precisely specified tasks that Christian hands it, on the paths each task names. Rails v1.2 §1 and §4 carry this, and they finish the lane edit the 2026-09-29 backend entry asked for.
- Unchanged: the review rules. Merges still need the other agent's review and Christian's approval (§5.6). A change to the safety spine still needs Gemini's audit and Christian's OK (§6).

## 2026-10-01 — Studio is the image and video marketing suite
Station: 02/03 (IA, frontend) · 18 (assets + pipelines) · Decided by: Christian
Christian: "The studio is specifically for the video and image marketing suite. This is where you can go to create, add videos, social media content, create, generate and edit images and videos to make product photos and anything of the sort. Take reference from higgsfield AIS or video and image suites as well as Google flow"
- Studio becomes the place to create, upload, generate and edit images and video: product photos, social content, ads. The references are Higgsfield and Google Flow.
- This replaces DESIGN.md §6.9 (Studio = agents, routines, Auto-adjust).
- Unchanged by this entry: the 2026-09-28 generation decision. Every generator sits behind its own per-org flag, OFF until Christian turns it on, with no dead buttons; generation runs server-side only (Rails §8).
- Not decided by this entry: where agents, routines and the Auto-adjust log move to. The proposal is in docs/claude/STUDIO-PLAN.md.

## 2026-10-01 — A simpler workspace: few pages around inbound, outbound and marketing, with full control in setup
Station: 02/03 (IA, frontend) · Decided by: Christian
Christian: "better page and workspace optimization. Making the workspace very intuitive and organized. Not too many pages, focused on the inbound, outbound, and marketing simplicity things brings you while still presenting and allowing detailed decisions correction, optimization, and harness setup per feature/tool/agent/dataset"
- The workspace is organized around inbound, outbound and marketing, with as few top-level pages as possible.
- Detail stays available: every feature, tool, agent and dataset has a place to see its decisions, correct them, tune it and set it up.
- Not decided by this entry: the exact grouping and names. The proposal is docs/claude/WORKSPACE-PLAN.md.

## 2026-10-01 — Laya is the decision engine; no Jev, ever
Station: 24 (model registry) · 15 (inbound) · 12/13 (gate) · Decided by: Christian
Christian: "laya now no jev ever. solve low latencey hosting."
- Every classify / route / rank / check decision in JEV-PLAN.md runs on Laya (convaiinnovations/laya, Apache-2.0), self-hosted in our own GCP project as the internal `decider` service. JEV-PLAN.md's design (typed questions, safe-side-only rule, registry, golden sets, pinned version stored on the row) carries over unchanged; only the engine changes.
- TypeSafe / Jev is out permanently, not deferred: no adapter, no fallback, no evaluation. J1–J4 in JEV-PLAN.md are closed by this entry (J2, a new data subprocessor, no longer arises: prospect text never leaves our project).
- Low-latency hosting is Claude's to solve and measure; the hosting choice and its standing cost come back to Christian before anything runs always-on.

## 2026-10-01 — The decider runs on Cloud Run (CPU) for the MVP
Station: 24 · 23 (infra) · Decided by: Christian
Christian: "the setup has to make sense it has to cost us less to host laya for our saas on multiple customers than to pay jev for usage" · then "approve cloud run for mvp"
- `decider` is a Cloud Run service in project omni-sdr (us-central1): CPU only, scales to zero, IAM-only, internal ingress, max 2 instances. This is Christian's approval for that service and its image repo (`omni` in Artifact Registry).
- The cost bar is Jev's usage price for the same decisions. Measured (LAYA-PLAN.md): per decision, Cloud Run CPU costs more than Jev would; the MVP still costs less in absolute terms because it runs inside the Cloud Run free tier and only wakes when replies are waiting. Beating Jev per decision needs a GPU kept busy, which needs volume (~1,000 customers, estimate).
- Not approved by this entry: GPU quota, an always-on (min-instances) setting, or anything that bills while idle. Those come back to Christian with numbers.

## 2026-10-01 — Laya until Jev is the cheaper option (amends "no Jev, ever")
Station: 24 · Decided by: Christian
Christian: "Use laya until jev becomes the most cost effective option."
- Laya stays the engine. The switch rule is cost: when what Jev would charge for the same decisions is less than what hosting Laya costs us, Jev becomes the engine. This replaces "no Jev, ever" from the entry above; the rest of that entry stands.
- To make the rule checkable, every decision records its input tokens (already on `inbound_messages.decision`), and the monthly Laya cost comes from the decider's billed Cloud Run usage. The comparison is a report Claude builds; the switch itself is Christian's call when the report says so.
- Not decided: re-opening the TypeSafe DPA question (JEV-PLAN J2). It comes back only if the report crosses.

## 2026-10-02 — No more Gemini: two Claude sessions only
Station: all · Decided by: Christian
Christian: "No more Gemini just this cloud session and my Claude local session"
- Gemini is retired from Omni-SDR. The work is done by two Claude Code sessions: `claude-local` (on Christian's machine) and `claude-cloud` (claude.ai/code). This replaces the 2026-09-30 entry's split between Claude and Gemini.
- Review stays two-party: each session reviews the other's work, so the author is never the auditor. Merges need the other session's review and Christian's approval (§5.6); a safety-spine change needs the other session's audit and Christian's OK (§6).
- Rails v1.3 carries this. Older documents that name Gemini as an auditor or reviewer (SPEC, DESIGN, STUDIO-PLAN and the audits) are history; read "Gemini" there as "the other session".
- Proposal, not decided: the workboard names `claude-local` and `claude-cloud` (rails §1, §5), so a claim says which session holds it.

## 2026-10-02 — The MVP costs $0 to run and to test
Station: 23 (infra) · all · Decided by: Christian
Christian: "Keep production and testing cost to zero for the mvp."
- Free tiers only for production and testing: no Cloud SQL, GPU, min-instances, paid model calls or paid data generation. Test deploys stay inside the free tier and are deleted after.
- One accepted exception: the 2.52 GB `decider` image stays in Artifact Registry (~$0.20/month). Christian: ".20 a month is fine". Superseded API images are deleted after each deploy.
- Recorded by claude-local from the 2026-10-02 conversation.

## 2026-10-02 — Production database: Postgres 16 on the free e2-micro VM
Station: 23 · Decided by: Christian
Christian chose "All in Google Cloud ($0 VM)" over Cloud SQL (~$28/month) and Supabase.
- `omni-db`: e2-micro, us-central1-a, internal IP only (an external IPv4 costs $3.65/month), nightly `pg_dump` to GCS with 14-day retention. RPO is 24 hours: the accepted trade against Cloud SQL's point-in-time recovery.
- Deployed 2026-10-02 on Christian's "Evverything is merged deploy" (master 1491f34). Details: docs/claude/DEPLOY-HANDOFF.md §3b and the workboard.

## 2026-10-02 — claude-local works without asking until the MVP is complete
Station: all · Decided by: Christian
Christian set claude-local's goal: "you job is to watch behind cloud session review the pull requests, keep things secure, bug free, and merged/deployed/updated." Then: "Ask no questions you have control" and "Your job isn't finished until the fullvpbis completed" (read as: the full MVP).
- claude-local reviews and merges the other session's PRs, deploys merged work, and takes the open defaults below without asking. It still reports every deploy, cloud change and decision on the workboard, and still stays at $0 (entry above).
- Not changed by this entry: rails §6. A change to auth, RLS, the gate, the guard or a public endpoint still gets the other session's audit before it merges.
- Defaults claude-local took under this entry (each was a proposal with a stated default; Christian can reverse any):
  - Bug bounty #4: `client_viewer` loses the agent, routine, campaign, connector, capacity, credit and settings reads (a team role is required); it keeps approvals (with the workspace toggle), meetings and analytics. Proposal's default: yes.
  - Bug bounty #5: Cloudflare Turnstile on the waitlist form, and the ingest service accepts only the Pages function. Proposal's default: yes, before the waitlist is promoted. [VERIFY] Turnstile's free tier: https://developers.cloudflare.com/turnstile/
  - Bug bounty #8: keep logout as is while the Worker password gate is single-owner; it goes away with G5.
  - Bug bounty #9: access codes from `crypto.randomUUID()`, before any code grants anything.
  - PR #33: merged by claude-local after its audit (approve with one P2 doc fix and one P3, both left with claude-cloud).
  - G5 sign-in: email-link only (Google sign-in later); Identity Platform Tier 1 is free to 50,000 monthly active users, so it's inside the $0 rule. SMS and multi-factor stay off because they bill per message.

## 2026-10-02 — No trial for now
Station: 1 (sign-up), credits · Decided by: Christian
Christian, in claude-local's session: "no trial for now". Then: "merge and deploy everything we can up to this point".
- No 7-day trial and no trial credits. A new org starts with no credits. Metered work (ICP proposal, competitor research, generation, lead finding, verification) needs credits granted through the ledger (ops) until pricing is decided.
- So PR #56's 0012 `grant_trial_credits` does not ship. Don't build a Stripe trial checkout (cloud's next step for M1). Anything that says "turn it on in the trial" (Places) waits for its own decision.
- Not decided here: when a trial comes back, or what it grants. The SPEC §1 step 1 trial stays in the spec as the target, not the current build.
- Merged and deployed 2026-10-02 under the second instruction: #44, #48, #53 (claude-local's, merged without the cross-audit, which claude-cloud is asked to run after the merge), then #47, #50, #51, #54 (all audited). Prod: migrations 0009–0011 after backup omni-20261002T223543Z, API image api:4940e59 (rev omni-api-00008-wg9), console Worker c269308d (the password gate stays on, so sign-up isn't public).


## 2026-10-03 — Rails v1.4: sessions talk through GitHub issues and PRs
Station: process · Decided by: Christian
Christian, in claude-cloud's session: "you two should talk in the repo messaging issues and pr systems or whatever works best for the two of you, talk as if im not here in whatever manor is most efficeint for you time, token, and accuracy wise", then "yes" to issue #68 (put the protocol in the rails).
- AGENT-RAILS.md v1.4: §1 coordination line and §5.7 (issues/PRs for messages; labels; terse agent-to-agent format; `to: christian` issues for decisions). Protocol detail: issue #63. The workboard stays the file-claim lock.
- Both sessions confirm `Rails v1.4 loaded` in their next report.
- Recorded by claude-cloud.

## 2026-10-03 — Standing approval: merge and deploy what both sessions approved
Station: process · Decided by: Christian
Christian, in claude-cloud's session (after "yes deploy"): "no longer ask if approved by both of you".
- A PR both sessions approved (§6 cross-audit, no open P0–P2) merges and deploys without asking Christian, prod
  migrations included, with a fresh prod backup first. The deployer posts what shipped in the PR and a `to: christian`
  FYI issue. AGENT-RAILS v1.4 §3 / §5.6 / §6 carry this.
- Scope as claude-cloud read it (Christian may widen it): merge + deploy only. Spend, new or reconfigured cloud
  resources, sending to real people or publishing, exposing data, secrets and decisions still need Christian.
- Recorded by claude-cloud.
