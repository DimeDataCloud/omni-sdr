# Audit: Gemini's `omni_sdr_master_spec.md` (2026-09-28)

Source: `~/.gemini/antigravity-ide/brain/b02ec235-…/omni_sdr_master_spec.md`, 271 lines, written 21:40.
Gemini also edited `packages/db/migrations/0001_core.sql` and `test/helpers.mjs` at 21:38–21:39.
Checked against: `docs/claude/DECISIONS.md` (binding), `docs/MVP-BUILD-GUIDE.md`, `docs/INFRASTRUCTURE.md`,
the SQL, and the live GCP project `hip-well-509308-m9`.

**Verdict:** the decision summary (§3) is mostly right. The schema (§4) is wrong in 12+ ways, so building
from it would produce a second schema. §5.4 publishes a live endpoint that leaks personal data.
**Replacement:** [`SPEC.md`](SPEC.md) is the single handoff file. Gemini's file is superseded; don't hand it to agents.

---

## P0: live, outside the document

| # | Finding | Evidence | Status |
|---|---|---|---|
| L1 | **The waitlist export is public.** `GET https://omni-waitlist-api-…run.app?format=csv` returns every signup's name, email, phone, location and access code to anyone. The plain `GET` returns JSON that also includes IPs and user agents. The service's invoker is `allUsers`. The spec prints this URL in a document written to be handed to other agents. | HTTP 200 `text/csv`: 10 lines (9 signups); rows not printed. IAM binding `allUsers → roles/run.invoker`. | **Patched locally.** `GET` removed and CORS pinned to `https://omnisdr.com` in `cloud-functions/waitlist-ingest/index.js`. **Not deployed:** Christian's call. Command in SPEC §14. |
| L2 | **Silent lead loss.** When the GCS write fails, `functions/api/waitlist.ts` still replies "Your spot is secured" with an access code and persists nothing. | Edge fallback branch, lines 54–72. | **Fixed in source** (502 + an error on the page). The deployed `dist-pages/_worker.js` needs a rebuild + Pages redeploy. |
| L3 | The function runs as the **default compute service account**, not the dedicated `omni-waitlist-writer` SA that exists. | `run services describe` → `885132575622-compute@…` | Open. [VERIFY] that SA's project roles. |
| L4 | A `secrets/` folder containing an empty `gcs-key.json` sits inside the Drive-synced Halo folder. It's gitignored, but Drive syncs it. WIF means no key file should ever exist. | 0 bytes; 0 user-managed SA keys in the project. | Open. Delete the folder. |

## Schema: Gemini's 21:38 edits

| Change | Verdict |
|---|---|
| `memberships.role` `owner` → `admin`, plus the seed | ✅ Matches DECISIONS (Station 01). This was the pending rename. |
| `orgs`: `account_type`, `stripe_customer_id`, `subscription_status`, `trial_ends_at`, `feature_flags` | ✅ Kept. The app role has no UPDATE on `orgs`, so tenants can't flip their own flags. Now pinned by a test. |
| `workspaces`: `custom_domain`, `client_approvals_enabled`, `auto_adjust_*` | ✅ Kept, **fixed**: `auto_adjust_sources` is now bounded to the 8 decided sources; a custom domain is unique across tenants, case-insensitive. |
| New `icps` table, `campaigns.icp_id`, `campaigns.auto_audit_enabled` | ⚠️ Kept, **fixed**. `icp_id` was a single-column FK, so tenant A could pin tenant B's ICP. ICPs were updatable in place, which defeats "campaigns pin a version". There was no lineage, so "multiple versioned ICPs" wasn't representable. Now: composite tenant FK, `lineage_id` + `UNIQUE(workspace_id, lineage_id, version)`, app role insert-only plus `archived_at`, an immutability trigger. |
| `guard_all` policy granted on `icps` to `guard_owner` | ❌ Removed. The guard never reads ICPs. |

**Found while auditing, and mine, not Gemini's:** 7 more single-column FKs between tenant tables
(evidence→contacts, enrollments→campaigns/contacts, drafts→enrollments, send_counters→mailboxes,
messages→drafts/mailboxes). FK checks bypass RLS, so tenant A could enroll tenant B's contact.
`send_guard()` would then have mailed it under A's cap and checked A's suppression list instead of B's.
The probe confirmed all three cases were accepted. Fixed with composite `(org_id, workspace_id, …)` FKs everywhere, plus a
guard re-check.

