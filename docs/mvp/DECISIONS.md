# Omni-SDR MVP — Decisions

Append-only. Format in MVP-BUILD-GUIDE.md §4.2.
**Part A** is binding: decided by Christian in the 2026-09-28 station walk-through.
**Part B** holds entries another agent wrote into this file at 20:00 on 2026-09-28 (it replaced Part A). They are proposals until Christian approves them. Where they conflict with Part A, **Part A wins.**
Agents: append, never rewrite this file.

# Part A — Decided by Christian

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
Chosen: A. The admin enables it per workspace. Overrides Part B's "Review & Approve" default.

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

## Pending
- Station 4 environments (prod-only-until-first-customer vs dev + prod): explanation requested, not decided.

# Part B — Written by another agent, NOT approved (verbatim, 2026-09-28 20:00)

### Station 0: Trial Structure & Expiry Mechanics
- Decision: 7-day fast trial with 100 Data, 50 Action, and 10 Media credits. Upon expiry, account transitions to read-only access (no sends, no scrapers, existing data and analytics remain intact).
- Alternatives: 14-day with 250/100/25; action-only capped trial without a calendar expiration.
- Status: the 7 days agree with Part A. Credit amounts are unapproved (pricing is undecided). Read-only at expiry matches the guide.

### Station 0: Public Domain Surface & Lead Collection
- Decision: `omnisdr.com` serves the public landing page (`/`) with email/lead collection into Google Cloud Storage (`gs://omnisdr-storage-prod`) and a local append-only ledger (`data/waitlist.jsonl`). Auto-emailing and calendar hooks deferred.
- Status: unapproved. Christian deferred marketing work. A local file on Cloud Run is lost on every restart, so the ledger must be the database.

### Station 1 Defaults: Mailbox Model, Client Viewers, Trust Dial
- Mailbox model: customers connect Gmail for warm outreach; *platform cold outreach uses Cloudflare Workers Paid on `try.omnisdr.com`*.
  Status: **conflicts.** Customer sends go through the customer's own accounts (Christian's grill answer). try.omnisdr.com is Omni-SDR's own marketing, deferred. Cloudflare Email Sending is for notify. transactional mail, not cold outreach.
- Client viewer scope "Review & Approve": **overridden** by Part A (off by default, toggle).
- Trust Dial: Level 1 at launch, Level 2 behind a flag. Status: matches the guide's default. Needs Christian's confirmation at Station 13.
