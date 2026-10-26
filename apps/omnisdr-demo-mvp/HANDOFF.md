# Handoff: Omni SDR demo MVP (demo.omnisdr.com)

Rails v1.4 loaded. Updated 2026-10-24 by claude-local (Christian's terminal session) for a separate session to pick up the voice engine build.
Branch: `claude/demo` (same commit as `claude/demo-mvp`). Worktree used so far: `C:\Users\cdsec\omni-sdr-demo`.

Verification results (live site, Gemini key state, Dependabot): **VERIFICATION-2026-10-24.md**. Small follow-ups for another session (Dependabot bumps, wrangler/undici, phone click-through): **HANDOFF-FOLLOWUPS.md**.

## Your job
Build the real voice engine. Read **ENGINE-BUILD.md** first; it is the spec. Short version: the live demo is a scripted, rule-based agent.
Engine B (Gemini Live in the browser) has a verified server half and **no browser audio client**; build that, wire `GEMINI_API_KEY` + `ENGINE_B=1`,
move the guardrails into the system instruction, add tests, run the spike checklist. Engine A (Workers AI pipeline) is the fallback and comparison baseline.

## State (2026-10-24)
Live at https://demo.omnisdr.com (also https://omnisdr-demo-mvp.dimedatateam.workers.dev). Deployed Worker version b6c107a0, repo commit e0996c0 plus this handoff.
- Turnstile ON (managed widget, site key in `wrangler.toml`, secret on the Worker). Start button waits for the token.
- Caps: DAILY_CAP=10, IP_CAP=2, SESSION_SECONDS=180, KILL=0, ENGINE_B=0.
- Tests: local `npm test` = walkthrough 47/47 + hardening 28/28 (`tests/run.sh` passes Cloudflare's published always-pass Turnstile test keys to the walkthrough instance, because the production site key cannot pass on localhost). Live: hardening 24/24 re-run 2026-10-24 (walkthrough 47/47 was before Turnstile went on; see VERIFICATION-2026-10-24.md) (the cap and lockout checks spoof `cf-connecting-ip`, which the Cloudflare edge rejects, so they run locally only; hardening.js handles this itself).
- Gemini Live server half verified (see ENGINE-BUILD.md). `node tools/gemini-live-smoke.mjs` re-proves it in about 5 seconds.
- Niche: bathroom remodeling ("Riverbend Bath") is the demo testing niche, by Christian's decision. Do not swap it. (Muse's niche research ranked other niches; that does not change this.)
- `mvp.omnisdr.com` belongs to the Lead Engine inbox Worker `omnisdr-mvp`. Never touch it.

## Where everything lives
| Thing | Location |
|---|---|
| Code, tests, docs | this repo, `apps/omnisdr-demo-mvp/`, branch `claude/demo` |
| Worker + Durable Object `Gate` | Cloudflare account "Dimedatateam", Worker `omnisdr-demo-mvp`, custom domain `demo.omnisdr.com` attached through the Workers Domains API (it is not in `wrangler.toml`, a redeploy keeps it) |
| Deploy credential | `CLOUDFLARE_API_TOKEN` in `C:\Users\cdsec\.halo-keys\rotation-inbox.env` (token "Worker Deploy Token"). `npx wrangler deploy` needs it exported as an env var for that shell |
| Dev portal passcode (`DEV_PASSCODE`) | `C:\Users\cdsec\.halo-keys\omnisdr-demo.md`; also a Worker secret. Local tests read it from `DEV_PASSCODE` env, default `test-passcode` against a local instance |
| Turnstile site key + secret | `C:\Users\cdsec\.halo-keys\omnisdr-turnstile.md`; site key is public and in `wrangler.toml`, secret is a Worker secret |
| Gemini key | `C:\Users\cdsec\.halo-keys\gemini-live.md` (free tier). **Not yet on the Worker.** The editor stores it with escaped underscores; `tools/gemini-live-smoke.mjs` parses that |
| Brain notes | `C:\Users\cdsec\Halo\BrainAI\builds\omni-sdr.md` (sections dated 2026-10-24) and `decisions/log.md` (hostname decision) |
| Plan doc | Docs artifact "Free Demo Agent Plan": https://claude.ai/artifact/X11StYAy88pigxPH89bXJ3 |

Secrets never go in chat, docs, code, commits, URLs or logs (rails 3.6). Keys live only in `C:\Users\cdsec\.halo-keys\`.

## Run it
1. `cd apps/omnisdr-demo-mvp && npm ci && npx playwright install chromium`
2. `npm test` (starts a local Worker on 8787 twice with the right caps, runs both suites, stops it). Needs `.dev.vars` with `DEV_PASSCODE=test-passcode` (gitignored).
3. Re-run `npm test` after any change; it must print 47/47 and 28/28. Live check: `BASE=https://demo.omnisdr.com DEV_PASSCODE=<from key file> node tests/hardening.js`. For the live walkthrough Turnstile blocks headless Chromium; use a local instance, or disable the widget temporarily with Christian's OK. Live runs consume the real daily cap of 10: reset with the dev portal "Reset today's counters" button.
4. Deploy (Christian approved deploys for this project on 2026-10-24; still say what you deploy): `npx wrangler deploy`, then re-run the live hardening check.

## Do not
- Delete, skip or loosen a test to make something pass (rails 3.7).
- Put the Gemini key in `wrangler.toml`, code or a commit. Use `npx wrangler secret put GEMINI_API_KEY`.
- Turn `ENGINE_B` on in production until the client works, falls back to the scripted agent on every failure, and the hardening suite covers the token path.
- Touch `mvp.omnisdr.com`.

## Known gaps
- No real voice engine (ENGINE-BUILD.md).
- Not tested on iOS Safari or Chrome arm64 (headless Chromium only).
- This branch is not merged to master and has no PR. Open one when the engine work is ready; Christian waived the other-session cross-audit for this demo on 2026-10-24, but each new public endpoint still gets a hardening test.
- Dependabot: 4 open alerts on master, all dev-tooling in other packages (vite in apps/console, sharp in edge/email-worker), none in this app. Triaged with fixes in VERIFICATION-2026-10-24.md.
- Live walkthrough has not been re-run since Turnstile went on (headless cannot pass the widget); do one manual phone click-through, which also covers iOS Safari.

## Completed this session (so you do not redo it)
Deployed and attached demo.omnisdr.com; deleted the unused KV namespace; added dev-portal "Reset today's counters"; made the hardening tests live-safe; DEV_PASSCODE env override in tests; Turnstile enabled and verified in a real browser; fixed the Gemini token mint (v1beta + `bidiGenerateContentSetup`) and verified it; rotated the two leaked Cloudflare tokens (2026-10-24).
