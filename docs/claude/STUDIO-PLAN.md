# Studio: the image and video marketing suite (plan, PROPOSAL)

Status: **proposal** (Rails §3.9). Christian decided what Studio is (DECISIONS 2026-10-01). Everything else here is a proposal until it's recorded in DECISIONS.md.
Owner: Claude. Written 2026-10-01 in the cloud session.

## 1. What Studio is

Studio is where a person makes marketing media:
- product photos, social posts, ads, short video;
- by uploading, generating or editing images and video;
- then sends the result to approval and on to a channel.

It replaces DESIGN.md §6.9, where Studio meant agents, routines and Auto-adjust.

It sits on things that are already decided:
- **The media pipeline** (DECISIONS 2026-09-28, SPEC Station 18): intake, scan, previews, versions, render jobs, metering. All of it gets built.
- **Every generator** (Imagen, Veo, audio, document) has its own per-org flag, **OFF** until Christian turns it on.
- **No dead buttons:** with a flag off, Studio hides the generate action and offers upload or pick-from-library instead.
- **No vendor calls from the browser** (Rails §8): every generation and every paid model call runs on the server.

## 2. Where agents, routines and Auto-adjust go (decision needed)

| Option | What it means | Cost |
|---|---|---|
| **A. A new "Agents" page (recommended)** | Today's Studio moves whole to `/w/:ws/agents` with the same three tabs. Studio's nav slot goes to the media suite. | Small: a route, a nav item, redirects from `studio?tab=routines` and `studio?tab=learning` |
| B. Split up | Agents go to Home's agent rail (edit from the core view), routines go to Settings, Auto-adjust goes to Settings | More moves and more places to look |
| C. Studio holds both | "Media" and "Agents" as tabs inside Studio | Muddies what Studio is |

**Why A:** the agent editor works and passes its gates. Moving it whole keeps Phase 4's "autonomy slider set in Studio" and "Studio → Guardrails" intact; they just read "Agents" instead.

## 3. What we take from the references

Feature summaries come from public reviews and Google's blog. Check them against the products before copying a detail: [VERIFY] https://higgsfield.ai, https://labs.google/flow.

| Reference | Idea | In Studio |
|---|---|---|
| Higgsfield: camera-move presets (dolly, crane, crash zoom, FPV…) as visual tiles, not prompt words | Motion picked from a gallery | A **Motion** picker on video generation: a looping preview tile per move |
| Higgsfield: Marketing studio, where you paste a product URL and get UGC, commercial or cinematic video | Product first | **Product kit**: pick a product (Shopify connector, URL, or upload) and Studio pulls its name, photos and copy. Templates: packshot, lifestyle, UGC-style, ad cut |
| Higgsfield: consistent character and model across images | Reuse | **Ingredients** (below) cover it. No real-person likeness (see §6) |
| Flow: **Ingredients**, reference images locked into a project that every generation inherits | Consistency | Each project holds ingredients: product, brand kit (logo, colors, fonts), style references, a fictional model or character |
| Flow: **Frames to video**, a first and last frame with motion between them | Control | Video generation takes an optional start frame and end frame from the library |
| Flow: **Scenebuilder**, clips in order with Extend and Jump to | Story | A **Sequence** timeline per project: order clips, trim, extend (when the Veo flag is on), add captions |
| Flow: camera, lens and angle controls in the UI | Structure | Video options: aspect (1:1, 4:5, 9:16, 16:9), length, camera, lens |

## 4. Screens

Route `/w/:ws/studio`, one layout with four views:

1. **Create:** a composer in the same style as Home's (prompt, `+` attach, mode chips), with these modes:
   - **Image**, **Product shot**, **Video**, **Edit**, **Social post**;
   - project ingredients shown as chips above the composer;
   - an output grid that fills as results come in;
   - an estimate of credits per run, next to the button.

   With a mode's flag off, that chip is hidden. With every flag off, Create becomes **Upload**: drop files, pick from the library, then edit.
2. **Library:** every asset as a grid.
   - Filters: kind, project, product, status (draft, in review, approved, published) and source (uploaded or generated, with the model).
   - Every asset has versions, and every generated asset keeps its prompt and ingredients ("how it was made").
3. **Projects:** a campaign or product gets a board with its ingredients, assets and sequences.
4. **Editor:** opens an asset.
   - Non-generative tools always work: crop to each channel's size, resize, trim, captions, text overlay, and export.
   - Generative tools appear only with their flag on: background remove or replace, inpaint, outpaint, upscale, extend video, reframe.

**Publish** never posts directly. "Use in a post" creates a content item that goes through Approvals, just like a draft. The claims gate checks the copy and any text on the image. Channel publishing follows SPEC Stations 17 and 18.

**Phone:** Library and Approvals come first. Create works as a single-column composer, and the Editor is limited to crop, trim and captions.

## 5. Data and backend (Claude's lane; needs a migration)

- **`0009_content_assets`** is already specified in SPEC §4: `assets` (versions, kinds including video), `content_items`, `channel_accounts`, `render_jobs`, `audits`. Studio adds:
  - `projects`;
  - `project_ingredients`;
  - `sequences` and their ordered clips;
  - a `generation` record per render job: model, prompt, ingredients, flag and credits.

  Every table gets `org_id` and `workspace_id`, forced RLS and composite FKs (Rails §8), plus tests.
- **Storage:** a bucket per environment, with signed URLs only. Creating it is a cloud change, so it needs Christian's go (Rails §3.2).
- **Render worker:** the `generator` service already listed in SPEC §2.
  - Imagen and Veo run on Vertex [VERIFY model IDs, prices and quotas].
  - Credits are metered per run.
  - Each pipeline has an end-to-end test with its flag forced on.
