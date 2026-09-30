# Omni SDR suite: UI/UX revision plan v2 (state of the art)

2026-09-29. v1 borrowed the *look and motion* of seven award sites (BrainAI `research/award-site-design-teardown-2026-09-29`). Award sites are marketing pages; none is a tool someone lives in for eight hours. v2 adds the second half of state of the art: how the best work tools *behave*. That means speed, keyboard control, undo, trust in the AI, a live feel, and native behavior on a phone, with every claim checked by a machine gate.

Scope: UI and UX only, on the demo data layer. No backend.

## What exists today (audited 2026-09-29, `apps/console/src`)

| Area | State |
|---|---|
| Built | Command palette (Ctrl K)<br>g-key shortcuts + sheet<br>j/k-style keyboard approve/reject/edit<br>SwipeCard on phone<br>`layoutId` pills (5)<br>one `aria-live`<br>one `vibrate`<br>`manifest.webmanifest` |
| Missing | Undo (0 of the destructive actions)<br>View Transitions<br>Hover prefetch<br>Optimistic updates<br>Service worker / installable shell<br>Live agent activity<br>An autonomy control<br>Provenance ("why did the agent do this")<br>A performance gate on a phone profile<br>Visual regression |

## Constraints that do not bend

- **Brand palette** (`tokens.css`, SPEC §12): sand base, green fill only, `--accent-ink` for green text. Every borrowed idea is re-expressed in it.
- **Text:** minimum 12px.
- **Bundle:** ≤ 260KB gzip (204.3KB now).
- **Libraries:** no new animation library.
- **Fonts:** self-hosted (`font-src 'self'`).
- **Gates:** all 13 current gates keep passing. Phone (390px) is a first-class target.

## The eight pillars

Each pillar has a measurable bar. A phase isn't done until its pillar's gate passes.

| # | Pillar | Bar (gated) | Benchmark |
|---|---|---|---|
| 1 | **Instant** | Every click gets a visible response within 100ms.<br>INP < 150ms on a mid-range-phone profile.<br>Route change < 150ms after warm-up.<br>LCP < 1.5s, CLS 0. | Linear, Superhuman |
| 2 | **Keyboard-complete** | Every action reachable from the keyboard and listed in Ctrl K.<br>A shortcut shown in every tooltip.<br>0 mouse-only controls (gate walks each route by Tab). | Linear, Raycast |
| 3 | **Forgiving** | Every destructive or outbound action has an undo window.<br>No "Are you sure?" dialogs except sign-out-everywhere. | Superhuman undo send, Gmail |
| 4 | **Legible AI** | Every agent output answers three questions on demand: *why*, *from what*, *how sure*.<br>Every agent has an autonomy level you can see and change. | Clico trace, Attio, Cursor |
| 5 | **Alive** | The app visibly changes while you watch (agents acting on a clock), without a refresh.<br>Idle FPS stays 0 when nothing is acting. | Linear live sync, Vercel deploys |
| 6 | **Native on phone** | Installable.<br>Opens standalone with no browser chrome.<br>Swipe, sheets with snap points, haptic ticks, safe areas.<br>Nothing needs a hover. | Things, Arc Search |
| 7 | **Crafted** | v1 phases 0-6: one signature moment, 3 motion speeds, CSS springs, serif titles, gradient-means-acting | Clico, SWSH, Elena |
| 8 | **Proven** | Visual-regression baselines per screen at 1440 and 390.<br>axe AA, reduced motion, idle FPS, INP and bundle all gated, each printing its denominator. | |

## Phases

Order changed from v1: interaction foundations come before visual polish, because polish on a slow or unforgiving app is lipstick.

### Phase 0: Foundation, tokens + gates (S)

From v1 Phase 0:
- **Motion:** tiers `--dur-press 160ms / --dur-move 400ms / --dur-reveal 650ms`, `--ease-expo`, and a CSS `linear()` spring on every control.
- **Type:** Instrument Serif page titles with one italic word; JetBrains Mono 12px caps as the label layer.
- **Color:** the `.ai-live` `@property --angle` green conic gradient, paused by default; warm charcoal dark theme `#1F1E1C`; a global reduced-motion block.

