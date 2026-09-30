// Gmail adapter: users.messages.send with the gmail.send scope only (Sensitive, not Restricted:
// citations/google-oauth-scopes.md). Never reads mail. fetch and the token source are injected, so
// tests run without network and credentials never pass through this module's callers.

export class SendError extends Error {
  // kind: 'auth' (reconnect the mailbox) | 'transient' (provider busy) | 'permanent' (this message will never go)
  constructor(kind, message) {
    super(message);
    this.name = 'SendError';
    this.kind = kind;
  }
}

export function gmailAdapter({ fetch: fetchImpl = globalThis.fetch, accessToken }) {
  if (typeof accessToken !== 'function') throw new Error('gmailAdapter: accessToken(mailbox) is required');
  return {
    name: 'gmail',
    async send({ raw, mailbox }) {
      const token = await accessToken(mailbox);
      let res;
      try {
        res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
        });
      } catch (e) {
        // The request may or may not have reached Google: treat it as unknown, never auto-retry.
        throw new SendError('transient', `network: ${e.message}`);
      }
      if (res.ok) {
        const body = await res.json();
        if (!body?.id) throw new SendError('permanent', 'gmail: 2xx without a message id');
        return { providerMessageId: body.id };
      }
      const detail = `gmail ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new SendError('auth', detail);
      if (res.status === 429 || res.status >= 500) throw new SendError('transient', detail);
      throw new SendError('permanent', detail);
    },
  };
}
