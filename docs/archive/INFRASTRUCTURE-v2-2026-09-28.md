# Omni-SDR — Infrastructure Plan

Status: plan v2, 2026-09-28 (adds asset platform, generation, integration fabric, surfaces). Supersedes the infrastructure sections of Gemini's `omni_sdr_master_spec.md`.
What exists today is a client-side mock ([[builds/omni-sdr]]); everything below is to be built.

Items marked **VERIFY** are platform facts from memory that must be confirmed against the vendor's
current docs before a build step depends on them.

---

## 0. The five constraints the original spec skipped

These decide the architecture. Everything else follows from them.

| # | Constraint | Consequence |
|---|---|---|
| 1 | **Gmail read scopes are "restricted."** Detecting replies needs `gmail.readonly` / `gmail.modify` / `gmail.metadata`. A public app using a restricted scope needs Google OAuth verification **plus an annual third-party security assessment (CASA)**. `gmail.send` alone is "sensitive": it needs verification but no assessment. **VERIFY** | Phase the product: an internal Workspace app (Dime Data dogfood, no verification) → a public app with send-only + routed replies → full Gmail read after the assessment. See §4. |
| 2 | **The Places API cannot find "unanswered bad reviews."** It returns a handful of reviews per place, not the full set, and owner replies are not reliably exposed. Maps Platform terms also forbid caching most Places content; `place_id` is the storable exception. **VERIFY** | "Unanswered review" is not a v1 evidence type. Store `place_id` plus a fetch timestamp, and re-fetch review text when rendering an audit page, with Google attribution. |
| 3 | **LinkedIn has no messaging/connection API for this**, and automating it breaks the User Agreement and gets accounts restricted. | Personal-profile invites and DMs are **one-click assisted, never unattended**. Full automation goes through LinkedIn's **sanctioned ad APIs** instead. See §16.4. |
| 4 | **Cold SMS is TCPA exposure.** Marketing texts need prior express written consent, and B2B isn't exempt. Twilio also requires **A2P 10DLC** brand + campaign registration for each sending brand, so each agency tenant is a secondary brand under an ISV registration. **VERIFY** fees and ISV flow | SMS is **post-reply only**: a follow-up after the prospect replied or booked, never a first touch. Ships last. |
| 5 | **Skool has no API**, and scraping community content is a ToS problem that also carries personal data. | Cut from v1. A "paste a post URL + text" manual evidence type covers the real use. |

Two smaller ones:
- **The key in the mock is browser-exposed.** Every model call moves server-side (§3).
- **The spec stores `refreshToken` in plaintext on the Tenant document.** OAuth tokens get envelope-encrypted with KMS and are never readable by client rules (§6).

---

## 1. Platform choice

**Google Cloud, one project per environment (`omni-sdr-dev`, `omni-sdr-prod`).** The spec says
Google-native, and one piece is Google-only regardless: Gmail push notifications arrive via
Pub/Sub. Keeping the rest on GCP avoids a cross-cloud hop on the hot path.

**Decided 2026-09-28: Google-native inside, open at every edge.** Everything inside the product
(compute, data, AI, media, orchestration) is Google Cloud. Everything that crosses the boundary
(calendars, CRMs, sales platforms, media outlets, storage, chat) goes through one connector layer
(§13), so no internal service ever imports a vendor SDK. This is a new stack for Dime Data; the
Hetzner box + Supabase ([[context/stack]]) stay where they are and connect in as just another
integration ([[builds/crm]] already exposes `/mcp`).

| Concern | Service |
|---|---|
| Web app + API | **Cloud Run** service `web` (Next.js standalone build, `min-instances=0` in dev, 1 in prod) |
| Background workers | **Cloud Run** service `worker` (same image, different entrypoint), invoked only by Tasks/Pub/Sub, `--no-allow-unauthenticated` |
| Database | **Firestore** (Native mode), one region |
| Auth | **Identity Platform** (Firebase Auth), Google sign-in + email link |
| Scheduled work | **Cloud Scheduler** → Pub/Sub → `worker` |
| Per-send jobs | **Cloud Tasks**, one queue per channel, `scheduleTime` for human-paced sends |
| Inbound mail events | **Pub/Sub** topic `gmail-push` (Gmail `users.watch`) |
| Secrets | **Secret Manager** (app secrets) + **Cloud KMS** (tenant OAuth token encryption) |
| LLM | **Vertex AI Gemini** via service account, not an AI Studio key: no key to leak, no free-tier cap (free tier = 20 requests/day), regional data handling |
| Files of every kind | **Cloud Storage** (`quarantine` → `assets` → `derivatives` buckets, object versioning on), served through Cloud CDN with signed URLs (§11) |
| Multi-step pipelines | **Workflows** (intake chains, video renders, report builds) + **Cloud Run jobs** for anything long (ffmpeg, LibreOffice, Remotion, headless Chrome) |
| Event bus | **Eventarc** (GCS object-finalize → intake) + **Pub/Sub** topic `domain-events` (every state change, fanned out to connectors) |
| Understanding files | **Gemini** multimodal (PDF, image, audio, video), **Document AI** (OCR, forms, tables), **Speech-to-Text Chirp** (transcripts), **Video Intelligence** (shots, labels), **Sensitive Data Protection** (PII scan) |
| Generating media | **Imagen** (images + mask edits), **Veo** (video clips), **Text-to-Speech** (voiceover), Gemini (scripts, reports, copy) — all on Vertex AI (§12) |
| Knowledge + RAG | **Cloud SQL for PostgreSQL** (pgvector + full-text, row-level security per tenant) as the retrieval index; **Vertex embeddings** (text + multimodal) and the **Vertex ranking API** for reranking. Firestore stays the system of record, and the index is derived and rebuildable (§17) |
| Public API + integrations | **API Gateway** (OpenAPI, tenant API keys), connector workers on Cloud Run, optional **Application Integration** for enterprise systems (§13) |
| Push notifications | **Firebase Cloud Messaging** (PWA + mobile) |
| Logs / errors | Cloud Logging + Error Reporting; one structured `send_audit` log stream (§7) |
| IaC | **Terraform** in `infra/`, one workspace per env |
| CI/CD | GitHub Actions → Artifact Registry → `gcloud run deploy`, via Workload Identity Federation (no JSON keys) |

---

## 2. Service topology

