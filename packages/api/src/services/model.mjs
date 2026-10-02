// Model adapters for agent chat (SPEC §10). The adapter only returns text: no tools, no sends, no fetches
// on the model's behalf (INFRA §10 injection containment). Model IDs are [VERIFY] on Vertex and come from
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

// Access token for Vertex: the Cloud Run metadata server in prod.
export async function metadataToken(fetchImpl = fetch) {
  const res = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new ModelError(`metadata token ${res.status}`);
  return (await res.json()).access_token;
}

/**
 * Vertex AI generateContent [VERIFY request shape and model IDs:
 * https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference].
 */
export function vertexModel({ project, location = 'us-central1', models, getToken = metadataToken, fetchImpl = fetch,
  timeoutMs = 60000, maxOutputTokens = 2048 }) {
  if (!project || !models?.flash) throw new Error('vertexModel needs project and models.{flash_lite,flash,pro}');
  return {
    name: 'vertex',
    async generate({ tier, system, messages, grounded = false }) {
      const model = models[tier] ?? models.flash;
      const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
      const res = await fetchImpl(url, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
          generationConfig: { maxOutputTokens },
          // [VERIFY] the grounding tool's field name for the configured Gemini model:
          // https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search
          ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
        }),
      });
      if (!res.ok) throw new ModelError(`vertex ${res.status}`);
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
      if (!text) throw new ModelError('empty response');
      const u = data.usageMetadata;
      const sources = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
        .map((c) => c.web).filter((w) => w?.uri).map((w) => ({ uri: String(w.uri).slice(0, 500), title: String(w.title ?? '').slice(0, 200) }));
      return { text, model, usage: u ? { inputTokens: u.promptTokenCount ?? null, outputTokens: u.candidatesTokenCount ?? null } : null,
        ...(grounded ? { sources } : {}) };
    },
  };
}
