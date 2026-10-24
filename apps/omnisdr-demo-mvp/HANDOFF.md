# Handoff: Omni SDR demo MVP (mvp.omnisdr.com)

Rails v1.4 loaded. Written 2026-10-24 by claude-cloud for a terminal Claude Code session (claude-local).

## Status
Built and verified LOCALLY ONLY. Not deployed. Goal still open: verify the portals at mvp.omnisdr.com.
Local: tests/walkthrough.js 47/47, tests/hardening.js 25/25, tests/caps.sh checked, `wrangler deploy --dry-run` bundles with the Gate Durable Object.
The cloud session cannot deploy: no Worker-upload tool, api.cloudflare.com blocked, deploys need Christian's approval (AGENT-RAILS §3.1).

## What it is
Cloudflare Worker + SQLite Durable Object `Gate` (single serialized state: caps, sessions, kill switch, login lockout).
- `/` demo portal: scripted nine-step bathroom-remodel intake agent (fictional tenant "Riverbend Bath"), simulated owner text and booking, 3-min timer, disclosure banner; second tab simulates CHASE speed-to-lead texting.
- `/dev` dev portal: passcode login, sessions vs cap, spend note, kill switch, sessions table, system checks, tenant JSON, Engine B spike checklist.
- Design: suite.omnisdr.com tokens (`src/base.css`, `src/logo.txt`). Strict per-request nonce CSP, no inline styles.
- Config in `wrangler.toml`: DAILY_CAP=10, IP_CAP=2, SESSION_SECONDS=180, KILL=0, ENGINE_B=0. No route attached on purpose.

## Do this first (Christian runs or approves each; §3)
1. `cd apps/omnisdr-demo-mvp && npm ci`
2. Local proof: `bash tests/start.sh` (needs `.dev.vars` with `DEV_PASSCODE=test-passcode`, gitignored), then `node tests/walkthrough.js` and `node tests/hardening.js`, then `bash tests/stop.sh`. Expect 47/47 and 25/25.
3. Check who owns the hostname: `omnisdr-mvp` may already hold mvp.omnisdr.com. Look in the Cloudflare dashboard before attaching.
4. `npx wrangler secret put DEV_PASSCODE` (never paste the value in chat or commits).
5. `npx wrangler deploy`, then attach `mvp.omnisdr.com` to the Worker (custom domain or route).
6. Walkthrough against live: `BASE=https://mvp.omnisdr.com node tests/walkthrough.js` and the same for `hardening.js`. Caps tests need a separate low-cap instance, run those locally only. Live runs consume the real daily cap (10): set DAILY_CAP higher for the run or reset via the Durable Object, then restore.
7. Fix differences, redeploy, repeat until both pass live. Then enable Turnstile (secrets `TURNSTILE_SECRET`, and a `meta[name=ts-key]` site key) before sharing the link.

## Known gaps (UNVERIFIED or not built)
- No real voice engine. The agent is scripted. Engine B (Gemini Live) `/api/token` and the browser audio client are untested against the live API. Engine A (Workers AI pipeline) not built.
- Not tested on iOS Safari or Chrome arm64.
- Turnstile is off by default.
- Unused KV namespace `omnisdr-demo-kv` exists in the Cloudflare account; delete it if not needed.
- Hostname ownership of `omnisdr-mvp` unknown.

## Niche note (from Muse, brain repo)
Bathroom remodeling appears in none of Muse's five niche runs. Top picks: wildlife 8.8, bail 8.7, garage door 8.5, generators 8.4 (speed-run); canonical Run 4: garage door 8.2, generators 8.1. Suggest adding a wildlife or garage-door entry to `src/tenant.js` (TENANTS) before the Oct 26 dial week. Rules: $499 paid pilots, cold calls only, one niche per cycle, never quote the "62% unanswered" stat.

## Plan doc
Docs artifact "Free Demo Agent Plan": https://claude.ai/artifact/X11StYAy88pigxPH89bXJ3 (rev 31). Companion docs: OmniSDR Systems and Cost Model, Standard Bundle, Ultimate Stack and Workflow.

## Rails reminders
Branch work only (`claude/*`), merge via PR reviewed by the other session. Append CLAIM/DONE to the journal WORKBOARD (this session could not reach the journal repo, so no claim was filed). Every public endpoint here needs the other session's audit with explicit approval.
