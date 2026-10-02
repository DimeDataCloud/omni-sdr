// Sealing mailbox credentials (docs/claude/SENDER-PLAN.md §1). AES-256-GCM with a 32-byte key from Secret Manager
// (`omni-mailbox-key`), held only in the processes that connect or send. The additional data binds a sealed value to
// its tenant and mailbox, so a row copied onto another mailbox fails to open instead of sending as someone else.
//
//   sealed = v1.<iv: 12 bytes, base64url>.<ciphertext || 16-byte tag, base64url>
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export class CredentialError extends Error {
  constructor(message) { super(message); this.name = 'CredentialError'; }
}

/** The key from its Secret Manager value: 32 random bytes, base64 or base64url. */
export function credentialKey(encoded) {
  const key = Buffer.from(String(encoded ?? '').trim(), 'base64');
  if (key.length !== 32) throw new CredentialError('mailbox key must be 32 bytes (base64)');
  return key;
}

const aadOf = ({ orgId, workspaceId, mailboxId }) => {
  for (const [k, v] of Object.entries({ orgId, workspaceId, mailboxId })) {
    if (typeof v !== 'string' || !v) throw new CredentialError(`${k} is required to seal or open a credential`);
  }
  return Buffer.from(`${VERSION}|${orgId}|${workspaceId}|${mailboxId}`, 'utf8');
};

export function seal(key, scope, plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) throw new CredentialError('nothing to seal');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aadOf(scope));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final(), c.getAuthTag()]);
  return `${VERSION}.${iv.toString('base64url')}.${ct.toString('base64url')}`;
}

export function open(key, scope, sealed) {
  const parts = String(sealed ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) throw new CredentialError('not a sealed credential');
  const iv = Buffer.from(parts[1], 'base64url');
  const body = Buffer.from(parts[2], 'base64url');
  if (iv.length !== 12 || body.length < 17) throw new CredentialError('not a sealed credential');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(aadOf(scope));
  d.setAuthTag(body.subarray(body.length - 16));
  try {
    return Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]).toString('utf8');
  } catch {
    // Wrong key, wrong mailbox, or tampered: never say which.
    throw new CredentialError('credential does not open for this mailbox');
  }
}
