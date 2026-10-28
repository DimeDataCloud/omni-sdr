// Agents, their chat, and routines. An agent is a role prompt + a model tier over this workspace. The model
// only returns text: no tools, no sends. The composer never sends or publishes (SPEC Station 07).
import { T, camel, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { notFound, forbidden, HttpError } from '../errors.mjs';
import { can } from '../../../db/src/permissions.mjs';
import { MODES, ABOUT_KINDS, ABOUT_ACTION, loadAbout, buildContext, modeSteer } from '../services/context.mjs';

const BADGES = ['EXEC', 'OPS', 'TRI', 'SDR', 'HR', 'MKT', 'CS', 'FIN', 'INT'];
const TIERS = ['flash_lite', 'flash', 'pro'];
const HISTORY = 20;           // messages of context sent to the model

const AGENT_FIELDS = {
  name: v.string({ min: 1, max: 80 }),
  station: v.string({ min: 1, max: 40, pattern: /^[a-z][a-z0-9_]*$/ }),
  badge: v.oneOf(BADGES),
  modelTier: v.oneOf(TIERS),
  systemPrompt: v.string({ max: 8000, trim: false }),
  contextSources: v.array(v.string({ min: 1, max: 80 }), { max: 20 }),
  autonomousMode: v.bool(),
  appearance: v.json({ maxBytes: 2000 }),
};
const AGENT_COLS = { name: 'name', station: 'station', badge: 'badge', modelTier: 'model_tier', systemPrompt: 'system_prompt',
  contextSources: 'context_sources', autonomousMode: 'autonomous_mode', appearance: 'appearance' };
const asDb = (k, val) => (k === 'appearance' ? JSON.stringify(val) : val);

// Guardrails prepended to every agent's own prompt. They restate the product's limits for the model;
// the real enforcement is that this code path has no send, publish or tool capability at all.
const HOUSE_RULES = `You are an assistant inside Omni-SDR for one workspace.
You can explain, draft, summarize and plan. You cannot send, publish, schedule, or contact anyone: every outbound
message is a draft that a person approves in the Approvals queue, and a claims gate checks it against evidence.
Never state facts about a prospect that you were not given. If something is missing, say what is missing.`;

const ROUTINE_FIELDS = {
  name: v.string({ min: 1, max: 120 }),
  category: v.oneOf(['briefing', 'triage', 'outbound', 'sync']),
  schedule: v.string({ min: 1, max: 120 }),
  active: v.bool(),
  agentId: v.nullable(v.uuid()),
};
const ROUTINE_COLS = { name: 'name', category: 'category', schedule: 'schedule', active: 'active', agentId: 'agent_id' };

export function registerAgents(r) {
  r.get(`${T}/agents`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`
      SELECT a.*, last.body AS last_body, last.sender AS last_sender, last.created_at AS last_at,
             (SELECT count(*)::int FROM routines rt WHERE rt.agent_id = a.id AND rt.active) AS active_routines
      FROM agents a
      LEFT JOIN LATERAL (SELECT body, sender, created_at FROM agent_messages am WHERE am.agent_id = a.id
                         ORDER BY created_at DESC LIMIT 1) last ON true
      WHERE a.archived_at IS NULL ORDER BY coalesce(last.created_at, a.created_at) DESC`)).rows;
    return { items: rows.map(({ last_body, last_sender, last_at, ...a }) => ({
      ...camel(a), lastMessage: last_at ? { preview: last_body.slice(0, 140), sender: last_sender, at: last_at } : null })) };
  }, { action: 'team_view' }));

  r.post(`${T}/agents`, (ctx) => {
    const b = parse(v.object({ ...AGENT_FIELDS, station: v.optional(AGENT_FIELDS.station), badge: v.optional(AGENT_FIELDS.badge),
      modelTier: v.optional(AGENT_FIELDS.modelTier), systemPrompt: v.optional(AGENT_FIELDS.systemPrompt),
      contextSources: v.optional(AGENT_FIELDS.contextSources), autonomousMode: v.optional(AGENT_FIELDS.autonomousMode),
      appearance: v.optional(AGENT_FIELDS.appearance) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const keys = Object.keys(b);
      const row = (await tx.query(`INSERT INTO agents (org_id, workspace_id, created_by, ${keys.map((k) => AGENT_COLS[k]).join(', ')})
        VALUES ($1, $2, $3, ${keys.map((_, i) => `$${i + 4}`).join(', ')}) RETURNING *`,
      [m.orgId, m.workspaceId, m.userId, ...keys.map((k) => asDb(k, b[k]))])).rows[0];
      await audit(tx, m, 'create', 'agent', row.id);
      return { status: 201, body: camel(row) };
    }, { action: 'build' });
  });

  r.patch(`${T}/agents/:id`, (ctx) => {
    const b = parse(v.object(Object.fromEntries(Object.entries(AGENT_FIELDS).map(([k, c]) => [k, v.optional(c)])), { atLeastOne: true }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const keys = Object.keys(b);
      const row = (await tx.query(`UPDATE agents SET ${keys.map((k, i) => `${AGENT_COLS[k]} = $${i + 2}`).join(', ')}
        WHERE id = $1 AND archived_at IS NULL RETURNING *`, [ctx.params.id, ...keys.map((k) => asDb(k, b[k]))])).rows[0];
      if (!row) throw notFound('agent not found');
      await audit(tx, m, 'update', 'agent', row.id);
      return camel(row);
    }, { action: 'build' });
  });

  r.delete(`${T}/agents/:id`, (ctx) => ctx.tenant(async (tx, m) => {
    const row = (await tx.query(`UPDATE agents SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id`, [ctx.params.id])).rows[0];
    if (!row) throw notFound('agent not found');
    await tx.query(`UPDATE routines SET active = false WHERE agent_id = $1`, [row.id]);
    await audit(tx, m, 'archive', 'agent', row.id);
    return { status: 204 };
  }, { action: 'build' }));

  // ?before=<ISO> for older pages
  r.get(`${T}/agents/:id/messages`, (ctx) => {
    const q = parse(v.object({ before: v.optional(v.datetime()), limit: v.optional(v.int({ min: 1, max: 200 })) }), ctx.query);
    return ctx.tenant(async (tx) => {
      if (!(await tx.query(`SELECT 1 FROM agents WHERE id = $1`, [ctx.params.id])).rows.length) throw notFound('agent not found');
      const rows = (await tx.query(`SELECT id, sender, author_id, body, meta, created_at FROM agent_messages
        WHERE agent_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2) ORDER BY created_at DESC LIMIT $3`,
      [ctx.params.id, q.before ?? null, q.limit ?? 50])).rows;
      return { items: rows.reverse().map(camel) };
    }, { action: 'team_view' });
  });

  // Send a message to an agent. Two short transactions around the model call, so a slow model never holds
  // a database transaction open; if the model fails, the person's message is kept and the answer is 502.
  r.post(`${T}/agents/:id/messages`, async (ctx) => {
    // `about.label` is accepted (the console sends it) and ignored: the label is built here from the row itself.
    const b = parse(v.object({ body: v.string({ min: 1, max: 8000, trim: false }), modelTier: v.optional(v.oneOf(TIERS)),
      about: v.optional(v.object({ kind: v.oneOf(ABOUT_KINDS), id: v.string({ min: 1, max: 64 }), label: v.optional(v.string({ max: 300 })) })),
      mode: v.optional(v.oneOf(MODES)) }), ctx.body);
    const mode = b.mode ?? 'ask';
    if (!ctx.allow(`chat:${ctx.user.id}`, 30, 60000, ctx.now().getTime())) throw new HttpError(429, 'rate_limited', 'slow down a little');
    const { agent, userMsg, history, about, rows } = await ctx.tenant(async (tx, m) => {
      const a = (await tx.query(`SELECT * FROM agents WHERE id = $1 AND archived_at IS NULL`, [ctx.params.id])).rows[0];
      if (!a) throw notFound('agent not found');
      // Resolve what the question is about BEFORE the message is stored: an unknown or other-workspace object is a 404
      // and leaves no trace; a role that can't open that kind of object is a 403.
      let loaded = null;
      if (b.about) {
        if (!can(m, ABOUT_ACTION[b.about.kind])) throw forbidden();
        loaded = await loadAbout(tx, m, b.about);
        if (!loaded) throw notFound(`${b.about.kind} not found`);
      }
      const um = (await tx.query(`INSERT INTO agent_messages (org_id, workspace_id, agent_id, sender, author_id, body, meta)
        VALUES ($1, $2, $3, 'user', $4, $5, $6) RETURNING id, sender, author_id, body, meta, created_at`,
      [m.orgId, m.workspaceId, a.id, m.userId, b.body, JSON.stringify({ ...(loaded ? { about: loaded.about } : {}), ...(b.mode ? { mode } : {}) })])).rows[0];
      const h = (await tx.query(`SELECT sender, body FROM agent_messages WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [a.id, HISTORY])).rows.reverse();
      return { agent: a, userMsg: um, history: h, about: loaded?.about ?? null, rows: loaded?.rows ?? [] };
    }, { action: 'build' });

    const tier = b.modelTier ?? agent.model_tier;
    const started = Date.now();
    // The data goes after the question, inside its blocks; the mode's steering is system text, away from the data.
    const context = buildContext({ mode, rows });
    const messages = history.map((x) => ({ role: x.sender === 'user' ? 'user' : 'model', text: x.body }));
    if (context.text) messages[messages.length - 1] = { ...messages.at(-1), text: `${messages.at(-1).text}\n\n${context.text}` };
    const steer = modeSteer(mode);
    let out;
    try {
      out = await ctx.model.generate({
        tier,
        system: `${HOUSE_RULES}\n\nYour role (${agent.name}):\n${agent.system_prompt || 'General assistant.'}${steer ? `\n\n${steer}` : ''}`,
        messages,
      });
    } catch {
      throw new HttpError(502, 'model_unavailable', 'the model did not answer; your message was saved', { userMessage: camel(userMsg) });
    }
    const reply = await ctx.tenant(async (tx, m) => (await tx.query(
      `INSERT INTO agent_messages (org_id, workspace_id, agent_id, sender, body, meta)
       VALUES ($1, $2, $3, 'agent', $4, $5) RETURNING id, sender, author_id, body, meta, created_at`,
      [m.orgId, m.workspaceId, agent.id, out.text.slice(0, 32000),
        JSON.stringify({ model: out.model, tier, ms: Date.now() - started, usage: out.usage,
          ...(about ? { about } : {}), ...(b.mode ? { mode } : {}), ...(context.sources.length ? { sources: context.sources } : {}) })])).rows[0], { action: 'build' });
    return { status: 201, body: { userMessage: camel(userMsg), reply: camel(reply) } };
  });

  r.get(`${T}/routines`, (ctx) => ctx.tenant(async (tx) => {
    const rows = (await tx.query(`SELECT rt.*, a.name AS agent_name FROM routines rt LEFT JOIN agents a ON a.id = rt.agent_id
      ORDER BY rt.created_at`)).rows;
    return { items: rows.map((x) => ({ ...camel(x), pausedByOps: x.paused_reason !== null })) };
  }, { action: 'team_view' }));

  r.post(`${T}/routines`, (ctx) => {
    const b = parse(v.object({ ...ROUTINE_FIELDS, active: v.optional(ROUTINE_FIELDS.active), agentId: v.optional(ROUTINE_FIELDS.agentId) }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const keys = Object.keys(b);
      const row = (await tx.query(`INSERT INTO routines (org_id, workspace_id, ${keys.map((k) => ROUTINE_COLS[k]).join(', ')})
        VALUES ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING *`, [m.orgId, m.workspaceId, ...keys.map((k) => b[k])])).rows[0];
      await audit(tx, m, 'create', 'routine', row.id);
      return { status: 201, body: camel(row) };
    }, { action: 'build' });
  });

  r.patch(`${T}/routines/:id`, (ctx) => {
    const b = parse(v.object(Object.fromEntries(Object.entries(ROUTINE_FIELDS).map(([k, c]) => [k, v.optional(c)])), { atLeastOne: true }), ctx.body);
    return ctx.tenant(async (tx, m) => {
      const keys = Object.keys(b);
      const row = (await tx.query(`UPDATE routines SET ${keys.map((k, i) => `${ROUTINE_COLS[k]} = $${i + 2}`).join(', ')}
        WHERE id = $1 RETURNING *`, [ctx.params.id, ...keys.map((k) => b[k])])).rows[0];
      if (!row) throw notFound('routine not found');
      await audit(tx, m, 'update', 'routine', row.id);
      return { ...camel(row), pausedByOps: row.paused_reason !== null };
    }, { action: 'build' });
  });
}
