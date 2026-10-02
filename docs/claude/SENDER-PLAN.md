# Sender: Gmail connect, credentials and the send loop (plan)

Status: **proposal**, written 2026-10-02 by claude-local. It covers API.md §7 items 1–2 and SPEC §13's sprint 6 (the demo:
"Tenant #0 sends real sequences under the ramp and cap"). The other session reviews this plan before the code merges
(rails §6: the sender, the guard and credentials are safety modules).

## 0. What exists, and what's missing

| Piece | State on master c049208 |
|---|---|
| `send_guard()` (0001) | Built. Refuses unapproved, edited, held, suppressed, unverified, over-cap or wrong-trust sends on `INSERT messages` |
| `sendDraft()` (`packages/sender/src/send.mjs`) | Built. Claim → provider → record, exactly once; no auto-retry |
| `composeEmail()` | Built. Plain text, postal address, RFC 8058 one-click unsubscribe, Reply-To `r+<hex>@reply.omnisdr.com` |
| Gmail adapter | Built. `users.messages.send`; takes `accessToken(mailbox)` as an injected function |
| Reply path | **Live** since 2026-10-02 (email-worker → `/internal/inbound`) |
| Mailbox connect (OAuth) | **Missing** |
| Credential storage | **Missing**: no table, no encryption |
| The loop that picks drafts and calls `sendDraft` | **Missing** |
| Steps 2–3 timing | **Missing** |
| `OMNI_UNSUBSCRIBE_BASE` on the API | **Unset**: it defaults to app.omnisdr.com, which doesn't exist. Must be the API's public origin before the first send |

## 1. Credentials at $0 (replaces "KMS envelope")

