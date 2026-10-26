# Handoff: follow-ups from the 2026-10-24 verification pass

Rails v1.4 loaded. For a separate Claude session. Source of the findings: `VERIFICATION-2026-10-24.md` (same folder). The voice engine build has its own handoff (`HANDOFF.md`, `ENGINE-BUILD.md`); these are the smaller leftovers and are independent of it.

Branch rules: work on a `claude/*` branch off `master` for tasks 1 and 2 (they touch other packages), off `claude/demo` for task 3. Merge only through a PR. Christian waived the other-session cross-audit for the demo app on 2026-10-24; that waiver does not cover `apps/console` or `edge/email-worker`, so for those say so in the PR and let Christian decide. Never delete, skip or loosen a test to make something pass (rails 3.7). Secrets never go in chat, commits or logs; keys live in `C:\Users\cdsec\.halo-keys\`.

## 1. Dependabot: vite in apps/console (3 alerts: #14 medium, #15 medium, #16 high)
- Problem: `apps/console/package-lock.json` has vite 8.3.1 (devDependency, dev server only). Patched in 8.3.3 (launch-editor issues).
- Do: branch off master, `cd apps/console && npm update vite`, confirm the lock shows >= 8.3.3 and `package.json` range still allows it (`^8.3.1` does).
- Done when: console tests and build pass (use the scripts in `apps/console/package.json`, report exact output), the three alerts close after merge, and the PR says it is a lockfile-only change.

## 2. Dependabot: sharp in edge/email-worker (alert #6, high)
- Problem: `edge/email-worker/package-lock.json` has sharp 0.35.4, pulled in by `wrangler > miniflare`. Patched in 0.35.5. The worker declares only `postal-mime`; sharp is not in its code or deployed bundle.
- Do: branch off master, `cd edge/email-worker`, bump `wrangler` (devDependency, currently `^4.146.0`) to a release whose miniflare depends on sharp >= 0.35.5; if none exists yet, say so in the PR and leave the alert open rather than overriding the dependency tree by hand. `npm test` (`node --test test/*.test.mjs`) must pass.
- Done when: lock shows sharp >= 0.35.5, tests pass, PR opened, alert closes after merge. Do not deploy the email worker; that needs Christian (rails 3.1).

## 3. Demo app: wrangler / undici (npm audit, 3 findings, no Dependabot alert yet)
- Problem: `apps/omnisdr-demo-mvp` shows wrangler > miniflare > undici (undici high: EventSource parser DoS and an SRI bypass). Dev tooling only; the Worker does not bundle undici.
- Do NOT run `npm audit fix --force` (it proposes downgrading wrangler to 4.35.0). Check `npm view wrangler version` and `npm audit` after a normal `npm update wrangler`. If a release carries patched undici, take it; else leave and note.
- Done when: `npm test` prints 47/47 and 28/28, `npx wrangler deploy --dry-run` still bundles with the Gate Durable Object, commit on `claude/demo`. Deploying is approved for this project (Christian, 2026-10-24) but only needed if the bump changes runtime behavior; it should not.

## 4. Manual live click-through (needs a human with a phone; you prepare it)
- Why: headless Chromium cannot pass the real Turnstile widget, so the live walkthrough has not run since Turnstile went on, and iOS Safari is untested.
- Do: write a one-page phone checklist into `apps/omnisdr-demo-mvp/MANUAL-PHONE-CHECK.md` (open demo.omnisdr.com, wait for the check, press Start, run the nine-step intake with made-up details, confirm the owner text and booking card appear, confirm the timer ends at 3:00, confirm the second tab's speed-to-lead texts, try Agent voice on/off and the mic, note iOS Safari and Chrome versions). Christian runs it and reports back; record results in that file. After any run, reset today's counters from `/dev` ("Reset today's counters"); the live cap is 10 per day, 2 per visitor.

## 5. Gemini key on the Worker: do NOT do yet
Leave `GEMINI_API_KEY` unset and `ENGINE_B=0` until the browser client exists and falls back to the scripted agent on every failure (see `ENGINE-BUILD.md`). When that time comes: `npx wrangler secret put GEMINI_API_KEY` (value in `C:\Users\cdsec\.halo-keys\gemini-live.md`), set `ENGINE_B = "1"`, deploy, then confirm the `/dev` checks go green.

## Report format
End with the rails task report (Task, Read, Changed, Ran with output summaries, Result, UNVERIFIED, Decisions needed, Next). Update `builds/omni-sdr.md` in the brain (`C:\Users\cdsec\Halo\BrainAI`) with a dated line per finished task and commit it as one `brain:` commit; run `node scripts/graph/graph-sync.mjs` from `C:\Users\cdsec\Halo`.