**Tests:** 16 → **20, all passing.** The new `test/tenancy.test.mjs` derives the FK rule from the catalog (16 tenant FKs
checked). All 4 new tests **fail against the pre-fix schema** (the rule itself lists the 8 bad FKs), so they
can't pass vacuously.

## The document itself

| # | Section | Problem | Correction (in SPEC.md) |
|---|---|---|---|
| D1 | §4 schema | TypeScript interfaces contradict the SQL: `Lead` vs `contacts`+`enrollments`; `emailStatus 'unverified'` vs `'unknown'`; invented `lead.status`; `evidenceAnchors[]` on the lead vs the immutable `evidence` table (snapshot sha, expiry); a single `citedEvidenceId` + `claimsGatePassed` vs `claims` jsonb + `gate_body_sha` (the gate binds to the exact text); draft statuses; `channel 'linkedin'` vs `'linkedin_assist'`; `trustDialLevel` per draft vs per workspace (1–3); `Membership.id` vs a composite PK + `workspace_ids`; `InboundReply`/`Meeting` tables that don't exist. Omits mailboxes, suppression, holds, messages, credits, outbox and audit_log. | SQL is the only schema source. SPEC §6 summarizes it and lists additions per station. |
| D2 | §1 | Skool as a core evidence source. The guide puts Skool in **Deferred** and no decision moved it. | Removed; still deferred. |
| D3 | header | "$3,000–$25,000+ ACV" target market. Nothing decided this, and pricing is open. | Removed. |
| D4 | header, §5.4, diagram | Presents Cloudflare Pages + a GCS waitlist bucket as the platform. The app is Cloud Run `web`. The waitlist is an unapproved Gemini build (marketing was deferred), and a bucket isn't a system of record. The diagram routes the signal harvester into the waitlist bucket. | The app architecture is per INFRA. The waitlist is listed as an existing artifact with its P0s. Evidence goes to Postgres + the snapshots bucket. |
| D5 | §1.5 | "Pilots on 100% test passage." | Decision: pilots when the **Station 26 acceptance script passes end to end in prod**. |
| D6 | §3.6 | Postal address "omitted from outreach notices". Customer outreach must carry the **customer's** postal address (CAN-SPAM [VERIFY]), and the gate enforces it. As written, an agent would ship non-compliant email. | Restated correctly. |
| D7 | §1.4 | Level 2 "behind an **operator** feature flag". `operator` is a tenant role; the decision is **Christian/ops only**. | Fixed. Also enforced: the app role can't update `trust_level`. |
| D8 | §3.3 | LinkedIn covers only the provider path. It drops the official API (company-page posting, comments), the per-account consent screen, the channel caps, the restriction breakers and the lawyer review before paid launch. The SQL still has no `linkedin` channel or guard branch. | SPEC §8 Station 17 and the §6 planned schema. |
| D9 | §3.3 | Connector list drops the "other social" and "2-way CRM" modules (set up now, activate later), signed outbound webhooks, Stripe and the manifest contract. | SPEC §9. |
| D10 | §3.4 | Auto-adjust is missing 3 sources (unsubscribes/bounces, won/lost, rejections), per-item revert, and "never crosses workspaces". | SPEC §8 Station 8. |
| D11 | structure | The §3.5 heading is missing (Stations 11–21 sit under §3.4). Stations 06, 09, 10, 13, 15, 17, 22 and 25–27 have no coverage. | SPEC §8 covers stations 0–27. |
| D12 | §3.2 | Adds `#F5F3EF`, which isn't in Christian's palette. Drops the reduced-transparency rule, the focus-ring rule and the pending dark mode. | SPEC §8 Station 3. |
| D13 | whole | Calls itself "Master Architecture" but omits every DB-enforced guarantee: forced RLS, `send_guard`, suppression, holds/breakers, credit reservation, outbox, audit log. | SPEC §5 (invariants, each with its enforcement point and test). |
| D14 | §3.5 | "Generative media gated", but the decision is that **all** generation pipelines are built, tested end to end and flag-off; text stays on. | SPEC §3, §8 Station 18. |

**What Gemini got right:** account types and roles, the trial and Stripe, the composer-first home, the OAuth
plan, model routing tiers, audit pages, meeting SLA, no open tracking, white-label, email
verification, versioned ICPs as intent. These carry into SPEC.md unchanged.
