// The decision engine adapter (DECISIONS 2026-10-01: Laya, self-hosted as the internal `decider` service).
// A decider answers typed questions (choice / noul / score) about one state and returns probabilities, never
// text, so nothing it says can be sent to anyone. Callers apply the answers through a registry entry
// (registry.mjs), which only lets a decision move toward the safe side.
//
// decide({ state, questions }) → { answers, engine, model, revision, inputTokens, ms }
// Any failure throws DecideError; callers treat that as "no decision yet" and keep the deterministic result.

export class DecideError extends Error {
  constructor(message) { super(message); this.name = 'DecideError'; }
}

// Default. No model runs and nothing leaves the process: callers keep their deterministic answer.
export function offDecider() {
  return { name: 'off', async decide() { throw new DecideError('decider is off in this environment'); } };
}

// Tests. `answer(state, questions)` returns the `answers` object laya-serve would.
export function fakeDecider(answer) {
  const calls = [];
  return {
    name: 'fake', calls,
    async decide({ state, questions }) {
      calls.push({ state, questions });
      return { answers: await answer(state, questions), engine: 'fake', model: 'fake', revision: 'fake', inputTokens: null, ms: 0 };
    },
  };
}

// Identity token for an IAM-only Cloud Run service: the metadata server in prod, audience = the service URL.
export function metadataIdentityToken(audience, fetchImpl = fetch) {
  return async () => {
    const res = await fetchImpl(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
      { headers: { 'Metadata-Flavor': 'Google' } });
    if (!res.ok) throw new DecideError(`metadata identity token ${res.status}`);
    return (await res.text()).trim();
  };
}

/**
 * laya-serve's POST /v1/systemone (services/decider). The checkpoint revision is pinned in the image; we
 * still read it back from /health once and stamp it on every decision, so a row records the weights that
 * actually answered rather than the ones we meant to deploy.
 */
export function layaDecider({ url, getToken = metadataIdentityToken(url), fetchImpl = fetch, timeoutMs = 90000 }) {
  if (!url) throw new Error('layaDecider needs url');
  let revision = null;
  const headers = async () => ({ authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' });
  return {
    name: 'laya',
    async decide({ state, questions }) {
      const t0 = Date.now();
      let res;
      try {
        if (!revision) {
          const h = await fetchImpl(`${url}/health`, { headers: await headers(), signal: AbortSignal.timeout(timeoutMs) });
          if (!h.ok) throw new DecideError(`decider health ${h.status}`);
          revision = (await h.json()).revisions?.english ?? null;
          if (!revision) throw new DecideError('decider reports no resident checkpoint revision');
        }
        res = await fetchImpl(`${url}/v1/systemone`, {
          method: 'POST', headers: await headers(), signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({ state, questions, model: 'english' }),
        });
      } catch (e) {
        throw e instanceof DecideError ? e : new DecideError(`decider unreachable: ${e.name}`);
      }
      if (!res.ok) throw new DecideError(`decider ${res.status}`);
      const body = await res.json();
      for (const id of Object.keys(questions)) if (!body.answers?.[id]) throw new DecideError(`decider returned no answer for ${id}`);
      return { answers: body.answers, engine: 'laya', model: body.model ?? null, revision, inputTokens: body.usage?.input_tokens ?? null, ms: Date.now() - t0 };
    },
  };
}
