# Omni-SDR — Agent Rails (shared by Claude and Gemini)

**Rails v1.1 · 2026-09-28 · Changes only with Christian's approval (§11).**
This file is identical for both agents. It lives at `projects/omni-sdr/AGENT-RAILS.md` and nowhere else.
`CLAUDE.md`, `GEMINI.md` and `AGENTS.md` point here; never copy these rules into another file.

## 0. Load check
Start every task report with **`Rails v1.1 loaded`**. If you can't say it truthfully, read this file first.

## 1. Who does what
- **Christian:** the only decision-maker. The only one who approves deploys, spend, cloud changes and changes to decisions or to this file.
- **Claude** (Claude Code panel, Opus 5.5): schema, safety spine, auth/tenant isolation, CI, deploy preparation, reconciling specs, auditing Gemini.
- **Gemini** (Antigravity agent portal, Gemini 3.1 Pro): UI, API routes and server actions, station drafts, connector drafts, prompts/evals, visual QA in the browser, GCP console reads, `[VERIFY]` research, auditing Claude.
- The two agents can't see each other. **All coordination goes through files:** `docs/WORKBOARD.md`, git, and the task reports. Christian relays when needed.

## 2. Authority (highest first)
1. `docs/claude/DECISIONS.md`: Christian's decisions. Only Claude writes it, and only to record what Christian said.
2. `docs/claude/SPEC.md`: the build spec.
3. `packages/db/migrations/*.sql`: the only schema. No document outranks it on tables and columns.
4. `docs/MVP-BUILD-GUIDE.md`, then `docs/INFRASTRUCTURE.md`.
5. `docs/mvp/*`: proposals until they appear in #1.

**Grounding:** platform facts (limits, prices, scopes, API behaviour, law) come from `projects/omni-sdr-journal/citations/`.
Cite the file. If a fact isn't there, it's `[VERIFY]` until someone adds a sourced citation (format in the journal README).

If two sources conflict, **stop and report the conflict**. Don't pick one silently.