SPEC and INFRASTRUCTURE §14 say credentials sit "under KMS". DECISIONS 2026-10-02 (the $0 rule) outranks that.
Cloud KMS bills per key version and per operation [VERIFY https://cloud.google.com/kms/pricing].

**Proposal:**
- **Key:** one 256-bit data key in Secret Manager, `omni-mailbox-key`. That's the 6th active version; 6 are free [VERIFY https://cloud.google.com/secret-manager/pricing].
- **Who reads the key:**
  - the send job's service account;
  - the API's service account, for the connect callback only.
- **Encryption:** AES-256-GCM in Node's `crypto`.
  - Ciphertext layout: `v1.<iv b64url>.<ciphertext+tag b64url>`.
  - The AAD binds the ciphertext to `org_id|workspace_id|mailbox_id`, so a row copied to another mailbox won't decrypt.
- **What is stored:** the Google **refresh token** only. Access tokens live in memory for one job run.

**Migration `0007_mailbox_credentials.sql`:**
- **Table** `mailbox_credentials`, with columns:
  - `org_id`, `workspace_id`, `mailbox_id`;
  - `provider`;
  - `secret` (the ciphertext above);
  - `scopes text[]`;
  - `connected_by`, `connected_at`, `revoked_at`.
- **Integrity:** composite FK `(org_id, workspace_id, mailbox_id)` → mailboxes; forced RLS on `org_id = app_org()`.
- **Grants:**
  - `app_rw` gets **INSERT and UPDATE (revoked_at) only, never SELECT on `secret`**. The console can connect and disconnect but never read a token back.
  - `sender_svc` gets SELECT.

**Rotation:** a new key version plus a re-encrypt job; the version id goes in the ciphertext prefix when that day comes.

## 2. Gmail connect (testing mode first)

- **OAuth client:** one Web client in project omni-sdr. Consent screen External, publishing status **Testing**, scope `https://www.googleapis.com/auth/gmail.send` only (Sensitive, not Restricted). Testing mode allows up to 100 test users with no Google verification [VERIFY https://support.google.com/cloud/answer/10311615].
  - Known cost of testing mode: refresh tokens expire after 7 days [VERIFY same page], so tenant #0 reconnects weekly until the app is verified.
  - Verification is a Christian decision (a privacy policy and a homepage on omnisdr.com).
- **Flow (API routes; these wait for claude-cloud's claim on packages/api):**
  - `POST …/mailboxes/google/start` (`connections`):
    - returns Google's authorization URL;
    - `state` is HMAC(`org|ws|user|nonce|exp`), single use, 10 minutes;
    - `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`, PKCE.
  - `GET /v1/oauth/google/callback`:
    - checks `state`, then exchanges the code;
    - refuses unless the granted scope set is exactly `gmail.send` (anything less can't send; anything more we don't want);
    - reads the address from the ID token's `email`;
    - upserts `mailboxes` (`provider='gmail'`, `daily_cap` = the ramp's day-1 value) and `mailbox_credentials`;
    - redirects to `/w/<ws>/connections?connected=gmail`.
  - `DELETE …/mailboxes/{id}` (`connections`): revokes at Google (`oauth2.googleapis.com/revoke`), sets `revoked_at` and pauses the mailbox.
- **Console:** Connections shows the Gmail card's real state. "Connect" calls start and follows the URL. The demo stays as is.

## 3. The send loop (`packages/sender/src/loop.mjs`, run by a Cloud Run job)

One run, every 10 minutes from Cloud Scheduler. That's the 2nd of the 3 free jobs; `omni-refine` is the 1st.

1. **Due drafts.** List drafts with all of:
   - `status='approved'`, `channel='email'`, no `messages` row;
   - their enrollment `state` not in (`stopped`, `converted`, `completed`, `paused`, `snoozed`);
   - the workspace not on hold.

   For step > 0, the previous step's message must be `sent` at least `wait.business_days` ago in the workspace time zone, and no reply may have arrived since. Reads run as `sender_svc`, one workspace at a time.
2. **Send window.** Weekdays 08:00–17:00 in the **workspace** time zone for the MVP; INFRASTRUCTURE §13.3's per-contact time zone comes when contacts carry one. Outside the window, skip; the next run picks it up.
3. **Mailbox.** The workspace's connected, unpaused, unrevoked mailbox with the most room under today's cap. The cap itself is enforced in the database by `send_guard()` and `send_counters`; the loop's choice is only a preference.
4. **Ramp.** `daily_cap` starts at 5 and rises by 5 per sending day to a ceiling of 40 (the demo seed's value). Each run recomputes the cap from the count of days with sends. These are proposal numbers; Christian may change them.
5. **Send.** `sendDraft()` with the Gmail adapter, plus a small jitter (0–90 s) between sends from one mailbox.
6. **On `auth` failure:** pause the mailbox (`paused_reason='reconnect'`) and stop that mailbox for this run. The console shows "Reconnect".
7. **Limits per run.** At most N sends (default 20). Nothing is retried; a failed message stays failed (send.mjs's contract).

**Exit code.** Non-zero only when the job itself broke, so Cloud Run doesn't re-run a partly sent batch. Any `claimed` row left by a crash shows in 0004's unknown-outcomes view for a human.

## 4. Sequencing steps 2–3

A step's draft is written and approved like step 1; the Approvals card already shows the sequence. The loop only decides **when** an approved later step may go (§3.1). The enrollment advances `step` and `state` in the same transaction that records `sent`.

**Stop rules** (any reply, meeting booked, unsubscribe, bounce) already stop the enrollment in the inbound transaction (0005). The loop re-reads the enrollment state inside the claim, so a reply that landed a second earlier still wins.

## 5. Tests (PGlite, no network)

- **Loop:**
  - picks only due, approved, gate-passed drafts;
  - skips outside the window, on hold, on a stopped enrollment, and for step 2 before its wait or after a reply;
  - picks the mailbox with room;
  - an `auth` error pauses the mailbox;
  - a second concurrent run doesn't double-send (`draft_id` UNIQUE plus `already_claimed`).
- **Credentials:**
  - round-trip;
  - the wrong AAD (a copied row) fails;
  - `app_rw` can insert but `SELECT secret` is refused;
  - another org can't see the row (catalog test, as `rls.test.mjs` does).
- **Connect:**
  - a forged, reused or expired `state` is refused;
  - a granted scope set other than exactly `gmail.send` is refused.

## 6. Order of work

1. This plan + migration 0007 + `credentials.mjs` + `loop.mjs`, with tests (packages/sender, packages/db/migrations). **claude-local, now.**
2. API routes for connect + the job entry (`packages/api/src/jobs/send.mjs`), after claude-cloud's packages/api claim is released.
3. Cloud: OAuth client and consent screen (testing), Secret Manager key, Scheduler job, `OMNI_UNSUBSCRIBE_BASE`.
   - These cost $0.
   - The OAuth consent screen needs Christian's Google account in a browser (claude-local).
4. Tenant #0: Christian connects his Gmail and approves one draft to his own second address; the reply path is already live.
