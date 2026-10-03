// Meta (Instagram + Facebook) inbound, the third channel of the SDR buffer (docs/claude/SDR-PIVOT.md §7, P6). Ships
// off: nothing here runs until a route wires it with an app secret, which needs Christian's Meta app and its review
// (docs/claude/META-SETUP.md). This module is the part that doesn't depend on that: the signature check and a parser
// that turns Meta's webhook payloads into one normalized shape.
//
// [VERIFY https://developers.facebook.com/docs/graph-api/webhooks/getting-started] X-Hub-Signature-256: "sha256=" +
// HMAC-SHA256(app secret, raw body). [VERIFY https://developers.facebook.com/docs/instagram-platform/webhooks] and
// [VERIFY https://developers.facebook.com/docs/graph-api/webhooks/reference/page/]: the payload shapes below come
// from the docs, not from a captured payload. Fetch one real payload of each kind before trusting the parser
// (memory: fixtures that invent payloads), and note what is ABSENT.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** true only for a well-formed header whose HMAC over the exact raw bytes matches. */
export function verifyMetaSignature(rawBody, header, appSecret) {
  if (!appSecret || typeof header !== 'string' || !Buffer.isBuffer(rawBody)) return false;
  const m = /^sha256=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return false;
  const want = createHmac('sha256', appSecret).update(rawBody).digest();
  const got = Buffer.from(m[1], 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The subscription handshake: answer hub.challenge only for our own verify token. */
export function verifyHandshake(query, verifyToken) {
  if (!verifyToken || query?.['hub.mode'] !== 'subscribe') return null;
  const a = Buffer.from(String(query['hub.verify_token'] ?? '')), b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const challenge = String(query['hub.challenge'] ?? '');
  return /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? challenge : null;
}

const str = (x, max) => (typeof x === 'string' && x.length ? x.slice(0, max) : null);
const when = (t) => {
  if (typeof t === 'number' && Number.isFinite(t)) return new Date(t < 1e12 ? t * 1000 : t);
  if (typeof t === 'string' && !Number.isNaN(Date.parse(t))) return new Date(t);
  return null;
};

/**
 * Meta webhook JSON → [{ channel, accountId, externalId, threadId, fromId, fromName, text, at }]. Unknown or partial
 * entries are skipped, never guessed. Our own echoes (a message our account sent) are skipped, so a reply we send
 * can't come back in as a new inbound message.
 *   channel: 'instagram_comment' | 'instagram_dm' | 'facebook_comment' | 'messenger'
 */
export function parseMetaEvents(json) {
  const out = [];
  const object = json?.object;
  if (object !== 'instagram' && object !== 'page') return out;
  for (const entry of Array.isArray(json.entry) ? json.entry : []) {
    const accountId = str(String(entry?.id ?? ''), 64);
    if (!accountId) continue;
    for (const ch of Array.isArray(entry.changes) ? entry.changes : []) {
      const v = ch?.value ?? {};
      if (object === 'instagram' && ch.field === 'comments') {
        const text = str(v.text, 5000), id = str(v.id, 128);
        if (!text || !id || String(v.from?.id ?? '') === accountId) continue;
        out.push({ channel: 'instagram_comment', accountId, externalId: id, threadId: str(v.media?.id, 128),
          fromId: str(String(v.from?.id ?? ''), 64), fromName: str(v.from?.username, 100), text, at: when(entry.time) });
      }
      if (object === 'page' && ch.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
        const text = str(v.message, 5000), id = str(v.comment_id, 128);
        if (!text || !id || String(v.from?.id ?? '') === accountId) continue;
        out.push({ channel: 'facebook_comment', accountId, externalId: id, threadId: str(v.post_id, 128),
          fromId: str(String(v.from?.id ?? ''), 64), fromName: str(v.from?.name, 100), text, at: when(v.created_time) ?? when(entry.time) });
      }
    }
    for (const ev of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const msg = ev?.message;
      if (!msg || msg.is_echo || String(ev.sender?.id ?? '') === accountId) continue;
      const text = str(msg.text, 5000), id = str(msg.mid, 256);
      if (!text || !id) continue;   // attachments-only messages wait for a later version
      out.push({ channel: object === 'instagram' ? 'instagram_dm' : 'messenger', accountId, externalId: id,
        threadId: str(String(ev.sender?.id ?? ''), 64), fromId: str(String(ev.sender?.id ?? ''), 64), fromName: null, text,
        at: when(ev.timestamp) ?? when(entry.time) });
    }
  }
  return out;
}
