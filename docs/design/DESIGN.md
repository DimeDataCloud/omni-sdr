# Omni-SDR: Design brief for the full web app

**For:** the design agent building Omni-SDR's UI/UX. **From:** Claude (backend), for Christian. **Version:** 1.0, 2026-09-29.
**Status:** handoff. Anything marked *proposal* needs Christian's OK; everything else is a decision or a rule already in force.

Read this file top to bottom once. Then keep it open as the checklist.

---

## 0. How to use this package

| File | What it is | Use it for |
|---|---|---|
| `DESIGN.md` (this) | The brief: product, rules, IA, every screen, components, copy, accessibility | What to build and why |
| `template/tokens.css` | Every color, type size, space, radius, shadow and motion value, light + proposed dark, with measured contrast | The only source of visual values |
| `template/tailwind-theme.css` | Tailwind v4 `@theme` mapping of the tokens | Drop into `apps/web` (Next.js 16 + Tailwind 4) |
| `template/index.html` | A static page rendering the app shell and every core component in its states | Open in a browser; copy structure and proportions |
| `template/assets/` | The logo: `logo.svg`, `logo-mark-small.svg` (16–32px, favicon), `logo-on-dark.svg`, and Christian's source `logo-source-christian.jpg` | Brand mark (§4.9) |
| `template/api-types.ts` | TypeScript shapes of every API response, written from the backend code | Build screens against real data, not the mock's |
| `../claude/API.md` | The backend contract: every endpoint, permission, error | Wiring and edge cases |

**The product floor.** The AI Studio prototype "Omni SDR - Autonomous Fleet Console" is the agreed starting point for how the product looks and flows (Christian, 2026-09-29): agents with chat, an approval queue, replies with SLAs, capacity and routines, analytics, connections, settings. Keep its spirit: a calm, glassy control room with a green accent. **Do not copy its data layer, its fake numbers or the 12 things in §13 that break the product's rules.**

**What to produce**, in order of preference:
1. React components and pages for `apps/web` (Next.js 16 App Router, Tailwind 4, shadcn/ui on Radix), styled only through the tokens.
2. If you prototype outside the repo: high-fidelity, responsive HTML/React for every screen in §6, each with its states (§6 "States"), using `tokens.css` verbatim.

**You may not change:** the rules in §2, the permission model in §5.3, the token values' contrast guarantees (§4.1), the status vocabulary in §7.4–7.6. **You own:** layout details, composition, iconography choices within §4.8, illustration, motion within §4.7, and anything this brief leaves open.

**Run the real backend while designing:** `cd packages/api && npm install && npm run dev` → `http://127.0.0.1:8787`, header `Authorization: Bearer dev:maya@example.com` (admin). Other roles: `sam@` operator, `riley@` reviewer, `client@` client viewer (first workspace only). The demo data is fictional and was produced by the real pipeline, so every state in this brief exists there.

---

## 1. The product in one page

**Omni-SDR** is an AI sales development rep for small businesses and the agencies that serve them. It learns the customer's offer and ideal customer (ICP), researches prospects, and drafts outreach **grounded in evidence it has actually fetched** (a website, reviews, a job post). A person approves each message; it sends from the customer's own mailbox; replies come back, get sorted, and meetings get booked.

**Who uses it**

| Persona | Account | Role | What they do all day |
|---|---|---|---|
| Maya, owner-operator of a small studio | `owner` (one workspace) | admin | Checks Today, approves drafts on her phone between jobs, answers meeting requests fast |
| Northside Growth, a 3-person agency with 4 clients | `agency` (a workspace per client) | admin / operator / reviewer | Runs campaigns per client, reviews drafts in bulk at a desk, reports to clients |
| The agency's client | inside the agency's workspace | client_viewer | Sees results; approves drafts only if the agency turned that on |

**The loop the UI serves** (everything else supports it):
```
Teach (offer, ICP) → Find leads + evidence → Draft (agents) → Claims gate checks every claim
→ A person approves → Sends from their mailbox (capped, suppressed, on schedule)
→ Replies land in the inbox (sorted, SLA on meeting requests) → Meeting booked → Measured
```

**Words the product uses** (use them exactly; see §8.3): workspace, agent, draft, claims gate, evidence, approve, reject, sequence, step, reply, meeting request, SLA, hold ("pause"), suppression ("do not contact"), trust level, credits.

---

## 2. Non-negotiables (the UI must never break these)

These come from the product's safety, legal and accessibility decisions. Each has a reason; none is a style preference.

