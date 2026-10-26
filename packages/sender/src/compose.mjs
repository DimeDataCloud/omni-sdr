// Builds the RFC 5322 message for one outreach email (INFRA §14 "Mail hygiene").
// Plain text only, so there's no HTML and nothing that could carry a tracking pixel (DECISIONS: no open
// tracking). The footer carries the sending customer's postal address and the unsubscribe link
// (citations/email-compliance-can-spam.md). The one-click header follows RFC 8058.

const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

function headerValue(name, v) {
  const s = String(v ?? '');
  if (/[\r\n\0]/.test(s)) throw new Error(`compose: ${name} contains a line break (header injection refused)`);
  return s;
}
function address(name, v) {
  const s = headerValue(name, v).trim();
  if (!ADDRESS.test(s)) throw new Error(`compose: ${name} is not a plain email address`);
  return s;
}
// RFC 2047 encoded-word for non-ASCII display text; ASCII passes through unchanged.
function encodeWord(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}
function wrap76(b64) {
  return b64.replace(/.{1,76}/g, (l) => `${l}\r\n`);
}

/**
 * @param m { from, fromName?, to, replyTo, subject, body, postalAddress, unsubscribeUrl, inReplyTo? }
 * @returns { raw: string, footer: string, parts } parts is the same message as structured fields for REST providers
 *   (Cloudflare Email Service): { from: {email, name?}, to, replyTo, subject, text, headers }
 */
export function composeEmail(m) {
  const from = address('from', m.from);
  const to = address('to', m.to);
  const replyTo = address('replyTo', m.replyTo);
  const subject = headerValue('subject', m.subject).trim();
  const unsubscribeUrl = headerValue('unsubscribeUrl', m.unsubscribeUrl);
  if (!/^https:\/\//.test(unsubscribeUrl)) throw new Error('compose: unsubscribeUrl must be https');
  const postal = String(m.postalAddress ?? '').trim();
  if (postal.length < 10) throw new Error('compose: postal address is required for commercial email');
  if (/<\s*img\b/i.test(String(m.body))) throw new Error('compose: images are not allowed in outreach (no tracking)');

  const footer = `--\n${postal}\nUnsubscribe: ${unsubscribeUrl}`;
  const text = `${String(m.body).replace(/\r\n/g, '\n').trimEnd()}\n\n${footer}\n`.replace(/\n/g, '\r\n');
  const fromHeader = m.fromName ? `${encodeWord(headerValue('fromName', m.fromName).replace(/"/g, ''))} <${from}>` : from;

  const headers = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${encodeWord(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    `List-Unsubscribe: <${unsubscribeUrl}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  ];
  if (m.inReplyTo) {
    const ref = headerValue('inReplyTo', m.inReplyTo);
    headers.push(`In-Reply-To: ${ref}`, `References: ${ref}`);
  }
  const raw = `${headers.join('\r\n')}\r\n\r\n${wrap76(Buffer.from(text, 'utf8').toString('base64'))}`;
  const parts = {
    from: m.fromName ? { email: from, name: headerValue('fromName', m.fromName).replace(/"/g, '') } : { email: from },
    to, replyTo, subject, text: text.replace(/\r\n/g, '\n'),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      ...(m.inReplyTo ? { 'In-Reply-To': headerValue('inReplyTo', m.inReplyTo), References: headerValue('inReplyTo', m.inReplyTo) } : {}),
    },
  };
  return { raw, footer, parts };
}