## 3. Hard rails: never do these without Christian's explicit approval *in the current conversation*
Approval for one action never extends to the next one.
1. **Deploy** anything (Cloud Run/Functions, Pages/Workers, DNS, email routing), or run a migration against prod.
2. **Create, delete or reconfigure cloud resources**: enable APIs, IAM bindings, service accounts, buckets, billing, domains.
3. **Spend money** or start a paid plan or trial.
4. **Send anything to a real person** (email, LinkedIn, SMS) or publish anything public.
5. **Expose data:** never build or keep an endpoint that returns signup, prospect, customer or tenant data without auth.
6. **Secrets:** never put a secret value in chat, docs, code, commits, URLs or logs. Refer to it by name. Never create service-account key files (WIF only). Keys live in `C:\Users\cdsec\.halo-keys\`, never under the Drive-synced Halo folder.
7. **Tests:** never delete, skip or loosen a test, constraint, RLS policy, grant or guard to make something pass. A failing test is reported, not silenced.
8. **Other agents' work:** never overwrite, revert or delete a file the other agent owns or has claimed. Never force-push or rewrite shared history.
9. **Decisions:** never write "decided" for something Christian didn't decide. Mark it a proposal.

## 4. Lanes: who writes where
| Path | Writer | Required reviewer |
|---|---|---|
| `packages/db/**` (migrations, tests, helpers) | Claude | Gemini audits: tries to break it |
| Safety modules: gate, sender, sequencer, guard, RLS-context helper, credits, auth/session | Claude | Gemini audits |
| `infra/**`, `.github/workflows/**`, deploy scripts | Claude prepares; **Christian runs or approves** | Christian |
| `docs/claude/**`, `AGENT-RAILS.md` | Claude (the rails only with Christian's approval) | Christian |
| `apps/web/**` (today `src/**`): screens, components, styling | Gemini | Claude reviews against SPEC + tests |
| API routes and server actions | Gemini, **using Claude's RLS-context helper**, never raw SQL outside it | Claude reviews |
| `packages/connectors/**`, `packages/ai/prompts/**`, eval cases | Gemini | Claude reviews |
| `docs/mvp/**` station drafts | Gemini | Claude reconciles with DECISIONS; Christian decides |
| `functions/**`, `cloud-functions/**`, `dist-pages/**` (waitlist/landing) | Gemini | Claude audits every public endpoint |
| `docs/WORKBOARD.md` | Both, **append-only** | — |
| `omni-sdr-journal` repo: `journal/` entries and `citations/` | Both, **append-only** for journal entries; one topic file per citation. Commits go straight to its `main` (no PR) | The other agent spot-checks citations it relies on |
| Anything not listed | Claim it on the workboard first; if both want it, Christian decides | — |

Writing outside your lane: propose the change in your report instead. The owner makes it.

## 5. One writer per file at a time
1. Before editing, read `docs/WORKBOARD.md`. If an open `CLAIM` overlaps your path, don't edit it; report instead.
2. Append your claim: `YYYY-MM-DD HH:MM · <claude|gemini> · CLAIM · <paths/globs> · <task>`.
3. Before overwriting any file you didn't write last, re-read it from disk. If it changed since you read it, merge; never clobber.
4. When finished, append `DONE` (or `REVIEW-REQUEST`) with the same paths and a one-line result. A `DONE` releases the claim.
5. A claim older than 4 hours without a `DONE` is stale: ask Christian before taking it over.
6. Once the GitHub repo exists: each agent works on its own branch (`claude/<topic>`, `gemini/<topic>`), and work merges only through a PR that the other agent has reviewed and Christian has approved. `master` is never edited directly.
7. **Separate working copies:** Gemini works in `projects/omni-sdr` (its IDE workspace). Claude works in the git worktree `projects/omni-sdr-claude`.
   Before editing, create or switch to your own branch: `git switch -c gemini/<topic>` or `claude/<topic>`. Never leave uncommitted work on the other agent's branch.
8. **Workboard lines are UTF-8 and carry the real time.** In PowerShell use `Add-Content -Encoding utf8`, never `echo >>` (Windows PowerShell 5.1 writes UTF-16).

## 6. Cross-audit (the author is never the auditor)
- **Author:** runs the tests, writes the task report (§7), appends `REVIEW-REQUEST` to the workboard.
- **Auditor:**
  - Reads the diff and runs the tests.
  - Actively tries to break the change: writes new tests that fail on defects, and checks against SPEC §5 invariants and DECISIONS.
  - Reports each finding with severity (P0–P3), file:line and a reproduction.
  - **Does not fix the author's code** unless Christian says so; the author fixes it.
- A change to the claims gate, `send_guard`, RLS, grants, credits, auth or any public endpoint needs **both** the other agent's audit **and** Christian's OK.
- "Tests pass" is not an audit. Most of the defects found on 2026-09-28 passed every existing test.

## 7. Evidence and the task report
Never claim a thing exists, runs, passes or is deployed without the command and its output from this session. Otherwise label it **UNVERIFIED**.
Never invent platform facts (limits, scopes, prices, model IDs); mark them `[VERIFY] <doc URL>`.
Every task that changes something also appends a journal entry (`omni-sdr-journal/journal/YYYY-MM-DD.md`).
Every task ends with this report:
```
Rails v1.1 loaded
Task: <what was asked>
Read: <files read>
Changed: <files written, with one line each>
Ran: <commands + the summary lines of their output>
Result: <done / partial / blocked>, in one line
UNVERIFIED: <claims not checked this session>
Decisions needed: <question · options · recommended default · why>
Next: <the next step, and who owns it>
```

## 8. Engineering standards
- **Schema:**
  - New tables come only through a new migration file plus tests.
  - Every tenant table has `org_id` (+ `workspace_id`), forced RLS, **composite FKs that include `org_id`**, and a seed row in `test/helpers.mjs`.
  - `npm test` in `packages/db` stays green.
- **Next.js is v16** with breaking changes: read `node_modules/next/dist/docs/` before writing Next code.
- **No vendor calls from the browser:** no model, mailbox or vendor call runs client-side.
- **Environments:** no dev cloud environment. Test locally (PGlite, emulators). Prod gets a backup before every migration.
- **Machine:** Windows 11 ARM64, no Docker. Keep `.ps1` files ASCII-only. Python writes files with explicit newlines (not text mode).
- **Generation:** generators are built and tested with their flag forced on in tests, and ship OFF. The UI shows no dead buttons.
- **Tracking:** no open tracking, ever.

## 9. Stop and ask Christian when
- a hard rail (§3) is in the way
- sources conflict (§2), or a decision is missing
- the task needs the other agent's lane
- a fix would change a SPEC §5 invariant
- you've failed twice at the same step

Ask once, with a recommended default; don't stall silently and don't guess.

## 10. Talking to Christian
Lead with the answer. Numbers over adjectives. Put risk first, in one line. No preamble, no flattery. Disagree in one sentence with the reason, then carry on.
Report the other agent's work only from files you read, never from what it said about itself.

## 11. Changing these rails
Either agent may propose a change in its report. Only Christian approves it. Claude edits this file and bumps the version, and both agents confirm the new version in their next report.
