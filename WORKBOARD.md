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