New:
- **Density tokens** `--row-h` (comfortable 44 / compact 36), a toggle in the user menu, and `d` as the shortcut. The phone is always comfortable.
- **New gates in `run-gates.mjs`, each printing its denominator:**

| Gate | Pass condition |
|---|---|
| Idle FPS | 0 on every route after 2s settle |
| Reduced motion | 0 running animations |
| Font budget | ≤ 60KB |
| INP | Median over a scripted 20-interaction run, Chrome CPU 4× throttle + Fast 4G, < 150ms |
| Tab walk | Every interactive element is reachable and has a visible focus ring |
| Visual regression | `pixelmatch` against committed baselines at 1440 and 390 per route. Threshold 0.1%. Baseline updates are explicit (`--update-baselines`), never automatic. |

### Phase 1: Instant + forgiving, the interaction model (M)

| Change | Detail |
|---|---|
| **Optimistic everything** | Approve, reject, edit, book, pause and archive update the UI in the same frame. Demo adapter calls resolve after, and on failure the change rolls back with an error toast. A shared `useMutation` in `lib/hooks.ts` owns this so no screen hand-rolls it. |
| **Undo window** | Approve & send and every destructive action show a toast: "Sent to Dana Kim · **Undo** (Z)" with a 6s draining ring.<br>**How:** the send is queued in the demo store and only commits when the window closes.<br>**Scope:** bulk actions get one undo for the whole batch.<br>**Confirms:** the `confirm()`-style dialogs are removed. |
| **View Transitions** | Route changes and list→detail use `document.startViewTransition` (0KB, native), with `view-transition-name` on the shared card.<br>**Fallback:** browsers without support get an instant swap.<br>**Motion:** reduced motion turns it off. |
| **Hover/focus prefetch** | Nav items and list rows warm the lazy route chunk and its query 80ms after hover or focus. `useQuery` gets a cache with stale-while-revalidate, so going back never shows a skeleton. |
| **Skeletons only on cold load** | Never on revisit. Skeleton shapes match the real layout, so there is no shift (CLS gate stays 0). |
| **Multi-select + bulk bar** | Leads, Inbox and Approvals rows are selectable.<br>**Keys:** `x` toggles, Shift-click selects a range, `Ctrl A` selects all visible.<br>**Bar:** a floating bulk bar with a count ("12 selected · Approve all passing · Reject · Assign").<br>**Safety:** blocked drafts are excluded from bulk approve by construction, and the bar says so ("3 blocked, skipped"). |

### Phase 2: Keyboard-complete (S)

| Change | Detail |
|---|---|
| **Ctrl K v2** | Actions on the current object as well as pages ("Approve this draft", "Pause Scout", "Book with Dana").<br>**Recents** at the top.<br>**Fuzzy search** across leads, meetings and drafts by name.<br>**Agent commands:** "Ask Scout to…" hands the text to the composer. |
| **Contextual shortcut hints** | Every tooltip shows its key. `?` opens a sheet of the shortcuts *for the current screen* first, then the global ones. |
| **Focus management** | After a route change, focus goes to the page `h1`. After an approve, focus goes to the next draft. Sheets return focus to their opener. |
| **Tab-walk gate** | Proves every control is reachable (Phase 0). |

### Phase 3: Home, the signature moment (L)

From v1 Phase 1:
- **Agent-core ring:** arcs are today's pipeline stages, ticks are the 180/day send budget. It draws in once with `pathLength`, and a working agent's arc goes `.ai-live`.
- **Composer:** Clico-style, with `+` attach, an agent picker, mic, and expanding mode chips (Ask · Find leads · Draft · Book · Report).
- **Result split:** the ask on the left, the result building on the right.
- **Phone:** a bento layout.
- **Wins:** ticket-stub cards when a campaign books.

New:

| Change | Detail |
|---|---|
| **"While you were away" briefing** | On the first visit of the day, a card above the ring: "Overnight: Scout found 14, Writer drafted 11 (2 blocked), Replies booked 1." Each number links to its filtered list, and it's dismissed for the day. This is the SDR morning ritual, and it's what makes the product feel like staff rather than software. |
| **Ask about anything** | Every object (lead, draft, meeting, chart) has an "Ask" action (`a`) that opens the composer with the object attached as a chip. Answers come from `brain.ts` using that object's data. |
| **Ghost suggestions** | An empty composer shows one rotating, context-aware suggestion in muted text ("Why was Daniel Kim blocked?"). Tab accepts it. They come from the SUGGESTIONS in `brain.ts`, ranked by what's on screen. |

