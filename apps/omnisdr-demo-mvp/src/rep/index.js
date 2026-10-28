// Rep sales portal: /rep (the page) and /rep/api/* (JSON over D1 omnisdr-rep). Design: omnisdr-pivot/DESIGN-rep-portal.md.
// Every route, the page included, needs a verified Cloudflare Access identity that is an active row in `reps`. Fail closed:
// no Access config, no token, a bad token or an unknown email all stop here. A rep reads and writes only accounts they own;
// an admin sees everyone's. Every write lands in `audit` in the same D1 batch as the change.
import repHtml from './rep.html';
import CSS from '../base.css';
import LOGO from '../logo.txt';
import { accessVerifier, AccessError, ACCESS_HEADER, identityFor } from './access.js';
import { afterCall, RULES, STAGES, OUTCOMES, addDays } from './rules.js';
import * as C from './content.js';
import * as K from './toolkit.js';
import * as M from './mix.js';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff' } });
class Bad extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new Bad(400, msg), notFound = (what) => new Bad(404, `No such ${what}`), forbidden = () => new Bad(403, 'Your role cannot do that');
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

/* ---------- identity ---------- */
let verifier = null, verifierKey = '';
async function identity(req, env) {
  const host = new URL(req.url).hostname;
  // Local development only: both a localhost host AND a dev email from .dev.vars. Production sets neither.
  if (env.REP_DEV_EMAIL && (host === 'localhost' || host === '127.0.0.1')) return identityFor(env.REP_DEV_EMAIL);
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) throw new AccessError(401, 'sign-in is not configured');
  if (!verifier || verifierKey !== env.ACCESS_TEAM + '|' + env.ACCESS_AUD) {
    verifier = accessVerifier({ teamDomain: env.ACCESS_TEAM, aud: env.ACCESS_AUD }); verifierKey = env.ACCESS_TEAM + '|' + env.ACCESS_AUD;
  }
  return verifier(req.headers.get(ACCESS_HEADER));
}
async function repFor(env, email) {
  let me = await env.REP_DB.prepare('SELECT email, name, role, active FROM reps WHERE email = ?').bind(email).first();
  // First sign-in of the owner: the admin email is a Worker secret, never in the repo.
  if (!me && env.REP_ADMIN_EMAIL && identityFor(env.REP_ADMIN_EMAIL) === email) {
    await env.REP_DB.batch([
      env.REP_DB.prepare("INSERT INTO reps (email, name, role, active, created_at) VALUES (?, 'Christian', 'admin', 1, ?)").bind(email, now()),
      audit(env, email, 'bootstrap_admin', 'rep', email, null, { role: 'admin' }),
    ]);
    me = { email, name: 'Christian', role: 'admin', active: 1 };
  }
  if (!me || !me.active) throw new AccessError(403, 'This email is not on the rep list. Ask Christian to add you.');
  return me;
}

