// Owner alert for a new lead (0030). Nothing here sends to a lead: it tells the workspace's own admins that one arrived.
// The relay claims `notify.lead` outbox rows (ids only), looks up the admins from memberships, hands one message per row to an
// AlertTransport, and marks a row published only after its send returned. A crash after a send can alert twice (acceptable,
// internal); a failed send leaves the row for the next pass (the kick, then the one-minute cron). Runs as alert_svc, which has
// no table grants: only the three definers in 0030. The send lock does not apply to it, and it cannot create a message.
import { withoutTenant } from '../../../db/src/context.mjs';

/**
 * AlertTransport: `{ send({ to: string[], subject: string, text: string }) }`, resolving when the provider accepted the message and
 * rejecting otherwise. No provider is wired yet (Halo is finding the provider facts); tests use fakeAlertTransport.
 */
export function fakeAlertTransport({ failFor = () => false } = {}) {
  const sent = [];
  return { sent, async send(msg) { if (failFor(msg)) throw new Error('fake transport refused'); sent.push(msg); } };
}

/** The text of an alert: no name, address, phone or message text, only where to look. */
export function alertMessage(consoleBase) {
  const base = String(consoleBase ?? '').replace(/\/+$/, '');
  return { subject: 'New lead waiting', text: `A new lead just arrived in your workspace.${base ? `

Open the console: ${base}` : ''}` };
}

/** Rejects if `fn` has not settled in `ms` (a provider that never answers must not pin the transaction). The late result is ignored. */
function withTimeout(fn, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('alert send timed out')), ms); });
  return Promise.race([Promise.resolve().then(fn), timeout]).finally(() => clearTimeout(timer));
}

/**
 * One relay pass. @returns { claimed, sent, failed, noRecipient }
 * The claim holds `FOR UPDATE SKIP LOCKED` until COMMIT, so two concurrent passes never take the same row.
 */
export async function relayAlerts(client, { transport, consoleBase = null, limit = 20, sendTimeoutMs = 5000, passBudgetMs = 30000 } = {}) {
  if (!transport) return { claimed: 0, sent: 0, failed: 0, noRecipient: 0, skipped: 'no_transport' };
  return withoutTenant(client, { role: 'alert_svc' }, async (tx) => {
    const rows = (await tx.query(`SELECT id, org_id, payload FROM alert_claim($1)`, [limit])).rows;
    const done = [];
    let sent = 0; let failed = 0; let noRecipient = 0;
    const started = Date.now();
    for (const row of rows) {
      // A pass holds its claim (and a pool connection) until COMMIT, so it has a budget: rows past it wait for the next pass.
      if (Date.now() - started > passBudgetMs) break;
      const p = row.payload ?? {};
      const to = (await tx.query(`SELECT email FROM alert_recipients($1, $2)`, [row.org_id, p.workspace_id])).rows.map((x) => x.email);
      // Nobody to tell is not retried forever: the console item is still there.
      if (!to.length) { noRecipient++; done.push(row.id); continue; }
      // One message per admin (they do not see each other's addresses). The row is done only when every send returned;
      // a retry may then repeat one already delivered, which an internal alert can afford.
      try {
        for (const addr of to) await withTimeout(() => transport.send({ to: [addr], ...alertMessage(consoleBase) }), sendTimeoutMs);
        sent++; done.push(row.id);
      } catch { failed++; }
    }
    if (done.length) await tx.query(`SELECT alert_publish($1::bigint[])`, [done]);
    return { claimed: rows.length, sent, failed, noRecipient };
  });
}
