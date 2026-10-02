// One send pass (docs/claude/SENDER-PLAN.md §3). A Cloud Run job that Cloud Scheduler starts every 10 minutes and that
// exits when the pass is done. Deploying the job and its schedule is Christian's call (rails §3.1).
//
//   DATABASE_URL              the API login (sender_svc is one of its roles)
//   OMNI_GOOGLE_CLIENT_ID     the OAuth client
//   OMNI_SENDER_SECRETS       Secret Manager JSON: { mailboxKey, googleClientSecret, stateSecret }
//   OMNI_UNSUBSCRIBE_BASE     the API's public origin, for /u/<token> links (required: a footer link must resolve)
//   OMNI_REPLY_DOMAIN         default reply.omnisdr.com
//   OMNI_SEND_MAX             sends per pass, default 20 (1..200)
//
// Exit 0 after a pass, whatever was skipped; 1 when the pass itself broke; 2 on missing config. Logs counts only:
// never an address, subject or body.
import { pathToFileURL } from 'node:url';
import { pgPool } from '../pool.mjs';
import { loadGoogleConfig } from '../routes/mailboxes.mjs';
import { withService } from '../../../db/src/context.mjs';
import { runSendPass } from '../../../sender/src/loop.mjs';
import { gmailAdapter, SendError } from '../../../sender/src/adapters/gmail.mjs';
import { open } from '../../../sender/src/credentials.mjs';
import { accessToken } from '../../../sender/src/google.mjs';

/** The Gmail adapter for one mailbox: its sealed refresh token is opened only here, and only for this pass. */
export function gmailFor(client, google, { fetchImpl = fetch } = {}) {
  return (mb, { orgId, workspaceId }) => {
    let token = null;
    const ready = async () => {
      if (token) return token;
      const row = await withService(client, { orgId, workspaceId, role: 'sender_svc' }, async (tx) =>
        (await tx.query(`SELECT secret FROM mailbox_credentials WHERE mailbox_id = $1 AND revoked_at IS NULL`, [mb.id])).rows[0]);
      if (!row) throw Object.assign(new Error('no credential'), { kind: 'auth' });
      const refreshToken = open(google.mailboxKey, { orgId, workspaceId, mailboxId: mb.id }, row.secret);
      token = await accessToken({ refreshToken, clientId: google.clientId, clientSecret: google.clientSecret, fetchImpl });
      return token;
    };
    const adapter = gmailAdapter({ fetch: fetchImpl, accessToken: async () => {
      try { return await ready(); } catch (e) { throw new SendError(e.kind === 'auth' ? 'auth' : 'transient', e.message); }
    } });
    return { ...adapter, ready };
  };
}

export async function runSend(env, { pool, google = loadGoogleConfig(env), fetchImpl, now, pause, log = (e) => console.log(JSON.stringify(e)) } = {}) {
  const missing = [!pool && !env.DATABASE_URL && 'DATABASE_URL', !google && 'OMNI_GOOGLE_CLIENT_ID/OMNI_SENDER_SECRETS', !env.OMNI_UNSUBSCRIBE_BASE && 'OMNI_UNSUBSCRIBE_BASE'].filter(Boolean);
  if (missing.length) { log({ job: 'send', error: `missing ${missing.join(', ')}` }); return 2; }
  const max = Number(env.OMNI_SEND_MAX ?? 20);
  if (!Number.isInteger(max) || max < 1 || max > 200) { log({ job: 'send', error: 'OMNI_SEND_MAX must be 1..200' }); return 2; }
  const ownPool = !pool;
  pool ??= await pgPool({ connectionString: env.DATABASE_URL, max: 1 });
  const { client, release } = await pool.acquire();
  try {
    await runSendPass(client, {
      adapterFor: gmailFor(client, google, { fetchImpl }),
      urls: { unsubscribeBase: env.OMNI_UNSUBSCRIBE_BASE.replace(/\/+$/, ''), replyDomain: env.OMNI_REPLY_DOMAIN ?? 'reply.omnisdr.com' },
      maxSends: max, log, ...(now ? { now } : {}), ...(pause ? { pause } : {}),
    });
    return 0;
  } catch (e) {
    log({ job: 'send', error: String(e?.message ?? e).slice(0, 300) });
    return 1;
  } finally {
    release();
    if (ownPool) await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runSend(process.env);