/* ---------- helpers ---------- */
function audit(env, actor, action, entity, id, before, after) {
  return env.REP_DB.prepare('INSERT INTO audit (actor, action, entity, entity_id, before, after, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(actor, action, entity, id, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), now());
}
async function body(req, cap = 16384) {
  const t = req.headers.get('content-type') || '';
  if (!t.startsWith('application/json')) throw new Bad(415, 'Send JSON');
  const len = Number(req.headers.get('content-length') || 0); if (len > cap) throw new Bad(413, 'Request too large');
  const text = await req.text(); if (text.length > cap) throw new Bad(413, 'Request too large');
  let v; try { v = JSON.parse(text); } catch { throw bad('That was not valid JSON'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('Send a JSON object');
  return v;
}
const str = (v, max, field, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${field} is required`); return null; }
  if (typeof v !== 'string') throw bad(`${field} must be text`);
  const s = v.trim(); if (s.length > max) throw bad(`${field} is limited to ${max} characters`);
  if (required && !s) throw bad(`${field} is required`);
  return s || null;
};
const iso = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw bad(`${field} must be a date and time`);
  return new Date(v).toISOString();
};
const email = (v) => { const s = str(v, 200, 'Email'); if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('That email does not look right'); return s ? s.toLowerCase() : null; };
const phone = (v) => { const s = str(v, 40, 'Phone'); if (s && !/^[+\d][\d\s().-]{6,}$/.test(s)) throw bad('That phone number does not look right'); return s; };
const website = (v) => { const s = str(v, 300, 'Website'); if (s && !/^https?:\/\/[^\s]+$/i.test(s)) return 'https://' + s.replace(/^\/+/, ''); return s; };
const isAdmin = (me) => me.role === 'admin';

async function account(env, me, id) {
  const a = await env.REP_DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  if (!a || (!isAdmin(me) && a.owner_email !== me.email)) throw notFound('account'); // not 403: a rep cannot probe other reps' ids
  return a;
}
const obj = (v) => { try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const shape = (a) => a && ({ ...a, onboarding: obj(a.onboarding), audit: obj(a.audit), archived: !!a.archived });
// A rep always sees only their own rows. An admin sees everyone, or one rep when the page passes ?owner= (the Viewing switch).
const who = (me, col, view = null) => !isAdmin(me) ? { sql: `${col} = ?`, args: [me.email] } : view ? { sql: `${col} = ?`, args: [view] } : { sql: '1 = 1', args: [] };
const scope = (me, alias = '', view = null) => who(me, `${alias}owner_email`, view);

/* ---------- routes ---------- */
const ACCOUNT_FIELDS = { business: (v) => str(v, 160, 'Business name', { required: true }), niche: (v) => str(v, 80, 'Niche') ?? '', website, phone, email,
  address: (v) => str(v, 200, 'Address'), city: (v) => str(v, 80, 'City'), state: (v) => str(v, 40, 'State'), zip: (v) => str(v, 20, 'ZIP'),
  signal: (v) => str(v, 300, 'Signal') ?? '', next_step: (v) => str(v, 200, 'Next step') ?? '', next_action_at: (v) => iso(v, 'Next action time'), notes: (v) => str(v, 4000, 'Notes') ?? '' };

async function createAccount(env, me, b, source = 'manual') {
  const id = uid(), t = now(), row = { id, owner_email: me.email, source, stage: 'new', created_at: t, updated_at: t, onboarding: '{}' };
  for (const [k, f] of Object.entries(ACCOUNT_FIELDS)) row[k] = f(b[k]);
  if (isAdmin(me) && b.owner_email) {
    const o = await env.REP_DB.prepare('SELECT email FROM reps WHERE email = ? AND active = 1').bind(email(b.owner_email)).first();
    if (!o) throw bad('That owner is not an active rep'); row.owner_email = o.email;
  }
  const cols = Object.keys(row);
  const stmts = [env.REP_DB.prepare(`INSERT INTO accounts (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...cols.map((c) => row[c])),
    env.REP_DB.prepare("INSERT INTO activities (id, account_id, rep_email, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(uid(), id, me.email, source === 'csv' ? 'import' : 'note', source === 'csv' ? 'Imported from CSV' : 'Account created', t),
    audit(env, me.email, 'create', 'account', id, null, row)];
  const c = b.contact;
  if (c && typeof c === 'object' && str(c.name, 120, 'Contact name')) {
    stmts.push(env.REP_DB.prepare('INSERT INTO contacts (id, account_id, name, role, phone, email, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .bind(uid(), id, str(c.name, 120, 'Contact name'), str(c.role, 80, 'Contact role') ?? '', phone(c.phone), email(c.email), t));
  }
  return { id, stmts };
}

async function runRules(env, me) {
  const t = now(), s = scope(me);
  const stmts = RULES.map((r) => env.REP_DB.prepare(
    `INSERT OR IGNORE INTO tasks (id, account_id, rep_email, kind, title, due_at, status, auto_key, created_at)
     SELECT lower(hex(randomblob(16))), id, owner_email, 'follow_up', ?, ?, 'open', ? || ':' || id, ?
     FROM accounts WHERE archived = 0 AND ${s.sql} AND ${r.where}`).bind(r.title, t, r.key, t, ...s.args, addDays(t, -r.days)));
  await env.REP_DB.batch(stmts);
}

function csvParse(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
// A cell starting with = + - @ would run as a formula when the export is opened in a spreadsheet.
const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const EXPORT_COLS = ['business', 'niche', 'stage', 'phone', 'email', 'website', 'city', 'state', 'signal', 'next_step', 'next_action_at', 'last_touch_at', 'owner_email', 'notes'];

async function api(req, env, me, path, m) {
  const D = env.REP_DB, seg = path.split('/').filter(Boolean); // e.g. ['accounts', ':id', 'contacts']
  const view = isAdmin(me) ? email(new URL(req.url).searchParams.get('owner') || null) : null;
  const s = scope(me, '', view);

  if (m === 'GET' && path === '/me') return { email: me.email, name: me.name, role: me.role };
  if (m === 'GET' && path === '/content') return { prices: C.PRICES, pay: C.PAY, taxNote: C.TAX_NOTE, pricingGuide: C.PRICING_GUIDE, path: C.PATH, pathGate: C.PATH_GATE, how: C.HOW, objections: C.OBJECTIONS, method: C.OBJECTION_METHOD, never: C.NEVER_SAY, swaps: C.SWAPS, opener: C.OPENER, demoSteps: C.DEMO_STEPS, demoLimits: C.DEMO_LIMITS, onboarding: C.ONBOARDING_FIELDS, stages: STAGES, outcomes: OUTCOMES, pilot: C.PILOT, mix: { overage: M.MIX.overage, minMinutes: M.MIX.minMinutes, minTexts: M.MIX.minTexts },
    templates: K.TEMPLATES, qualify: K.QUALIFY, discovery: K.DISCOVERY, auditSteps: K.AUDIT_STEPS, auditFields: K.AUDIT_FIELDS, resultsCall: K.RESULTS_CALL, resultsSay: K.RESULTS_SAY, resultsDont: K.RESULTS_DONT,
    afterYes: K.AFTER_YES, safety: K.SAFETY, daily: K.DAILY, glossary: K.GLOSSARY, brand: K.BRAND, resources: K.RESOURCES };

  if (m === 'GET' && path === '/today') {
    await runRules(env, me);
    const end = new Date(); end.setUTCHours(23, 59, 59, 999); const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const wt = who(me, 't.rep_email', view), wc = who(me, 'rep_email', view);
    const [tasks, calls, stages] = await D.batch([
      D.prepare(`SELECT t.*, a.business, a.stage FROM tasks t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.status = 'open' AND t.due_at <= ? AND ${wt.sql} ORDER BY t.due_at LIMIT 200`).bind(end.toISOString(), ...wt.args),
      D.prepare(`SELECT outcome, COUNT(*) n FROM calls WHERE created_at >= ? AND ${wc.sql} GROUP BY outcome`).bind(dayStart.toISOString(), ...wc.args),
      D.prepare(`SELECT stage, COUNT(*) n FROM accounts WHERE archived = 0 AND ${s.sql} GROUP BY stage`).bind(...s.args),
    ]);
    const by = Object.fromEntries(calls.results.map((r) => [r.outcome, r.n]));
    const attempts = calls.results.reduce((n, r) => n + r.n, 0);
    const conversations = (by.interested || 0) + (by.not_interested || 0) + (by.callback_scheduled || 0);
    return { tasks: tasks.results, counts: { attempts, conversations, interested: by.interested || 0 }, stages: Object.fromEntries(stages.results.map((r) => [r.stage, r.n])) };
  }

  if (m === 'GET' && path === '/queue') {
    const r = await D.prepare(`SELECT a.*, (SELECT name FROM contacts c WHERE c.account_id = a.id ORDER BY is_primary DESC LIMIT 1) contact_name
      FROM accounts a WHERE a.archived = 0 AND a.stage IN ('new','results_call','proposed') AND (a.next_action_at IS NULL OR a.next_action_at <= ?) AND ${scope(me, 'a.', view).sql}
      ORDER BY COALESCE(a.next_action_at, a.created_at) LIMIT 100`).bind(addDays(now(), 0.5), ...s.args).all();
    return { accounts: r.results.map(shape) };
  }

  if (seg[0] === 'accounts') {
    if (m === 'GET' && seg.length === 1) {
      const u = new URL(req.url), where = [`archived = ${u.searchParams.get('archived') === '1' ? 1 : 0}`, s.sql], args = [...s.args];
      const st = u.searchParams.get('stage'); if (st) { if (!STAGES.includes(st)) throw bad('Unknown stage'); where.push('stage = ?'); args.push(st); }
      const ni = u.searchParams.get('niche'); if (ni != null && ni !== '') { where.push('niche = ?'); args.push(ni === '(none)' ? '' : ni.slice(0, 80)); }
      const sa = u.searchParams.get('state'); if (sa) { where.push('state = ?'); args.push(sa.slice(0, 40)); }
      // The pool: leads still held by an admin, waiting to be handed out. Admin only; a rep's scope already limits them.
      if (isAdmin(me) && u.searchParams.get('pool') === '1') where.push("owner_email IN (SELECT email FROM reps WHERE role = 'admin')");
      const q = (u.searchParams.get('q') || '').trim().slice(0, 80); if (q) { where.push("(business LIKE ? ESCAPE '\\' OR niche LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')"); const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'; args.push(like, like, like, like); }
      const r = await D.prepare(`SELECT * FROM accounts WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`).bind(...args).all();
      return { accounts: r.results.map(shape) };
    }
    if (m === 'POST' && seg.length === 1) { const b = await body(req); const { id, stmts } = await createAccount(env, me, b); await D.batch(stmts); return { account: shape(await account(env, me, id)) }; }
    const a = await account(env, me, seg[1]);
    if (m === 'GET' && seg.length === 2) {
      const [contacts, acts, tasks, calls, deals] = await D.batch([
        D.prepare('SELECT * FROM contacts WHERE account_id = ? ORDER BY is_primary DESC, created_at').bind(a.id),
        D.prepare('SELECT * FROM activities WHERE account_id = ? ORDER BY created_at DESC LIMIT 100').bind(a.id),
        D.prepare("SELECT * FROM tasks WHERE account_id = ? AND status = 'open' ORDER BY due_at").bind(a.id),
        D.prepare('SELECT * FROM calls WHERE account_id = ? ORDER BY created_at DESC LIMIT 50').bind(a.id),
        D.prepare('SELECT * FROM deals WHERE account_id = ? ORDER BY closed_at DESC').bind(a.id),
      ]);
      return { account: shape(a), contacts: contacts.results, activities: acts.results, tasks: tasks.results, calls: calls.results, deals: deals.results };
    }
    if (m === 'PATCH' && seg.length === 2) {
      const b = await body(req), set = {}, t = now();
      for (const [k, f] of Object.entries(ACCOUNT_FIELDS)) if (k in b) set[k] = f(b[k]);
      if ('stage' in b) { if (!STAGES.includes(b.stage)) throw bad('Unknown stage'); if (['onboarding', 'live'].includes(b.stage) && !isAdmin(me)) throw forbidden(); set.stage = b.stage; }
      if ('archived' in b) set.archived = b.archived ? 1 : 0;
      if ('onboarding' in b) {
        if (!b.onboarding || typeof b.onboarding !== 'object' || Array.isArray(b.onboarding)) throw bad('Onboarding must be an object');
        const o = {}; for (const f of C.ONBOARDING_FIELDS) { const v = str(b.onboarding[f.key], 1000, f.label); if (v) o[f.key] = v; }
        set.onboarding = JSON.stringify(o);
      }
      if ('audit' in b) {
        if (!b.audit || typeof b.audit !== 'object' || Array.isArray(b.audit)) throw bad('Audit must be an object');
        const o = {}; for (const f of K.AUDIT_FIELDS) { const v = str(b.audit[f.key], 1000, f.label); if (v) o[f.key] = v; }
        set.audit = JSON.stringify(o);
      }
      if (!Object.keys(set).length) throw bad('Nothing to change');
      set.updated_at = t;
      const stmts = [D.prepare(`UPDATE accounts SET ${Object.keys(set).map((k) => k + ' = ?').join(', ')} WHERE id = ?`).bind(...Object.values(set), a.id), audit(env, me.email, 'update', 'account', a.id, a, set)];
      if (set.stage && set.stage !== a.stage) stmts.push(D.prepare("INSERT INTO activities (id, account_id, rep_email, kind, body, created_at) VALUES (?, ?, ?, 'stage', ?, ?)").bind(uid(), a.id, me.email, `Stage: ${a.stage} to ${set.stage}`, t));
      await D.batch(stmts);
      return { account: shape(await account(env, me, a.id)) };
    }
    if (m === 'POST' && seg[2] === 'contacts') {
      const b = await body(req), id = uid(), t = now();
      const row = { name: str(b.name, 120, 'Name', { required: true }), role: str(b.role, 80, 'Role') ?? '', phone: phone(b.phone), email: email(b.email), is_primary: b.isPrimary ? 1 : 0 };
      const stmts = [];
      if (row.is_primary) stmts.push(D.prepare('UPDATE contacts SET is_primary = 0 WHERE account_id = ?').bind(a.id));
      stmts.push(D.prepare('INSERT INTO contacts (id, account_id, name, role, phone, email, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, a.id, row.name, row.role, row.phone, row.email, row.is_primary, t), audit(env, me.email, 'create', 'contact', id, null, row));
      await D.batch(stmts); return { ok: true, id };
    }
    if (m === 'POST' && seg[2] === 'notes') {
      const b = await body(req), kind = b.kind || 'note';
      if (!['note', 'email', 'text', 'demo'].includes(kind)) throw bad('Unknown note kind');
      const text = str(b.body, 2000, 'Note', { required: true }), id = uid(), t = now();
      await D.batch([D.prepare('INSERT INTO activities (id, account_id, rep_email, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, a.id, me.email, kind, text, t),
        D.prepare('UPDATE accounts SET last_touch_at = ?, updated_at = ? WHERE id = ?').bind(t, t, a.id), audit(env, me.email, 'create', 'activity', id, null, { kind })]);
      return { ok: true };
    }
  }

  if (m === 'DELETE' && seg[0] === 'contacts' && seg.length === 2) {
    const c = await D.prepare('SELECT * FROM contacts WHERE id = ?').bind(seg[1]).first(); if (!c) throw notFound('contact');
    await account(env, me, c.account_id);
    await D.batch([D.prepare('DELETE FROM contacts WHERE id = ?').bind(c.id), audit(env, me.email, 'delete', 'contact', c.id, c, null)]);
    return { ok: true };
  }

  if (m === 'POST' && path === '/calls') {
    const b = await body(req), a = await account(env, me, str(b.accountId, 64, 'Account', { required: true }));
    if (!OUTCOMES.includes(b.outcome)) throw bad('Pick how the call went');
    const t = now(), callbackAt = iso(b.callbackAt, 'Callback time');
    if (b.outcome === 'callback_scheduled' && (!callbackAt || callbackAt < t)) throw bad('Pick a callback time in the future');
    const note = str(b.note, 1000, 'Note') ?? '', next = afterCall({ outcome: b.outcome, stage: a.stage, callbackAt, now: t });
    const callId = uid(), stmts = [
      D.prepare('INSERT INTO calls (id, account_id, rep_email, outcome, note, callback_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(callId, a.id, me.email, b.outcome, note, callbackAt, t),
      // This call is the follow-up the open ones asked for.
      D.prepare("UPDATE tasks SET status = 'done', done_at = ? WHERE account_id = ? AND status = 'open' AND kind IN ('follow_up','callback')").bind(t, a.id),
      D.prepare('INSERT INTO activities (id, account_id, rep_email, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(uid(), a.id, me.email, 'call', b.outcome.replace(/_/g, ' ') + (note ? ': ' + note : ''), t),
      D.prepare('UPDATE accounts SET last_touch_at = ?, updated_at = ?, stage = COALESCE(?, stage), next_action_at = ? WHERE id = ?').bind(t, t, next.stage, next.task ? next.task.dueAt : null, a.id),
      audit(env, me.email, 'create', 'call', callId, null, { outcome: b.outcome, stage: next.stage }),
    ];
    if (next.stage && next.stage !== a.stage) stmts.push(D.prepare("INSERT INTO activities (id, account_id, rep_email, kind, body, created_at) VALUES (?, ?, ?, 'stage', ?, ?)").bind(uid(), a.id, me.email, `Stage: ${a.stage} to ${next.stage}`, t));
    if (next.task) stmts.push(D.prepare("INSERT INTO tasks (id, account_id, rep_email, kind, title, due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)").bind(uid(), a.id, a.owner_email, next.task.kind, next.task.title, next.task.dueAt, t));
    await D.batch(stmts);
    return { ok: true, stage: next.stage ?? a.stage, task: next.task };
  }

  if (seg[0] === 'tasks') {
    if (m === 'GET' && seg.length === 1) {
      const u = new URL(req.url), from = iso(u.searchParams.get('from'), 'From') ?? addDays(now(), -7), to = iso(u.searchParams.get('to'), 'To') ?? addDays(now(), 35);
      const r = await D.prepare(`SELECT t.*, a.business FROM tasks t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.status = 'open' AND t.due_at >= ? AND t.due_at <= ? AND ${who(me, 't.rep_email', view).sql} ORDER BY t.due_at LIMIT 500`).bind(from, to, ...who(me, 't.rep_email', view).args).all();
      return { tasks: r.results };
    }
    if (m === 'POST' && seg.length === 1) {
      const b = await body(req), kind = b.kind || 'follow_up';
      if (!['follow_up', 'callback', 'demo', 'onboarding'].includes(kind)) throw bad('Unknown task kind');
      const accId = b.accountId ? (await account(env, me, String(b.accountId))).id : null;
      const dueAt = iso(b.dueAt, 'Due time'); if (!dueAt) throw bad('Pick when it is due');
      const id = uid(), row = { kind, title: str(b.title, 200, 'Title', { required: true }), due_at: dueAt };
      await D.batch([D.prepare("INSERT INTO tasks (id, account_id, rep_email, kind, title, due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)").bind(id, accId, me.email, row.kind, row.title, row.due_at, now()), audit(env, me.email, 'create', 'task', id, null, row)]);
      return { ok: true, id };
    }
    if (m === 'PATCH' && seg.length === 2) {
      const tk = await D.prepare('SELECT * FROM tasks WHERE id = ?').bind(seg[1]).first();
      if (!tk || (!isAdmin(me) && tk.rep_email !== me.email)) throw notFound('task');
      const b = await body(req), set = {};
      if ('status' in b) { if (!['open', 'done', 'dropped'].includes(b.status)) throw bad('Unknown status'); set.status = b.status; set.done_at = b.status === 'open' ? null : now(); }
      if ('dueAt' in b) { const d = iso(b.dueAt, 'Due time'); if (!d) throw bad('Pick when it is due'); set.due_at = d; }
      if (!Object.keys(set).length) throw bad('Nothing to change');
      await D.batch([D.prepare(`UPDATE tasks SET ${Object.keys(set).map((k) => k + ' = ?').join(', ')} WHERE id = ?`).bind(...Object.values(set), tk.id), audit(env, me.email, 'update', 'task', tk.id, tk, set)]);
      return { ok: true };
    }
  }

  // The slider's steps for a pilot price. The price only picks the allowance; nothing on this route can change either.
  if (m === 'GET' && path === '/mix') {
    const price = Number(new URL(req.url).searchParams.get('priceCents'));
    if (!Number.isInteger(price) || price < C.PILOT.minCents || price > C.PILOT.maxCents) throw bad('Pick a pilot price first');
    const steps = M.mixSteps(C.pilotSplit(price).allowanceCents);
    if (!steps) throw bad('That allowance is too small for a mix');
    return { allowanceCents: C.pilotSplit(price).allowanceCents, ...steps };
  }

  if (path === '/deals') {
    if (m === 'GET') {
      const r = await D.prepare(`SELECT d.*, a.business, a.niche, a.stage FROM deals d JOIN accounts a ON a.id = d.account_id WHERE ${who(me, 'd.rep_email', view).sql} ORDER BY d.closed_at DESC LIMIT 200`).bind(...who(me, 'd.rep_email', view).args).all();
      return { deals: r.results.map((d) => ({ ...(d.level === 1 ? { ...d, ...C.pilotSplit(d.price_cents) } : d), mix: d.mix ? obj(d.mix) : null })) };
    }
    if (m === 'POST') {
      const b = await body(req), a = await account(env, me, str(b.accountId, 64, 'Account', { required: true }));
      if (['onboarding', 'live'].includes(a.stage)) throw new Bad(409, 'This account is already signed');
      const lvl = C.PRICES.levels.find((l) => l.level === Number(b.level) && l.level > 0);
      if (!lvl) throw bad('Pick a level');
      // No discounts: a rep never sets the price. Only quotable levels with a set amount; an admin may enter a price for the rest.
      let price;
      if (lvl.level === 1) { // the rep sets the pilot price, never below the floor
        price = b.priceCents == null ? C.PILOT.minCents : b.priceCents;
        if (!Number.isInteger(price) || price < C.PILOT.minCents) throw bad('The pilot starts at $499');
        if (price > C.PILOT.maxCents) throw bad('That is above a pilot. Send it to Christian as a custom quote');
      } else if (lvl.quotable && lvl.amountCents != null) price = lvl.amountCents;
      else if (isAdmin(me) && Number.isInteger(b.priceCents) && b.priceCents > 0 && b.priceCents <= 10_000_000) price = b.priceCents;
      else throw isAdmin(me) ? bad('Enter the agreed price for this level') : forbidden();
      // The usage mix is chosen by a slider position. A rep may move it freely: it never touches price, allowance or pay.
      let mix = null;
      if (lvl.level === 1) {
        mix = M.resolveMix(C.pilotSplit(price).allowanceCents, b.mixPosition ?? null);
        if (mix === undefined) throw bad('That is not a position on the mix slider');
      } else if (b.mixPosition != null) throw bad('The mix slider is for pilots');
      const id = uid(), t = now(), notes = str(b.notes, 1000, 'Notes') ?? '';
      await D.batch([
        D.prepare('INSERT INTO deals (id, account_id, rep_email, level, price_cents, price_is_draft, notes, closed_at, mix) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, a.id, a.owner_email, lvl.level, price, C.PRICES.isFinal ? 0 : 1, notes, t, mix && JSON.stringify(mix)),
        D.prepare("UPDATE accounts SET stage = 'onboarding', updated_at = ?, last_touch_at = ? WHERE id = ?").bind(t, t, a.id),
        D.prepare("INSERT INTO activities (id, account_id, rep_email, kind, body, created_at) VALUES (?, ?, ?, 'deal', ?, ?)").bind(uid(), a.id, me.email, `Closed: ${lvl.label}, ${(price / 100).toFixed(2)}${C.PRICES.isFinal ? '' : ' (draft price)'}${mix ? `, mix ${mix.minutes} min and ${mix.texts} texts` : ''}`, t),
        D.prepare("INSERT INTO tasks (id, account_id, rep_email, kind, title, due_at, status, created_at) VALUES (?, ?, ?, 'onboarding', 'Fill in the onboarding details with the owner', ?, 'open', ?)").bind(uid(), a.id, a.owner_email, addDays(t, 1), t),
        audit(env, me.email, 'create', 'deal', id, null, { level: lvl.level, price_cents: price, ...(mix ? { mix } : {}) }),
      ]);
      return { ok: true, id };
    }
  }

  if (m === 'GET' && path === '/export.csv') {
    const r = await D.prepare(`SELECT * FROM accounts WHERE archived = 0 AND ${s.sql} ORDER BY business`).bind(...s.args).all();
    await D.batch([audit(env, me.email, 'export', 'accounts', '*', null, { rows: r.results.length })]);
    const csv = [EXPORT_COLS.join(','), ...r.results.map((a) => EXPORT_COLS.map((c) => csvCell(a[c])).join(','))].join('\r\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }
  if (m === 'POST' && path === '/import') {
    const b = await body(req, 600_000), text = typeof b.csv === 'string' ? b.csv : '';
    const rows = csvParse(text); if (rows.length < 2) throw bad('The file needs a header row and at least one account');
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
    if (!head.includes('business')) throw bad('The header row needs a "business" column');
    if (rows.length > 1001) throw bad('Import up to 1,000 accounts at a time');
    const stmts = [], errors = [], fileOwner = isAdmin(me) ? email(b.owner || null) : null;
    for (let i = 1; i < rows.length; i++) {
      const o = Object.fromEntries(head.map((h, k) => [h, (rows[i][k] ?? '').trim()]));
      if (fileOwner && !o.owner_email) o.owner_email = fileOwner;
      try {
        const { stmts: s2 } = await createAccount(env, me, { ...o, next_action_at: undefined, contact: o.contact_name ? { name: o.contact_name, role: o.contact_role, phone: o.contact_phone, email: o.contact_email } : null }, 'csv');
        stmts.push(...s2);
      } catch (e) { if (!(e instanceof Bad)) throw e; errors.push({ row: i + 1, message: e.message }); }
    }
    if (errors.length) return { imported: 0, errors: errors.slice(0, 50) }; // all or nothing, so a fixed file can be re-imported cleanly
    for (let i = 0; i < stmts.length; i += 90) await D.batch(stmts.slice(i, i + 90));
    return { imported: rows.length - 1, errors: [] };
  }

  // Lead dashboard counts (admin only): live, non-archived leads by category, rep, stage and state.
  if (m === 'GET' && path === '/leads/facets') {
    if (!isAdmin(me)) throw forbidden();
    const q = (col) => D.prepare(`SELECT ${col} k, COUNT(*) n FROM accounts WHERE archived = 0 GROUP BY ${col} ORDER BY n DESC, k LIMIT 200`);
    const [niche, owner, stage, state, pool] = await D.batch([q('niche'), q('owner_email'), q('stage'), q('state'),
      D.prepare("SELECT COUNT(*) n FROM accounts WHERE archived = 0 AND owner_email IN (SELECT email FROM reps WHERE role = 'admin')")]);
    const m2 = (r) => r.results.map((x) => ({ key: x.k ?? '', n: x.n }));
    return { niche: m2(niche), owner: m2(owner), stage: m2(stage), state: m2(state), pool: pool.results[0]?.n || 0, total: stage.results.reduce((n, x) => n + x.n, 0) };
  }

  // Bulk category or archive (admin only). Same shape as /assign: validate everything, then write in batches.
  if (m === 'POST' && path === '/bulk') {
    if (!isAdmin(me)) throw forbidden();
    const b = await body(req), ids = Array.isArray(b.accountIds) ? [...new Set(b.accountIds)] : [];
    if (!ids.length || ids.length > 500 || !ids.every((x) => typeof x === 'string' && x.length <= 64)) throw bad('Pick between 1 and 500 accounts');
    const set = {};
    if ('niche' in b) set.niche = str(b.niche, 80, 'Category') ?? '';
    if ('archived' in b) set.archived = b.archived ? 1 : 0;
    if (!Object.keys(set).length) throw bad('Nothing to change');
    const found = (await D.prepare(`SELECT id, niche, archived FROM accounts WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
    if (found.length !== ids.length) throw notFound('account');
    const t = now(), stmts = [];
    for (const a of found) {
      stmts.push(D.prepare(`UPDATE accounts SET ${Object.keys(set).map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).bind(...Object.values(set), t, a.id),
        audit(env, me.email, 'bulk', 'account', a.id, { niche: a.niche, archived: a.archived }, set));
    }
    for (let i = 0; i < stmts.length; i += 90) await D.batch(stmts.slice(i, i + 90));
    return { updated: found.length };
  }

  // Hand leads to a rep (admin only). The rep's open tasks on those leads move with them; calls, notes and closed deals stay
  // credited to whoever did them. Everything is validated before the first write (an unknown id or rep writes nothing);
  // the writes then go out in D1 batches of 92 statements, so a move of more than 23 leads spans several batches.
  if (m === 'POST' && path === '/assign') {
    if (!isAdmin(me)) throw forbidden();
    const b = await body(req), ids = Array.isArray(b.accountIds) ? [...new Set(b.accountIds)] : [];
    if (!ids.length || ids.length > 500 || !ids.every((x) => typeof x === 'string' && x.length <= 64)) throw bad('Pick between 1 and 500 accounts');
    const to = email(b.owner); if (!to) throw bad('Pick a rep');
    const rep = await D.prepare('SELECT email, name FROM reps WHERE email = ? AND active = 1').bind(to).first();
    if (!rep) throw bad('That rep is not active');
    const found = (await D.prepare(`SELECT id, owner_email FROM accounts WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
    if (found.length !== ids.length) throw notFound('account');
    const t = now(), stmts = [];
    for (const a of found) {
      if (a.owner_email === to) continue;
      stmts.push(D.prepare('UPDATE accounts SET owner_email = ?, updated_at = ? WHERE id = ?').bind(to, t, a.id),
        D.prepare("UPDATE tasks SET rep_email = ? WHERE account_id = ? AND status = 'open'").bind(to, a.id),
        D.prepare("INSERT INTO activities (id, account_id, rep_email, kind, body, created_at) VALUES (?, ?, ?, 'note', ?, ?)").bind(uid(), a.id, me.email, `Assigned to ${rep.name}`, t),
        audit(env, me.email, 'assign', 'account', a.id, { owner_email: a.owner_email }, { owner_email: to }));
    }
    for (let i = 0; i < stmts.length; i += 92) await D.batch(stmts.slice(i, i + 92));
    return { assigned: stmts.length / 4 };
  }

  if (seg[0] === 'reps') {
    if (!isAdmin(me)) throw forbidden();
    if (m === 'GET') {
      const week = addDays(now(), -7);
      const [reps, stages, tasks, calls, deals] = await D.batch([
        D.prepare('SELECT email, name, role, active, created_at FROM reps ORDER BY created_at'),
        D.prepare('SELECT owner_email e, stage, COUNT(*) n FROM accounts WHERE archived = 0 GROUP BY owner_email, stage'),
        D.prepare("SELECT rep_email e, COUNT(*) n FROM tasks WHERE status = 'open' GROUP BY rep_email"),
        D.prepare('SELECT rep_email e, COUNT(*) n FROM calls WHERE created_at >= ? GROUP BY rep_email').bind(week),
        D.prepare('SELECT rep_email e, COUNT(*) n, SUM(price_cents) c FROM deals GROUP BY rep_email'),
      ]);
      const by = (rows) => Object.fromEntries(rows.results.map((r) => [r.e, r]));
      const tk = by(tasks), cl = by(calls), dl = by(deals);
      return { reps: reps.results.map((r) => {
        const st = Object.fromEntries(stages.results.filter((x) => x.e === r.email).map((x) => [x.stage, x.n]));
        return { ...r, stats: { leads: Object.values(st).reduce((n, v) => n + v, 0), stages: st, openTasks: tk[r.email]?.n || 0, calls7d: cl[r.email]?.n || 0, deals: dl[r.email]?.n || 0, soldCents: dl[r.email]?.c || 0 } };
      }) };
    }
    if (m === 'POST' && seg.length === 1) {
      const b = await body(req), e = email(b.email); if (!e) throw bad('Email is required');
      const role = b.role === 'admin' ? 'admin' : 'rep', name = str(b.name, 80, 'Name', { required: true });
      const ex = await D.prepare('SELECT email FROM reps WHERE email = ?').bind(e).first(); if (ex) throw new Bad(409, 'That email is already on the list');
      await D.batch([D.prepare('INSERT INTO reps (email, name, role, active, created_at) VALUES (?, ?, ?, 1, ?)').bind(e, name, role, now()), audit(env, me.email, 'create', 'rep', e, null, { name, role })]);
      return { ok: true };
    }
    if (m === 'PATCH' && seg.length === 2) {
      const e = decodeURIComponent(seg[1]).toLowerCase(), r = await D.prepare('SELECT * FROM reps WHERE email = ?').bind(e).first();
      if (!r) throw notFound('rep'); if (e === me.email) throw bad('You cannot change your own access');
      const b = await body(req), set = {};
      if ('active' in b) set.active = b.active ? 1 : 0;
      if ('role' in b) set.role = b.role === 'admin' ? 'admin' : 'rep';
      if (!Object.keys(set).length) throw bad('Nothing to change');
      await D.batch([D.prepare(`UPDATE reps SET ${Object.keys(set).map((k) => k + ' = ?').join(', ')} WHERE email = ?`).bind(...Object.values(set), e), audit(env, me.email, 'update', 'rep', e, r, set)]);
      return { ok: true };
    }
  }
  throw notFound('route');
}

/* ---------- page ---------- */
function page() {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const html = repHtml.replaceAll('__NONCE__', nonce).replace('__CSS__', CSS).replaceAll('__LOGO__', LOGO.trim());
  return new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow',
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
    'strict-transport-security': 'max-age=63072000; includeSubDomains', 'permissions-policy': 'microphone=(), camera=(), geolocation=()',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  } });
}
const deniedPage = (msg, status) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Rep portal · OmniSDR</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px"><h1 style="font-size:22px">You are not signed in to the rep portal.</h1><p>${msg.replace(/[<>&]/g, '')}</p><p><a href="/">Back to the front door</a></p>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });

export async function handleRep(req, env) {
  const u = new URL(req.url), p = u.pathname, m = req.method;
  const isApi = p.startsWith('/rep/api/');
  try {
    if (!env.REP_DB) throw new AccessError(503, 'The rep portal is not set up on this server');
    const me = await repFor(env, await identity(req, env));
    if (!isApi) {
      if (m === 'GET' && (p === '/rep' || p === '/rep/')) return page();
      return json({ ok: false, message: 'Not found' }, 404);
    }
    // Writes must come from our own page: a custom header no cross-site form can set, and a same-origin Origin when present.
    if (m !== 'GET') {
      if (req.headers.get('x-rep') !== '1') throw new Bad(403, 'Missing request header');
      const o = req.headers.get('origin'); if (o && o !== u.origin) throw new Bad(403, 'Cross-site request refused');
    }
    const out = await api(req, env, me, p.slice('/rep/api'.length), m);
    return out instanceof Response ? out : json(out);
  } catch (e) {
    if (e instanceof AccessError) return isApi ? json({ ok: false, message: e.message }, e.status) : deniedPage(e.message, e.status);
    if (e instanceof Bad) return json({ ok: false, message: e.message }, e.status);
    return json({ ok: false, message: 'Something went wrong. Try again.' }, 500);
  }
}