```
                    ┌──────────── Identity Platform (tenant users)
                    │
 browser ──HTTPS──▶ web (Cloud Run, Next.js)
                    │   • dashboard, approval queue, settings
                    │   • /audit/[slug]  (public, noindex)
                    │   • /u/[token]     (one-click unsubscribe, public)
                    │   • /api/*         (server actions — ALL model + DB writes)
                    │
                    ├──▶ Firestore
                    ├──▶ Vertex AI Gemini
                    └──▶ Cloud Tasks ──▶ worker (Cloud Run, private)
                                           ├─ enrich.lead      (website teardown, Places, verify email)
                                           ├─ draft.generate   (Gemini → claims gate)
                                           ├─ send.email       (Gmail API, per-inbox token bucket)
                                           ├─ send.sms         (Twilio, post-reply only)
                                           └─ reply.classify   (Gemini → state machine)

 Cloud Scheduler ─▶ Pub/Sub ─▶ worker: cadence.tick (every 5 min), gmail.rewatch (daily),
                                      breaker.evaluate (every 15 min), places.refresh (daily)

 Gmail ─users.watch─▶ Pub/Sub gmail-push ─▶ worker: history.sync ─▶ reply.classify
 Twilio ─webhook─▶ web /api/twilio/inbound (signature-verified) ─▶ Tasks ─▶ reply.classify
```

Rule: **the browser never talks to Gemini, Gmail, Twilio or Places.** It reads its tenant's
Firestore data through security rules and writes through server actions only.

---

## 3. Data model (Firestore)

Tenant isolation lives in the **path**, not a field, so a missing `where` clause can't cross tenants.

```
tenants/{tenantId}
  ├─ members/{uid}                role: owner|admin|reviewer
  ├─ inboxes/{inboxId}            connected Gmail account, daily cap, warmup stage, health
  ├─ campaigns/{campaignId}
  ├─ leads/{leadId}
  │    ├─ evidence/{anchorId}     immutable once written (see §5)
  │    ├─ drafts/{draftId}        body, channel, anchor refs, gate result, status
  │    └─ events/{eventId}        append-only: enriched, drafted, approved, sent, opened, replied, booked
  ├─ audits/{slug}                public projection only — no PII beyond business name
  ├─ suppression/{hash}           sha256(lowercased email | E.164 phone)
  └─ usage/{yyyy-mm}              sends, model tokens, Places calls — billing + caps
secrets live elsewhere:
oauth_tokens/{tenantId}_{inboxId} ciphertext (KMS-wrapped DEK), server-only, rules deny all
global_suppression/{hash}        hard bounces + complaints across all tenants
```

Security rules: members read their own `tenants/{t}/**`; **all client writes denied** except
draft approve/edit/discard, which go through a server action anyway. `oauth_tokens` and
`global_suppression` deny all client access.

Composite indexes: `leads(campaignId, status, nextActionAt)`, `drafts(status, createdAt)`.

---

## 4. Email: the channel that has to be right

### 4.1 Sending path

1. `cadence.tick` finds leads whose `nextActionAt <= now` and whose draft is `approved`
   (or auto-approved at Trust Dial 2/3, §6).
2. For each, it enqueues `send.email` in Cloud Tasks with
   **task name = `send-{leadId}-{step}`**. Cloud Tasks de-duplicates by name, so a retried
   tick can't double-send.
