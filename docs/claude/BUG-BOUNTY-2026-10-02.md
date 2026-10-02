# Bug bounty, 2026-10-02 (claude-cloud)

Christian: "Run a massive bug bounty for Omni sdr". Target: master 1491f34, which holds PRs #25–#32. Method:
attack scripts against the real API (PGlite), a real Postgres 16, and the Workers under Node. Every finding has
a reproduction; every fix has a test that fails on 1491f34 and passes on the fix branch (`claude/bug-bounty`).

## Scoreboard

| # | Sev | Where | Finding | Status |
|---|---|---|---|---|
| 1 | P2 | `edge/email-worker/src/index.mjs` | The worker capped a reply at 100,000 *characters*; the API refuses bodies over 256 KB. A long non-Latin reply (267 KB) got 413, so it was never ingested, an opt-out in it included | **fixed:** body also cut to fit 240 KB, top kept |
| 2 | P2 | `packages/api/src/app.mjs` `clientIp` | Behind a proxy, the client IP was always the *last* X-Forwarded-For entry. With Cloudflare or a load balancer in front, that is the proxy, so every user shares one rate-limit bucket and one sign-in-failure bucket (30/min): one attacker locks everyone out | **fixed:** `OMNI_TRUST_PROXY=<hops>`; set 2 behind Cloudflare/LB + Cloud Run [VERIFY on the deployed path] |
| 3 | P2 | `functions/api/waitlist.ts` | The Pages function still proxied GET `?format=` to the ingest service: the path the 2026-09-28 P0 used to leak every signup. Upstream refuses GET today (405), so nothing leaks now, but one upstream change reopens it | **fixed:** GET handler removed. Takes effect on the next omnisdr.com deploy |
| 4 | P2 | API permissions (SPEC §7) | `client_viewer` (the agency's client, an outside party) gets 200 on agent chat transcripts, agents (with model tiers), routines, campaigns, connectors, capacity, credits and settings, because those routes check only `reports_view`. The console hides them; the API doesn't | **decision for Christian**: proposal below |
| 5 | P2 | `cloud-functions/waitlist-ingest` | The ingest service is public (allUsers) with no rate limit or bot check: anyone can write unlimited records to `gs://omnisdr-leads` directly, skipping the site | **needs a cloud change:** proposal below |
| 6 | P3 | `packages/api/src/app.mjs` route matching | Malformed %-encoding in any path (`/u/%E0%A4%A`) threw in `decodeURIComponent`, returned 500 and logged a stack trace | **fixed:** 404 |
| 7 | P3 | `packages/api/src/auth.mjs` | Every made-up `kid` forced a fetch of Google's certificates (rate-limited only by the 30/min auth-failure bucket per IP) | **fixed:** at most one forced refresh a minute; real rotation still refreshes immediately |
| 8 | P3 | `apps/console/worker/index.ts` | Logout only clears the cookie; a copied session stays valid up to 12 h. A password change does revoke every session | proposal: bump `pwver` on logout ("sign out everywhere"), or keep, as it's the single-owner preview |
| 9 | P3 | `cloud-functions/waitlist-ingest` | The "access code" is 4 base-36 characters from `Math.random()` (1.7M values, collisions likely at scale) | proposal: `crypto.randomUUID()`-based, before any code grants a discount |

## Attacked and held (no finding)

- **Tenant isolation:** 135 calls across all 44 tenant routes, as a stranger with her own org:
  - Northside's org and workspace;
  - her org with Northside's workspace;
  - her own workspace with Northside's record ids (IDOR).
  0 not refused.
- **Claims gate and approvals:**
  - approving a gate-blocked draft → 409;
  - approve, then edit in an unsourced claim → re-gated and blocked;
  - an invite accepted by a different email → 403; reusing an invite → 403.
- **Reviewer role:** 13 reads, plus approve and reject, succeed. Of the writes, 9 were refused (403). 21 were rejected as invalid input (400), which comes before the permission check, so those 21 are **not proven**: a follow-up probe with valid bodies is listed under Next.
- **Token verification:** RS256 only (`none` and HS256 refused); audience, issuer, expiry and subject checked; a verified email required.
- **Internal hook:** HMAC compared in constant time; 5-minute window; bad or stale signature → 401.
- **Unsubscribe page:** a `<script>` token isn't reflected.
- **Request bodies:** a `__proto__` key in a body doesn't pollute.
- **Errors:** SQL errors never reach the client (`errors.mjs`).
- **Sign-in Worker (suite.omnisdr.com):**
  - HMAC session with a `__Host-` cookie: HttpOnly, SameSite=Strict, revoked on password change;
  - timing-safe compares; CSRF origin and Sec-Fetch-Site checks;
  - redirects only to relative paths; rate-limited.
- **Migrations and VM:** covered by PR #30's tests on Postgres 16 (non-superuser owner, pg_hba, TLS).

## Proposals needing Christian

- **#4, client viewer scope.** Proposal: the agent, routine, campaign, connector, capacity, credit and settings
  reads require a team role (admin, operator or reviewer); client viewers keep approvals (when the workspace
  toggle is on), meetings and analytics, which matches what the console shows them. This edits the SPEC §7
  matrix (a new action such as `team_view`), so it's your call. Default: yes.
- **#5, waitlist spam.** Proposal: Cloudflare Turnstile on the form, verified in the Pages function; ingest then
  takes only calls from the Pages function (a shared secret header). Both are deploys plus a cloud change. Cost $0
  [VERIFY] developers.cloudflare.com/turnstile. Default: yes, before the waitlist is promoted.

## Deploy notes (claude-local)

- **API:** set `OMNI_TRUST_PROXY` to the hop count of the real path. With Cloudflare proxying `api.omnisdr.com` in
  front of Cloud Run, that's 2. Check a request's X-Forwarded-For once after deploy. Otherwise leave it unset
  (socket address).
- **omnisdr.com:** the waitlist GET removal ships with the next Pages deploy.
- **Email-worker:** the byte cap ships with its first deploy.

- **Write-route permissions, closed statically:** each write route's `action` is mapped against the SPEC §7 matrix. Reviewers and client viewers can only reach the approve family (approve, reject, bulk approve, edit, holds); every other write needs build, members, inbox_draft, clear_hold or workspace_settings. `POST /v1/o/:org/workspaces` checks nothing in the API, but `create_workspace()` allows org-wide admins only. Live check: a stranger, reviewer, operator and client viewer all get 403; the org-wide admin gets 201.

## Next
- The full console gate run stalls after INP on runs that include #29 (see the 2026-10-02 PR audit). Owner: claude-local on Windows.
