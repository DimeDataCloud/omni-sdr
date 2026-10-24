# Omni SDR demo MVP (demo portal + dev portal)

Cloudflare Worker, no build step, no paid services. Built to the Omni-SDR suite look
(warm off-white, mint `#A3FFB4`, green ink `#166534`, system sans, strict nonce CSP).

- `/` demo portal: inbound-call simulation for ONE fictional niche (bathroom remodeler, "Riverbend Bath").
  A scripted intake agent (9-step shape from the competitor reels) with typed input, optional browser mic, optional agent voice
  (browser speech synthesis). Shows captured fields, simulated owner text, simulated booking. Second tab simulates speed-to-lead
  texts (first text in seconds, stops on reply, booking or STOP). Nothing is ever really sent.
- `/dev` dev portal: passcode login, sessions today vs cap, spend estimate, kill switch, recent sessions, system checks, tenant config,
  Engine B spike checklist.
- `/api/token` mints a constrained Gemini Live ephemeral token. OFF by default and UNTESTED against the live API (no key in the sandbox).
  The browser audio client for Engine B is the spike task, not part of this MVP.

Swap the niche by editing `src/tenant.js` (fact sheet, zips, services, slots, hot words).

## Deploy (needs your Cloudflare login; nothing here has been deployed)
1. `npm install`
2. `npx wrangler secret put DEV_PASSCODE`  (long random string)
3. Nothing to create: all state (caps, session logs, kill switch, login lockout, dev sessions) lives in one Durable Object that `wrangler deploy` creates from the `[[migrations]]` block.
4. Recommended before sharing a link: create a Turnstile widget, then `npx wrangler secret put TURNSTILE_SECRET` and add `TURNSTILE_SITEKEY` under `[vars]`.
5. `npx wrangler deploy` -> https://omnisdr-demo-mvp.<your-subdomain>.workers.dev
6. Hostname: `demo.omnisdr.com`. `mvp.omnisdr.com` belongs to the Lead Engine inbox (Worker `omnisdr-mvp`); leave it alone. Check Workers & Pages -> Domains & Routes that `demo.` is free before attaching.

## Tests
`npm test` starts the local Worker and drives both portals in headless Chromium (47 checks: happy path, AI-question, price deflection,
out-of-scope, out-of-area, speed-to-lead STOP, mobile layout, dev login, kill switch, CSP, auth). `tests/caps.sh` checks caps against a server
started with `--var IP_CAP:1 --var DAILY_CAP:3`.

## Known limits
- The scripted agent is rule-based and demonstrates the flow and the guardrails; it is not an LLM and not a voice engine. Voice quality is untested until Engine A/B spikes run.
- Transcripts are kept 30 days in the Durable Object (purged lazily); the page tells visitors to use made-up details.
- Turnstile is OFF until you set TURNSTILE_SECRET and TURNSTILE_SITEKEY. Without it the demo caps can be burned by anyone with the link, so do not share the link publicly before enabling it.
- Independent security audit (Oct 24) found and I fixed: racy caps, open token endpoint, event flood, static dev cookie, no login lockout, CSRF, kill-switch expiry, chunked-body bypass, null-body 500s, and several scripted-agent logic bugs. `tests/hardening.js` (25 checks) covers them.
- Not yet verified on real iOS Safari or Chrome 152 arm64 (headless Chromium only).
