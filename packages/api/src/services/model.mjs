// Model adapters for agent chat (SPEC §10). The adapter only returns text: no tools, no sends, no fetches
// on the model's behalf (INFRA §10 injection containment). Model IDs are [VERIFY] and come from
// config, never from the request.
//
// generate({ tier: 'flash_lite'|'flash'|'pro', system, messages: [{ role: 'user'|'model', text }], grounded? })
//   → { text, model, usage: { inputTokens, outputTokens } | null, sources?: [{ uri, title }] }
// `grounded: true` lets the model search Google (competitor discovery only, DECISIONS 2026-09-28); the web pages it
// used come back as `sources`. Still no tools of ours: the model can search, never act.

export class ModelError extends Error {
  constructor(message) { super(message); this.name = 'ModelError'; }
}

// Default. Nothing leaves the process and nothing is spent.
export function offModel() {
  return {
    name: 'off',
    async generate() {
      return { text: 'Model calls are turned off in this environment, so I can\'t answer yet. Your message is saved.', model: 'off', usage: null };
    },
  };
}

// Tests.
export function fakeModel(reply = ({ messages }) => `echo: ${messages.at(-1)?.text ?? ''}`) {
  const calls = [];
  return {
    name: 'fake', calls,
    async generate(input) { calls.push(input); return { text: reply(input), model: `fake-${input.tier}`, usage: null }; },
  };
}

// The Gemini API (Google AI Studio) on its free tier, for demos only (Christian 2026-10-02, item 4b: "OK for a demo
// with fake/demo data only; never real prospect or customer data"). The free tier's terms let Google use what is sent
// [VERIFY https://ai.google.dev/gemini-api/terms], so server.mjs refuses to start with this adapter unless the
// deployment declares its data is demo-only. It also stops itself at a daily request budget, so the free quota
// [VERIFY https://ai.google.dev/gemini-api/docs/rate-limits] runs out as a clear message, not a storm of 429s.
// The key is read by name from the environment and sent only in its header. No grounding: search grounding is not offered here.
export function geminiApiModel({ key, models, fetchImpl = fetch, timeoutMs = 60000, maxOutputTokens = 2048, perDay = 20, now = () => new Date() }) {
  if (!key || !models?.flash) throw new Error('geminiApiModel needs a key and models.{flash_lite,flash,pro}');
  let day = null; const used = new Map();
  return {
    name: 'gemini_api',
    async generate({ tier, system, messages, grounded = false }) {
      if (grounded) throw new ModelError('grounded search is off with the free Gemini API');
      const model = models[tier] ?? models.flash;
      const today = now().toISOString().slice(0, 10);
      if (today !== day) { day = today; used.clear(); }
      if ((used.get(model) ?? 0) >= perDay) throw new ModelError(`daily demo budget of ${perDay} requests for ${model} is used up`);
      used.set(model, (used.get(model) ?? 0) + 1);
      // [VERIFY] endpoint and header: https://ai.google.dev/api/generate-content
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // A redirect would carry the custom key header to wherever it points (fetch strips only Authorization on a
        // cross-origin redirect; #62 audit P3-2), so a redirect is an error.
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
          generationConfig: { maxOutputTokens },
        }),
      });
      if (!res.ok) throw new ModelError(`gemini_api ${res.status}`);
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
      if (!text) throw new ModelError('empty response');
      const u = data.usageMetadata;
      return { text, model, usage: u ? { inputTokens: u.promptTokenCount ?? null, outputTokens: u.candidatesTokenCount ?? null } : null };
    },
  };
}
