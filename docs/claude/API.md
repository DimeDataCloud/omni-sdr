# Omni-SDR API: the backend behind the Fleet Console

**Status:** v0.1, built 2026-09-29 by Claude (DECISIONS 2026-09-29: the AI Studio console is the product floor; Claude builds the backend).
**Code:** `packages/api` (HTTP), `packages/db` (schema + tenant context), `packages/gate`, `packages/sender`.
**Tests:** `cd packages/api && npm test` (42), `packages/db` (46), `packages/gate` (8), `packages/sender` (7). Mutation-checked; see the PR.

## 1. Run it locally (for design work)
```
cd packages/api && npm install && npm run dev        # http://127.0.0.1:8787, fresh demo data on every start
```
- **Sign in:** `Authorization: Bearer dev:maya@example.com`. The dev accounts:
  - `maya@` (admin)
  - `sam@` (operator)
  - `riley@` (reviewer)
  - `client@` (client_viewer, first workspace only)
- **Demo data:**
  - An agency "Northside Growth" with 3 client workspaces.
  - The first workspace holds 6 agents, 4 routines, 6 fictional dental prospects with evidence, 7 drafts in review, 1 draft blocked by the gate with its findings, 3 sent first touches, 3 real replies (a meeting request with its SLA, a question, an opt-out) and a booked meeting.
  - All of it was made by the real gate, sender (capture adapter) and inbox code. All addresses are on `.example` domains; nothing leaves the machine.
- **Dev-only rules:** the dev server refuses to start with `NODE_ENV=production`, listens only on 127.0.0.1, and never calls a model (`OMNI_MODEL` is off).
- **Browser access:** CORS allows `localhost:3000` and `:5173`. Add others with `OMNI_CORS_ORIGINS`.
- **Real Firebase tokens:** set `OMNI_FIREBASE_PROJECT=hip-well-509308-m9` to accept real Identity Platform / Firebase ID tokens as well. The AI Studio app already signs in through that project, so its `user.getIdToken()` works here.

## 2. Conventions
- **Auth:** `Authorization: Bearer <ID token>`, an Identity Platform / Firebase ID token.
  - The server checks it against Google's certs: RS256, audience, issuer, expiry, and a verified email.
  - There are no cookies, so there's no CSRF surface.
- **Tenant routes:** `/v1/o/{orgId}/w/{workspaceId}/…`.
  - The server proves the membership from the database on every request (`withTenant`), then checks the SPEC §7 role.
  - A workspace you're not a member of is `403`. A malformed id is `404`.
- **Bodies:** JSON only (`415` otherwise), with at most 256 KB.
  - Unknown fields are `400`, so the UI can't set a column by accident.
- **Errors:** `{ error, message, details?, requestId }`. The status codes:
  - `400` bad input
  - `401` sign in again
  - `403` role
  - `404` missing or not yours
  - `409` refused by a rule (the message says which)
  - `429` rate limit
  - `502` model unavailable
- **Field names:** responses are camelCase. Timestamps are ISO strings (UTC).
- **Rendering:** render every text field as **text**, never as HTML. That covers agent replies, prospect replies and draft bodies: prospect text is hostile input and model output is untrusted.

## 3. Endpoints
Permission names are from `packages/db/src/permissions.mjs` (SPEC §7).

### Identity (signed in, no workspace yet)
| Method + path | Who | Body → answer |
|---|---|---|
| `GET /v1/me` | anyone signed in | → `{ user, orgs: [{ id, name, accountType, subscriptionStatus, role, workspaces: [{ id, name }] }] }` |
| `POST /v1/orgs` | anyone signed in (5/hour) | `{ orgName, accountType: owner\|agency, workspaceName? }` → `201 { orgId, workspaceId }`. Stripe trial checkout is not wired yet |
| `POST /v1/invites/accept` | the invited email only | `{ token }` → `{ orgId }` |
| `POST /v1/o/{org}/workspaces` | org-wide admin; **agency only** | `{ name }` → `201 { workspaceId }`. An owner account gets `409` |

### Workspace
| Method + path | Permission | Notes |
|---|---|---|
| `GET …/settings` | member | `{ workspace, org, you: { role } }`. Trust level and feature flags are **read-only** (ops only) |
| `PATCH …/settings` | `workspace_settings` (admin) | `name, timezone, clientApprovalsEnabled, autoAdjustEnabled, autoAdjustSources[], postalAddress` |
| `GET …/members` | `members` (admin) | members + pending invites |
| `POST …/invites` | `members` | `{ email, role, workspaceIds? }` → `201 { id, expiresAt, inviteUrl }`. **The link is shown once**; only a hash is stored. Valid 7 days, single use |
| `DELETE …/invites/{id}` | `members` | revoke |

