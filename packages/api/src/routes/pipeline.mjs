// GET …/pipeline?since=ISO[&until=ISO]: the console Home's funnel for a window, as server-side counts (the list routes
// page at 50 rows, so a client can't sum them). Counts only: no addresses, bodies or names of people (SPEC §5 S15).
// Same scope and permission as /analytics: one workspace by RLS, `reports_view`. No open tracking anywhere (S14):
// "replies", never "opens".
//
// Definitions (each from one column; the console's tiles use these words):
//   found            contacts created in the window
//   drafted          drafts created in the window, any status
//   waiting/blocked  the CURRENT status ('review' / 'blocked') of those window-created drafts. The Approvals page shows
//                    ALL drafts in review, so its list can be longer than this number.
//   approved         drafts whose approved_at is in the window (an edit voids approved_at, so an edited draft leaves the count)
//   sent             messages sent in the window
//   replies          inbound messages received in the window, bounces and out-of-office excluded, 'unclassified' included
//   meetingRequests  the subset of replies classified meeting_request
//   optOuts          replies classified unsubscribe (OPT_OUT_INTENTS). Contacts suppressed through /u/:token or
//                    List-Unsubscribe have no reply row and are NOT counted here.
//   booked           meetings created in the window (not their start time), canceled excluded
//   byAgent          window drafts per agent, most first. Drafts with no agent are not listed, so the sum can be < drafted.
//   live             right now, whatever the window: drafts being written or gated; replies not yet classified
// Errors are errors (400 bad window, 403 role without reports_view); a failure is never answered with zeros.
import { T } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { badRequest } from '../errors.mjs';

const MAX_WINDOW_DAYS = 90;   // the same ceiling as /analytics
// What the console's "opt-outs" tile counts. Unsubscribe only; add 'not_interested' here if the label means that too.
const OPT_OUT_INTENTS = ['unsubscribe'];
// Replies exclude bounces and out-of-office auto-replies, like /analytics.
const NOT_REPLIES = ['bounce', 'out_of_office'];
const SENT_STATES = ['sent', 'confirmed', 'handed_off'];   // the predicate /analytics uses

export function registerPipeline(r) {
  r.get(`${T}/pipeline`, (ctx) => {
    const q = parse(v.object({ since: v.datetime(), until: v.optional(v.datetime()) }), ctx.query);
    const until = new Date(q.until ?? ctx.now().toISOString());
    const since = new Date(q.since);
    if (!(since < until)) throw badRequest('since must be before until');
    if (until.getTime() - since.getTime() > MAX_WINDOW_DAYS * 86400000) throw badRequest(`the window is at most ${MAX_WINDOW_DAYS} days`);

    return ctx.tenant(async (tx) => {
      // Window is [since, until): a row at exactly `until` belongs to the next window.
      const w = (col) => `${col} >= $1 AND ${col} < $2`;
      const c = (await tx.query(`
        SELECT
          (SELECT count(*) FROM contacts WHERE ${w('created_at')})::int AS found,
          (SELECT count(*) FROM drafts WHERE ${w('created_at')})::int AS drafted,
          (SELECT count(*) FROM drafts WHERE ${w('created_at')} AND status = 'review')::int AS waiting,
          (SELECT count(*) FROM drafts WHERE ${w('created_at')} AND status = 'blocked')::int AS blocked,
          (SELECT count(*) FROM drafts WHERE ${w('approved_at')})::int AS approved,
          (SELECT count(*) FROM messages WHERE ${w('sent_at')} AND state = ANY($3))::int AS sent,
          (SELECT count(*) FROM inbound_messages WHERE ${w('received_at')} AND intent <> ALL($4))::int AS replies,
          (SELECT count(*) FROM inbound_messages WHERE ${w('received_at')} AND intent = 'meeting_request')::int AS meeting_requests,
          (SELECT count(*) FROM inbound_messages WHERE ${w('received_at')} AND intent = ANY($5))::int AS opt_outs,
          (SELECT count(*) FROM meetings WHERE ${w('created_at')} AND status <> 'canceled')::int AS booked,
          (SELECT count(*) FROM drafts WHERE status IN ('generating', 'gating'))::int AS drafting,
          (SELECT count(*) FROM inbound_messages WHERE intent = 'unclassified')::int AS classifying`,
      [since, until, SENT_STATES, NOT_REPLIES, OPT_OUT_INTENTS])).rows[0];

      // Drafts with no agent (campaign generation and reply drafts don't set one today) aren't listed here, so the
      // per-agent numbers can add up to less than `drafted`.
      const byAgent = (await tx.query(`
        SELECT a.id AS agent_id, coalesce(nullif(a.name, ''), 'An agent') AS name, count(*)::int AS drafted
        FROM drafts d JOIN agents a ON a.id = d.agent_id
        WHERE ${w('d.created_at')} GROUP BY a.id, a.name ORDER BY count(*) DESC, a.name, a.id`, [since, until])).rows;

      return {
        since: since.toISOString(), until: until.toISOString(),
        found: c.found, drafted: c.drafted, waiting: c.waiting, blocked: c.blocked, approved: c.approved, sent: c.sent,
        replies: c.replies, meetingRequests: c.meeting_requests, optOuts: c.opt_outs, booked: c.booked,
        byAgent: byAgent.map((x) => ({ agentId: x.agent_id, name: x.name, drafted: x.drafted })),
        live: { drafting: c.drafting, classifying: c.classifying },
      };
    }, { action: 'reports_view' });
  });
}
