# Verification findings, 2026-10-24 (claude-local, after the close-out commit 58fe742)

Rails v1.4 loaded. Three things were left unchecked at close-out; here is each result with the evidence.

## 1. Live site (https://demo.omnisdr.com)
- Deployed Worker version is `b6c107a0` at 100% (`npx wrangler deployments list --name omnisdr-demo-mvp`, created 2026-10-24 18:09 UTC). It is the Turnstile-on build. Commits since then (58fe742) change only docs, `tools/` and `tests/run.sh`, so the deployed code equals the repo code. No redeploy was needed.
- `/healthz` 200, `/` 200, `/dev` 200. CSP on `/` still allows `wss://generativelanguage.googleapis.com`.
- Dev login 200. Dev stats: `turnstile:true`, `turnstileKey:true`, `devPasscode:true`, `geminiKey:false`, `engineB:false`, caps 10/day and 2 per visitor, not killed.
- `POST /api/token` returns 501 while `ENGINE_B` is off, as designed.
- `tests/hardening.js` against the live site: **24/24** (the cap and lockout checks are skipped on live by design, because the edge rejects a forged `cf-connecting-ip`). Earlier notes said 21/21; the reset-today checks account for the difference.
- The live **walkthrough was not re-run**: headless Chromium cannot pass the real Turnstile widget. Its last live pass (47/47) was before Turnstile was switched on. Locally it passes 47/47 with Cloudflare's test keys (`npm test`). A person should click through once on a real phone, which also covers the untested iOS Safari gap.
- Counters were reset to 0 after the run (dev portal reset-today); the demo is not killed.

## 2. Gemini key and Engine B
- The key is valid (`node tools/gemini-live-smoke.mjs`: mint 200, 15 audio chunks, first audio about 1.3 s).
- It is **not on the Worker**: the dev stats check reports `geminiKey:false`. `ENGINE_B` is `0`. Nothing was changed, since turning it on is part of the engine build and there is no browser client to use it yet.
- To enable later: `npx wrangler secret put GEMINI_API_KEY` (value in `C:\Users\cdsec\.halo-keys\gemini-live.md`), set `ENGINE_B = "1"` in `wrangler.toml`, deploy, then confirm the dev portal shows both checks green.

## 3. Dependabot (4 open alerts on master)
None is in `apps/omnisdr-demo-mvp`. All four are dev-tooling, not code that runs in a production Worker.

| # | Severity | Package | Where | Fixed in | Reality |
|---|---|---|---|---|---|
| 16 | high | vite (launch-editor, `fs.existsSync` check bypass on Windows) | `apps/console/package-lock.json`, vite 8.3.1, devDependency | 8.3.3 | Dev server only |
| 15 | medium | vite (launch-editor, editor CLI flag misinterpretation) | same | 8.3.3 | Dev server only |
| 14 | medium | vite (launch-editor, `%` not escaped on Windows) | same | 8.3.3 | Dev server only |
| 6 | high | sharp 0.35.4 (librsvg CVE-2026-96889) | `edge/email-worker/package-lock.json` | 0.35.5 | Transitive: wrangler > miniflare > sharp. Email worker declares only `postal-mime`; sharp is not in its code or its deployed bundle |

Suggested fix, not applied (these paths belong to other work and need their own PR): in `apps/console` run `npm update vite` to reach 8.3.3 or later; in `edge/email-worker` bump `wrangler` so miniflare pulls sharp 0.35.5 or later. Both are lockfile-only changes. Run each package's tests after.

`npm audit` in `apps/omnisdr-demo-mvp` itself reports 3 findings (wrangler, miniflare, undici; undici high for an EventSource parser DoS and an SRI bypass). All are inside wrangler's local runtime, used only by `wrangler dev` and `deploy`; the Worker does not bundle undici. **Do not run `npm audit fix --force`**: it proposes downgrading wrangler to 4.35.0. Bump wrangler normally when a release carries a patched undici, and re-run `npm test`.

Nothing here was a blocker, and nothing was changed except this report and the handoff pointer.