3. `send.email` then, in order:
   - checks `global_suppression` + tenant `suppression` → stop
   - checks the **tenant hold** and **inbox breaker** (§6) → stop
   - takes a token from the inbox's daily bucket in a Firestore transaction (default 30/day,
     ramped during warmup) → if empty, re-enqueue for tomorrow's window
   - re-runs the claims gate on the exact rendered body (the draft may have been edited)
   - sends via `gmail.users.messages.send` with `List-Unsubscribe` +
     `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, the tenant's physical mailing address
     in the footer (CAN-SPAM), and the thread headers for step ≥ 2
   - writes a `sent` event + a `send_audit` log line holding the full rendered body and anchor ids
4. Randomized send times inside the tenant's business hours in the **prospect's** time zone,
   derived from Places/address. Scheduling is done in UTC instants.

### 4.2 Before the first touch: verify the address

Dime Data's own outbound is at **12.5% bounce** right now, and was 5.58% in August, both inside
or above the throttling band ([[builds/outbound-funnel]]). `enrich.lead` runs every new address
through an email-verification API and drops anything but `valid`. A burned tenant inbox is the
fastest way to lose a customer.

### 4.3 Reply detection, three stages

| Stage | Who | Scopes | How replies are seen |
|---|---|---|---|
| **A. Dogfood** | Dime Data only | Internal Workspace OAuth app: all scopes, no Google verification | `users.watch` → Pub/Sub → `history.list` |
| **B. Public, pre-assessment** | Paying tenants | `gmail.send` + `userinfo.email` (sensitive → verification, no CASA) | `Reply-To: r+{leadToken}@reply.omnisdr.com` via an inbound mail route (Cloudflare Email Routing → Worker → `web /api/inbound`), forwarded on to the tenant's real inbox so they still see it |
| **C. Public, assessed** | Paying tenants | + `gmail.modify` (restricted → CASA annually) | Same as A. Replies stay native in the tenant's inbox |

Stage B is the unlock. It ships a sellable product without waiting on a security assessment.
The trade-off is honest: replies land in our route first. That route needs its own domain and
never touches `dimedata.cloud` MX or SPF.

`gmail.rewatch` runs daily because a Gmail watch expires after 7 days. **VERIFY**

### 4.4 Domains and deliverability

- Tenants send from **secondary domains** (e.g. `getacme.com`, never `acme.com`), with SPF, DKIM
  and DMARC checked at inbox-connect time. Connect fails with the missing record named, instead
  of a silent warning.
- The warmup ramp lives in `inboxes/{id}.warmupStage`: the day-N cap is a table, not a formula
  someone edits.
- Omni-SDR sends must **never** draw from the Dime Data company send budget (900/mo in
  [[context/loops]]). Separate domains, separate reputation.

---

## 5. Evidence + Claims Gate v2

The mock's gate passes any copy that shares one 5+ letter word with the evidence. The replacement:

**Evidence anchors are immutable snapshots.**
```ts
EvidenceAnchor {
  id, type: 'website_gap' | 'places_rating' | 'hiring_signal' | 'manual',
  sourceUrl, fetchedAt,
  snapshotSha256,          // hash of the raw fetched bytes, stored in GCS for 90 days
  facts: { key: string; value: string | number; span?: string }[],  // extracted, typed
  // Places-derived: store placeId + fields allowed by Maps ToS only; re-fetch to display
}
```

**Generation is structured.** Gemini returns JSON with `body` plus `claims[]`, each
`{ text, anchorId, factKey }`.

**The gate is deterministic and fails closed:**
1. every `claims[].anchorId` exists on this lead and is < 30 days old
2. every `factKey` exists on that anchor, and any number in `claims[].text` equals the fact's value
3. every sentence in `body` containing a digit, a `$`, or a superlative maps to a claim
4. banned-phrase list (kept from the mock) + no competitor names
5. **revenue-loss numbers never come from the model.** They come from a named formula with its
   inputs shown on the audit page, or they don't appear

Sabotage-test the gate the way [[builds/halo-agent]]'s was: seed known-bad drafts and assert each
one is refused. Check the denominator too: a suite that reports "0 refused of 0" means nothing
().

**Evidence sources, v1:**
- **Website teardown:** port `leadgen/starter.js` from [[builds/leadgen]]. It already does browser-UA
  reads, parked-domain detection and `null`-not-`false` for unseen signals. Don't rewrite it.
- **Places:** rating, review count, hours, website presence, `business_status`. No review text stored.
- **Hiring signal:** a careers page or job-board listing URL, fetched and snapshotted.
- **Storefront signal:** detects the platform (Shopify, WooCommerce, BigCommerce, Wix, Squarespace)
  from the served page, then records public, observable gaps: no product reviews, no email
  capture, slow mobile product page, missing structured product data, out-of-stock bestsellers.
  Only what a visitor can see; never anything behind a login.
- **Manual:** a human pastes a URL + quote, and it's marked `manual` on the audit page.

---

## 6. Autonomy controls (Trust Dial, server-side)

The mock's dial is a React state. It has to be enforced where the send happens.

| Level | Enforced in `send.email` |
|---|---|
| 1 Manual | Draft must have `approvedBy` (a member uid) + `approvedAt` |
| 2 Guarded | Auto-approve only if the gate passed with 0 warnings, the lead has ≥ 2 anchors, the inbox is past warmup, and the tenant has ≥ 50 manually approved sends with < 2% bounce |
| 3 Full | Level 2 conditions + tenant owner re-confirmed within 30 days; each Level 3 tenant gets a weekly sample of 10 sent emails to review |

**Circuit breakers** (`breaker.evaluate`, every 15 min, per inbox and per tenant):
- hard bounce > 3% over the last 50 sends → pause the inbox
- any spam complaint → pause the inbox, drop the tenant to Level 1
- reply-classified `UNSUBSCRIBE_NEGATIVE` rate > 5% over the last 100 → pause the campaign
- a pause is a **document at `tenants/{t}.hold`** that every dispatcher reads, not an in-memory
  flag. Only a human clears it.

---

## 7. Reply triage + booking

- `reply.classify` → Gemini (Flash) with a fixed label set and `responseSchema`. Anything below
  0.8 confidence goes to the human queue as `NEEDS_REVIEW`. There's no sixth label for the model to invent.
- `UNSUBSCRIBE_NEGATIVE` writes suppression **before** anything else runs. It's idempotent, and
  a crash after this step still leaves the person suppressed.
- Auto-replies to objections are **drafts at every Trust Dial level**. A model arguing price with
  a human who replied is the highest-cost mistake in the system.
- **Booking v1 = Google Calendar appointment-schedule link** embedded on the audit page and in
  replies. It needs no Calendar scope and no verification. v2 moves to `calendar.events` + freebusy
  when tenants ask for in-page slots.

---

## 8. Public audit pages

- Slug = `{business-slug}-{8 random base32 chars}`. Unguessable, so pages can't be enumerated.
- `noindex`, `X-Robots-Tag: noindex`, no business contact PII, and auto-expire after 60 days
  (the page then shows "this audit has expired, request a fresh one").
- Rendered statically from `audits/{slug}` + a live Places re-fetch (cached ≤ the ToS window),
  with Google attribution where Places data shows.
- Views write an `audit_viewed` event. This is the best buying signal in the system, so it
  bumps the lead in the queue. Bots are filtered by UA + a JS beacon.
- Custom domain per tenant later (`audit.agency.com`) via Cloud Run domain mapping.

---

## 9. Security + compliance

- OAuth refresh tokens: a per-tenant DEK encrypts them, KMS wraps the DEK, and only the
  `worker` service account has `cloudkms.cryptoKeyDecrypter`. `web` can't decrypt tokens.
- Service accounts: `web-sa` (Firestore user, Tasks enqueuer, Vertex user), `worker-sa`
  (+ KMS decrypt, Secret access). No owner/editor roles anywhere.
- Twilio + inbound-mail webhooks: signature-verified, rejected otherwise.
- Data deletion: a tenant delete is a `worker` job that walks `tenants/{t}/**` + `oauth_tokens`
  and revokes the Google grant.
- Documents to write before Stage B: privacy policy + ToS + a **Google API Limited Use**
  disclosure (Google requires it for verification). **VERIFY**
- Consent log: every SMS number carries the event that established consent (reply / booking /
  form). No event means no send.

---

## 10. Billing + metering

Stripe, reusing the account already configured.
`usage/{yyyy-mm}` counts sends, Gemini tokens and Places calls. Plan caps are enforced in
`send.email` and `enrich.lead`, not the UI. Plans cap **connected inboxes** and **sends/month**,
the two numbers that actually drive cost and risk.

---

## 11. Asset platform: intake, storage and editing of any file

Every file in the system, whether uploaded, emailed in, pulled from a connector, or generated, is
an **asset**. The SDR features (evidence, audits, outreach attachments, social posts) are
consumers of the asset layer, not owners of their own files.

### 11.1 Asset model
```
tenants/{t}/assets/{assetId}
  kind: document | image | video | audio | spreadsheet | slides | archive | other
  mime, sizeBytes, sha256, originalName
  source: { via: upload | email | connector | generated, connectorId?, externalId?, model?, prompt? }
  versions/{n}      gcsUri, createdBy, createdAt, note        ← every edit is a new version
  derivatives:      thumb, preview.pdf, poster.jpg, hls/, transcript.vtt, text.md, ocr.json
  understanding:    summary, entities[], labels[], pii: none|found|redacted
  (no vector on the asset doc; chunks + embeddings live in the RAG index, §17)
  links:            leadIds[], campaignIds[], derivedFrom: assetId@version
```
`derivedFrom` gives lineage: a report knows which transcripts and screenshots it was built from,
and a video cut knows its source clips. Generated assets record the model + prompt, and Imagen/Veo
output carries Google's SynthID watermark. **VERIFY** current SynthID coverage.

### 11.2 Intake pipeline (one path for every source)
```
upload (resumable signed URL) ┐
email → intake+{tenant}@…     ├─▶ gs://quarantine ─Eventarc─▶ Workflow "intake"
connector pull (Drive, Dropbox, CRM files, social media) ┘
   1. sniff type from magic bytes (never the extension); reject off-allowlist
   2. malware scan: ClamAV on Cloud Run (Google's published GCS-scan pattern; GCP has no native AV)
   3. move to gs://assets, write asset doc
   4. fan out by kind:
        document → Document AI OCR/layout → text.md; LibreOffice job → preview.pdf
        image    → thumbnails; Gemini caption + labels
        video    → Transcoder API → HLS + poster; Chirp transcript; Video Intelligence shots
        audio    → Chirp transcript + diarization
        sheet    → parse to typed tables (feeds CSV lead import)
   5. Sensitive Data Protection scan → flag or redact
   6. hand off to the RAG indexer (§17); emit asset.ready on domain-events
```
Size caps per plan; anything above 5 GB goes through resumable upload only.

### 11.3 Editing
| Kind | Editor | Storage behaviour |
|---|---|---|
| Documents / reports | In-app rich editor (TipTap) with "Open in Google Docs" round-trip via the Docs API (`drive.file` scope, **VERIFY** its classification) | Each save = new version; exports to DOCX / PDF / MD |
| Spreadsheets | "Open in Google Sheets" round-trip; in-app grid for lead lists | Same |
| Slides / decks | Generated as Google Slides via the Slides API; PPTX export | Same |
| Images | Canvas editor (crop, text, brand overlay) + **Imagen mask edit** (inpaint, outpaint, background swap) | Edit → new version; the mask is stored with it |
| Video | Timeline editor on **Remotion Player** over a JSON composition (clips, captions, VO, brand kit); renders on a Cloud Run job | The composition is the source of truth; renders are derivatives. **VERIFY** Remotion's company-license terms before selling |
| Audio | Trim + TTS regenerate of a line | Same |

---

## 12. Generation

One `generate` API, with each output kind a Workflow. Every generation is a metered job with a
status the UI subscribes to, never a request held open for minutes.

| Output | Pipeline | Grounding |
|---|---|---|
| **Report / audit** (PDF, DOCX, Google Doc) | Gemini writes a section-by-section JSON → HTML template → headless Chrome PDF, and/or Docs API doc | Every figure goes through the §5 claims gate; numbers come from anchors, never from the model |
| **Proposal / one-pager** | Same engine, proposal template, brand kit per tenant | Same |
| **Deck** | Gemini outline → Slides API from the tenant's master template | Same |
| **Image** (social, ad, thumbnail, audit hero) | Imagen with the tenant brand kit (palette, logo overlay done in code, not by the model) | Text in images is rendered as an overlay layer, not generated, so it's always spelled right |
| **Short video** (teardown walkthrough, social clip) | Gemini script → TTS voiceover → screenshots/screen-capture of the prospect's site (headless Chrome) + optional Veo b-roll → Remotion composition → render job → Transcoder renditions | The script is gated like copy; claims on screen must map to anchors |
| **Personalized video at scale** | One template composition × N leads, fan-out render jobs | Cost cap per campaign, enforced before enqueue |
| **Social posts / threads / carousels** | Gemini + Imagen, from aggregated campaign findings | Same gate; published via §13 connectors |
| **Spreadsheets / exports** | Typed data → XLSX / CSV / Google Sheet | — |

**Cost control is part of the infrastructure, not the pricing page.** Veo and Imagen are billed
per output, so every generation reserves credits from `usage/{yyyy-mm}` in a transaction before
the job starts and refunds on failure. A campaign can't enqueue 500 personalized videos past its
cap. **VERIFY** current Veo/Imagen per-unit pricing before setting plan limits.

---

## 13. Integration fabric: calendars, CRMs, sales platforms, media outlets, everything else

### 13.1 One connector contract
Every external system is a **connector** implementing the same interface, deployed as its own
Cloud Run service (`connector-hubspot`, `connector-calendly` …), so one vendor's outage or rate
limit never touches another:

```ts
Connector {
  id, auth: 'oauth2' | 'apiKey' | 'basic' | 'none',
  scopes[], rateLimit: { perSecond, perDay },
  triggers:  { event, mode: 'webhook' | 'poll', schedule? }[]     // outside → in
  actions:   { name, inputSchema, outputSchema, idempotent }[]   // in → outside
  sync?:     { objects: ('contact'|'company'|'deal'|'event'|'file')[], direction: 'in'|'out'|'both' }
  mapping:   default field map, overridable per tenant
}
```
Credentials use the same KMS envelope as Gmail tokens (§9). Token refresh, retries (Cloud Tasks,
exponential backoff), rate limiting and field mapping are shared code. A new connector is mostly a
mapping file plus its API calls.

### 13.2 Two directions, one bus
- **Out:** every internal state change publishes to Pub/Sub `domain-events`
  (`lead.created`, `lead.enriched`, `draft.approved`, `email.sent`, `reply.received`,
  `meeting.booked`, `asset.ready`, `report.generated`, `post.published` …). Each enabled connector
  subscribes to the events its tenant mapped. Delivery is at-least-once, so actions are idempotent
  by `eventId`.
- **In:** webhooks land on `web /hooks/{connector}/{tenant}` and are signature-verified per vendor,
  then enqueued. Vendors without webhooks are polled on Cloud Scheduler with a stored cursor.
  Inbound objects are **upserted by `(connector, externalId)`**, so a re-delivered webhook can't
  duplicate a lead.
- **Sync conflicts:** last-writer-wins per field with a per-field "system of record" flag set by the
  tenant (e.g. "deal stage is owned by HubSpot, evidence is owned by Omni-SDR"). Conflicts log an
  `sync.conflict` event rather than failing silently.

### 13.3 Three tiers of reach
| Tier | What | Covers |
|---|---|---|
| **1. Native connectors** | Built and maintained here: two-way sync, UI settings, field mapping | The systems agencies live in (table below) |
| **2. Open API + webhooks + MCP** | Public REST API (OpenAPI 3.1, API Gateway, per-tenant keys + OAuth for apps), signed outbound webhooks (HMAC-SHA256, timestamped), and an **MCP server** at `/mcp` | Any developer, Claude, ChatGPT, HALO Agent ([[builds/halo-agent]]) — same pattern as the CRM's `/mcp` |
| **3. Automation marketplaces** | Zapier, Make and n8n apps built on tier 2 | The long tail (thousands of apps) without building each |
| *Enterprise option* | Google **Application Integration** / Integration Connectors for Salesforce, ServiceNow, SAP, databases | Only when a paying customer needs it; it's priced per connection. **VERIFY** |

### 13.4 Native connector roadmap (tier 1)
| Category | Connectors, in build order | Used for |
|---|---|---|
| **Calendars / booking** | Google Calendar, Microsoft Outlook Calendar (Graph), Calendly, Cal.com | Availability, booked meetings → `meeting.booked`, auto-stop sequences |
| **CRMs** | HubSpot, GoHighLevel, Salesforce, Pipedrive, Zoho CRM, Close, Dime Data CRM (via its `/mcp`) | Two-way contacts/companies/deals; push evidence + audit links onto the record; pull existing lists to avoid re-prospecting customers |
| **Sales engagement / sending** | Gmail (§4), **Microsoft 365 Outlook (Graph `Mail.Send`)**, Instantly, Smartlead, Apollo sequences | Many agencies already own warmed inboxes elsewhere. Omni-SDR can hand the approved draft to their sender instead of sending itself |
| **Enrichment / data** | Apollo, Clay, Hunter, an email-verification API, Google Places | Contacts + verification before first touch |
| **Media outlets / publishing** | LinkedIn company pages, X, Facebook + Instagram (Meta Graph), YouTube, TikTok, Google Business Profile posts | Publish generated social content + video; pull engagement back as `post.metrics` |
| **Storage** | Google Drive, Dropbox, OneDrive/SharePoint, Box | Two-way asset sync into §11 intake |
| **Team chat / approvals** | Slack, Google Chat, Microsoft Teams | Approval cards (approve / edit / discard) + reply alerts |
| **Meetings** | Google Meet, Zoom | Recording → transcript → call notes + follow-up draft |
| **Commerce / storefronts** | **Shopify** (first), WooCommerce, BigCommerce, Square, Wix, Squarespace; Amazon Seller Central + Etsy later | See §13.6. Push generated product images/video into product media, sync customers + orders for tenants selling wholesale/B2B, and trigger outreach off store events |
| **Payments / billing** | Stripe, Square, PayPal | Deal won → invoice; own subscription billing (§10) |
| **Forms / inbound** | Typeform, Tally, Google Forms, website form webhook | Inbound lead → enrich → route |

**Platform reality per outlet** (**VERIFY** each before building): Meta, TikTok, YouTube and
LinkedIn publishing APIs each require an app review and business verification of their own, and
LinkedIn's posting API covers company pages, not personal profiles (personal profiles fall under the
§0 draft-only rule). Budget weeks per outlet for approval, not days.

### 13.5 Integration admin
Per tenant: a connections page showing status, last sync, error count and scopes held; one-click
reconnect; a per-connector event log (last 1,000 deliveries with payload + response) so "why
didn't my HubSpot update" is answerable without us.

### 13.6 Commerce platforms (Shopify first)

Shopify plays three roles, and the architecture treats them separately:

| Role | What it means | How |
|---|---|---|
| **1. Prospects are stores** | Shopify merchants as the target list | Storefront evidence (§5), from public pages only. Store detection is a fingerprint, not an API call |
| **2. Tenants run stores** | A tenant connects their own Shopify store | Connector: products, collections, customers, orders, draft orders, discounts, files. Actions: upload generated images/video to product media, create a draft order or discount code from a won reply, tag a customer. Triggers: `orders/create`, `customers/create`, `checkouts/update`, `products/update` webhooks → `domain-events` |
| **3. Distribution** | Omni-SDR listed in the Shopify App Store | Public app with embedded admin UI (App Bridge + Polaris) and Shopify Billing API for charges made inside Shopify |

**Shopify build rules (VERIFY each against the current Shopify docs before P6):**
- The Admin **GraphQL** API only; new public apps can't be built on REST. Bulk operations for full syncs, not paginated loops.
- The three **mandatory privacy webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`) are required for a public app, and wired to the §9 deletion job.
- **Protected customer data** (names, emails, addresses) requires Shopify's approval per field, and the request has to justify each field. Ask only for what the enabled features use.
- Webhook HMAC verified on every delivery; the `app/uninstalled` webhook revokes tokens and triggers deletion.
- App review is its own queue. Submit once P6 is feature-complete, not before.

**The other commerce connectors reuse the same mapping.** Products, customers and orders get
normalized into one internal `commerce` shape, so WooCommerce (REST + webhooks), BigCommerce,
Square, Wix and Squarespace are field maps against it, not new features.

---

## 14. Omnipresence: every surface a user already works in

Same backend, same approve endpoint, same Trust Dial. A surface is only a new client.

| Surface | Built on | Does |
|---|---|---|
| **Web app (PWA)** | Next.js on Cloud Run, installable, offline queue, FCM push | Everything |
| **Mobile** | The PWA first; Capacitor wrapper for app stores once usage justifies it | Swipe approval queue, reply alerts, voice-note intake |
| **Gmail / Calendar / Drive side panel** | Google Workspace Add-on (HTTP runtime on Cloud Run) | Lead dossier + evidence beside any email; draft reply; save attachment as asset |
| **Outlook side panel** | Office Add-in | Same as Gmail |
| **Chrome extension** | Manifest V3 side panel | Capture any website / LinkedIn profile as a lead + evidence snapshot; insert an approved LinkedIn draft into the composer (human clicks send) |
| **Slack / Google Chat / Teams** | Chat apps with interactive cards | Approve / edit / discard drafts; "/omni audit acme.com" |
| **Email-in** | `intake+{tenant}@` route | Forward anything (a lead, a PDF, a recording) and it becomes an asset or a lead |
| **AI assistants** | MCP server (§13.3) | Claude, ChatGPT, HALO Agent run Omni-SDR as a tool |
| **API** | §13.3 tier 2 | Anything else |

Auth is the same everywhere: Identity Platform sessions for first-party surfaces, OAuth 2.1
(PKCE) for add-ons, extensions and MCP clients, and scoped API keys for server-to-server. Approval
actions from chat/email carry a **single-use signed action token** bound to the draft version, so
approving from Slack an outdated draft that was since edited is refused.

---

## 15. Build order

Each phase ends with something a real account exercises end to end, not "routes return 200."
The scope above is roughly three times the original spec. Order it by what earns money soonest:
reports and images sell audits this month, while video and outlet publishing take app reviews
measured in weeks.

| Phase | Ships | Done when |
|---|---|---|
| **P0 Foundations** | Terraform, two GCP projects, Cloud Run `web`+`worker`, Identity Platform, Firestore + rules, CI via WIF, all Gemini calls server-side, mock data behind `?demo=1` only, `domain-events` bus | A new user signs up, lands in an empty tenant, and a rules test proves tenant A can't read tenant B |
| **P1 Asset core** | §11 intake pipeline (upload + email-in), quarantine + scan, documents/images/sheets understanding, versions, search | 20 mixed real files (PDF, DOCX, JPG, XLSX, MP4, M4A) each reach `asset.ready` with a text derivative; a test EICAR file is quarantined |
| **P2 Evidence + gate** | `enrich.lead` with ported `starter.js`, Places (placeId-only), email verification, CSV/Sheet import, Claims Gate v2 + sabotage suite | 50 real Nashville businesses enriched; the sabotage suite refuses 100% of seeded bad drafts, with the denominator printed |
| **P3 Reports + images** | §12 report/audit/proposal/deck generation, Imagen with brand kit, doc + image editors, `/audit/[slug]` | A generated audit PDF + Google Doc for a real prospect has every figure traced to an anchor |
| **P4 Email (Stage A) + calendars** | Internal Workspace app, `send.email`, suppression, unsubscribe, breakers, `users.watch`; Google Calendar + Calendly connectors | Dime Data sends 100 real emails from a secondary domain; a booked Calendly meeting stops the sequence |
| **P5 Replies + CRM + chat** | `reply.classify`, human queue; HubSpot, GoHighLevel, Dime Data CRM connectors; Slack/Google Chat approvals | A real reply is classified in < 2 min and appears on the HubSpot contact |
| **P6 Open edges + Shopify** | Public API + webhooks + MCP server; Zapier app; Chrome extension; Gmail add-on; Shopify connector (dev store) + storefront evidence | An outside Zap creates a lead and receives `report.generated`; a generated product image lands in a dev store's product media; the privacy webhooks delete data end to end |
| **P6b Shopify App Store** | Embedded admin app, Billing API, protected-data approval, app review | Listing approved |
| **P7 Public (Stage B)** | OAuth verification for `gmail.send`, Reply-To routing, Outlook sending, Stripe, legal pages | First external tenant connects an inbox and sends |
| **P8 Video** | Transcoder + Chirp intake, Remotion timeline editor, teardown-video pipeline, Veo b-roll, per-campaign cost caps | A 60-second teardown video renders for a real prospect with every on-screen claim gated |
| **P9 Media outlets** | LinkedIn pages, Meta, YouTube, TikTok, Google Business Profile publishing + metrics | Each outlet's app review passed; one generated post live per outlet |
| **P10 Remaining connectors + SMS** | WooCommerce, BigCommerce, Square, Wix, Squarespace, Salesforce, Pipedrive, Zoho, Instantly/Smartlead handoff, Teams, Zoom/Meet, Twilio ISV 10DLC (post-reply only) | Per connector: two-way sync round-trips 100 records with zero duplicates |
| **P11 Stage C** | CASA assessment, `gmail.modify` | Assessment letter on file |

**LinkedIn personal profiles** stay draft-only at every phase. **Skool** is not scheduled.

---

## 16. Reference benchmark: GTM (trygtm.com)

Read 2026-09-28 from their home, product, pricing, security, agencies and subprocessors pages.
The main CTA is **"Join waitlist"**, and the named customer quotes can't be verified, so treat it
as a well-specified pre-launch product, not proven traction.

### 16.1 What they are
An AI SDR on email + LinkedIn + SMS: **Find → Qualify → Write → Send → Book → Track**.
- **Data:** a licensed 700M-contact database, up to 200 new leads/day per workspace, LinkedIn searched every minute, CSV import.
- **Qualify:** "heat" score 1–5; only engages 4s and 5s. It uses the **strongest** signal, not a sum ("a reply beats a like"), and a score "cools down after 14 quiet days."
- **Send:** separate outreach domains they buy and configure for you; peer warmup; LinkedIn ramp "5, then 10, then 20 a day", maturing at 20–25 invites/day.
- **Gate:** "A message cannot be sent until it passes the check. The database enforces that check, so nobody can switch it off." Rules block invented claims and implied prior contact.
- **Replies:** one inbox for email + LinkedIn; any reply stops the sequence; stop requests are honored first and kept forever; a CRM note for every reply, stop and booking.
- **No open tracking:** "We count calls, not emails."
- **Jobs:** 11 named background jobs with published cadences. The Sender runs every minute and is "the only job contacting people."
- **Agencies:** 5 client spaces per plan, each with its own buyers, voice and accounts; white-label; invited clients see only their own space.

**Pricing:** Solo $297/mo · Agency $497/mo, plus usage on **two separate credit meters**:
- **Data credits:** enrichment 10, verification 2, contact reveal 8, LinkedIn profile read 10. Overage $9 per 1,000.
- **Action credits:** message written 2, meeting booked 1, email and LinkedIn sends 0. Overage $2.50 per 1,000.
- **Add-ons:** $12 per connected account, $19 per seat, $99 per client space.
- No trial, no refunds.

**Stack (from their subprocessor list):** Vercel (app + AI gateway), Supabase, Fly.io (workers +
domain provisioning), Upstash, Resend, **Unipile (LinkedIn + customer mailboxes)**, OpenRouter,
Firecrawl, Apify, ZeroBounce, Clay, Stripe, Twilio, Namecheap (domain purchase), Cloudflare (DNS).
Nothing Google-native. SOC 2 "working on it", US-only data.

### 16.2 Adopt (each amends a section above)
| # | Take | Amends | Our version |
|---|---|---|---|
| 1 | **Heat score 1–5, strongest signal wins, 14-day decay, engage 4–5 only** | §5, §6 | `leads.heat` computed by a `heat.score` job every minute from `events`. Trust Dial 2/3 auto-approve additionally requires heat ≥ 4 |
| 2 | **Gate enforced below the app** | §5 | Firestore has no CHECK constraints, so: only the `gate-sa` service account can write `drafts.gate`, rules deny it to everyone else, and the gate stores `bodySha256`. `send` refuses unless `gate.passed && gate.bodySha256 == sha256(renderedBody)`. An edit after gating invalidates the draft automatically |
| 3 | **One egress service** | §2, §4.1 | A single `sender` Cloud Run service is the only holder of `cloudkms.cryptoKeyDecrypter` for channel credentials. Enrichment, generation and connectors can't contact a person even if compromised |
| 4 | **No open-tracking pixel** | §4.1 | Pixels hurt deliverability and Apple Mail inflates them. Measure replies, audit-page views (§8) and meetings. Link clicks go through the audit page only |
| 5 | **Managed sending domains** | §4.4 | Buy + configure outreach domains for the tenant: registrar API → Cloud DNS zone → SPF/DKIM/DMARC → mailbox. **VERIFY** which registrar API to use (Google's own registrar business was sold). Peer warmup networks sit in a grey area of Google's ToS, so ramp on real, low-volume sends instead |
| 6 | **Dual credit meters** | §10 | Split `usage` into **data** (enrichment, verification, Places, contact reveal) and **action** (drafts, generations, bookings), with sends free. Media generation (§12) is a third meter because Veo and Imagen cost orders of magnitude more per unit |
| 7 | **Agency client spaces** | §3 | `tenants/{t}/workspaces/{w}/…`: leads, campaigns, inboxes, voice and brand kit move under the workspace. Client viewers are scoped to one workspace by rules; white-label domain per workspace |
| 8 | **Published job registry** | §2 | `infra/jobs.yaml` is the single list of scheduled jobs + cadences; Terraform builds Cloud Scheduler from it and the UI's status page reads it. One list, not three |
| 9 | **Honest security page + subprocessor list** | §9 | Publish certification status as-is, including "not yet", and the subprocessor list from day one |
| 10 | **Stop requests first and forever** | §7 | Already in the plan; suppression is never touched by retention cleanup |

### 16.3 The decision their stack forces: Unipile
GTM connects LinkedIn **and customer Gmail/Outlook mailboxes** through Unipile. This conflicts
with two positions in this plan:
- **Mailboxes:** a hosted provider that already passed Google's verification would make the §4.3
  Stage B/C wait disappear, at the cost of a non-Google dependency holding every tenant's mailbox
  access. **VERIFY** how Unipile's Gmail connection is verified before relying on it.
- **LinkedIn:** it does automate personal-profile invites and messages. That's exactly what §0
  rules out, because LinkedIn's User Agreement prohibits it and accounts get restricted. GTM's
  ramp numbers (5/10/20, then 20–25/day) are the risk they're managing, not removing.

**Recommendation:** use a mailbox-connection provider as a **bridge** for Gmail/Outlook until our
own OAuth verification lands, behind the §13 connector contract so it can be swapped out. Keep
LinkedIn draft-only. Automating it is a business-risk call that's Christian's to make, not a
build default.

### 16.4 LinkedIn: full automation without the Unipile model

There is **no sanctioned API for sending personal-profile invites or DMs**. Any vendor that fully
automates them, whether cloud session, browser extension or desktop bot, is breaking LinkedIn's
User Agreement. Some routes are only less detectable, not allowed. So automation is split by what
LinkedIn itself permits:

| Lane | What | Automation | Allowed |
|---|---|---|---|
| **A. Sanctioned, unattended** | **Marketing API** ([VERIFY] access tiers + approval): (1) sync each campaign's lead list and target companies as **Matched Audiences**, refreshed daily; (2) **Conversation/Message Ads** into LinkedIn inboxes for heat-4/5 segments; (3) **Thought Leader Ads** sponsoring the tenant's own posts to that audience; (4) **Lead Gen Forms** → webhook → §11/§13 intake as a hot lead. **Community Management API** publishes company-page content from §12 | Fully unattended, scheduled, metered | Yes |
| **B. Assisted, 1:1** | Chrome extension (§14) holds a daily queue of approved, gated notes/DMs for heat-4/5 leads, opens the profile, pre-fills the text; **the human clicks Send**. Capped at 20/day, randomized order, no background actions, no scraping of pages the user didn't open | ~5 s per touch, human-triggered | Defensible (a person performs each action) |
| **C. Unattended personal-profile automation** | Cloud sessions (Unipile-type), headless browsers, extension auto-clickers | — | **No. Not built.** |

**The honest limits of lane A** ([VERIFY] each):
- **It isn't 1:1.** Matched Audiences need a minimum matched size (hundreds of members), so ads land on a segment, not on one named person. Personalization is per segment (niche, city, pain type), backed by the same §5 evidence.
- **It costs ad spend per send / impression.** Run it on the **tenant's own LinkedIn ad account** via OAuth. Spend goes on their card and Omni-SDR never floats media money. We charge a management fee in action credits.
- **Sponsored Messaging is not available for members in some regions (EU).** The plan is US-only first, the same as GTM.
- **Marketing API access is an application.** Submit in P0 so approval arrives before it's needed.

**The combined play, and why it beats GTM's:** email lands (§4) → the same account's decision
makers see a Thought Leader Ad from the tenant that week (lane A) → heat-5 responders get a Message
Ad and a one-click personal note (lanes A + B) → any Lead Gen Form fill or reply stops the sequence.
Every touch is sanctioned or human-sent, so a customer's personal LinkedIn account can't be
restricted because of us. That's a selling point against GTM, whose customers carry that risk.

**Billing fit (base + usage, like GTM):** lane A = management action credits + pass-through spend
on the customer's own ad account; lane B = 1 action credit per queued touch; drafts are
already metered.

### 16.5 Where Omni-SDR is different, and has to be to charge for it
| GTM | Omni-SDR |
|---|---|
| Text messages only | **Proof assets**: a hosted audit page, report PDF and teardown video per prospect (§8, §12) |
| Generic "invented claims" rule | **Evidence-bound gate**: every figure traced to a snapshotted anchor (§5) |
| Licensed contact DB | Local-business + storefront evidence (Places, website teardown, Shopify signals). Add a licensed-data connector for B2B contacts (§13.4 enrichment) rather than competing on database size |
| CRMs + calendars + Slack + Zapier | Adds **commerce** (§13.6), **media outlets**, storage, an MCP server, and in-product surfaces (§14) |
| Vercel / Supabase / Fly / OpenRouter | Google-native interior; Gemini/Imagen/Veo under one bill and one data boundary |

**Pricing anchor:** their $297/$497 is the ceiling a buyer will compare against. An Omni-SDR plan
above that has to be justified by the proof-asset and generation layer. Everything GTM also does
is table stakes.


---

## 17. Knowledge layer (RAG)

Everything a tenant already has and everything the system collects becomes one searchable,
permission-aware, cited knowledge base. Drafting, reply handling, reports and every surface ask
it before writing anything.

### 17.1 What goes in
| Corpus | Sources | Notes |
|---|---|---|
| **Tenant knowledge** | Offer, pricing, case studies, brand + voice docs, SOPs, past proposals | Uploaded (§11) or pulled from Drive / Dropbox / OneDrive / Notion / Confluence connectors (§13) |
| **Proven messaging** | Every sent message, labelled with outcome (replied / booked / ignored / unsubscribed) | Becomes the exemplar library that drafting retrieves from (§17.5) |
| **Prospect knowledge** | Evidence snapshots, website pages, storefront signals, call + meeting transcripts, reply threads | Per lead; expires with the evidence (30 days) unless the lead is active |
| **CRM + commerce history** | Notes, deals, activities, won/lost reasons; Shopify products + orders | Via §13 sync; the tenant's system of record wins on conflicts |
| **Pre-existing archives** | Bulk ZIP, mbox/PST email exports, CSVs, old decks + recordings | Bulk intake through §11. Importing live Gmail history needs a restricted scope, so it waits for Stage C (§4.3) or goes through an export file |

**Never indexed:** Places review text (Maps terms, §0), anything flagged PII-restricted by the §11
scan, and suppressed contacts' content beyond the suppression record.

### 17.2 Index pipeline
```
asset.ready / connector.synced / email.sent / reply.received  (domain-events)
  -> rag-indexer (Cloud Run, Pub/Sub push)
     1. normalize: Document AI layout text, transcripts, HTML -> clean markdown with structure kept
     2. chunk by structure, not by fixed size:
          docs        -> heading sections, 300-800 tokens, tables whole
          transcripts -> speaker turns grouped into ~2-minute windows with timestamps
          emails      -> one message per chunk, thread id kept
          images / video frames -> multimodal embedding + Gemini caption as a text twin
     3. contextualize: prepend a one-line "where this is from" header (doc title, section,
        entity, date) to each chunk before embedding; short chunks retrieve far better with it
     4. dedupe: sha256 per chunk; unchanged chunks are skipped, so an edit re-embeds only what changed
     5. embed: Vertex text embeddings (batch API) + multimodal for visuals  [VERIFY current model ids + dims]
     6. write: Postgres row + tsvector, tagged tenant / workspace / lead / corpus / source / date / visibility
```
Re-indexing a whole tenant is a Cloud Run job reading Firestore + GCS, so the index can be
dropped and rebuilt at any time and never becomes a second source of truth.

### 17.3 Store: Cloud SQL Postgres, not Firestore vectors
Firestore vector search has no keyword ranking, and sales text is full of exact tokens a pure
vector search misses: product names, SKUs, competitor names, prices, city names. Postgres gives
**hybrid search in one query**:
```sql
chunks(id, tenant_id, workspace_id, lead_id, corpus, source_uri, source_sha, section,
       body, tsv tsvector, embedding vector(768), visibility, outcome, created_at, expires_at)
-- HNSW index on embedding, GIN on tsv, btree on (tenant_id, workspace_id, corpus)
-- ROW LEVEL SECURITY: tenant_id = current_setting('app.tenant_id')
```
Row-level security enforces tenant isolation inside the database, the same rule as §3's path
isolation, so a retrieval bug can't leak another tenant's knowledge. Start on a small Cloud SQL
instance, and move to AlloyDB (same SQL, ScaNN index) only when latency or size requires it.

**Alternatives considered:** Vertex AI RAG Engine and Vertex AI Search are managed and faster to
stand up, but give less control over hybrid scoring, tenant isolation and per-chunk outcome
weighting, and bill per query. Keep them as a swap-in behind the same `retrieve()` interface.

### 17.4 Retrieval
```
retrieve(query, scope{tenant, workspace, lead?, corpora[]}, k=8)
  1. rewrite: Gemini Flash turns the task into 1-3 search queries + filters (date, corpus, entity)
  2. hybrid: top 50 by vector + top 50 by keyword -> reciprocal-rank fusion
  3. filter BEFORE ranking: scope, visibility, not expired, not suppressed
  4. rerank: Vertex ranking API -> top k, near-duplicates dropped for diversity
  5. return chunks + citation ids (chunk id -> source_uri + source_sha + section)
```
**Efficiency:**
- **Hot facts skip retrieval.** A small typed "tenant brief" (offer, price, ICP, voice rules,
  booking link) is always in the prompt, held in Gemini context caching per tenant. Retrieval is
  only for the long tail.
- **Cache by query hash** for 10 minutes. Batch jobs drafting 200 leads in one niche reuse the
  same tenant-side retrievals and only retrieve per-lead evidence fresh.
- **Budgets:** k and total context tokens are capped per task type, so drafting never ships 40
  chunks when 8 decide it.

### 17.5 Where it's used
| Task | Retrieves | Guard |
|---|---|---|
| **Drafting** | Tenant brief + the 3 closest **exemplars that got replies** in this niche + this lead's evidence | Claims gate (§5). Retrieved tenant claims (case-study numbers, prices) count as anchors only if they came from a tenant-approved document |
| **Reply handling** | Objection answers, pricing, case studies, thread history | Answers are drafts at every Trust Dial level (§7) |
| **Reports / audits / decks** | Evidence + relevant case studies + prior audits in the niche | Every figure cited to a chunk |
| **"Ask your pipeline"** | Everything in scope | Answers cite sources; "not in the knowledge base" is a valid answer and is shown as one |
| **MCP / API** | `search_knowledge`, `get_source` tools (§13.3) | Same scope + row-level security as the app |

**Learning loop:** the `outcome` column is updated when a sent message gets a reply or booking,
so exemplar retrieval gets better as the tenant sends, without training a model.

### 17.6 Safety
- **Retrieved text is data, not instructions.** Prospect websites, emails and uploaded files can
  carry prompt injection. Chunks go into the prompt inside a fenced, labelled block, the model has
  no tools while drafting, and the gate + single sender (§16.2) mean injected text can't cause a send.
- **Permissions follow the source.** A Drive file shared with two people is indexed with that
  visibility and filtered for everyone else. Connectors re-check source permissions on each sync.
- **Deletion propagates.** Asset delete, lead suppression, tenant delete and Shopify redact
  webhooks all delete chunks by `source_uri` / `lead_id` / `tenant_id` in the same job.

### 17.7 Quality gate
Each tenant gets a golden set of 30 questions generated at onboarding from its own documents,
plus 10 that must return "not found." A nightly job measures recall@8, citation correctness and
the not-found rate. A drop past the noise floor (measured by running the same build twice)
blocks a retrieval-config deploy.

### 17.8 Build placement
| Phase | RAG work |
|---|---|
| P1 Asset core | Cloud SQL + schema + row-level security, indexer for documents/sheets, `retrieve()` with hybrid + rerank, golden-set harness |
| P3 Reports + images | Tenant brief + context caching; reports cite chunks |
| P4 Email | Sent-message exemplars + outcome labelling |
| P5 Replies + CRM | Objection retrieval; CRM notes corpus |
| P6 Open edges | `search_knowledge` in the MCP server + API; Drive/Notion/Dropbox corpus sync |
| P8 Video | Transcript + frame indexing |
