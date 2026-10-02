// One pass of the send loop (docs/claude/SENDER-PLAN.md §3). A Cloud Run job runs it on a schedule and exits.
// It decides only *what is due and from which mailbox*. Whether a message may go at all stays with sendDraft()
// and the database guards (send_guard, send_guard_enrollment): approval, gate pass, holds, suppression, the
// verified address, the cap and the enrollment's state are all re-checked inside the claim.
//
// Due means:
//   - approved email draft with no message yet, in a workspace sender_due_workspaces() lists
//   - its enrollment isn't stopped, converted, completed, paused or snoozed
//   - step 0 at once; a later step only after the previous step was sent and WAIT_BUSINESS_DAYS have passed
//   - now is inside the send window: weekdays, 08:00–17:00 in the workspace's time zone
import { withService } from '../../db/src/context.mjs';
import { sendDraft } from './send.mjs';

export const WAIT_BUSINESS_DAYS = Object.freeze({ 1: 3, 2: 4 }); // INFRASTRUCTURE §13.1: bump after 3, breakup after 4
export const WINDOW = Object.freeze({ open: 8, close: 17 });
const INACTIVE = new Set(['stopped', 'converted', 'completed', 'paused', 'snoozed']);

/** Weekday and hour of `at` in `timeZone`. */
function local(at, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour), date: `${p.year}-${p.month}-${p.day}` };
}
const WEEKEND = new Set(['Sat', 'Sun']);

export function inWindow(at, timeZone, w = WINDOW) {
  const l = local(at, timeZone);
  return !WEEKEND.has(l.weekday) && l.hour >= w.open && l.hour < w.close;
}

/** Whole business days from `from` to `to` in `timeZone`: weekdays strictly after from's local date, up to to's. */
export function businessDaysBetween(from, to, timeZone) {
  if (!(from instanceof Date) || to <= from) return 0;
  let n = 0;
  const start = local(from, timeZone).date;
  const end = local(to, timeZone).date;
  // Walk calendar days by noon UTC of each local date; at most a few weeks in practice.
  for (let d = new Date(`${start}T12:00:00Z`); ; ) {
    d = new Date(d.getTime() + 86400000);
    const iso = d.toISOString().slice(0, 10);
    if (iso > end) break;
    if (!WEEKEND.has(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d))) n++;
    if (n > 60) break;
  }
  return n;
}

/** Why a draft isn't due now (null when it is). Pure, so the rules are tested without a database. */
export function notDueReason(d, now) {
  if (INACTIVE.has(d.enrollment_state)) return `enrollment_${d.enrollment_state}`;
  if (!inWindow(now, d.timezone)) return 'outside_window';
  if (d.step > 0) {
    if (!d.prev_sent_at) return 'previous_step_not_sent';
    const need = WAIT_BUSINESS_DAYS[d.step] ?? WAIT_BUSINESS_DAYS[2];
    if (businessDaysBetween(new Date(d.prev_sent_at), now, d.timezone) < need) return 'waiting';
  }
  return null;
}

/**
 * @param client  one DB connection (the API login: sender_svc is one of its roles)
 * @param opts    { adapterFor(mailbox) → adapter, urls: { unsubscribeBase, replyDomain }, now?, maxSends?, maxWorkspaces?,
 *                  pause?(ms), jitterMs?() , log?(event) }
 * @returns       a tally: { workspaces, considered, sent, failed, refused, skipped: { reason: n }, paused: [mailboxId] }
 */