1. **Nothing sends from the UI.** There is no "Send", "Send now" or "Send via Gmail" button anywhere. Approving is the last human step; the sender worker sends later under checks the UI can't bypass. *Why:* every send must pass the gate, a human approval, suppression, the daily cap and holds. The prototype's browser-side send guessed addresses and would have emailed strangers.
2. **The claims gate is the only way into Approvals.** A draft blocked by the gate shows its findings and **no Approve button** (absent, not disabled). Editing text re-runs the gate; show the new verdict. *Why:* only evidence-backed text may be approved.
3. **No open tracking, anywhere.** No "opened", "open rate", "read" or pixel language. The funnel is sent → replied → positive → meeting. *Why:* SPEC invariant S14.
4. **Trust level is read-only.** Show "Level 1 · a person approves every message." Never a toggle, slider or "auto-send above N" control. *Why:* Level 2 is set only by Omni-SDR ops.
5. **The daily cap is a safety floor, not a setting.** Show it read-only with usage. A warm-up ramp (later) is a separate control that can never exceed the cap.
6. **No false claims about Omni-SDR.** No "SOC2 certified", uptime SLAs, customer counts or "AI-verified" badges. *Why:* legal exposure. If a number isn't from the API, it doesn't appear.
7. **Green is a fill, never text.** `--accent` / `--accent-hover` only as backgrounds with `--text-on-accent` (#1A1A1A) on them. For green text, links, icons and focus rings use `--accent-ink`. *Why:* green on sand is 1.2:1.
8. **Untrusted text renders as text.** Prospect replies, agent/model replies, draft bodies, contact names and evidence snippets are displayed as plain text (no HTML, no Markdown-to-HTML, links not auto-activated in replies). *Why:* prospect text is hostile input and model output is untrusted.
9. **No dead buttons.** A feature that's off (a generator flag, a module that "activates later") is hidden or offered as an alternative (upload, pick), never shown disabled with "coming soon". Disabled is only for a momentary, explained condition ("Fix the 2 gate findings to approve").
10. **Costs are shown before they're spent.** Any action that spends credits shows its estimate on or next to its button ("Run · ≈ 12 action credits"). The press is the consent; no confirmation modal for costs.
11. **White-label means invisible.** In an agency's client-facing views (reports, client viewer, audit pages, notify emails): no "Omni-SDR" wordmark, logo, favicon, footer or "powered by".
12. **Omni-SDR's own postal address never appears in the app.** The customer's postal address appears only as a setting they enter (it goes into their outreach footers).
13. **Accessibility is WCAG 2.2 AA.** Contrast (§4.1), keyboard (§10), 44px touch targets, reduced motion and reduced transparency honored.

---

## 3. Design principles (how it should feel)

- **Calm control room.** Sand background, frosted glass cards, generous space, soft shadows. Urgency is reserved for things that are actually urgent (an SLA about to lapse, a paused workspace). If everything glows, nothing does.
- **Evidence first.** Wherever a claim about a prospect appears, the evidence behind it is one glance away (source, fetched date, expiry). Trust is the product.
- **One decision at a time.** Queues show the next thing to decide, big and clear, with the next few peeking. Keyboard and swipe make decisions fast; nothing is decided in bulk without the person having seen it.
- **Numbers over adjectives.** "3 of 40 sent today", "44 min left", "fit 83". Never "healthy pipeline".
- **Say what's missing.** When an agent or screen lacks context (no ICP, no mailbox), say exactly what's missing and offer the one-click fix.
- **Agents are colleagues, not magic.** They draft, summarize and plan. The UI never implies they act on their own in the world.

---

## 4. Foundations

All values live in `template/tokens.css`. Never hard-code a hex in a component.

### 4.1 Color (light theme; ratios measured 2026-09-29)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--bg` | #F7F5F0 Translucent Sand | App background | — |
| `--surface-glass` | white 65% + blur 14px | Panels, cards over content, composer | — |
| `--surface` | #FFFFFF | Solid cards (approval card, lists) | — |
| `--surface-sunken` | #EFECE4 | Wells, table headers, action bars, skeletons | — |
| `--text` | #1A1A1A Satin Black | All text | 15.97 on sand · 17.40 white · 14.52 on green |
| `--text-muted` | #5C6459 | Secondary text, meta | 5.63 sand · 6.14 white · 5.20 sunken |
| `--accent` | #A3FFB4 Pastel Neon Green | Primary buttons, active toggles, selected fills. **Fill only** | — |
| `--accent-hover` | #7BFF93 Electric Mint | Hover/pressed fill, focus glow (decorative) | — |
| `--accent-ink` | #166534 | Links, success text, icons, focus ring, meter fill | 6.54 sand · 7.13 white |
| `--accent-soft` | #DCFCE7 | Success chip fill, evidence highlight | ink on it 6.49 |
| `--border` | #E8E4D9 Pale Sand | Decorative dividers and card edges | (decorative) |
| `--border-control` | #8F8878 | Input, select, checkbox, switch outlines | 3.23 sand · 3.52 white (≥3:1 for controls) |
| `--warning` / `-soft` | #854D0E / #FEF3C7 | Paused, SLA < 30 min, objections | 6.15 on soft |
| `--danger` / `-soft` | #B42318 / #FDE8E6 | Blocked, overdue, unsubscribed, destructive | 5.59 on soft |
| `--info` / `-soft` | #1D4ED8 / #E0EBFF | In review, questions, neutral notices | 5.58 on soft |

The prototype used `#6F7A6E` for muted text (4.11 on sand: fails AA) and `#16A34A` for green text (3.02: fails). Both are replaced above.

**Dark theme: proposal** (Christian decides; `:root[data-theme='dark']` in tokens.css). Near-black `#0F100E`, surfaces `#1A1B19`, text `#F2F0EA` (16.7:1), muted `#A8AFA4` (8.5:1). In dark, mint `#7BFF93` leads as the fill and may also be used as text (15:1). Ship light first; build components theme-agnostic so dark is a token swap.

**Charts:** `--chart-1…6` in order. Always label series directly or with a legend that includes text; never color alone.

### 4.2 Type
Inter (UI) and JetBrains Mono (ids, counts, estimates). Headings semibold (600), body regular (400), buttons medium (500). No weights above 600.

| Token | Size / line | Use |
|---|---|---|
| `--text-2xl` | 28/36 | Stat numbers, empty-state headlines |
| `--text-xl` | 22/30 | Page titles |
| `--text-lg` | 18/26 | Card and panel titles |
| `--text-md` | 16/24 | **Reading text**: draft bodies, replies, chat |
| `--text-base` | 14/22 | Body, inputs, buttons |
| `--text-sm` | 13/20 | Dense lists, tables |
| `--text-xs` | 12/16 | Meta, badges, timestamps. **The floor.** |

The prototype's 9–11px labels are below the floor; use 12px and fewer labels. Reading text is capped at `--reading-max` (68ch).

### 4.3 Space, radius, elevation
- **Space:** 4px base (`--space-1` 4 … `--space-16` 64). Cards pad 16; panels 16–24; page gutters 24 desktop, 16 phone.
- **Radius:** 6 badges · 8 buttons/inputs · 12 cards/rows · 16 panels/modals/composer.
- **Shadow:** `--shadow-md` (0 8px 32px rgba(0,0,0,.04), the brand shadow) on cards and panels; `--shadow-lg` for modals, drawers, popovers, toasts. No hard shadows.

### 4.4 Glass
Use `--surface-glass` + `backdrop-filter: blur(var(--blur))` for chrome that floats over content: top bar, composer, drawers, the Today panel. Use solid `--surface` for content you read or decide on (approval cards, replies, tables). If text on glass would drop below 4.5:1 because of what's underneath, make that surface solid. `prefers-reduced-transparency` sets glass to solid automatically (tokens.css).

### 4.5 Layout tokens
Top bar 56px · agent rail 280px · right panel 360px · single-column pages max 1200px · reading width 68ch · touch target ≥44px.

### 4.6 Focus
Every interactive element: `outline: 2px solid var(--focus-ring); outline-offset: 2px` on `:focus-visible`. The mint glow may accompany it, never replace it.

### 4.7 Motion
Fast and quiet: `--dur-fast` 120ms (hover/press), `--dur-base` 180ms (toggles, expand), `--dur-slow` 240ms (drawers, modals), all `--ease-out`. Card leaves the queue after approve: 180ms slide + fade, next card slides up. No bouncing, no confetti, no looping animation except spinners and skeleton shimmer. `prefers-reduced-motion` zeroes durations (tokens.css).

### 4.8 Icons and imagery
[Lucide](https://lucide.dev) (the prototype's set), 16px in dense UI, 20px in nav and buttons, stroke 1.75, color `currentColor`. An icon never carries meaning alone: pair it with text or an `aria-label`. Agent avatars: a rounded square with the badge code (EXEC, SDR…) or a Lucide glyph on `--surface-sunken`; agencies may set an agent color via `appearance.color`, used only as a 3px left accent or dot, never as text color. No stock photos, no 3D blobs, no robot mascots.

### 4.9 Logo
The mark is a **funnel**: a black outline over a white-to-mint gradient (Christian, 2026-09-29). It says what the product does: many prospects in, a few real conversations out.

| File | Use |
|---|---|
| `assets/logo.svg` | Default, ≥48px (sign-in, empty states, loading splash) |
| `assets/logo-mark-small.svg` | 16–40px: top bar (28–30px tall), favicon, avatars. Heavier stroke so it survives small sizes |
| `assets/logo-on-dark.svg` | Dark theme and dark surfaces (light outline; the black one disappears on dark) |
| `assets/logo-source-christian.jpg` | Christian's original, for reference only |

- **The SVGs are a vector recreation.** The original is a JPG with the transparency checkerboard painted into the pixels, so it can't sit on sand. Ask Christian for the original vector or a transparent PNG, and swap the files when you get it; the file names stay.
- **Wordmark:** "Omni-SDR" in Inter semibold, `--text`, set to the right of the mark at the mark's cap height, gap 8px. The mark alone is fine in the top bar.
- **Clear space:** at least half the mark's width on every side. **Minimum size:** 16px tall.
- **Don't:** recolor the outline (except the dark variant), put it on green fills, add shadows or glows, stretch it, or animate it beyond a gentle loading pulse (which respects reduced motion).
- **White-label:** the agency's logo replaces the funnel everywhere a client can see (§9), including the favicon.

---

## 5. Structure

### 5.1 App shell (desktop ≥1280px)
```
┌─ Top bar (56, glass) ─────────────────────────────────────────────────────────────┐
│ [logo] [Org / Workspace ▾]   Home  Approvals(7)  Inbox(1)  Meetings  Leads  …     │
│                                        [Level 1 badge] [credits] [avatar ▾]       │
├──────────────┬───────────────────────────────────────────────┬────────────────────┤
│ Agent rail   │ Main (the page)                               │ Today panel        │
│ 280          │ fluid                                         │ 360 (Home only;    │
│              │                                               │ collapsible)       │
└──────────────┴───────────────────────────────────────────────┴────────────────────┘
```
- The agent rail and Today panel belong to **Home**. Other pages use the full width under the top bar (max 1200 centered, except Approvals and Inbox which use a list + detail split).
- Nav badges: Approvals = drafts in review (`counts.review`); Inbox = open replies with an SLA under 60 minutes, in `--danger` fill with white text. Nothing else gets a badge.

### 5.2 Breakpoints

| Width | Behavior |
|---|---|
| ≥1280 | Three columns on Home; list + detail split on Approvals/Inbox |
| 960–1279 | Home: rail + main; Today becomes a drawer (button in the page header) |
| 640–959 | Single column; nav collapses to a bottom bar; rail becomes a sheet |
| <640 (phone) | Bottom nav: Home · Approvals · Inbox · Meetings · More. Approvals and Inbox are **designed mobile-first**: one card per screen, swipe right = approve, swipe left = reject (with reason sheet), tap = open |

### 5.3 Information architecture and who sees what

Routes (Next.js App Router): `/app/[workspaceId]/…`. Permissions come from the API (`packages/db/src/permissions.mjs`); **hide** what a role can't do, don't disable it.

| Nav | Route | admin | operator | reviewer | client_viewer | API |
|---|---|---|---|---|---|---|
| Home | `home` | ✓ | ✓ | ✓ read-only (no chat input) | client summary (§6.13) | agents, routines, capacity, inbox, meetings |
| Approvals | `approvals` | ✓ | ✓ | ✓ | only if workspace toggle on | approvals |
| Inbox | `inbox` | ✓ | ✓ | read-only | — | inbox |
| Meetings | `meetings` | ✓ | ✓ | ✓ (view) | ✓ (view) | meetings |
| Leads | `leads` (contacts, ICPs, campaigns) | ✓ | ✓ | — | — | contacts, icps, campaigns |
| Analytics | `analytics` | ✓ | ✓ | ✓ | ✓ | analytics, credits |
| Studio | `studio` (agents, routines, Auto-adjust log) | ✓ | ✓ | view | — | agents, routines |
| Connections | `connections` | ✓ (connect) | view | view | — | connectors |
| Settings | `settings` | ✓ all tabs | workspace (read) | workspace (read) | — | settings, members, activity |

Outside a workspace: `/signin`, `/signup`, `/onboarding`, `/workspaces` (picker), `/invite/[token]`, and the public `/u/[token]` (unsubscribe).

### 5.4 Global patterns
- **Workspace switcher** (top-left): org name small, workspace name bold; menu lists `GET /v1/me` workspaces, "New client workspace" (agency admins only), and org switch if the user has several orgs.
- **Command palette** `⌘K` / `Ctrl K`: jump to any page, agent, contact, draft; run "Pause sending", "Invite teammate". Results show the keyboard shortcut next to each.
- **Global shortcuts:** `g h` Home, `g a` Approvals, `g i` Inbox, `g m` Meetings, `?` shortcut sheet. Page shortcuts in each page spec.
- **Toasts** (bottom-center, `--surface-inverse`): confirm completed actions in plain words ("Approved. It sends in the next window."). Errors that block work are inline, not toasts.
- **Time:** relative for <24h ("40 min ago"), then "Tue 10:30" within a week, then "29 Sep". Always in the **workspace time zone** (`settings.workspace.timezone`); hover shows the absolute time with zone.

---

## 6. Screens

Every screen spec lists: **job**, **data**, **layout**, **states**, **roles**, **mobile**, and **done when**. "States" always includes loading (skeletons shaped like the content), empty, error (inline, with retry and the `requestId`), and permission (hidden entry points; direct URL shows a plain "You don't have access" with who to ask).

### 6.1 Sign in, sign up, onboarding
- **Job:** get a new customer from zero to a first reviewed draft without a wall of forms.
- **Sign in:** Google, or email magic link (Identity Platform). One card on sand, product name, two options, legal links. No marketing carousel.
- **Sign up:** after first sign-in with no orgs (`GET /v1/me` → `orgs: []`): choose **Owner** ("one business") or **Agency** ("clients, each in its own workspace"), business name → `POST /v1/orgs`. Then Stripe Checkout for the 7-day trial (card required; *backend pending*: design the step, it opens Stripe's hosted page).
- **Onboarding is a conversation in the composer** (SPEC Station 06), not a wizard. The Chief of Staff agent asks one thing at a time: website → offer → voice note (optional) → ICP → connect mailbox. **Every question has "Skip".** The minimum required input is nothing. Each answer shows as a chip in a "What I know" strip; missing items show as "Add" chips. *Backend pending* for storing onboarding answers; design it with the composer (§6.3).
- **Eight connection modules** are offered as skippable cards at the end (and live in Connections): Gmail · Google Calendar · Email sending & routing · LinkedIn · Other social · Two-way CRM · MCP · SMS.
- **Done when:** a new user can reach Home in under a minute, skipping everything, and Home says exactly what's missing.

### 6.2 Workspaces (picker and agency admin)
- `/workspaces`: cards per workspace (name, drafts waiting, open replies, meetings this week). Agency admins get "New client workspace" (`POST /v1/o/{org}/workspaces`; owners never see it; an owner who tries gets the API's 409 as "Owner accounts have one workspace. Switch to Agency to add clients.").
- **Done when:** an agency admin with 4 clients sees at a glance which client needs attention.

### 6.3 Home: agents, chat, Today
- **Job:** the start of every session: see what needs you, talk to agents, act.
- **Data:** `GET agents`, `GET agents/{id}/messages`, `POST agents/{id}/messages`, `GET routines`, `GET capacity`, `GET inbox`, `GET meetings`, `GET approvals?limit=3`.
- **Layout:** see template `index.html`.
  - **Agent rail:** search, "New agent" (build roles), list sorted by last activity. Item: avatar, name, one-line `lastMessage.preview` (muted), relative time. Selected = solid surface + shadow. No unread counts (not tracked yet).
  - **Chat:** header with agent name, tier ("Flash"), "N routines", and the line **"can draft, can't send"**. Messages: user right on `--surface-inverse`; agent left on `--surface`; system notices (model off, model failed) on `--surface-sunken`, no avatar. Agent message meta: name · time · `tier · seconds`. When the answer references Approvals/Inbox, show action buttons under it ("Open Approvals (7)").
  - **Composer** (glass, sticky bottom): multiline input ("Ask, draft, summarize… Agents draft; you approve. Nothing sends from here."), attach, voice, tier select (Flash-Lite / Flash / Pro), **inline estimate** ("≈ 1 action credit · a few seconds"), Send (`↵`; `Shift+↵` newline).
  - **Today panel:** in this order: (1) urgent banner if a meeting request's SLA < 60 min; (2) next approval (compact card, Approve + Review); (3) sending capacity per mailbox (used/cap meter, "Resets 00:00 UTC"); (4) routines with switches ("Paused by Omni-SDR" badge when `pausedByOps`); (5) upcoming meetings; (6) **"Pause all sending in this workspace"** (secondary danger button → `POST holds {scopeType:'workspace'}`, reason sheet).
- **States:** no agents ("Create your first agent" + 3 suggested presets: Sales Outbound, Inbox Triage, Chief of Staff); agent with no messages (3 suggested prompts as chips); model off (system notice style, not an error); model failed (502: keep the user's bubble, add "Didn't get an answer. Try again" inline); sending in flight (typing indicator in agent bubble, input stays usable); workspace on hold (warning banner across the top of Home: "Sending is paused for this workspace. Set by Sam · 'pause for review'. Resume (admin)").
- **Roles:** reviewer sees chat history but no composer ("Reviewers can read agent conversations"); client_viewer gets §6.13 instead.
- **Mobile:** agent list is the Home screen; tapping opens the chat full-screen; Today is a tab at the top ("Today · Agents").
- **Done when:** someone opening the app knows in 5 seconds whether anything is urgent, and can approve the next draft from Home.

### 6.4 Approvals
- **Job:** review drafts quickly and safely; never approve something unseen or unsupported.
- **Data:** `GET approvals?status=review|blocked|approved&channel=&minFit=`, `GET approvals/{id}`, `POST …/approve`, `POST …/reject {reason}`, `PATCH …/{id} {subject, body}` (returns the new gate verdict), `POST …/bulk-approve {ids}`.
- **Layout (desktop):** tabs **In review (7) · Blocked (1) · Approved · All** with counts from `counts`. Left: list (recipient, company, subject, fit, channel icon, gate badge; sorted by fit then age). Right: the **approval card** (template §Approval card):
  - Header: recipient name, title · company · email (with `emailStatus` badge if not valid), campaign, agent + tier; **ICP fit** as a big number (or "—" if null).
  - **Sequence stepper** (1 · first touch, 2 · follow-up…) switching the body below; each step shows its own status.
  - Subject, then body at reading size (16/24, 68ch), **claim sentences highlighted** with `--accent-soft`; each highlight links to its evidence block below (source domain, fetched date, expiry, the fact text). Expired evidence → warning badge.
  - Blocked drafts: offending sentences highlighted in `--danger-soft`; findings listed in plain English (§7.4); actions are **Edit to fix** and **Reject** only.
  - Action bar (sunken): **Approve (A)** primary · **Edit (E)** · **Reject (D)** danger-outline · **Skip (S)** ghost.
- **Edit:** inline, in place of the body; "Save and re-check" runs the PATCH; show "Re-checking…" then the new verdict. Approve is hidden until the new verdict passes. Cancel restores.
- **Reject:** a small sheet with reason chips ("Tone", "Wrong person", "Claim feels off", "Too pushy", "Other…") + optional text → `reason` (it trains Auto-adjust). `Enter` confirms.
- **Bulk:** checkboxes appear in the list; "Approve N reviewed" is enabled only for drafts the person has **opened** in this session (track locally). There is no "approve all above fit N".
- **Keyboard:** `J/K` next/prev · `A` approve · `E` edit · `D` reject · `S` skip · `Enter` open · `1–5` sequence step · `?` help.
- **After approve:** card slides out, next slides in, toast "Approved. It sends in the next window." (*Undo* needs a backend endpoint not built yet; leave space for it but don't show it until it exists.)
- **States:** empty ("Nothing to approve. New drafts land here after the claims gate checks them." + "Ask Sales Outbound for drafts"); all blocked; draft already dispatched (read-only, "Sent" badge, no actions); 409 from approve ("This draft changed. Reload to see the latest." + reload); 403 (hidden).
- **Roles:** admin, operator, reviewer act; client_viewer only when the workspace toggle is on (the API enforces it; the nav item disappears when off).
- **Mobile:** one card per screen; swipe right approve (with a haptic and a 1s "Approved" confirmation), swipe left opens the reject sheet; "Edit" opens full-screen editor; long-press shows evidence.
- **Done when:** a reviewer can clear 20 drafts in under 5 minutes with the keyboard, and it is impossible to approve a draft with open gate findings.

### 6.5 Inbox
- **Job:** answer the replies that matter, fast; never miss a meeting request's SLA.
- **Data:** `GET inbox?status=open|handled|all`, `POST inbox/{id}/handle`, `POST inbox/{id}/meeting {startsAt, endsAt, meetUrl?}`.
- **Layout:** list sorted by SLA then time (the API already sorts). Row: contact name, company, intent badge (§7.5), **SLA chip** (`slaMinutesRemaining`), "Needs a look" when `needsHuman`, 2-line preview. Detail: full reply (plain text, 16/24), the original message it answers (link to the draft), contact card with evidence, actions.
- **SLA chip:** > 60 min neutral "2h 10m"; 30–60 warning; < 30 warning bold; ≤ 0 danger "Overdue 12m". Business hours only (the API computes due time in the workspace zone); show "due Tue 10:30" on hover. Refresh the list every 60s while visible.
- **Actions:** **Book** (meeting requests; opens a time picker: 3 suggested slots when Calendar is connected, or a date/time + duration + optional https link) → the API creates the meeting, marks handled, ends the sequence. **Mark handled** (`H`). **Open contact**. Replying from the inbox is *backend pending* (a drafted reply will go through the gate + approval like any draft). Design the "Draft reply" affordance to hand off to Approvals, not to send.
- **Automatic outcomes to explain, not hide:** opt-outs are suppressed and sequences stopped automatically: say so on the row ("Suppressed automatically, sequence stopped"). Out-of-office doesn't stop the sequence: say "Sequence continues".
- **States:** empty ("No replies yet. Replies to your outreach land here."); all handled; reviewer read-only (no actions).
- **Mobile:** mobile-first list; Book and Mark handled as the two big buttons in the detail.
- **Done when:** a meeting request with 20 minutes left is impossible to overlook from any page (nav badge + Home banner + top of Inbox).

### 6.6 Meetings
- **Data:** `GET meetings?range=upcoming|past|all`, `POST meetings`, `PATCH meetings/{id} {status…}`.
- **Layout:** upcoming grouped by day; row: time (workspace zone), contact · company, provider badge (Native / Calendly / Cal.com), join link (opens in new tab, `rel="noopener"`), status. Past: outcome buttons **Completed · No-show · Canceled** (no-show will later suggest a reschedule draft).
- **Done when:** outcomes take one tap and feed Analytics.

### 6.7 Leads (contacts, ICPs, campaigns)
- **Contacts** (`GET/POST contacts`, `GET contacts/{id}`): table (name, company, title, email + status badge, fit, created). Import: paste or CSV → column mapping → preview → import; result shows created / skipped (duplicates) / invalid addresses with reasons. Explain once: "Free checks can only mark an address invalid. Only verified addresses (paid check) can be emailed." Contact detail: evidence list (source, fetched, expires, facts rendered as plain key-value text), enrollments (campaign, state, step, stop reason).
- **ICPs** (`GET/POST icps`): list of ICPs with version ("v2"); edit creates a new version ("Campaigns keep using the version they started with"). A version history drawer; old versions read-only.
- **Campaigns** (`GET/POST/PATCH campaigns`, `POST campaigns/{id}/enrollments`): list with status, pinned ICP version, enrolled / live counts; detail with enrolled contacts and their state. Status control: Draft · Active · Paused · Archived.
- **Evidence can't be typed in.** Don't design an "add evidence" form; evidence comes from research.
- **Done when:** an operator can import 50 contacts, enroll them in a campaign, and see who's live.

### 6.8 Analytics
- **Data:** `GET analytics?days=7|30|90`, `GET credits`.
- **Layout:** period switch (7 / 30 / 90 days) and the time zone shown. Tiles: Sent · Replies · Positive · Meetings · Approval rate. A daily chart (sent vs replies vs meetings). A reply-rate-by-step table. Credits by meter.
- **Rules:** rates with no denominator show "—" plus the reason ("nothing sent yet"), never 0%. Every number links to the rows behind it (e.g. Meetings → Meetings page filtered). No opens (§2.3).
- **Client viewer:** the same page, white-labeled, is their main view.

### 6.9 Studio (agents, routines, Auto-adjust)
- **Agents** (`POST/PATCH/DELETE agents`): editor with name, station, badge, model tier (with a one-line explanation of each tier and relative cost), role prompt (monospace-free text area, 8000 chars, character count), context sources, **autonomous mode** switch with its exact meaning: "Runs its routines without being asked. Everything it drafts still needs approval." Archive (not delete) with confirmation.
- **Routines** (`GET/POST/PATCH routines`): name, category (Briefing · Triage · Outbound · Sync), schedule (plain text now, e.g. "weekdays 08:00"), agent, active switch. "Paused by Omni-SDR" when `pausedByOps` (not clearable). *The runner isn't built yet*: routines save and toggle; show "Last run —" until it exists.
- **Auto-adjust log:** a list of what the system learned, each traceable to its source event and revertible (*backend pending*, SPEC Station 08). It never changes guardrails; say so in the header.

### 6.10 Connections
- **Data:** `GET connectors` (status is real: `connected`, `not_connected`, `activates_later`).
- **Layout:** grouped by category; card: name, what it does, **each OAuth scope with a plain-English "why"**, who pays (`costOwner`), status, action. Gmail's card states "Send-only. Omni-SDR can't read your mail. Replies come back through reply.omnisdr.com."
- **Activates later** modules (HubSpot, other social, SMS): shown with "Set up now, activates later" and only the setup that exists (SMS collects registration details). Never "Coming soon".
- **LinkedIn automation** requires a consent screen before connecting: plain statement that automation breaks LinkedIn's User Agreement and the account may be restricted, a checkbox, and the consent version.
- **Connect flows** are *backend pending* (OAuth callbacks); design the card states: Not connected → Connecting → Connected (account shown) → Reconnect needed → Error (with the provider's reason).
- Warm-up modules carry the warning "Reply-network warm-up can put your mailbox at risk. Your hard daily cap always applies."

### 6.11 Settings
Tabs (admin sees all; others see Workspace read-only):
- **Workspace** (`GET/PATCH settings`): name, time zone (searchable), **postal address for outreach footers** (10–300 chars, required before anything can send: say so), client approvals switch, Auto-adjust switch + sources (8 checkboxes, §7.7). **Trust level** read-only row (§2.4).
- **Members** (`GET members`, `POST invites`, `DELETE invites/{id}`): members table (email, role, workspaces); invite form (email, role with one-line descriptions, optional workspace scope). On success show the **invite link once** with Copy ("Anyone with this link and that email can join. It expires in 7 days."). Pending invites with Revoke.
- **Sending & safety** (`GET capacity`, `POST/DELETE holds`, `POST suppression`): mailboxes with cap (read-only) and today's usage, active holds with who/why/when and Resume (admin), "Add to do-not-contact" (email → stored as a hash; say "We store a fingerprint, not the address").
- **Activity** (`GET activity`): audit log (who, what, when). Filter by action.
- **Billing** (*backend pending*): plan, trial days left, credits by meter, "Manage in Stripe".

### 6.12 Public and edge pages
- **Invite** `/invite/[token]`: sign in with the invited email → accept (`POST /v1/invites/accept`). Any failure → one message: "This invite is invalid or expired. Ask for a new one." (the API deliberately doesn't say which).
- **Unsubscribe** `/u/[token]` (served by the API, rendered server-side; design it): one line, one button, the sender's workspace name at most, no Omni-SDR branding in white-label. After: "You're unsubscribed." Same page for every token.
- **Errors:** 404, no access (with who to ask), session expired (sign in again, return to the page), offline (banner; queued actions are not supported, so disable actions while offline with the reason).

### 6.13 Client viewer (white-label)
A focused view for an agency's client: agency logo and name top-left, their workspace only. Tabs: **Results** (Analytics), **Meetings**, **Approvals** (only when enabled). No agents, leads, settings, connections, credits or Omni-SDR mentions (§2.11). Tone: a clean report, not a control room.

---

## 7. Components

Build these once, in `apps/web/components/`, shadcn/ui primitives underneath. Each lists variants, states and the accessibility contract.

### 7.1 Primitives
| Component | Variants | States / notes |
|---|---|---|
| Button | primary (green fill), secondary (outline control border), ghost, danger (outline red); sizes sm 28 / md 36 / lg 44 | hover, focus-visible, pressed, loading (spinner + verb-ing: "Re-checking…"), disabled only with a reason nearby. Keyboard hint `kbd` optional |
| Input / Textarea / Select | — | label always visible; hint; error text below with `aria-invalid` + `aria-describedby`; control border `--border-control` |
| Switch | — | `role="switch"`, `aria-checked`, label + one-line description; green fill when on |
| Checkbox, Radio | — | 20px box, 44px hit area |
| Badge | neutral, success, warning, danger, info, accent | text always present; 12px |
| Count | default (green), danger (red, white text) | nav only |
| Tabs, Segmented control | — | arrow-key navigation |
| Tooltip | — | only for supplementary info; never the only place a fact lives |
| Toast | info, success, error | `role="status"`; auto-dismiss 5s, pauses on hover/focus |
| Banner | warning, danger, info | inline at top of page/panel; `role="alert"` only for new blocking problems |
| Dialog, Drawer, Sheet (mobile) | — | focus trap, `Esc` closes, returns focus |
| Skeleton | line, block, card | shaped like the content |
| Empty state | — | headline (18/600), one sentence, one action |
| Meter | default, warning (≥80%), danger (≥100%) | `role="meter"` with values |
| Avatar | user (initials), agent (badge code) | — |
| Kbd | — | mono 11px |

### 7.2 Domain components
- **AgentListItem**, **ChatMessage** (user / agent / system), **Composer** (with estimate), **ApprovalCard** (+ `ApprovalListRow`, `SequenceStepper`, `EvidenceBlock`, `ClaimHighlight`, `GateFindings`, `RejectSheet`), **ReplyRow** + **SlaChip**, **MeetingRow**, **RoutineRow**, **CapacityMeter**, **HoldBanner**, **ConnectorCard**, **StatTile**, **InviteLinkReveal**, **WorkspaceSwitcher**, **CommandPalette**.

### 7.3 Draft status → label
| API `status` | Label | Badge |
|---|---|---|
| generating | Writing… | neutral + spinner |
| gating | Checking claims… | neutral + spinner |
| blocked | Blocked by gate | danger |
| review | In review | info |
| approved (not `dispatched`) | Approved · sends next window | success |
| approved + `dispatched` | Sent | neutral |
| discarded | Rejected | neutral |
| superseded | Replaced | neutral |

### 7.4 Gate finding → plain English
| `code` | Say |
|---|---|
| unsupported_sentence | This sentence makes a claim with nothing behind it. |
| unsupported_number | This number has no evidence behind it. |
| number_mismatch | A number doesn't match the evidence. |
| no_evidence | A first message must cite at least one verified fact about the prospect. |
| evidence_expired | The evidence is out of date. Refresh it or remove the claim. |
| evidence_not_found / evidence_wrong_contact | The cited evidence isn't about this prospect. |
| fact_missing / claim_malformed | A claim points at evidence that doesn't say it. |
| claim_not_in_body | A cited claim is no longer in the text. |
| revenue_formula_required | Dollar-loss figures need a verified calculation. Remove the figure. |
| implied_prior_contact | Implies you've talked before ("{detail}"). This is a first message. |
| banned_filler | Filler phrase: "{detail}". |
| competitor_named | Names a competitor ({detail}). |
Show the sentence the finding is about (from `detail`) highlighted in the body when it can be matched.

### 7.5 Reply intent → label
| `intent` | Label | Badge |
|---|---|---|
| meeting_request | Meeting request | accent (green fill) |
| positive_inquiry | Interested | success |
| question | Question | info |
| referral | Referral | info |
| objection | Objection | warning |
| out_of_office | Out of office | neutral |
| not_interested | Not interested | neutral |
| wrong_person | Wrong person | neutral |
| unsubscribe | Unsubscribed | danger |
| bounce | Bounced | danger |
| unclassified | Needs a look | neutral |
Plus "Needs a look" whenever `needsHuman` is true (today: always, because the classifier is rules-based).

### 7.6 Other vocabularies
- **Enrollment state:** waiting "Queued", drafting "Drafting", awaiting_approval "Waiting for approval", scheduled "Scheduled", sent "Sent", paused "Paused", snoozed "Snoozed until…", stopped "Stopped · {reason}", converted "Meeting booked", completed "Finished".
- **Stop reasons:** `reply:{intent}` → "Replied ({intent label})", `unsubscribe` → "Unsubscribed", `meeting_booked` → "Meeting booked".
- **Email status:** valid "Verified", unknown "Unverified", risky "Risky", invalid "Invalid". Only Verified can be emailed.
- **Model tier:** flash_lite "Flash-Lite · fastest, cheapest", flash "Flash · default", pro "Pro · best for plans and research".
- **Roles:** admin "Admin: billing, members, settings", operator "Operator: campaigns, leads, approvals", reviewer "Reviewer: approves drafts, reads the inbox", client_viewer "Client: sees results".

### 7.7 Auto-adjust sources (labels)
booked_meetings "Booked meetings" · positive_replies "Positive replies" · objections "Objections" · unsubscribes_bounces "Unsubscribes and bounces" · sops "Your SOPs" · won_lost "Won/lost notes" · draft_edits "Your draft edits" · rejections "Rejection reasons".

---

## 8. Content and voice

### 8.1 Voice
Direct, short sentences, contractions, no filler. Reads like a sharp colleague, not a company. No exclamation marks. No "AI-powered", "magic", "supercharge", "seamless", "unlock". Numbers over adjectives.

### 8.2 Microcopy patterns
- Buttons are verbs: Approve, Reject, Book, Pause sending, Invite. Not "OK", "Submit", "Yes".
- Say what happens next: "Approved. It sends in the next window." / "Paused. Nothing sends from this workspace until an admin resumes it."
- Errors say what happened and what to do, with no blame and no codes up front: "Couldn't load the inbox. Try again." (request id small, for support).
- Empty states teach the next step in one sentence.
- Never "solo" (use "owner"). Never "leads" for people in a reply context (use their name).

### 8.3 Glossary
| Term | Meaning in the UI |
|---|---|
| Workspace | One business (owner) or one client (agency) |
| Agent | A named assistant with a role; drafts and answers, never sends |
| Draft | A message waiting for a person |
| Claims gate | The automatic check that every claim in a draft is backed by evidence |
| Evidence | A fetched snapshot (a page, a review, a job post) with a date and an expiry |
| Sequence / step | The planned messages to one person; step 1 is the first touch |
| Hold / Pause sending | Stops all sends for a scope until an admin resumes |
| Do not contact | Suppression; stored as a fingerprint |
| Trust level | How much runs without a person. Level 1 = a person approves every message |
| Credits | Data (lookups), Action (AI jobs), Media (images/video when enabled) |

---

## 9. White-label (agency accounts)
- Agencies override exactly three tokens: `--brand-fill`, `--brand-fill-hover`, `--brand-on-fill`, plus logo and product name. Everything else stays.
- **Contrast rule:** compute `--brand-on-fill` as #1A1A1A or #FFFFFF, whichever has the higher contrast on `--brand-fill`; if neither reaches 4.5:1, refuse the color in settings with the reason. Links and focus rings stay `--accent-ink` unless the agency color, darkened, reaches 4.5:1 on sand (compute it; don't eyeball it).
- Client-facing surfaces (client viewer, reports, audit pages, notify email templates, unsubscribe page) show the agency's brand only (§2.11).

---

## 10. Accessibility checklist (WCAG 2.2 AA)
- [ ] Text contrast ≥ 4.5:1 (large ≥ 3:1); control boundaries and meaningful graphics ≥ 3:1: use the tokens and it holds.
- [ ] Nothing conveyed by color alone (status = word + color).
- [ ] Full keyboard operation; visible focus (§4.6); logical order; no traps outside dialogs.
- [ ] Landmarks: `banner`, `nav`, `main`, `complementary` (rail, Today); one `h1` per page.
- [ ] Chat log `role="log" aria-live="polite"`; toasts `role="status"`; new blocking errors `role="alert"`.
- [ ] Touch targets ≥ 44×44; swipe actions always have a button equivalent.
- [ ] Text resizes to 200% without loss; layouts reflow at 320px width.
- [ ] `prefers-reduced-motion` and `prefers-reduced-transparency` honored (tokens do most of it).
- [ ] Forms: visible labels, errors tied with `aria-describedby`, no placeholder-only labels.
- [ ] Timeouts: SLA countdowns are informational; nothing expires the user's work.

---

## 11. Wiring notes (for whoever connects the UI)
- **Base URL:** `http://127.0.0.1:8787` in dev; `https://app.omnisdr.com` later. Workspace routes `/v1/o/{orgId}/w/{workspaceId}/…`.
- **Auth:** Firebase/Identity Platform `user.getIdToken()` → `Authorization: Bearer …` on every call. On 401, refresh the token once, then send to sign-in and return.
- **Errors:** `{ error, message, details?, requestId }`. Show `message` (it's written for people); keep `requestId` small for support. 403 → hide the entry point next time (the user's role changed). 409 → reload the item and explain. 429 → "Slow down a little" and retry after a few seconds.
- **Optimistic updates:** OK for Mark handled, routine switches, meeting outcome. **Not** for Approve or Edit: wait for the server (the gate and the approval check are the point).
- **Polling:** Inbox + nav counts every 60s while the tab is visible; Approvals counts on focus. (Live push is later.)
- **Types:** `template/api-types.ts`.
- **Never** call Gmail, Google APIs, or any model from the browser (SPEC §4 browser rule).

---

## 12. Built vs pending (design both; wire only what exists)

| Area | Backend today | Design now as |
|---|---|---|
| Approvals, Inbox (read, handle, book), Meetings, Agents + chat, Routines (CRUD), Capacity, Holds, Suppression, Analytics, Connectors (status), Contacts, ICPs, Campaigns, Settings, Members, Invites, Activity, Sign-up, Workspaces | **Built** (PR #11) | Full fidelity, wired |
| Sending (worker), follow-up sequencer | Pending | Approved state says "sends next window" |
| Gmail/Calendar connect (OAuth), LinkedIn, Shopify/GHL/Whop, MCP | Pending | Card states (§6.10) |
| Onboarding answers storage, knowledge/RAG, competitor research, lead finding | Pending | Composer conversation + "What I know" strip |
| Routine runner, Auto-adjust log, reports/exports, notifications, billing/Stripe | Pending | Screens and states; no dead buttons in prod |
| Draft replies from Inbox, Undo approve, unread markers | Pending | Leave room; hide until built |

---

## 13. Where the prototype breaks the rules (don't carry these over)

| # | In the prototype | Do instead |
|---|---|---|
| 1 | "Send via Gmail" button; browser-side Gmail | Remove (§2.1) |
| 2 | "Opened" columns | Remove (§2.3) |
| 3 | "SOC2 Type II Certified", "99.98% uptime SLA" | Remove (§2.6) |
| 4 | Trust dial toggle in the top bar; "Auto-send over 95 fit" | Read-only Level 1 badge (§2.4) |
| 5 | Editable daily cap 120; "auto-capped at 80/day" | Read-only cap + usage (§2.5) |
| 6 | "Approve all ≥90 fit" | Bulk-approve reviewed drafts only (§6.4) |
| 7 | Every integration "Connected" | Real status from `GET connectors` |
| 8 | Evidence "confidence score" | Source, fetched date, expiry, fact |
| 9 | Unread counts per agent | Hide (not tracked yet) |
| 10 | `native_google_cal` provider | Native / Calendly / Cal.com |
| 11 | Model names ("Gemini 2.5 Flash") | Tier names (§7.6) |
| 12 | Role picker that lets anyone "become" Admin | Role comes from the membership; display only |
| + | 9–11px labels, `#6F7A6E` muted and `#16A34A` green text | 12px floor; `--text-muted`, `--accent-ink` |
| + | Hard-coded hex in components | Tokens only |

---

## 14. Acceptance: done means
- [ ] Every screen in §6 exists at desktop (1440) and phone (390), with loading, empty, error and permission states.
- [ ] Every visual value comes from `tokens.css`; zero raw hex in components (grep for `#` in `className`/styles).
- [ ] Each role (admin, operator, reviewer, client viewer) was walked through against the dev server and sees only what §5.3 allows.
- [ ] The Approvals flow runs end to end on the dev server by keyboard only: open, edit to trigger a block, fix, approve, reject with reason.
- [ ] A meeting request under 30 minutes is visible from Home, the nav badge, and the top of Inbox.
- [ ] No element in §2 or §13 appears anywhere (search the build for "open", "SOC2", "send now", "auto-send", "coming soon").
- [ ] Axe (or Lighthouse accessibility) reports no violations on each screen; manual keyboard pass done.
- [ ] Light theme complete; dark theme renders without contrast failures (proposal, pending approval).
- [ ] Agency white-label: an override color is accepted or refused by the contrast rule; the client viewer shows no Omni-SDR branding.

---

## 15. Sources
- Brand palette (binding): `docs/claude/brand-palette.md`
- Build spec: `docs/claude/SPEC.md` (§1 product, §3 scope, §5 invariants, §7 roles, §8 stations, §12 design)
- Decisions: `docs/claude/DECISIONS.md`
- Backend contract: `docs/claude/API.md`
- Gemini's design-system proposal (PR #2, `docs/mvp/DESIGN.md` on `gemini/design-system`): folded in here: accent ink #166534, dark palette direction, radii, motion, connector states, white-label contrast rule.
- The AI Studio prototype and its audit: `docs/claude/AUDIT-2026-09-29-ai-studio-fleet-console.md`
