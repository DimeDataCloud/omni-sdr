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

## 2026-09-28 — Code home: Drive + GitHub (supersedes "out of the Drive-synced folder")
Decided by: Christian ("keep everything in drive as well")
- The working tree stays in the Drive-synced Halo folder (`projects/omni-sdr`) AND is pushed to the private repo DimeDataCloud/omni-sdr.
- Git data is kept out of Drive (`~/.halo-git/omni-sdr`, via a `.git` pointer file) so Drive never syncs half-written git objects, matching the brain repo.
- Real data never enters git: `data/` (waitlist signups) is gitignored.

## 2026-09-28 — Project grounding journal: DimeDataCloud/omni-sdr-journal
Decided by: Christian ("a specific secondary journal for this project only, for grounding purposes")
Local: `projects/omni-sdr-journal` (Drive + GitHub, git data in `~/.halo-git/omni-sdr-journal`). It holds dated journal entries and cited sources for every [VERIFY] fact. Decisions stay here, not in the journal.
