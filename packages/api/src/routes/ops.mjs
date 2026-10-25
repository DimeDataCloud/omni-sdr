// Capacity, holds (the kill switch), suppression, credits, analytics, connectors, activity.
// Analytics count only what happened: sends, replies, positive replies, meetings, approvals. There is no
// open rate anywhere (SPEC §5 S14: no tracking pixels), and every number comes from rows in this workspace.
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, badRequest } from '../errors.mjs';
import { CONNECTORS } from '../services/catalog.mjs';

const POSITIVE = `('meeting_request', 'positive_inquiry', 'referral')`;

export function registerOps(r) {
  // Per mailbox: today's sends against the hard cap (UTC day, the same one send_guard counts), holds, pause.
  r.get(`${T}/capacity`, (ctx) => ctx.tenant(async (tx, m) => {
    const mailboxes = (await tx.query(`SELECT mb.id, mb.provider, mb.address, mb.daily_cap, mb.paused_reason,
        coalesce(sc.count, 0)::int AS sent_today
      FROM mailboxes mb LEFT JOIN send_counters sc ON sc.mailbox_id = mb.id AND sc.day = (now() AT TIME ZONE 'UTC')::date
      ORDER BY mb.address`)).rows;
    // holds RLS is org-wide; show the ones that stop THIS workspace: the org, the workspace, its campaigns and mailboxes.
    const holds = (await tx.query(`SELECT h.scope_type, h.scope_id, h.reason, h.set_by, h.set_at FROM holds h
      WHERE (h.scope_type = 'org' AND h.scope_id = $1) OR (h.scope_type = 'workspace' AND h.scope_id = $2)
         OR (h.scope_type = 'campaign' AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = h.scope_id))
         OR (h.scope_type = 'mailbox' AND EXISTS (SELECT 1 FROM mailboxes mb WHERE mb.id = h.scope_id))
      ORDER BY h.set_at DESC`, [m.orgId, m.workspaceId])).rows;
    const queue = (await tx.query(`SELECT count(*) FILTER (WHERE d.status = 'approved' AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.draft_id = d.id))::int AS approved_unsent,
        count(*) FILTER (WHERE d.status = 'review')::int AS awaiting_review FROM drafts d`)).rows[0];
    const cap = mailboxes.filter((x) => !x.paused_reason).reduce((s, x) => s + x.daily_cap, 0);
    const used = mailboxes.reduce((s, x) => s + x.sent_today, 0);
    return {
      mailboxes: mailboxes.map(camel), holds: holds.map(camel), queue: camel(queue),
      today: { cap, used, remaining: Math.max(0, cap - used) },
      workspaceOnHold: holds.some((h) => (h.scope_type === 'workspace' && h.scope_id === m.workspaceId) || (h.scope_type === 'org' && h.scope_id === m.orgId)),
    };
  }, { action: 'team_view' }));

  // Setting a hold is always the safe direction, so anyone who can build or approve may pull it.
  // The scope must be something in this tenant (checked here; the holds key is global, see PR notes).
  r.post(`${T}/holds`, (ctx) => {
    const b = parse(v.object({ scopeType: v.oneOf(['workspace', 'campaign', 'mailbox']), scopeId: v.optional(v.uuid()),
      reason: v.string({ min: 1, max: 300 }) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const scopeId = b.scopeType === 'workspace' ? m.workspaceId : b.scopeId;
      if (!scopeId) throw badRequest('scopeId: is required', { field: 'scopeId' });
      const table = { workspace: 'workspaces', campaign: 'campaigns', mailbox: 'mailboxes' }[b.scopeType];
      if (!(await tx.query(`SELECT 1 FROM ${table} WHERE id = $1`, [scopeId])).rows.length) throw notFound(`${b.scopeType} not found`);
      await tx.query(`INSERT INTO holds (org_id, scope_type, scope_id, reason, set_by) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (scope_type, scope_id) DO NOTHING`, [m.orgId, b.scopeType, scopeId, b.reason, `user:${m.userId}`]);
      await audit(tx, m, 'hold', b.scopeType, scopeId);
      return { status: 201, body: { scopeType: b.scopeType, scopeId, held: true } };
    }, { action: 'approve' });
  });

  r.delete(`${T}/holds/:scopeType/:id`, (ctx) => ctx.tenant(async (tx, m) => {
    if (!['workspace', 'campaign', 'mailbox'].includes(ctx.params.scopeType)) throw notFound();
    // holds RLS is org-wide; an admin narrowed to this workspace may only clear this workspace's holds.
    const inScope = ctx.params.scopeType === 'workspace' ? ctx.params.id === m.workspaceId
      : (await tx.query(`SELECT 1 FROM ${ctx.params.scopeType === 'campaign' ? 'campaigns' : 'mailboxes'} WHERE id = $1`, [ctx.params.id])).rows.length > 0;
    if (!inScope) throw notFound('no such hold');
    const res = await tx.query(`DELETE FROM holds WHERE scope_type = $1 AND scope_id = $2 RETURNING scope_id`, [ctx.params.scopeType, ctx.params.id]);
    if (!res.rows.length) throw notFound('no such hold');
    await audit(tx, m, 'clear_hold', ctx.params.scopeType, ctx.params.id);
    return { status: 204 };
  }, { action: 'clear_hold' }));

  // Manual do-not-contact. Hash only; the address itself is not stored in suppression.
  r.post(`${T}/suppression`, (ctx) => {
    const b = parse(v.object({ email: v.email(), reason: v.optional(v.string({ max: 200 })) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      await tx.query(`INSERT INTO suppression (scope_org_id, value_hash, kind, reason) VALUES ($1, value_hash($2), 'email', $3)
        ON CONFLICT DO NOTHING`, [m.orgId, b.email, b.reason ? `manual: ${b.reason}` : 'manual']);
      await audit(tx, m, 'suppress', 'email', 'hash');
      return { status: 201, body: { suppressed: true } };
    }, { action: 'approve' });
  });

  // A contact held because its name matches an opted-out person it shares no identity with (0020). Clearing is a person's
  // decision with a written reason; the database function checks the role (admin or operator) and writes the audit row.
  r.post(`${T}/contacts/:id/clear-hold`, (ctx) => {
    const b = parse(v.object({ reason: v.string({ min: 10, max: 500 }) }), ctx.body);
    return ctx.tenant(async (tx) => {
      await tx.query(`SELECT clear_name_hold($1, $2)`, [ctx.params.id, b.reason]);
      return { status: 204 };
    }, { action: 'approve' });
  });

  // An opted-out contact's name is frozen; changing it (a typo fix) is audited and goes through this one function.
  r.post(`${T}/contacts/:id/rename`, (ctx) => {
    const b = parse(v.object({ name: v.string({ min: 1, max: 200 }), reason: v.string({ min: 10, max: 500 }) }), ctx.body);
    return ctx.tenant(async (tx) => {
      await tx.query(`SELECT rename_opted_out_contact($1, $2, $3)`, [ctx.params.id, b.name, b.reason]);
      return { status: 204 };
    }, { action: 'approve' });
  });

  r.get(`${T}/credits`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT meter, balance FROM credit_balances ORDER BY meter`)).rows;
    return { balances: Object.fromEntries(rows.map((x) => [x.meter, Number(x.balance)])) };
  }, { action: 'team_view' }));

  // ?days=7|30|90
  r.get(`${T}/analytics`, (ctx) => {
    const q = parse(v.object({ days: v.optional(v.oneOf(['7', '30', '90'])) }), ctx.query);
    const days = Number(q.days ?? 7);
    return ctx.tenant(async (tx, m) => {
      const tz = (await tx.query(`SELECT timezone FROM workspaces WHERE id = $1`, [m.workspaceId])).rows[0].timezone;
      const since = `now() - make_interval(days => ${days})`;
      const daily = (await tx.query(`
        WITH d AS (SELECT generate_series(((now() AT TIME ZONE $1)::date - ${days - 1}), (now() AT TIME ZONE $1)::date, interval '1 day')::date AS day)
        SELECT d.day,
          (SELECT count(*) FROM messages x WHERE x.state IN ('sent', 'confirmed', 'handed_off') AND (x.sent_at AT TIME ZONE $1)::date = d.day)::int AS sent,
          (SELECT count(*) FROM inbound_messages i WHERE i.intent NOT IN ('bounce', 'out_of_office') AND (i.received_at AT TIME ZONE $1)::date = d.day)::int AS replies,
          (SELECT count(*) FROM inbound_messages i WHERE i.intent IN ${POSITIVE} AND (i.received_at AT TIME ZONE $1)::date = d.day)::int AS positive,
          (SELECT count(*) FROM meetings mt WHERE mt.status <> 'canceled' AND (mt.created_at AT TIME ZONE $1)::date = d.day)::int AS meetings
        FROM d ORDER BY d.day`, [tz])).rows;
      const byStep = (await tx.query(`
        SELECT dr.step,
          count(DISTINCT x.id) FILTER (WHERE x.state IN ('sent', 'confirmed', 'handed_off'))::int AS sent,
          count(DISTINCT i.message_id) FILTER (WHERE i.intent NOT IN ('bounce', 'out_of_office'))::int AS replied
        FROM messages x JOIN drafts dr ON dr.id = x.draft_id LEFT JOIN inbound_messages i ON i.message_id = x.id
        WHERE x.claimed_at >= ${since} GROUP BY dr.step ORDER BY dr.step`)).rows;
      // audit_log RLS is org-wide; joining drafts (workspace-scoped) keeps other workspaces out.
      const decisions = (await tx.query(`SELECT a.action, count(*)::int AS n FROM audit_log a JOIN drafts dr ON dr.id::text = a.entity_id
        WHERE a.entity_type = 'draft' AND a.action IN ('approve', 'reject') AND a.at >= ${since} GROUP BY a.action`)).rows;
      const dec = Object.fromEntries(decisions.map((x) => [x.action, x.n]));
      const totals = daily.reduce((t, x) => ({ sent: t.sent + x.sent, replies: t.replies + x.replies, positive: t.positive + x.positive,
        meetings: t.meetings + x.meetings }), { sent: 0, replies: 0, positive: 0, meetings: 0 });
      const rate = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);   // null, not 0%, when nothing was sent
      return {
        days, timezone: tz, totals,
        rates: { replyRate: rate(totals.replies, totals.sent), positiveRate: rate(totals.positive, totals.sent),
          approvalRate: rate(dec.approve ?? 0, (dec.approve ?? 0) + (dec.reject ?? 0)) },
        approvals: { approved: dec.approve ?? 0, rejected: dec.reject ?? 0 },
        daily: daily.map((x) => ({ ...x, day: x.day instanceof Date ? x.day.toISOString().slice(0, 10) : String(x.day).slice(0, 10) })),
        byStep: byStep.map((x) => ({ ...x, replyRate: rate(x.replied, x.sent) })),
      };
    }, { action: 'reports_view' });
  });

  r.get(`${T}/connectors`, (ctx) => ctx.tenant(async (tx) => {
    const providers = new Set((await tx.query(`SELECT DISTINCT provider FROM mailboxes WHERE paused_reason IS NULL`)).rows.map((x) => x.provider));
    const connected = { gmail: providers.has('gmail'), smtp_imap: providers.has('smtp_imap'), email_routing: providers.size > 0 };
    return { items: CONNECTORS.map((c) => ({ ...c,
      status: c.activation === 'later' ? 'activates_later' : connected[c.id] ? 'connected' : 'not_connected' })) };
  }, { action: 'team_view' }));

  r.get(`${T}/activity`, (ctx) => {
    const q = parse(v.object({ limit: v.optional(v.int({ min: 1, max: 200 })) }), ctx.query);
    return ctx.tenant(async (tx) => {
      const rows = (await tx.query(`SELECT a.id, a.actor, u.email AS actor_email, a.action, a.entity_type, a.entity_id, a.at
        FROM audit_log a LEFT JOIN users u ON u.id::text = a.actor ORDER BY a.at DESC LIMIT $1`, [q.limit ?? 50])).rows;
      return { items: rows.map((x) => ({ ...camel(x), id: String(x.id) })) };
    }, { action: 'members' });
  });
}