### Approvals (Trust Dial Level 1)
| Method + path | Permission | Notes |
|---|---|---|
| `GET …/approvals?status=review\|blocked\|approved\|all&channel=&minFit=&limit=` | `approve` | → `{ items: [Card], counts }` |
| `GET …/approvals/{id}` | `approve` | one Card |
| `POST …/approvals/{id}/approve` | `approve` | only from `review`; `409` otherwise |
| `POST …/approvals/bulk-approve` | `approve` | `{ ids: [...] }` (≤100) → per-item results. **Send the ids the person reviewed**; there is no "approve everything above fit N" |
| `POST …/approvals/{id}/reject` | `approve` | `{ reason? }`; the reason feeds Auto-adjust |
| `PATCH …/approvals/{id}` | `approve` | `{ subject?, body? }`. The edit voids the gate pass and the approval, and the gate runs again at once. → `{ gate: passed\|blocked, item: Card }` |

`client_viewer` sees and acts on approvals only when the workspace's `clientApprovalsEnabled` is on.

**Card:**
```
{ id, status, dispatched, channel, step, subject, body,
  recipient: { contactId, name, title, company, email, emailStatus }, fitScore,
  campaign: { id, name }, agent: { id, name, modelTier } | null,
  gate: { passed, version, gatedAt, findings: [{ code, detail }] },
  claims: [{ text, factKey, evidence: { id, type, sourceUri, fetchedAt, facts, expiresAt } | null }],
  sequence: [{ id, step, subject, body, status }], trustLevel, rejectionReason, approvedBy, approvedAt, createdAt }
```
**There is no send endpoint.** Approved drafts are sent by the sender worker, under `send_guard()`. The guard checks approval, a current gate pass, trust level, holds, a verified email, suppression and the daily cap.

### Inbox and meetings
| Method + path | Permission | Notes |
|---|---|---|
| `GET …/inbox?status=open\|handled\|all` | `inbox_read` | Sorted by SLA first. Each item carries `intent`, `needsHuman`, `slaMinutesRemaining` |
| `POST …/inbox/{id}/handle` | `inbox_draft` | once |
| `POST …/inbox/{id}/meeting` | `inbox_draft` | `{ startsAt, endsAt, meetUrl? (https) }`. Books the meeting, marks the reply handled and ends the contact's sequence, all at once |
| `GET …/meetings?range=upcoming\|past\|all` | `reports_view` | |
| `POST …/meetings` | `inbox_draft` | `{ startsAt, endsAt, meetUrl?, contactId? }` |
| `PATCH …/meetings/{id}` | `inbox_draft` | `{ status: booked\|completed\|no_show\|canceled, startsAt?, endsAt?, meetUrl? }` |

**Reply intents:** `meeting_request, positive_inquiry, question, objection, referral, out_of_office, not_interested, unsubscribe, wrong_person, bounce, unclassified`.
- An opt-out or bounce reply suppresses the address in the same transaction.
- Any real reply (not an out-of-office) stops the sequence.
- A meeting request gets a 2-business-hour SLA in the workspace's time zone.
- The current classifier is keyword rules (confidence 0.6), so everything is `needsHuman` until the Jev layer (JEV-PLAN) lands.

