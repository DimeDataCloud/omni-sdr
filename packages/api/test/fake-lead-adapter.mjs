// The S2L-1 harness: a fake channel adapter that follows the adapter contract in src/leads/core.mjs, so the core can be driven
// through every refusal case with no network, no provider and no send. Real adapters (S2L-2 onward) replace `raw` parsing only.
export function fakeAdapter({ source = 'web_form', channel = 'form', secret = 'fake-secret' } = {}) {
  return {
    source,
    verify: (raw) => raw?.secret === secret,
    normalize: (raw) => ({
      channel: raw.channel ?? channel,
      externalId: raw.id,
      consentBasis: raw.consent ?? 'express_form',
      receivedAt: raw.at ?? new Date(),
      contact: raw.contact,
      payload: raw.payload,
    }),
  };
}
export const event = (id, extra = {}) => ({ secret: 'fake-secret', id, contact: { email: 'lena@example.test', name: 'Lena' }, ...extra });