- **Demo (apps/console):** the demo adapter gets an asset store with seeded fictional products and media. Whether the demo can show generation is decision 3 below.

## 6. Rules specific to media

- **No real-person likeness.** Characters and models are fictional or the customer's own upload with consent. There's no face-swap of a named person.
- **Product truth.** A product shot can't change the product itself (shape, label, color). The editor marks generated regions, and the claims gate checks any text in the image.
- **Disclosure.** Generated media keeps its provenance metadata [VERIFY SynthID / C2PA on Imagen and Veo output]. The library always shows "Generated".
- **Brand safety.** Every generated asset is a draft and goes through Approvals before it's used anywhere.

## 7. Order of work

| Step | What | Needs |
|---|---|---|
| S0 | Move agents, routines and Auto-adjust to Agents (option A), with redirects | Decision 1 |
| S1 | Studio shell, Library and Upload on demo data: grid, filters, asset sheet, versions | — |
| S2 | Editor, non-generative: crop to channel sizes, resize, trim, captions, text overlay | — |
| S3 | Create composer with modes, ingredients, motion presets and frames, hidden per flag | Decision 3 for the demo |
| S4 | Projects and Sequence timeline | — |
| S5 | Backend: migration 0009+, storage, render worker, Imagen pipeline with its test (flag forced on) | Bucket = Christian's go |
| S6 | Veo pipeline, extend video, product kit from Shopify | Shopify connector (Station 20) |

Each step runs the review loop in UI-REVISION-PLAN.md (gates, visual review, a walk-through like a customer). Bundle: Studio is code-split into its own chunk, so the initial-JS gate stays under 260 KB.

## 8. Decisions needed

1. **Where agents, routines and Auto-adjust go:** A (Agents page), B (split up), C (both in Studio). Recommended: A.
2. **Order against the UI revision:** Studio S0–S3 before or after Phase 4 (Legible AI)? Recommended: S0 first (Phase 4 points at Studio), then Phase 4, then S1–S3.
3. **Generation in the demo:** the demo has no vendor and no org flags.
   - (a) Show the Create modes, and "generate" returns seeded sample media labeled **Demo sample**.
   - (b) Hide them exactly as production would with flags off.

   Recommended: (a), so Christian can judge the flow on his phone. Production stays OFF.
4. **Models beyond Google:** Higgsfield's catalog runs other vendors' video models.
   - Start with Imagen and Veo only (Vertex, already in SPEC).
   - Or plan for more models later, each a paid vendor needing Christian's approval (Rails §3.3).

   Recommended: Google only for now.

## 9. Build outcome (2026-10-01, cloud session, `/goal build the studio UI/UX`)

Built on demo data in `apps/console`, using the recommended defaults for decisions 1, 3 and 4 (each still Christian's to confirm):

| Piece | What exists |
|---|---|
| S0 Agents page | `features/agents/AgentsPage.tsx` (the old Studio, unchanged inside), nav item **Agents** (`g t`). `studio?tab=routines|learning|agents` and `studio?new=agent` redirect there; Home's "New agent" points there. |
| Create | Modes Product shot, Image, Social post, Video, each hidden when its flag is off. Project ingredients as chips (tap one to leave it out of a run), product picker, example prompts, scene tiles drawn from the chosen product, 10 camera-move tiles that preview on hover/focus only, a start frame and length for video, shape and count, a credit estimate next to the button (Ctrl Enter generates). With every flag off, Create is Upload. |
| Library | Every asset with review-state tabs and counts, kind, project and text filters; drag-and-drop or picked uploads (images scaled to 1600px and kept on the device; video kept in the tab only). A reviewer lands on "In review". |
| Editor | Full screen. Crop to a channel shape, rotate, flip, brightness/contrast/saturation, headline (two styles, three positions), video trim and captions. Saving makes a new version; v1 is never changed; restore any version. AI tools (remove/replace background, upscale 2x, expand) only with `imageGeneration` on. Review: send for review, approve, or send back with a required note; saving an approved item puts it back to draft. Download exports a PNG at the channel size on the device. |
| Projects | Cards with a 3-up preview; ingredients (brand kit, style, character) editable; a sequence of clips (order, trim, caption) with a player that runs them as one cut; "Create in this project". |
| Demo data | `lib/api/demo/studio.ts`: 4 products, 4 projects, 11 assets across the three workspaces, 600 media credits, renders that finish a moment later. `lib/media.ts` draws every sample as SVG on the device (labeled **Demo sample**); no vendor call. |
| Contract | `Client` gains 16 Studio methods; `types.ts` gains the Studio shapes; `docs/claude/API.md` §7.8 proposes the routes. |
| CSP | `blob:` added to `img-src` and a `media-src 'self' blob:` line, for previewing a picked video. Needs Gemini's audit (Rails §6: CSP is part of the public surface). |
| Gates | Agents added to every route check; 7 Studio flow steps (generate and charge, edit and version, review round-trip, video controls, flag-off path, sequence playback, old links) and a reviewer step. |

Changed from the plan:
- **No "Edit" mode in Create.** Editing starts from an asset (Library, results, project), where there is something to edit.
- **Review stays inside Studio** for now: asset states draft → in review → approved / changes requested, with the `approve` permission. Moving media into the Approvals queue waits on `content_items` (SPEC 0009).
- **Demo generation flags are ON** in the demo seed (world v7), per decision 3 default (a). Production orgs keep every flag OFF.
