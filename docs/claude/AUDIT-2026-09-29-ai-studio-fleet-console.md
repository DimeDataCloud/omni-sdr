# Audit: AI Studio "Omni SDR - Autonomous Fleet Console"

**2026-09-29, Claude.** Source: `Downloads/omni-sdr---autonomous-fleet-console.zip` (AI Studio app `e9d46c97…`), ~7,100 lines of React/Vite + Firebase.
Checked live, read-only: `gcloud firestore databases list`, `gcloud run services list`, and the Firebase Rules API releases and ruleset for `hip-well-509308-m9`.

## Verdict
**Use it as a UI mockup only.** The screens are useful reference for Gemini's `apps/web` lane. The data layer and the send path must not ship, and the live Firestore rules should be locked today.

## Status 2026-09-30: F1 done, findings 2–5 closed at the rules level
Checked read-only through the Firebase Rules API on 2026-09-30.
- **The live rules were replaced 14 minutes after this audit.**
  - Ruleset `14310aae-…` was released 2026-09-29 22:50 UTC.
  - Everything is denied by default.
  - Workspaces, approvals, routines and meetings can be read and written only by their owner, the workspace owner or the admin. The admin is the verified `dimedatateam@gmail.com`, or a doc in `admins/`, which no rule lets a client write.
  - Updates are limited to named fields:
    - Approvals: `status`, `rejectionReason`, `body`, `updatedAt`. Refused once an approval is `dispatched`.
    - Routines: `active`, `pausedByAdmin`, `schedule`, `updatedAt`.
    - Meetings: `status`, `meetLink`, `scheduledTime`, `updatedAt`.
- **Still true:**
  - `claimsGatePassed` is written by the client when an approval is created. Nothing may send on it.
  - Finding 1, the browser send path, is app code. It was not deployed to Cloud Run on 09-29 and was not re-checked on 09-30.
  - Finding 6, the OAuth scopes, was not re-checked.
- **F2 is still open.** The database still exists in `hip-well-509308-m9`, `us-west2`.

## What is live right now (verified this session)
- **Firestore database** `ai-studio-omnisdrautonomou-e9d46c97-…` is in the **Omni-SDR prod project** `hip-well-509308-m9`.
  - Region: `us-west2`, not the stack's `us-central1`.
  - Created 2026-09-29 22:32 UTC.
- **Security rules released 22:36 UTC.** The live ruleset is byte-identical to the exported `firestore.rules`, so every finding below applies to prod now.
- **Not deployed to Cloud Run.** The only service is `omni-waitlist-api`.
- The app appears to have its own OAuth client and Firebase Auth setup in the project; not inspected.

## Findings
| # | Sev | Where | Defect | Reproduction |
|---|---|---|---|---|
| 1 | **P0** | `src/App.tsx:284-304` | "Send via Gmail" **makes up the recipient address**: `first.last@<company>.com`. It sends a real email from the operator's Gmail with no claims gate, no `send_guard`, no suppression check, no unsubscribe link and no postal address. | Sign in, open the mock approval "Sarah Jenkins / Retool", click send. Gmail sends to `sarah.jenkins@retool.com`, a real company domain. That breaks CAN-SPAM, hard rail 4 and the whole safety spine. |
| 2 | **P0** | `firestore.rules:54,65,78,89` | **Any signed-in Google account can read every workspace**, plus every approval (prospect names and email bodies), routine and meeting, across all tenants. Sign-in accepts any Google account. | Any Gmail user signs in and runs `getDocs(collection(db,'workspaces'))`. Breaks hard rail 5 and the tenant model. |
| 3 | **P0** | `firestore.rules:69-72` | Any signed-in user can change **any** approval's `status` to `approved` or `dispatched` **and rewrite its `body`**, including after approval. | A non-owner `updateDoc` with `{status:'approved', body:'<anything>'}` passes the rule. The gate result (`claimsGatePassed`) is a client-written boolean. |
| 4 | P1 | `firestore.rules:91-94` | Any signed-in user can change the `meetLink` and time on any meeting. | A phishing path: a prospect's booked Meet link gets swapped for an attacker URL. |
| 5 | P1 | `firestore.rules:80-83` | Any signed-in user can switch any tenant's routine `active` on or off, or change its `schedule`. | Pause a competitor's outbound, or turn on someone else's. |
| 6 | P1 | `src/lib/firebase.ts:33-44` | Requests 12 OAuth scopes, including **`gmail.readonly` and `drive.readonly` (Restricted)**, plus `gmail.compose` and Forms and Meet scopes. | The restricted scopes force a CASA security assessment. The citation (`google-oauth-scopes.md`) says never add a Gmail read scope without Christian's decision. The plan is send-only. |
| 7 | P1 | `src/lib/googleWorkspace.ts` | Every Gmail, Drive and Calendar call runs **in the browser** with the user's OAuth token. | Breaks rails §8 "no vendor calls from the browser"; nothing server-side can enforce the gate. |
| 8 | P2 | `firestore.rules:30-35,42-45`, `TopNavigation.tsx:73-77` | The admin is hard-coded to `dimedatateam@gmail.com` with no `email_verified` check. The role picker (Admin, Reviewer, …) is client-only state, so any user "becomes" Admin in the UI. `users.create` accepts `role:'admin'`. | Cosmetic today because `isAdmin()` ignores `role`, but a later rule that trusts `role` would be a privilege escalation. |
| 9 | P2 | `firestore.rules:55-57` | Anyone can create a workspace with any `orgId`. No org membership exists. | Tenancy is `ownerId` only. That's not the SPEC §7 model (org → workspace → membership roles). |
| 10 | P2 | whole app | **A second data store.** Firestore duplicates Postgres (`packages/db`), which authority §2.3 names as the only schema. | Approvals, routines and meetings exist in both places with different shapes. That's a conflict, reported here, not resolved. |
| 11 | P3 | `App.tsx:144,237-239`, `metadata.json` | The agents, credits and "Gemini" replies are `setTimeout` mocks. There are no `@google/genai` calls, despite `SERVER_SIDE_GEMINI_API`. `handleApproveAll` approves by `icpFit >= 90` alone. | It's a demo; the credits and approvals aren't real. |

## Lock-down (Christian runs; cloud change, needs his OK)
Replace the live rules with deny-all until the app is either deleted or rebuilt on Postgres:
```
rules_version = '2';
service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }
```
- **Quickest route:** AI Studio's Firebase panel, or Firebase console → Firestore → the `ai-studio-omnisdrautonomou-…` database → Rules → publish.
- **Then decide:** delete the database (it's in the wrong region anyway) or keep it for the demo with deny-all rules.
- **Before anyone signs in:** delete or disable the "Send via Gmail" button.

## What to keep
The layout, the approval review modal, the capacity dispatch panel, the inspect-state drawer and the search palette are good visual reference for Gemini's `apps/web` work. They'd need rewiring onto `withTenant()`, server actions, the gate and the sender.

## Decisions for Christian
| # | Question | Recommended |
|---|---|---|
| F1 | Lock the live Firestore rules to deny-all | **Yes, today.** They are open to any Google account |
| F2 | Keep or delete the Firestore database in the prod project | **Delete** after exporting anything wanted. It's a second data store in the wrong region |
| F3 | Role of this app | **UI reference only**: Gemini ports the screens into `apps/web` on the Postgres spine |
