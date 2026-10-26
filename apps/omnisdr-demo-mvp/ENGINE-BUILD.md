# Voice engine: what has to be built

Status 2026-10-24: **the real voice engine does not exist.** The live demo at https://demo.omnisdr.com is a scripted, rule-based
intake agent with typed input, the browser's own speech recognition and the browser's own speech synthesis. It demonstrates the flow and
the guardrails. It is not an LLM and not a voice engine. Christian has decided the real engine gets built next ("we're going to have to build that out").

Two candidate engines. Build B first (server half is done and verified); build A as the fallback and the baseline to compare against.

## Engine B: Gemini Live in the browser (server half done, client missing)

### Already working and verified (2026-10-24)
- Gemini key is valid (free tier). Model `models/gemini-3.8-live` exists and supports `bidiGenerateContent`.
- Ephemeral token mint: `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens` with header `x-goog-api-key` and body
  `{ uses:1, expireTime, newSessionExpireTime, bidiGenerateContentSetup:{ model, generationConfig:{responseModalities:['AUDIO']}, systemInstruction } }`.
  The REST field is `bidiGenerateContentSetup` (the SDK calls it `liveConnectConstraints`); the endpoint is `v1beta`, not `v1alpha`.
  The first version of `mintToken` in `src/worker.js` used the wrong version and field and Google rejected it with a 400; fixed in e0996c0.
- Websocket: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=<token>`.
  First client message `{ setup:{ model } }`, server answers `{ setupComplete }`, then `clientContent` text turns work and audio comes back as
  `serverContent.modelTurn.parts[].inlineData` (base64 PCM).
- Smoke result with a text turn: mint 200, setupComplete, 12 audio chunks, first audio at 1.3 s. Reproduce with `tools/gemini-live-smoke.mjs`.
- Worker side already in place: `POST /api/token` (needs a live session `sid`, one token per session, 501 unless `ENGINE_B=1` and `GEMINI_API_KEY` set),
  `engineB` boolean returned by `POST /api/session`, CSP `connect-src` already allows `wss://generativelanguage.googleapis.com`,
  Permissions-Policy already allows `microphone=(self)`.

### To build (nothing of this exists)
1. **Browser audio client** in `src/demo.html` (or a new `src/engine-b.js` served from `'self'`; CSP is `script-src 'self' 'nonce-...'`, no inline, no `blob:` workers):
   - `getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})`.
   - Capture to 16 kHz mono 16-bit PCM. Use an `AudioWorklet` module served from a Worker route (`worker-src` falls back to `script-src 'self'`; a `blob:` URL would be blocked, so add a static route such as `/engine-b-worklet.js`, then update the CSP only if needed and re-run hardening).
   - Send `realtimeInput` audio chunks (`audio/pcm;rate=16000`, base64) over the websocket.
   - Play returned 24 kHz PCM with a scheduled `AudioBufferSourceNode` queue; handle barge-in by flushing the queue on `serverContent.interrupted`.
   - Turn the call timer, transcript bubbles and captured-fields panel into consumers of the live transcripts (enable input/output transcription in the setup).
   - Fall back to the scripted agent on any failure (mic denied, token 5xx, socket close) so the demo never dead-ends.
2. **Wire `ENGINE_B`**: `npx wrangler secret put GEMINI_API_KEY` (value is in `C:\Users\cdsec\.halo-keys\gemini-live.md`, never paste it in chat or commits), set `ENGINE_B = "1"` in `wrangler.toml`, deploy.
3. **Guardrails move into the model**: the scripted agent currently enforces them in code (no prices, AI disclosure, out-of-area, out-of-scope, hot words, STOP, 3-minute cap). With a live model they must be enforced in the system instruction plus server-side limits:
   - Extend the `systemInstruction` in `mintToken` from the tenant fact sheet (`src/tenant.js`): script, services, zips, slots, "never quote prices", "say you are automated", end the call when asked.
   - Keep the token constrained: `uses:1`, 3-minute `expireTime`, 1-minute `newSessionExpireTime`, model locked, no tools except the booking tool below.
   - Add a blocking `book_slot` function-call tool so a slot is only "booked" when the tool returns; the existing simulated owner text and booking card consume its result.
   - Cost cap: the existing DAILY_CAP and IP_CAP gate session start; add an upper bound on audio seconds per session server-side (the `SESSION_SECONDS` timer is client-side only, so the token expiry is the real backstop).
4. **Tests**: headless Chromium cannot use a real mic, but Playwright can fake it (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` with a wav file). Add a test that runs a full Engine B call against the real API with a short wav (costs a few cents, gate behind an env flag so `npm test` stays free), and tests that every failure path falls back to the scripted agent. Never delete or loosen an existing test to make the new engine pass (rails 3.7).
5. **Spike checklist** (also listed in the dev portal, unchecked): real cost per call from usage metadata; burst test free vs paid project; caller-side latency in browser then through a Twilio bridge; 50 scripted bathroom-remodel calls comparing base 3.8 Live vs Extended Thinking with a blocking booking call; ephemeral token lock-down test; browser matrix (Chrome 152 arm64, iOS Safari, desktop Safari); phone checks (8 kHz output, DTMF, transfer, noise).
6. **Public endpoint audit**: every new public endpoint or changed CSP needs the audit pass in AGENT-RAILS. Christian waived the other-session cross-audit for this demo (2026-10-24), but run `npm test` (walkthrough + hardening) and, because Engine B adds a token path, extend `tests/hardening.js` for it.

### Known risks
- Free-tier key: rate limits and data-use terms apply; fine for the demo, not for paying customers. Decide on a paid project before the Oct 26 dial week if volume matters.
- iOS Safari needs a user gesture to start `AudioContext` and is the most likely place for the client to break.
- Echo: speaker output into the open mic will make the model interrupt itself without echo cancellation; test on laptop speakers, not only headphones.

## Engine A: Workers AI pipeline (not started)
Speech to text, LLM, text to speech chained on Cloudflare (the "Cloudflare voice package"). Higher latency than Engine B, but it stays on one platform and one bill. Only needed if Engine B fails the spike checklist (cost, latency, or guardrail control). Treat it as the baseline in the 50-call comparison.

## Where things stand elsewhere
- Telephony (a real phone number via Twilio) is out of scope for the demo; the checklist only asks for a bridge latency check.
- The CHASE speed-to-lead tab stays simulated. Nothing is ever really sent.
