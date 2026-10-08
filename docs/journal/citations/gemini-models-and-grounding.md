# Gemini models and Google Search grounding

## Grounding with Google Search: Gemini 3 models get 5,000 free search requests/month, then $14 per 1,000 (Gemini Developer API)
- Source: https://ai.google.dev/gemini-api/docs/pricing
- Retrieved: 2026-09-28 by claude
- Excerpt: Gemini 3: "5,000 free search requests per month (shared across all Gemini 3.x models)"; paid "$14 per 1,000 requests". Gemini 2.5: "1,500 RPD (free …)", paid "$35 / 1,000 grounded prompts".
- Used in: Station 10 (competitor discovery), SPEC §8 St.10
- Confidence: partial. This is the **Gemini Developer API** price. Omni-SDR calls **Vertex AI**, whose grounding price page didn't render; confirm on https://cloud.google.com/vertex-ai/generative-ai/pricing before Station 10's cost model.
- Note: for Gemini 3 it's billed per *search request*, and one prompt can issue several searches, so estimate per query, not per prompt.

## Current model IDs (Gemini Developer API listing)
- Source: https://ai.google.dev/gemini-api/docs/pricing
- Retrieved: 2026-09-28 by claude
- Excerpt: Flash-Lite `gemini-3.5-flash-lite`; Flash `gemini-3.8-flash` (also 3.7/3.6/3.5); Pro `gemini-3.1-pro-preview`
- Used in: Station 24 routing (Flash-Lite / Flash / Pro)
- Confidence: partial. The Vertex model IDs may differ (SPEC [VERIFY]).
- Consequence: **Pro is preview-only** in this listing. The Pro tier needs a GA fallback (Flash, or a GA Pro when one exists) in the model registry, and the evals must run on both.
