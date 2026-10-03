// One test message from a connected Gmail mailbox to that same mailbox (Christian 2026-10-02: "one connect and one test
// send, to my own address only"). It proves the OAuth client, the sealed refresh token and gmail.send end to end without
// a campaign: the recipient is never an input, it is the mailbox's own address, so this can't reach anyone else. It
// doesn't touch contacts, email_status or the send guard. Run once by hand as a Cloud Run job execution; never scheduled.
//
//   DATABASE_URL            the API login (sender_svc is one of its roles)
//   OMNI_GOOGLE_CLIENT_ID   the OAuth client
//   OMNI_SENDER_SECRETS     Secret Manager JSON: { mailboxKey, googleClientSecret, stateSecret }
//   OMNI_TEST_ORG, OMNI_TEST_WS, OMNI_TEST_MAILBOX   which mailbox (ids, not addresses)
//
// Exit 0 sent · 1 the send failed · 2 missing or bad config. Logs the Gmail message id or the error kind, never the address.
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { pgPool } from '../pool.mjs';
import { loadGoogleConfig } from '../routes/mailboxes.mjs';
import { withService } from '../../../db/src/context.mjs';
import { gmailFor } from './send.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^[^\s<>@,;"]{1,64}@[A-Za-z0-9.-]{1,253}$/;

/** RFC 5322 message from the mailbox to itself. The address comes from the database; anything header-unsafe is refused. */
export function selfMessage(address, { now = new Date(), id = randomUUID() } = {}) {
  if (!ADDRESS.test(address)) throw new Error('mailbox address is not a plain address');
  return [
    `From: ${address}`,
    `To: ${address}`,
    'Subject: Omni-SDR test send',
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@omnisdr.com>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'This is the one test message Omni-SDR sends after you connect Gmail. It went from this mailbox to itself.',
    'Nothing else was sent. You can delete it.',
    '',
  ].join('\r\n');
}

export async function runSendTest(env, { pool, google = loadGoogleConfig(env), fetchImpl, log = (e) => console.log(JSON.stringify(e)) } = {}) {
  const ids = { orgId: env.OMNI_TEST_ORG, workspaceId: env.OMNI_TEST_WS, mailboxId: env.OMNI_TEST_MAILBOX };
  if (!google || (!pool && !env.DATABASE_URL) || !Object.values(ids).every((v) => UUID.test(v ?? ''))) {
    log({ job: 'send-test', error: 'missing config: DATABASE_URL, OMNI_GOOGLE_CLIENT_ID/OMNI_SENDER_SECRETS, OMNI_TEST_ORG/WS/MAILBOX (uuids)' });
    return 2;
  }
  const ownPool = !pool;
  pool ??= await pgPool({ connectionString: env.DATABASE_URL, max: 1 });
  const { client, release } = await pool.acquire();
  try {
    const mb = await withService(client, { orgId: ids.orgId, workspaceId: ids.workspaceId, role: 'sender_svc' }, async (tx) =>
      (await tx.query(`SELECT id, address, provider FROM mailboxes WHERE id = $1`, [ids.mailboxId])).rows[0]);
    if (!mb || mb.provider !== 'gmail') { log({ job: 'send-test', error: 'no such gmail mailbox in that workspace' }); return 2; }
    const adapter = gmailFor(client, google, fetchImpl ? { fetchImpl } : {})(mb, { orgId: ids.orgId, workspaceId: ids.workspaceId });
    const { providerMessageId } = await adapter.send({ raw: selfMessage(mb.address), mailbox: mb });
    log({ job: 'send-test', sent: true, providerMessageId });
    return 0;
  } catch (e) {
    log({ job: 'send-test', sent: false, kind: e?.kind ?? 'error', error: String(e?.message ?? e).slice(0, 200) });
    return 1;
  } finally {
    release();
    if (ownPool) await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runSendTest(process.env);