export async function runSendPass(client, { adapterFor, urls, now = () => new Date(), maxSends = 20, maxWorkspaces = 100,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)), jitterMs = () => 5000 + Math.floor(Math.random() * 25000), log = () => {} }) {
  const tally = { workspaces: 0, considered: 0, sent: 0, failed: 0, refused: 0, skipped: {}, paused: [] };
  const skip = (r) => { tally.skipped[r] = (tally.skipped[r] ?? 0) + 1; };

  await client.query('BEGIN');
  let due;
  try {
    await client.query('SET LOCAL ROLE sender_svc');
    due = (await client.query(`SELECT org_id, workspace_id FROM sender_due_workspaces($1)`, [maxWorkspaces])).rows;
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }

  for (const { org_id: orgId, workspace_id: workspaceId } of due) {
    if (tally.sent >= maxSends) break;
    tally.workspaces++;
    const ctx = { orgId, workspaceId, role: 'sender_svc' };
    const { drafts, mailboxes } = await withService(client, ctx, async (tx) => ({
      drafts: (await tx.query(`
        SELECT d.id, d.step, e.state AS enrollment_state, w.timezone,
               (SELECT m.sent_at FROM drafts p JOIN messages m ON m.draft_id = p.id
                 WHERE p.enrollment_id = d.enrollment_id AND p.step = d.step - 1 AND m.state = 'sent'
                 ORDER BY m.sent_at DESC LIMIT 1) AS prev_sent_at
        FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN workspaces w ON w.id = d.workspace_id
        WHERE d.status = 'approved' AND d.channel = 'email' AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.draft_id = d.id)
        ORDER BY d.step, d.approved_at NULLS LAST, d.id LIMIT 200`)).rows,
      mailboxes: (await tx.query(`
        SELECT mb.id, mb.address, mb.provider, mb.daily_cap,
               coalesce((SELECT sc.count FROM send_counters sc WHERE sc.mailbox_id = mb.id AND sc.day = (now() AT TIME ZONE 'UTC')::date), 0) AS used
        FROM mailboxes mb JOIN mailbox_credentials cr ON cr.mailbox_id = mb.id AND cr.revoked_at IS NULL
        WHERE mb.paused_reason IS NULL AND mb.provider = 'gmail'`)).rows,
    }));
    const room = new Map(mailboxes.map((m) => [m.id, { ...m, left: m.daily_cap - Number(m.used) }]));
    for (const d of drafts) {
      if (tally.sent >= maxSends) break;
      tally.considered++;
      const why = notDueReason(d, now());
      if (why) { skip(why); continue; }
      const mb = [...room.values()].filter((m) => m.left > 0).sort((a, b) => b.left - a.left)[0];
      if (!mb) { skip('no_mailbox_room'); continue; }
      const adapter = adapterFor(mb, { orgId, workspaceId });
      // Get the mailbox ready (an access token) before claiming: a claim consumes the draft for good, so a token
      // Google refuses must stop here, leaving the draft to send once the mailbox is reconnected.
      try {
        await adapter.ready?.();
      } catch (e) {
        if (e?.kind === 'auth') {
          await withService(client, ctx, (tx) => tx.query(`UPDATE mailboxes SET paused_reason = 'reconnect' WHERE id = $1 AND paused_reason IS NULL`, [mb.id]));
          tally.paused.push(mb.id);
        }
        room.delete(mb.id); skip(e?.kind === 'auth' ? 'mailbox_needs_reconnect' : 'mailbox_not_ready');
        continue;
      }
      const r = await sendDraft(client, { orgId, workspaceId, draftId: d.id, mailboxId: mb.id, adapter, urls });
      if (r.outcome === 'sent') {
        tally.sent++; mb.left--;
        if (tally.sent < maxSends) await pause(jitterMs());
      } else if (r.outcome === 'failed') {
        tally.failed++;
        if (/^auth:/.test(r.reason ?? '')) {
          // Google refused the token: stop using this mailbox until a person reconnects it.
          await withService(client, ctx, (tx) => tx.query(`UPDATE mailboxes SET paused_reason = 'reconnect' WHERE id = $1 AND paused_reason IS NULL`, [mb.id]));
          room.delete(mb.id); tally.paused.push(mb.id);
        }
      } else if (r.outcome === 'refused') {
        tally.refused++;
        if (/daily cap reached|mailbox paused/.test(r.reason ?? '')) room.delete(mb.id);
        skip(`refused:${String(r.reason).replace(/^send_guard: /, '').slice(0, 60)}`);
      } else {
        skip(r.outcome);
      }
    }
  }
  log({ job: 'send', ...tally });
  return tally;
}
