# Design references for the console (proposal)

Status: **proposal**, written 2026-10-02 by Claude for Christian. Nothing here is decided until it appears in
`DECISIONS.md`. It records what Omni's console should take from six products Christian named, and what it should
not take. The notes on those products are from the author's knowledge of them, **not checked against the live products
this session**: before quoting a detail as fact, open the product and confirm it.

Omni's constraints decide every borrowing: nothing sends without a person's yes, every claim has a source, no open
tracking, tokens only, and the accent (#A3FFB4) is a fill, never text.

## The one idea from each

| Reference | Take | Leave |
|---|---|---|
| macOS / iOS | Panes that fill the window and scroll on their own; actions in a toolbar that never scrolls away; quiet chrome, content first | Skeuomorphic chrome, translucency stacked on translucency |
| Grok | One composer that is always in reach and changes what it does by mode | Personality as a feature; a feed of everything |
| Muse | A calm canvas where things you collect sit side by side and can be arranged | An infinite board as the main way to work |
| Google Flow | The prompt dock: what you make is the stage, the prompt and Generate stay pinned below it | Film timeline depth for a 6-second clip |
| Google AI Studio | Settings that change the output sit beside it, visible, with cost and model shown before you run | Developer chrome (raw JSON, token counters) as the default view |
| Higgsfield | Presets with a picture of what you get (camera moves, styles) instead of words | Feed of other people's work, credit pressure, upsell banners |

## macOS / iOS

What it does well (from memory):
- **Split views fill the window.** Mail, Notes, Finder: list and detail panes run to the bottom edge, each scrolls by
  itself, and the window never scrolls as a whole.
- **Toolbars are pinned.** The actions for the thing you are looking at stay in one place, top or bottom, whatever
  the scroll position.
- **Sheets and popovers say where they came from.** A sheet slides from its window; a popover points at its control.
- **Edges hint at more.** Scrolling rows fade or cut a tile in half so it is obvious there is more.
- **One accent, used sparingly**, on the default action only; everything else is plain.
- **Keyboard first on Mac, thumb first on iPhone:** every list action has a key; on iPhone the primary actions sit in
  the bottom third.

In Omni:
- *Done before this pass:* one accent for the default action; keyboard shortcuts in every list (j/k, A, E, D, S);
  phone bottom bar for the four main sections.
- *Done in this pass:*
  - Approvals and Inbox panes now fill the window to its bottom edge. Approvals' decision bar (Approve, Edit, Reject,
    Skip) was 45 px below the fold at 1440×900 because its height was set before the section tab row existed.
  - Section tabs on phones fade at the right edge when they scroll ("Settings" was cut with no hint).
- *Proposed next:*
  - Make the section tab row sticky under the top bar, so the section's pages stay one click away on long pages.
  - Inbox reply actions: a bottom toolbar on phones, like Approvals already has.

## Grok

What it does well (from memory):
- **One input does everything.** Chat, image, search and "think harder" are modes of the same composer, not separate
  pages.
- **The composer is always there**, pinned at the bottom, with the current mode shown on it.
- **Answers render progressively** and show their sources inline.

In Omni:
- *Done before this pass:* the Home composer already pairs Ask with tool buttons beside it (agent picker, model, credit estimate), and the claims gate
  shows evidence inline.
- *Proposed next:*
  - The same composer reachable from every page (⌘K already opens the palette; a "?" or `/` could open the composer
    with the page as context, the way "Ask about this" works on a draft).
  - Keep sources inline in agent answers, as in Approvals, never in a footnote list.
- *Leave:* Grok's playful tone. Omni's copy stays plain and factual.

## Muse

What it does well (from memory):
- **A calm, paper-like canvas.** Few colors, generous space, cards that look like the thing they hold.
- **Things you collect sit next to each other** and can be grouped by dragging them together.
- **Zooming into a board is how you go deeper**, so where you are is always visible.

In Omni:
- *Proposed next:*
  - Studio Projects as a board: a project shows its brief, references and results side by side, and dragging a result
    onto a project files it. This is a bigger change; it needs Christian's go and a plan.
  - Use Muse's restraint on Home: one column of what matters, with the agents list and the right rail collapsible.
- *Leave:* an infinite canvas as the main way to work. Sales work is a queue, not a board.

## Google Flow

What it does well (from memory):
- **The result is the stage.** Clips take the screen; the prompt sits in a dock along the bottom.
- **Settings live in the dock as chips** (model, aspect, count), not in a long form above it.
- **Reuse is one click:** a result can become the start of the next prompt or a scene in a sequence.

In Omni:
- *Done before this pass:* Studio Create has scene tiles with pictures, shape and count as segmented controls, and the
  cost before Generate.
- *Done in this pass:* the Create panel is a dock on wide screens. It fills the window, its options scroll inside it,
  and the credits line and Generate stay pinned at its bottom. At 1440×900, Generate was at y≈1010, below the fold.
- *Proposed next:*
  - "Use as start" on a result: opens Create with that result's product, scene and prompt filled in.
  - Shape and count as chips in the dock row itself, so short runs need no scrolling at all.

## Google AI Studio

What it does well (from memory):
- **Run settings are visible beside the output**, in a right-hand panel: model, temperature, tools. Nothing hidden
  behind a menu.
- **The cost of a run is visible before you run it**, and the model you are using is always named.
- **Get the code / share** turns a session into something reusable.

In Omni:
- *Done before this pass:* the model ("Flash") and an action-credit estimate show on the composer before you send;
  media credits show before Generate.
- *Proposed next:*
  - Agent setup (Setup → Agents) as AI Studio's layout: the agent's instructions on the left, its settings (model,
    autonomy, data access, guardrails) in a right panel that stays in view, and a test pane that runs the agent on demo
    data without sending anything.
- *Leave:* raw tokens, temperatures and JSON as the default view. They can live behind "Advanced".

## Higgsfield

What it does well (from memory):
- **Camera moves and styles are presets with a moving preview**, not a parameter list.
- **A strong visual grid of results** with the preset name on each.

In Omni:
- *Done before this pass:* Studio's video mode offers camera moves by name (push in, orbit…), and scene tiles have
  pictures.
- *Proposed next:*
  - Camera-move tiles with a looping preview **that plays only on hover or focus**: the idle gate requires zero
    animation at rest, and reduced motion shows a still frame.
- *Leave:* other people's work as a feed, credit countdowns, upgrade banners. Omni shows credits as a plain number
  and never pushes spend (rails §3.3).

## Rules these notes add (proposal for DESIGN.md)

1. **The main action never scrolls away.** A list-detail page fills the window; a form longer than the window docks
   its submit row.
2. **A cut-off row says it continues** (edge fade or a half-visible tile).
3. **Cost and model show before a run**, never after.
4. **Previews move only when asked** (hover, focus, play). At rest, nothing animates.
5. **One composer, many modes**, before any new page.

## How this pass was checked

- Screenshots of all 11 pages in light and dark at 1440×900, and on a 390 px phone, before and after. They stay in
  the session scratchpad, not the repo.
- The gate suite on the branch; results are in the task report.
