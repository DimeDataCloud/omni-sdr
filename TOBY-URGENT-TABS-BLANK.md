# URGENT: Qualify / Close / Onboard tabs blank — top priority

**From:** Dime (via Omni)
**To:** Toby
**Priority:** TOP — first thing to work on, no need to ask Joe
**Approval:** Full approval from Dime to fix. Do not send back until verified and fixed.

## Problem
In the rep portal account detail view (`https://demo.omnisdr.com/rep/` → open any account), three tabs render completely blank:
- **Qualify** (data-p="4") — blank
- **Close** (data-p="3") — blank  
- **Onboard** (data-p="2", the Order Form) — blank

Working tabs: **Overview** (data-p="0") ✅, **Activity** (data-p="1") ✅

The tab buttons highlight correctly, the URL updates (e.g. `#account/<id>/audit`), but the content area below the tabs is empty. No error shown. Reproduced in both the assistant's logged-in browser session and Dime's phone (hard refresh, incognito).

## Pattern
All three broken tabs depend on `K` (the `/content` API payload: `K.auditSteps`, `K.auditFields`, `K.onboarding`, `K.prices`, etc.). The two working tabs do not use `K`.

## What Omni tried (all deployed, none visually confirmed)
1. Defensive `show()` (String coercion, removeAttribute/setAttribute, style.display) — logic verified in Node mock-DOM, passes
2. Qualify rewritten flat + defensive, then redesigned from scratch
3. Found and removed leftover HTML fragments after Qualify div (unbalanced `</div>`, stray `<p id="est">`) — structure verified balanced via API
4. Made `ol()` null-safe: `((items)||[]).map(...)`
5. Made `qGroup` null-safe: `(((K||{}).auditFields)||[])`
6. Wrapped `qRender()` in try-catch
7. Hardcoded Qualify audit steps (zero K dependency in injected HTML)
8. `qInject()` — injects Qualify HTML via JS, bypassing the template entirely

## Deployment / cache complications
- Cloudflare zone `omnisdr.com` had **cache level: aggressive** (ignoring `cache-control: no-store`). Development Mode has been enabled (2026-10-30 ~08:03 CDT) to bypass edge cache for 3 hours.
- The browser session is stuck on a stale build (shows removed `v999` badge even on brand-new URL paths like `/rep/fresh`). Verification in a fresh browser session is needed.
- GitHub pushes via API work; `wrangler deploy` via `/tmp/cf_deploy4.py` (now wiped, needs recreate) deploys from `origin/master`.

## Current deployed state (per Cloudflare API)
Worker `omnisdr-demo-mvp` contains: `qInject`, `/rep/fresh` route, null-safe `ol()`, defensive `qRender`, hardcoded audit steps. The `v999` debug badge is still present (removal never reached GitHub — harmless).

## What Toby should do
1. Pull latest `origin/master` of `DimeDataCloud/omni-sdr`
2. Reproduce the blank tabs in a FRESH browser session (not the cached one)
3. Find the root cause — strong suspicion is a JS exception during `account()` render or `qInject`/`qRender` execution related to `K` data shape
4. Fix Qualify, Close, and Onboard
5. Verify visually in browser that all three tabs render content
6. Do NOT send back until verified fixed

Dime's directive: "He doesn't need to ask Joe, just start working when he sees it."
