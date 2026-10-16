<div align="center">

# Omni-SDR

**An AI sales development platform for owner-operators and agencies. Campaigns are grounded in evidence, approved by a person, and sent from the customer's own accounts.**

[![tests](https://github.com/DimeDataCloud/omni-sdr/actions/workflows/tests.yml/badge.svg)](https://github.com/DimeDataCloud/omni-sdr/actions/workflows/tests.yml)

</div>

Omni-SDR researches a prospect, writes a multi-channel sequence tied to verifiable facts about that
prospect, and routes every message through an approval step before it is sent. Replies are classified
and answered until a meeting is booked or the thread ends.

> **Private repository.** This README is the handoff document for the owner and the build agents. It
> is not a public product page. Authoritative build decisions live in `docs/claude/`.

## Status

Pre-launch MVP build. The production platform is the set of packages, services and edge workers
described under [Components](#components). The Next.js app at the repository root is a clickable mock
that stores state in the browser; it is kept for layout reference and is scheduled for replacement.

## What it does

- **Evidence-grounded research.** Harvests Google Places listings, Skool community posts and prospect
  websites, and keeps only dated, checkable operational details (for example, unanswered reviews or
  slow quote turnaround).
- **Claims gate.** A deterministic gate (`packages/gate`) requires every outreach claim to cite an
  evidence anchor. The gate fails closed and is enforced by the database as well as by application
  code.
- **Approval before send.** Drafts sit in an approval queue. The trust dial sets how much runs
  unattended, from per-item review up to confidence-gated autonomy with rate caps.
- **Sending from the customer's accounts.** Gmail through the Google Workspace API, with a send guard
  that must pass before any message leaves the system (`packages/sender`).
- **Inbound triage.** Replies are classified into intents such as meeting requested, pricing
  objection, timing, wrong person and unsubscribe (`services/decider`, `src/server/triage`).
- **Audit pages.** Public, branded audit pages at `/audit/[slug]` with an estimated revenue impact and
  a booking link.

## Components

| Path | Role |
| --- | --- |
| `packages/api` | HTTP API behind the console. Every tenant request runs inside `withTenant()`. Includes the send, refine and eval jobs. |
| `packages/db` | Postgres access and the migration runner. `migrations/*.sql` is the only schema of record. |
| `packages/gate` | Claims gate. The only writer of draft gate status. |
| `packages/sender` | The only egress to a recipient. Claims a send through the guard, composes, and hands off to a provider adapter. |
| `packages/enrich` | Website enricher that turns a contact's homepage into citable evidence. Deterministic and SSRF-guarded. |
| `packages/ai` | Adapter to the decision engine and the decision registry. |
| `services/decider` | Self-hosted decision service for reply triage and benchmarks. Has its own Dockerfile. |
| `apps/console` | Vite and React web app (the console). Styled only through the design tokens in `docs/design`. |
| `edge/api-proxy` | Cloudflare Worker that passes API traffic to the Cloud Run API without state. |
| `edge/email-worker` | Cloudflare Email Worker that parses replies and posts them, HMAC-signed, to the API inbound endpoint. |
| `cloud-functions/waitlist-ingest` | Serverless ingest for waitlist leads into Cloud Storage. |
| `src/` (root) | Next.js mock of the product, plus the public landing, waitlist, privacy, security and terms pages. |

## Architecture

- **System of record:** Cloud SQL Postgres. `docs/INFRASTRUCTURE.md` (v3) drops Firestore; the root mock still imports Firebase helpers.
- **Compute:** API on Cloud Run; edge on Cloudflare Workers.
- **AI:** Gemini models through Vertex AI, configured by `OMNI_MODEL*` variables.
- **Google integrations:** Gmail and Calendar (OAuth), Places API.
- **Telephony:** Twilio for SMS follow-ups.

The full backend and infrastructure spec, with `[VERIFY]` markers for platform facts, is
`docs/INFRASTRUCTURE.md`.

## Quick start

Requires Node 24 (CI uses 24) and npm. Each package has its own lockfile.

```bash
# Root Next.js mock
npm ci
npm run dev -- -p 3005          # http://localhost:3005

# Backend API
cd packages/api
npm ci
npm run dev                     # node src/dev.mjs
npm test

# Console
cd apps/console
npm ci
npm run dev                     # vite
npm run typecheck
npm run gates
```

Other packages follow the same pattern: `cd packages/<name> && npm ci && npm test`.

## Configuration

Names only. Set values in your local environment or in the Cloud Run and Cloudflare dashboards. Never
commit them. The code that reads each variable is the authority for the full list:
`packages/api/src/server.mjs`, `packages/api/src/routes/mailboxes.mjs`, `packages/db/src/migrate-cli.mjs`.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `packages/db`, `packages/api` | Postgres connection string |
| `OMNI_PGLITE_DIR` | `packages/api` (dev) | Local embedded Postgres data directory |
| `PORT`, `ORIGIN`, `OMNI_CORS_ORIGINS` | `packages/api` | Listen port and allowed origins |
| `OMNI_GOOGLE_CLIENT_ID`, `OMNI_GOOGLE_REDIRECT_URI` | `packages/api` | Google OAuth for mailboxes |
| `OMNI_SENDER_SECRETS` | `packages/sender` | Sender credential source. Secret |
| `OMNI_VERTEX_PROJECT`, `OMNI_VERTEX_LOCATION` | `packages/api`, `packages/ai` | Vertex AI project and region |
| `OMNI_MODEL`, `OMNI_MODEL_FLASH`, `OMNI_MODEL_FLASH_LITE`, `OMNI_MODEL_PRO` | `packages/api`, `packages/ai` | Model selection per task |
| `OMNI_DECIDER_URL` | `packages/api` | URL of `services/decider` |
| `OMNI_INBOUND_SECRET`, `OMNI_EDGE_SECRET`, `INBOUND_SECRET`, `EDGE_SECRET` | API and edge workers | Shared secrets for inbound and edge calls. Secret |
| `OMNI_REPLY_DOMAIN`, `REPLY_DOMAIN` | API and email worker | Domain for reply routing |
| `OMNI_UNSUBSCRIBE_BASE` | `packages/api` | Base URL for unsubscribe links |
| `GEMINI_API_KEY` | root app (server side) | Gemini key for the mock's server routes. Secret |
| `GOOGLE_PLACES_API_KEY` | `src/server/harvester` | Places API key. Secret |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | `src/server/dispatcher` | Twilio SMS. The token is secret |
| `GCS_BUCKET_NAME`, `BUCKET_NAME` | `src/lib/storage.ts`, `cloud-functions/waitlist-ingest` | Cloud Storage bucket for leads |
| `ADMIN_SECRET_KEY` | `src/app/api/waitlist` | Shared secret for the waitlist endpoint. Secret |

Do not use the `NEXT_PUBLIC_` prefix for keys. Anything with that prefix is bundled into the browser.

## Project structure

```
omni-sdr/
├── packages/          # API, schema, claims gate, sender, enricher, AI adapter
├── services/decider/  # decision service and benchmarks
├── apps/console/      # Vite + React console
├── edge/              # Cloudflare Workers (API proxy, email worker)
├── cloud-functions/   # waitlist ingest
├── functions/api/     # serverless waitlist handler
├── src/               # Next.js mock and public pages (root app)
├── e2e/               # end-to-end tests
├── infra/             # infrastructure definitions (db-vm)
├── scripts/           # build helpers (build-pages.mjs)
└── docs/
    ├── claude/        # build spec, decisions log, plans, audits
    ├── mvp/           # design proposals (not decisions)
    ├── design/        # design system and tokens
    ├── journal/       # workboard and build journal
    └── archive/       # superseded documents
```

## Testing

- CI (`.github/workflows/tests.yml`) runs `npm ci && npm test` for every package under `packages/*` and
  `edge/*` that has a test script, on each pull request and on pushes to `master`.
- `apps/console` has no test script yet. It is covered by `typecheck` and `gates`.
- The root app has a `lint` script (ESLint).

## Working agreements

Build work by AI agents follows `AGENT-RAILS.md` (lanes, hard rails, workboard protocol). `AGENTS.md`
and `CLAUDE.md` point to it. Decisions are recorded in `docs/claude/DECISIONS.md` and are append-only.
Where documents conflict, `DECISIONS.md` wins, then `docs/claude/SPEC.md`, then the SQL migrations for
schema facts.

## Handoff notes for the owner

- The root app's routes (approval queue, prospect miner, settings and so on) exist only as mock views.
  The production console lives in `apps/console`.
- The root app calls Gemini from the browser in its mock. That path must be removed before any public
  deployment. If `NEXT_PUBLIC_GEMINI_API_KEY` was ever set, rotate that key.
- Dates in `docs/` record when each decision was made. Check them before relying on a plan.

## License

Proprietary. Copyright (c) 2026 Dime Data. All rights reserved. See [LICENSE](LICENSE). No use,
copy or distribution without written permission from the copyright holder.
