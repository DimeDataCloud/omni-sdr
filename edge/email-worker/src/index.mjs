// The Email Worker for reply.omnisdr.com (INFRASTRUCTURE §21.1, API.md §7 item 4).
// Cloudflare Email Routing hands every message for the domain to `email()`. A reply to one of our sends is addressed
// to its Reply-To, r+<token>@reply.omnisdr.com; the worker parses it and posts it, HMAC-signed, to the API's
// POST /internal/inbound, which resolves the token to the right tenant. Inbound only, stateless, one secret.
//
//   env.API_URL          the API's base URL, e.g. https://api.omnisdr.com (no trailing slash)
//   env.INBOUND_SECRET   the HMAC key the API checks (secret: `wrangler secret put INBOUND_SECRET`)
//   env.REPLY_DOMAIN     default reply.omnisdr.com
//   env.FALLBACK_TO      optional, a verified Email Routing destination: if the API can't take a reply, the original
//                        message is forwarded there instead of being lost
//
// Never rejected for size: an opt-out inside a large reply must still arrive. The body is capped to what the API
// stores (100,000 characters). Nothing is logged but the outcome: never an address, subject or body.
import PostalMime from 'postal-mime';

const MAX_BODY = 100000;
const enc = new TextEncoder();

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Plain text of a parsed message: the text part, else the HTML part with tags removed. */
export function textOf(email) {
  if (email.text && email.text.trim()) return email.text;
  const html = String(email.html ?? '');
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    // Gmail and Outlook mark the quoted thread in HTML; keep it as "> " lines so the API's cleaner drops it.
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, (q) => `\n${q.replace(/<[^>]+>/g, '').split('\n').map((l) => `> ${l}`).join('\n')}\n`)
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export default {
  async email(message, env, ctx, { fetchImpl = fetch, now = () => Date.now(), log = (e) => console.log(JSON.stringify(e)) } = {}) {
    const domain = (env.REPLY_DOMAIN || 'reply.omnisdr.com').toLowerCase();
    const to = String(message.to ?? '').trim();
    const at = to.lastIndexOf('@');
    const token = /^r\+[A-Za-z0-9_-]{16,64}$/i.test(to.slice(0, at)) && to.slice(at + 1).toLowerCase() === domain;
    if (!token) {
      // Not one of our Reply-To addresses: refuse at the SMTP stage, so nothing is accepted and later bounced.
      message.setReject('Unknown address');
      log({ worker: 'email', outcome: 'rejected_recipient' });
      return;
    }

    let payload;
    try {
      const email = await PostalMime.parse(message.raw);
      payload = {
        to,
        from: String(email.from?.address || message.from || '').slice(0, 320),
        subject: String(email.subject ?? '').slice(0, 998),
        body: textOf(email).slice(0, MAX_BODY),
        receivedAt: new Date(now()).toISOString(),
        ...(email.messageId ? { externalId: String(email.messageId).slice(0, 998) } : {}),
      };
    } catch {
      return fallback(message, env, log, 'unparseable');
    }

    const raw = JSON.stringify(payload);
    const ts = Math.floor(now() / 1000);
    let res;
    try {
      res = await fetchImpl(`${env.API_URL}/internal/inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-omni-timestamp': String(ts), 'x-omni-signature': `sha256=${await hmacHex(env.INBOUND_SECRET, `${ts}.${raw}`)}` },
        body: raw,
      });
    } catch {
      return fallback(message, env, log, 'api_unreachable');
    }
    if (!res.ok) return fallback(message, env, log, `api_${res.status}`);
    const out = await res.json().catch(() => ({}));
    // `unmatched` (no send has this token) is never bounced: that would tell a stranger which addresses exist. It
    // goes to the fallback mailbox when there is one, so a reply whose address was mangled on the way is still read
    // by a person (found in the 2026-10-02 audit); without one it is dropped.
    if (out.outcome === 'unmatched' && env.FALLBACK_TO) {
      await message.forward(env.FALLBACK_TO);
      log({ worker: 'email', outcome: 'unmatched_forwarded' });
      return;
    }
    log({ worker: 'email', outcome: out.outcome ?? 'unknown' });
  },
};

// The API couldn't take it: keep the message. Forward it to the fallback mailbox if one is set; otherwise throw, so
// Email Routing doesn't accept it and the sending server retries later. [VERIFY] Email Routing's handling of a
// thrown error: https://developers.cloudflare.com/email-routing/email-workers/runtime-api/
async function fallback(message, env, log, reason) {
  if (env.FALLBACK_TO) {
    await message.forward(env.FALLBACK_TO);
    log({ worker: 'email', outcome: 'forwarded_to_fallback', reason });
    return;
  }
  log({ worker: 'email', outcome: 'failed', reason });
  throw new Error(`inbound not delivered: ${reason}`);
}
