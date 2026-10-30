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
- Cloudflare zone `omnisdr.com` had **cache level: aggressive** (ignoring `cache-control: no-store`). Development Mode was enabled (2026-10-30 ~08:03 CDT) to bypass edge cache for 3 hours.
- The browser session was stuck on a stale build (showed removed `v999` badge even on brand-new URL paths like `/rep/fresh`). Verification in a fresh browser session is needed.
- GitHub pushes via API work; `wrangler deploy` deploys from `origin/master`.

## Current deployed state (per Cloudflare API, ~08:12 CDT)
Worker `omnisdr-demo-mvp` contains: `qInject`, `/rep/fresh` route, null-safe `ol()`, defensive `qRender`, hardcoded audit steps.

## What Toby should do
1. Pull latest `origin/master` of `DimeDataCloud/omni-sdr`
2. Reproduce the blank tabs in a FRESH browser session (not a cached one)
3. Find the root cause — strong suspicion is a JS exception during `account()` render or `qInject`/`qRender` execution related to `K` data shape
4. Fix Qualify, Close, and Onboard
5. Verify visually in browser that all three tabs render content
6. Do NOT send back until verified fixed

Dime's directive: "He doesn't need to ask Joe, just start working when he sees it."

## Update requirement (from Dime, 2026-10-30 ~08:14 CDT)
Keep us updated when you:
- START working on this
- PAUSE (and why)
- RESUME
- Find the root cause
- Deploy a fix
- VERIFY the fix (with screenshot or browser confirmation)

Post updates as comments on your PR, or update this file. Omni checks every 10 minutes.

## The account page and its workflow (added 2026-10-30 ~11:09 CDT)

### What the page is
When a rep opens an account from the pipeline (`#pipeline` → click account), they land on the account detail view. It has:
- Header: business name, niche · city · state, Stage dropdown, "Next:" button, Workflow progress line
- Tab row: **Overview** (0) → **Qualify** (4) → **Activity** (1) → **Close** (3) → **Onboard** (2)

The tabs follow the rep's sales workflow. Each tab is a step. The rep should be able to move through them in order without anything breaking.

### What each tab does
1. **Overview** (data-p="0", default) — Account facts: business name, contact info, notes, people, calling clearance, open tasks. ✅ WORKS
2. **Qualify** (data-p="4") — The free-check audit: research fields (grouped Research / Call test / Form test from `K.auditFields`), "How to run the free check" steps (`K.auditSteps`), Lost-job math calculator (avg job value × missed leads/month), Save audit + stage-advance buttons. ❌ BLANK
3. **Activity** (data-p="1") — Message templates + activity timeline + add-note form. ✅ WORKS
4. **Close** (data-p="3") — The Order Form: plan picker (Lite/Standard/Plus/Agency), client details, services, term, review/sign, handoff. Also Quick-close form. ❌ BLANK
5. **Onboard** (data-p="2") — Post-sale onboarding fields (`K.onboarding`), prefilled from Overview. ❌ BLANK

### Toby's scope
Fix the three blank tabs so the full workflow works end to end:
- **Qualify**: renders research fields, audit steps, lost-job math, save works, stage advances
- **Close**: renders the Order Form (plan picker, client/services/term, review/sign), Quick-close works
- **Onboard**: renders onboarding fields with Overview prefill, save works

Use the automation and workflow already in the codebase (the `K` content payload, `qRender`/`qInject` patterns, the stage machine). Make it look good — match the existing design system (dark cards, mint accents, the visual refresh already on master). Don't redesign; repair and polish.

### End goal (definition of done)
All five tabs render real content in a FRESH browser session (not a cached one). Click through Overview → Qualify → Activity → Close → Onboard on a real account. Every tab shows content, every form saves, stage advances work. Screenshot or screen-recording as proof. Do NOT send back until verified.

### How to see Dime's latest instructions
Dime's instructions live in this file (`TOBY-URGENT-TABS-BLANK.md`) on `origin/master` — pull latest before starting. New instructions from Dime get appended here. Check the file's tail for the newest directives.