### Phase 4: Legible AI, trust and control (M)

v1 Phase 2 (AgentTrace, the writing caret, gradient-means-acting, the memory toast), plus:

| Change | Detail |
|---|---|
| **Why / from what / how sure** | Every agent output (draft, reply classification, lead score) has a `?` that opens a popover:<br>**Why:** the rule or signal that fired, e.g. "Reply classified *interested*: matched 'send me times'".<br>**From what:** evidence chips linking to the source record.<br>**How sure:** a 3-step confidence bar (low / medium / high), never a fake percentage.<br>Data comes from what `checkDraft` and `classifyReply` already return. |
| **Autonomy slider per agent** | Levels from BrainAI `references/methodology`: **Suggest → Draft for approval → Send within guardrails → Autopilot**. Shown on the agent card and set in Studio.<br>**Constraint:** the demo caps at "Draft for approval" for outbound. The higher levels render but are locked, with the reason ("Needs a verified sending domain").<br>**Why:** it teaches the model without pretending. |
| **Steer by editing** | After an edited approve, a toast: "Make this a rule? *Never mention pricing in first touch*", with **Save to playbook** or **Just this once**. Saved rules appear in Studio → Guardrails and re-gate open drafts live. The gate already exists; this makes it visible. |
| **Record history tab** | Every lead and draft has a timeline: who (agent or person) did what, when, with what result. It reads from the demo store events. |

### Phase 5: Alive (M)

| Change | Detail |
|---|---|
| **Demo clock** | `demo/store.ts` gets a scheduler. While the tab is visible, agents act every 20-40s:<br>a new lead found, a draft written (and gated), a reply arriving and being classified, occasionally a meeting booked.<br>Each event flows through the existing `invalidate` bus, so every screen updates on its own. The clock pauses when the tab is hidden (`visibilitychange`), and a "Pause demo agents" switch sits in the user menu. |
| **Arrival motion** | New rows slide in at the top with a 650ms green left-edge highlight that fades out. Counts tick with the existing CountUp. The dock badge bumps with a spring. |
| **Live region** | One polite `aria-live` announcer, rate-limited to one message per 10s and summarised ("2 new drafts need you"), so screen-reader users get the same live feel without noise. |
| **Activity rail** | Desktop only: a collapsible right rail on Home listing agent actions as they happen, each with its trace. On phone this is the Home feed. |
| **Idle FPS stays 0** | Animations run only on arrival, then stop. The gate proves it. |

### Phase 6: Approvals (M)

From v1 Phase 3:
- The draft rendered inside a mail-window frame.
- Before/after comparison with a word diff.
- "Sends 1 of 180 today" under Approve.
- Blocked reasons as a mono arrow list.
- A "Start here" sticker on the first approval for new users.
- Clay depth on Approve only.

New:

| Change | Detail |
|---|---|
| **Triage mode** | `Enter` on the Approvals tab opens a focused one-draft-at-a-time view.<br>**Chrome:** the nav hides; keys `A` approve / `R` reject / `E` edit / `S` skip; a progress strip reads "4 of 11".<br>**End:** "Inbox zero" plus the day's stats.<br>**Phone:** this *is* the default. SwipeCard with haptic ticks at the commit threshold and snap-back springs. |
| **Split view on wide screens** | ≥1280px: list left, draft center, evidence and trace right. All three resize with persisted widths. |

### Phase 7: Native on phone (M)

