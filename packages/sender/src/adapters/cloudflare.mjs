// Cloudflare Email Service adapter: POST /accounts/{id}/email/sending/send (REST), one recipient per call.
// Outreach is one-to-one and qualified only (Christian, B-12): this is the transactional API, not a bulk path.
// fetch and the token are injected, so tests run with no network and the token never passes through a caller.
// The REST response lists recipients (delivered / permanent_bounces / queued) and carries NO message id, so the adapter
// returns a stable key of our own ('cf-rest:<our message id>'); bounce and complaint events find the message by recipient
// (0021 record_mail_event). A named sender is {address, name} in the REST examples (the Workers binding says `email`).
// [VERIFY] https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
import { SendError } from './gmail.mjs';

export function cloudflareAdapter({ fetch: fetchImpl = globalThis.fetch, accountId, apiToken }) {
  if (!/^[0-9a-f]{32}$/i.test(String(accountId ?? ''))) throw new Error('cloudflareAdapter: accountId (32 hex) is required');
  if (typeof apiToken !== 'function') throw new Error('cloudflareAdapter: apiToken() is required');
  return {
    name: 'cloudflare',
    async send({ parts, messageId }) {
      if (!parts) throw new SendError('permanent', 'cloudflare: no structured message parts');
      const token = await apiToken();
      let res;
      try {
        res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: parts.from.name ? { address: parts.from.email, name: parts.from.name } : parts.from.email, to: parts.to, reply_to: parts.replyTo, subject: parts.subject, text: parts.text, headers: parts.headers }),
        });
      } catch (e) {
        // May or may not have reached Cloudflare: unknown, never auto-retry.
        throw new SendError('transient', `network: ${e.message}`);
      }
      let body = null;
      try { body = await res.json(); } catch { /* not JSON */ }
      if (res.ok && body?.success) {
        const r = body.result ?? {};
        if ((r.permanent_bounces ?? []).length) throw new SendError('permanent', 'cloudflare: permanent bounce at send');
        return { providerMessageId: `cf-rest:${messageId}` };
      }
      const code = body?.errors?.[0]?.code;
      const detail = `cloudflare ${res.status}${code ? ` ${code}` : ''}`;
      if (res.status === 401 || res.status === 403) throw new SendError('auth', detail);   // 10207 = account paused for reputation
      if (res.status === 429 || res.status >= 500) throw new SendError('transient', detail);
      throw new SendError('permanent', detail);
    },
  };
}
