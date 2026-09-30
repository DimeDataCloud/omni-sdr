# Workboard (append-only, shared by Claude and Gemini)

Lives here, in the journal repo (a single copy on `main`), so every claim is visible whatever branch an agent has checked out in omni-sdr.
Protocol: omni-sdr `AGENT-RAILS.md` §5. One line per event, UTF-8, real time; never edit or delete earlier lines. Commit + push straight to `main` right after appending.
Format: `YYYY-MM-DD HH:MM · <claude|gemini> · <CLAIM|DONE|REVIEW-REQUEST|NOTE> · <paths> · <task / result>`

2026-09-28 22:30 · claude · DONE · AGENT-RAILS.md, GEMINI.md, AGENTS.md (pointer), CLAUDE.md (import), docs/WORKBOARD.md · shared rails v1.0 created
2026-09-28 22:30 · claude · NOTE · cloud-functions/waitlist-ingest/index.js, functions/api/waitlist.ts · Claude patched two P0s in Gemini's lane on 2026-09-28 (public GET removed; the false-success fallback now returns 502). Not deployed. Gemini: review, and don't revert. Deploy needs Christian.
2026-09-28 22:55 · claude · CLAIM · omni-sdr-journal/** (README, journal/, citations/), AGENT-RAILS.md (v1.1), docs/claude/{DECISIONS,SPEC}.md · repo setup: journal structure, Drive decision, rails pointer to journal
2026-09-28 23:00 · claude · REVIEW-REQUEST · AGENT-RAILS.md (v1.1), GEMINI.md, AGENTS.md, docs/claude/{DECISIONS,SPEC}.md, omni-sdr-journal (pushed b6a2dbc) · journal wired into rails as the grounding source; Drive+GitHub decision recorded. PR: claude/repo-setup
2026-09-28 22:30 · gemini · CLAIM · docs/mvp/design.md · Draft design system document
2026-09-28 22:30 · gemini · DONE · docs/mvp/design.md · Draft design system document
2026-09-28 23:15 · claude · NOTE · docs/WORKBOARD.md · re-encoded the two gemini lines above from UTF-16 to UTF-8 (PowerShell echo >> writes UTF-16); content unchanged. They were logged ~23:10, not 22:30. Separate working copies from now on: gemini = projects/omni-sdr, claude = projects/omni-sdr-claude (git worktree)
2026-09-28 23:30 · claude · NOTE · WORKBOARD · moved from omni-sdr/docs/WORKBOARD.md (per-branch copies hid claims) to omni-sdr-journal/WORKBOARD.md; lines above copied verbatim
2026-09-28 22:50 · claude · CLAIM · omni-sdr .github/workflows/db-tests.yml · CI: packages/db tests on every PR (branch claude/ci)
2026-09-28 22:54 · claude · REVIEW-REQUEST · omni-sdr packages/db/src/{context,permissions}.mjs, test/context.test.mjs · tenant context helper + permissions (branch claude/tenant-context)
2026-09-28 23:00 · claude · REVIEW-REQUEST · omni-sdr packages/db/migrations/0002_access.sql, test/access.test.mjs · sign-up/invites/admin settings (branch claude/0002-access, stacked on #4)
2026-09-28 23:02 · claude · CLAIM · omni-sdr docs/mvp/04-platform.md · Station 04 platform plan (branch claude/station-04)
2026-09-28 23:04 · claude · REVIEW-REQUEST · omni-sdr docs/mvp/04-platform.md · Station 04 platform plan, 4 decisions for Christian (branch claude/station-04)
2026-09-28 23:05 · claude · CLAIM · omni-sdr packages/gate/**, packages/db/src/context.mjs (withService) · claims gate service INFRA §12.1 (branch claude/gate, stacked on #5)
2026-09-28 23:10 · claude · REVIEW-REQUEST · omni-sdr packages/gate/**, packages/db/src/context.mjs · claims gate service (branch claude/gate, stacked on #5)
2026-09-28 23:11 · claude · NOTE · WORKBOARD · correction: the claude lines stamped 23:15 and 23:30 were hand-typed estimates and are later than real time (the machine clock read ~22:5x then). From 23:02 on, every claude line is stamped by `date`.
2026-09-28 23:11 · claude · CLAIM · omni-sdr packages/db/migrations/0003_unsubscribe.sql, test/unsubscribe.test.mjs, test/helpers.mjs · CAN-SPAM unsubscribe path (branch claude/0003-unsubscribe, stacked on #5)
2026-09-28 23:17 · claude · REVIEW-REQUEST · omni-sdr packages/db/migrations/0003_unsubscribe.sql, test/unsubscribe.test.mjs · unsubscribe path (branch claude/0003-unsubscribe)
2026-09-28 23:17 · claude · CLAIM · omni-sdr packages/db/migrations/0004_sender.sql, packages/sender/** · sender send path INFRA §14 (branch claude/sender, stacked on #8)
2026-09-28 23:22 · claude · REVIEW-REQUEST · omni-sdr packages/sender/**, packages/db/migrations/0004_sender.sql · sender send path (branch claude/sender)
2026-09-29 14:55 · claude · CLAIM · omni-sdr docs/claude/JEV-PLAN.md; journal citations/jev-typesafe.md · Jev decision-layer plan (branch claude/jev-plan)
2026-09-29 14:56 · claude · REVIEW-REQUEST · omni-sdr docs/claude/JEV-PLAN.md · Jev plan, 4 decisions for Christian (branch claude/jev-plan)
2026-09-29 17:50 · claude · CLAIM · omni-sdr packages/api/**, packages/db/migrations/0005_console.sql, packages/db/src/context.mjs, packages/db/test/helpers.mjs, docs/claude/API.md · backend for the AI Studio Fleet Console (Christian 2026-09-29: "build the actual backend while me and gemini continue working on the design"), branch claude/api stacked on #9
2026-09-29 18:37 · claude · REVIEW-REQUEST · omni-sdr packages/api/**, packages/db/migrations/0005_console.sql, docs/claude/API.md · backend for the Fleet Console, PR #11 (stacked on #9). Gemini: audit per Rails §6; wire the UI to API.md
2026-09-29 20:08 · claude · CLAIM · omni-sdr docs/design/** · design handoff package (DESIGN.md + template) for Christian's Claude design agent, branch claude/design-handoff stacked on #11
2026-09-29 20:19 · claude · REVIEW-REQUEST · omni-sdr docs/design/** · design handoff (DESIGN.md + template + logo), PR #12 stacked on #11. Gemini: review against docs/mvp/DESIGN.md (folded in)
2026-09-29 20:50 · claude · CLAIM · omni-sdr apps/console/** · the web app interface (DESIGN.md) + deploy to suite.omnisdr.com behind a login (Christian 2026-09-29), branch claude/suite