### Agents, chat, routines
| Method + path | Permission | Notes |
|---|---|---|
| `GET …/agents` | `reports_view` | Each agent carries `lastMessage { preview, sender, at }` and `activeRoutines` |
| `POST …/agents` | `build` | `{ name, station?, badge?, modelTier: flash_lite\|flash\|pro, systemPrompt?, contextSources?, autonomousMode?, appearance? }` |
| `PATCH …/agents/{id}` · `DELETE …/agents/{id}` | `build` | Delete archives the agent and switches off its routines |
| `GET …/agents/{id}/messages?before=&limit=` | `reports_view` | Oldest first |
| `POST …/agents/{id}/messages` | `build` | `{ body, modelTier? }` → `201 { userMessage, reply }`. The model gets fixed house rules (it can't send, publish or contact anyone) plus the agent's role. If the model fails: `502`, and the person's message is kept |
| `GET …/routines` · `POST` · `PATCH …/routines/{id}` | `reports_view` / `build` | `{ name, category: briefing\|triage\|outbound\|sync, schedule, active, agentId }`. `pausedByOps` is the ops kill switch and isn't settable here. **The runner that executes routines isn't built yet** |

### Build side
| Method + path | Permission | Notes |
|---|---|---|
| `GET …/contacts?q=` · `GET …/contacts/{id}` | `build` | The detail view includes evidence and enrollments |
| `POST …/contacts` | `build` | `{ contacts: [ { name, email, phone, company, title } ] }` (≤500). Free checks run on each: syntax, disposable domain, role address. **They never mark an address valid** (only paid verification can). Duplicates are skipped |
| `GET …/icps` · `POST …/icps` | `build` | Without `lineageId`: a new ICP. With it: the next version. Old versions never change |
| `GET …/campaigns` · `POST` · `PATCH …/campaigns/{id}` | `reports_view` / `build` | |
| `POST …/campaigns/{id}/enrollments` | `build` | `{ contactIds }` |
| `POST …/drafts` | `build` | `{ enrollmentId, step?, channel?, subject?, body, claims?: [{ text, evidence_id, fact_key }], agentId? }` → gated at once → `201 { id, gate, findings }` |

Evidence can't be written through the API. It is a fetched, hashed snapshot made by the enricher, and the gate trusts it.

### Operations
| Method + path | Permission | Notes |
|---|---|---|
| `GET …/capacity` | `reports_view` | Per mailbox: `sentToday` vs `dailyCap` (the same UTC day the guard counts), plus the holds that stop this workspace, the queue counts and `workspaceOnHold` |
| `POST …/holds` | `approve` | `{ scopeType: workspace\|campaign\|mailbox, scopeId?, reason }`. Pausing is always allowed, so operators and reviewers can pull the brake |
| `DELETE …/holds/{scopeType}/{id}` | `clear_hold` (admin) | |
| `POST …/suppression` | `approve` | `{ email, reason? }`. Stores a hash only |
| `GET …/credits` | `reports_view` | `{ balances: { data, action, media } }` |
| `GET …/analytics?days=7\|30\|90` | `reports_view` | `totals { sent, replies, positive, meetings }`, `rates { replyRate, positiveRate, approvalRate }` (**null, not 0, when nothing happened**), `daily[]`, `byStep[]`. **No open rate** (SPEC S14) |
| `GET …/connectors` | `reports_view` | The SPEC §9 module list, with the real status: `connected`, `not_connected` or `activates_later` |
| `GET …/activity` | `members` | Audit log |

### Public
- `GET /healthz`.
- `GET /u/{token}`: shows a one-button unsubscribe page. It never unsubscribes on a GET, because link scanners prefetch links.
- `POST /u/{token}`: unsubscribes. This is the form's button and also RFC 8058 one-click. The response is the same for a valid, reused or unknown token.
- `POST /internal/inbound`: for the Cloudflare email-worker only.
  - Signed with `X-Omni-Timestamp` + `X-Omni-Signature: sha256=HMAC(secret, "<ts>.<raw body>")`, within a 5-minute window.
  - The route is `404` unless `OMNI_INBOUND_SECRET` is set.

## 4. Mock screen → endpoint
| Console screen / component | Calls |
|---|---|
| Agent sidebar, ChatWorkspace | `GET agents`, `GET/POST agents/{id}/messages` |
| Deploy Agent modal, Studio (prompt editor) | `POST/PATCH agents` |
| Approvals view, Review modal, Capacity panel's approval card | `GET approvals`, `approve`, `reject`, `PATCH` (edit), `bulk-approve` |
| Approvals → Inbound tab, Capacity panel's replies | `GET inbox`, `handle`, `inbox/{id}/meeting` |
| Capacity/Dispatch panel | `GET capacity`, `GET routines`, `PATCH routines/{id}`, `POST/DELETE holds` |
| Analytics view | `GET analytics`, `GET credits` |
| Skills & Connections | `GET connectors` |
| Settings | `GET/PATCH settings`, `GET members`, `POST invites` |
| Workspace switcher, top nav | `GET /v1/me` |
| Inspect-state drawer | `GET approvals/{id}`, `GET contacts/{id}`, `GET activity` |

## 5. Where the mock disagrees with the rules (for Christian and Gemini)
Each of these is shown in the mock but conflicts with a decision or an invariant. The backend follows the rule. The screen needs the change.

| # | Mock | Rule | What the screen should do |
|---|---|---|---|
| 1 | "Send via Gmail" button; browser-side Gmail send | Nothing sends except the sender worker after approval + `send_guard()`; no vendor calls from the browser (SPEC §4) | Remove it. Approving is the last human step |
| 2 | Analytics columns "opened" | S14: no open tracking | Remove opens; use replies, positive replies and meetings |
| 3 | "SOC2 Type II Certified" badge, "99.98% uptime SLA" | Not true; a false claim in the product is a legal risk | Remove |
| 4 | Settings "Auto-send over 95 fit" | Trust Dial Level 2 is ops-only (S7) | Remove, or show read-only "Level 1" |
| 5 | Settings "Daily cap 120" editable; routine "auto-capped at 80/day" | The hard cap is a safety floor; the warm-up ramp is admin-customizable but can't lift the cap (S12) | Show the cap read-only; put the ramp in a separate control once built |
| 6 | "Approve all ≥90 fit" | Approval is a human review per draft | Bulk-approve the drafts the person actually reviewed (send their ids) |
| 7 | Integrations all "Connected" | Status must be real | Use `GET connectors` |
| 8 | Evidence `confidenceScore` | Evidence is a snapshot (source, time, facts, expiry), not a score | Show source + fetched time + expiry |
| 9 | Unread counts per agent | Not tracked yet (needs per-user read markers) | Hide, or use `lastMessage.at` |
| 10 | Meeting provider `native_google_cal` | `native \| calendly \| cal_com` | Rename |
| 11 | Model names ("Gemini 2.5 Flash") | Tiers (`flash_lite`, `flash`, `pro`); model IDs are config [VERIFY] | Show the tier |
| 12 | Agents like Talent Scout (HR), Expense Lead (FIN) | Out of MVP scope (§3) | They work as generic chat agents; no HR/finance data behind them |

## 6. Production notes (Christian runs these; nothing here is deployed)
- **Entry point:** `npm start` (`src/server.mjs`). The env vars are listed at the top of that file.
- **Required env:** `DATABASE_URL` and `OMNI_FIREBASE_PROJECT`.
- **Model calls:** `OMNI_MODEL=vertex` plus the model IDs.
- **Database login:** create a login role (e.g. `omni_api`).
  - It must be a **member of `app_rw`, `gate_svc`, `sender_svc`, `inbox_svc` and nothing else**: not a table owner, not `cloudsqlsuperuser`.
  - The server drops to one of those roles in every transaction, and RLS applies.
- **Migrations:** `packages/db/src/migrate.mjs`, run as a job by the owner role, **after a backup**.
- **Client IP:** `OMNI_TRUST_PROXY=1` makes the server read the client IP from `X-Forwarded-For` behind Cloud Run. [VERIFY which hop Cloud Run appends.]

## 7. Not built yet (next, in order)
1. **Sender worker loop.** Pick up approved, unsent drafts in send windows, choose the mailbox, call `sendDraft` with the Gmail adapter, and run the sequencer for steps 2–3.
2. **Mailbox connect.** The Gmail OAuth flow (`gmail.send` only) plus the smtp_imap fallback, credentials under KMS (SPEC 0005_connectors), warm-up ramp config.
3. **Routine runner.** A scheduler that executes routines: briefings, triage sweeps, follow-up drafting.
4. **Email-worker** on Cloudflare for `reply.omnisdr.com`, calling `/internal/inbound`.
5. **Stripe trial checkout** at sign-up; credit metering on chat and composer jobs (waits on prices).
6. **Stations 08–12 and 16–22:** knowledge/RAG, competitor research, lead finding and enrichment (the evidence writer), Calendly/Cal.com webhooks, reports/exports, notifications, MCP, LinkedIn. Jev decision layer per JEV-PLAN once J1–J4 are decided.
7. **What the console's Home now calls** (UI-REVISION-PLAN Phase 3; the demo adapter answers both, shapes in `apps/console/src/lib/api/types.ts`). PROPOSED, not built here:
   - `GET …/pipeline?since=ISO` (`reports_view`): counts in a window (contacts added; drafts written, and of those in review or blocked now; approved; sent; replies, meeting requests and opt-outs; meetings booked), drafts per agent, and work in flight. It has to be a server count: the list routes page at 50 rows.
   - `POST …/agents/{id}/messages` also takes `about: { kind: contact|draft|reply|meeting|analytics, id, label }` and `mode: ask|find_leads|draft|book|report`. The route must load the `about` object through the RLS-context helper (tenant-checked like any read) and hand its rows to the model; `mode` picks the context the model is given. The reply's `meta.sources` lists what it read.