| Change | Detail |
|---|---|
| **Installable PWA** | Complete the existing manifest: icons 192/512/maskable, `display: standalone`, theme colors from tokens, screenshots.<br>**Service worker:** a small hand-written one (no Workbox) that caches the app shell and hashed assets so opening from the home screen is instant.<br>**Auth:** pages still require the session cookie. The service worker never caches `/auth/*` or HTML without a session, so the auth wall is not weakened.<br>**Gates:** "installable" (manifest + SW registered) and "signed-out shell reveals nothing" are both gated. |
| **Sheets with snap points** | Bottom sheets snap at 50% and 92%, drag to dismiss, rubber-band at the edges. motion's `drag` is already bundled. |
| **Pull to refresh** | On Inbox and Approvals, it runs one demo-clock tick. |
| **Haptics** | `navigator.vibrate(8)` at the swipe commit threshold, on approve, and on undo. Android only; iOS ignores it silently. |
| **Floating glass dock** | v1 Phase 4: approvals count badge, `.ai-live` on the active agent, safe-area insets. |
| **Nothing needs hover** | Every hover-revealed action also has a long-press menu on touch. The gate checks that no control's only trigger is `:hover`. |

### Phase 8: Data screens (M)

From v1 Phase 5:
- Metric + denominator cards.
- "est." marks on inferred numbers.
- The tick-scrubber range control.
- Center-out first-paint stagger.
- The Leads list/grid + Sources/Refresh/CSV header.
- Tool-first empty states.
- Status tints.

New:
- **Inline sparklines** in the Leads and Analytics tables: 7-day reply trend per campaign, hand-rolled SVG at 0KB.
- **Funnel as the Analytics hero:** sent → opened (est.) → replied → interested → booked. Each stage shows its count and conversion, and clicking a stage filters the table.
- **Saved views:** filters and sort save as named views in the sidebar ("Hot replies this week"), stored per viewer.

### Phase 9: First run, sign-in, chrome (S)

From v1:
- A 3-step tour with stretched-dot progress, replayable from `?`.
- A one-line color legend.
- The blurred Omni mark behind the sign-in card.
- A one-time headline sweep after sign-in.
- The announcement strip.
- Folder-tab section headers.
- Arrow-in-circle for "open" links.
- Scrolling pill sub-nav on phone.
- The desktop top bar stays put.

New:
- **Empty workspace (Summit Roofing) onboarding checklist:** Connect inbox → Import leads → Set voice → Approve first draft. Each step is a card with a mini UI preview (the ai-dubbing 01/02/03 pattern), and progress persists.

## Explicitly cut

| Cut | Why |
|---|---|
| Scroll-jacking and fixed full-screen sections | |
| Lenis | |
| Particle loaders and audio | |
| All-black palettes | |
| Faux-OS props | |
| Marquees | |
| Neumorphism beyond Approve and the composer | |
| A bottom-docking desktop nav | |
| Any new animation library | |
| Fake confidence percentages | |
| Unlocked "Autopilot" in the demo | It would teach a promise the product can't keep yet |

## Review loop (every phase)

1. `npm run gates`: 13 existing + 6 new gates, each with its denominator. A gate added in a phase gets tested once against a deliberately broken build, to prove it can fail.
2. Visual regression diff reviewed screen by screen at 1440 and 390, with each change checked against the reference it came from.
3. A full flow walked like a customer on production-like `vite preview` with the prod CSP: desktop, phone, keyboard only, reduced motion on.
4. Fix and re-run. The next phase starts only when the pillar bar is met.
5. **Deploy** to suite.omnisdr.com at three checkpoints, each with Christian's go:
   - after Phase 2 (feels instant)
   - after Phase 5 (feels alive)
   - after Phase 9 (complete)

## Order, size, budget

| Phase | Size | Bundle delta (est.) |
|---|---|---|
| 0 Foundation | S | +25KB font (not JS) |
| 1 Instant + forgiving | M | +4KB |
| 2 Keyboard | S | +2KB |
| 3 Home signature | L | +8KB |
| 4 Legible AI | M | +6KB |
| 5 Alive | M | +3KB |
| 6 Approvals | M | +5KB |
| 7 Native phone | M | +3KB (+ a ~2KB service worker, not in the bundle) |
| 8 Data | M | +4KB |
| 9 First run | S | +3KB |

JS lands at about **242KB of 260KB**. If a phase breaks budget, the fix is code-splitting that route, never raising the gate.

## Defaults chosen (override any)

| Default | Alternatives |
|---|---|
| Instrument Serif | Fraunces, Newsreader |
| Warm charcoal dark | |
| Desktop nav fixed | |
| Demo clock on, with a pause switch | |
| Autonomy capped at Draft-for-approval | |
| Undo window 6s | |
