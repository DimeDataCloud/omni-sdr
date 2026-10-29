// Admin Lead Engine: queue a sweep by ZIP and niche, stage what comes back, and let an admin add it to accounts.
// Sweeps run on GitHub Actions in the private engine repo (workflow_dispatch) and POST their rows to /engine/ingest with a shared
// secret, outside /rep because Actions has no Cloudflare Access login. Staged leads are never accounts until an admin adds them.
// Real lead data lives only in D1 (engine_results) and the runner's memory; nothing here is logged or written to a repo.
// ZIP prefixes the engine's Census file covers: New Jersey 070-089, Tennessee 370-385.
import { scan, cleanUrl, makeGet, NICHE_CONFIG, EXCLUDE } from './scan.js';
const STATES = [{ code: 'NJ', from: '070', to: '089' }, { code: 'TN', from: '370', to: '385' }];

export const NICHES = ['Plumbing', 'HVAC', 'Electrical', 'Garage doors', 'Locksmith', 'Towing', 'Well pumps', 'Roofing', 'Remodeling', 'Painting', 'Landscaping', 'Pool builders', 'Flooring and epoxy', 'Fencing and decks', 'Windows and siding', 'Martial arts', 'Water damage restoration', 'Pest control', 'Auto repair', 'House cleaning', 'Dog grooming', 'Appliance repair', 'Home inspection', 'Movers', 'Septic'];
const REPO = 'DimeDataCloud/OmniSDR-engine', WORKFLOW = 'sweep.yml', REF = 'main';
const now = () => new Date().toISOString();
const digits = (p) => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const safeEqual = (a, b) => { // constant time on equal-length digests of both sides
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let d = x.length ^ y.length; for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff' } });

export const zipState = (zip) => (/^\d{5}$/.test(zip) ? STATES.find((s) => zip.slice(0, 3) >= s.from && zip.slice(0, 3) <= s.to)?.code : null) || null;

/* ---------- admin routes, called from the rep API (identity and the x-rep CSRF header are already checked) ---------- */
export async function engineApi(env, me, path, m, req, h) {
  const { Bad, bad, forbidden, body, audit, createAccount, uid } = h, D = env.REP_DB;
  if (me.role !== 'admin') throw forbidden();
  const seg = path.split('/').filter(Boolean); // ['engine', 'jobs', ':id', ...]

  if (m === 'GET' && path === '/engine/config') {
    return { niches: NICHES, states: STATES.map((s) => ({ code: s.code, from: s.from, to: s.to })), connected: !!(env.ENGINE_DISPATCH_TOKEN && env.ENGINE_POST_SECRET), maxCap: 100, defaultCap: 25 };
  }
  if (m === 'GET' && path === '/engine/jobs') {
    const r = await D.prepare(`SELECT j.id, j.kind, j.zip, j.niche, j.url, j.cap, j.status, j.summary, j.error, j.created_by, j.created_at, j.updated_at,
      (SELECT COUNT(*) FROM engine_results e WHERE e.job_id = j.id AND e.state = 'staged') staged,
      (SELECT COUNT(*) FROM engine_results e WHERE e.job_id = j.id AND e.state = 'added') added
      FROM engine_jobs j ORDER BY j.created_at DESC LIMIT 40`).all();
    return { jobs: r.results.map((j) => ({ ...j, summary: safeObj(j.summary) })) };
  }
  if (m === 'POST' && path === '/engine/jobs') {
    const b = await body(req, 4096), zip = String(b.zip || '').trim(), niche = String(b.niche || '').trim();
    if (!/^\d{5}$/.test(zip)) throw bad('A ZIP is five digits');
    if (!zipState(zip)) throw bad('Sweeps cover New Jersey and Tennessee ZIPs for now');
    if (!NICHES.includes(niche)) throw bad('Pick a niche from the list');
    const cap = Math.min(100, Math.max(1, parseInt(b.cap ?? 25, 10) || 25));
    const open = await D.prepare("SELECT COUNT(*) n FROM engine_jobs WHERE kind = 'sweep' AND status IN ('queued', 'running') AND created_at > ?").bind(new Date(Date.now() - 3 * 3600e3).toISOString()).first();
    if (open.n >= 3) throw new Bad(429, 'Three sweeps are already running. Wait for one to finish.');
    const id = 'j' + uid().replaceAll('-', '').slice(0, 20), t = now();
    await D.batch([D.prepare("INSERT INTO engine_jobs (id, kind, zip, niche, cap, status, created_by, created_at, updated_at) VALUES (?, 'sweep', ?, ?, ?, 'queued', ?, ?, ?)").bind(id, zip, niche, cap, me.email, t, t),
      audit(env, me.email, 'engine_sweep', 'engine_job', id, null, { zip, niche, cap })]);
    const out = await dispatch(env, { id, zip, niche, cap });
    await D.prepare('UPDATE engine_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?').bind(out.ok ? 'running' : out.notConnected ? 'queued' : 'failed', out.ok ? null : out.message, now(), id).run();
    return { id, status: out.ok ? 'running' : out.notConnected ? 'queued' : 'failed', message: out.ok ? 'Sweep started. Results land here in a few minutes.' : out.message };
  }
  if (m === 'POST' && path === '/engine/scan') { // one link, read politely, scored; nothing is added until an admin clicks Add
    const b = await body(req, 4096), url = cleanUrl(b.url || '');
    if (!url) throw bad('Paste a public web address, like https://example.com');
    const open = await D.prepare("SELECT COUNT(*) n FROM engine_jobs WHERE kind = 'scan' AND created_at > ?").bind(new Date(Date.now() - 3600e3).toISOString()).first();
    if (open.n >= 30) throw new Bad(429, 'Thirty scans in the last hour. Try again later.');
    const result = await scan(url, { get: makeGet(env.ENGINE_FETCH || fetch, env.ENGINE_GAP_MS), niches: NICHE_CONFIG, excl: EXCLUDE });
    const id = 'j' + uid().replaceAll('-', '').slice(0, 20), t = now(), stmts = [];
    const p = digits(result.phone), state = zipState(result.zip || ''); let staged = null;
    if (result.status === 'read' && result.business && p.length === 10 && state) {
      const dupe = await D.prepare("SELECT 1 x FROM accounts WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '(', ''), ')', ''), '-', ''), ' ', ''), '+1', '') = ? LIMIT 1").bind(p).first();
      if (dupe) staged = 'duplicate';
      else { staged = 'staged'; stmts.push(D.prepare("INSERT INTO engine_results (id, job_id, phone, lead, state, created_at) VALUES (?, ?, ?, ?, 'staged', ?)").bind(crypto.randomUUID(), id, p, JSON.stringify({ business: FIELD(result.business, 160), niche: result.niche || '', website: FIELD(result.url, 300), phone: `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`, state, zip: result.zip, email: FIELD((result.emails || [])[0], 200), signal: `site scan score ${result.score}`, notes: FIELD((result.why || []).join('; '), 4000) }), t)); }
    }
    stmts.unshift(D.prepare("INSERT INTO engine_jobs (id, kind, url, cap, status, summary, created_by, created_at, updated_at) VALUES (?, 'scan', ?, 1, 'done', ?, ?, ?, ?)").bind(id, url, JSON.stringify({ status: result.status, score: result.score ?? null, solid: result.solid ?? null, staged: staged === 'staged' ? 1 : 0 }), me.email, t, t));
    stmts.push(audit(env, me.email, 'engine_scan', 'engine_job', id, null, { url, status: result.status }));
    await D.batch(stmts);
    return { id, staged, result };
  }
  if (seg[1] === 'jobs' && seg[2] && m === 'GET' && seg[3] === 'results') {
    const j = await D.prepare('SELECT id FROM engine_jobs WHERE id = ?').bind(seg[2]).first(); if (!j) throw new Bad(404, 'No such job');
    const r = await D.prepare("SELECT id, phone, lead, state, account_id FROM engine_results WHERE job_id = ? ORDER BY state = 'staged' DESC, created_at").bind(seg[2]).all();
    return { results: r.results.map((x) => ({ id: x.id, state: x.state, accountId: x.account_id, lead: safeObj(x.lead) })) };
  }
  if (seg[1] === 'jobs' && seg[2] && m === 'POST' && seg[3] === 'add') { // every staged lead of the job, all or nothing
    const rows = (await D.prepare("SELECT id, lead FROM engine_results WHERE job_id = ? AND state = 'staged'").bind(seg[2]).all()).results;
    return addStaged(env, me, rows, h);
  }
  if (seg[1] === 'results' && seg[2] && m === 'POST' && seg[3] === 'add') {
    const rows = (await D.prepare("SELECT id, lead FROM engine_results WHERE id = ? AND state = 'staged'").bind(seg[2]).all()).results;
    if (!rows.length) throw new Bad(404, 'That lead is not waiting to be added');
    return addStaged(env, me, rows, h);
  }
  if (seg[1] === 'results' && seg[2] && m === 'POST' && seg[3] === 'dismiss') {
    const r = await D.prepare("SELECT id FROM engine_results WHERE id = ? AND state = 'staged'").bind(seg[2]).first(); if (!r) throw new Bad(404, 'That lead is not waiting');
    await D.batch([D.prepare("UPDATE engine_results SET state = 'dismissed' WHERE id = ?").bind(seg[2]), audit(env, me.email, 'engine_dismiss', 'engine_result', seg[2], null, null)]);
    return { ok: true };
  }
  throw new Bad(404, 'No such route');
}

const safeObj = (v) => { try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

// Add staged leads to accounts, owned by the admin who clicked (they hand them out from the pool as usual). Deduped by phone against
// accounts; a lead that turned up since staging is marked added to nothing and counted as a duplicate.
async function addStaged(env, me, rows, h) {
  const { createAccount, audit, Bad } = h, D = env.REP_DB, stmts = [], seen = new Set();
  let dup = 0, added = 0, skipped = 0;
  for (const r of rows) {
    const lead = safeObj(r.lead), p = digits(lead.phone);
    const exists = seen.has(p) || (p && await D.prepare("SELECT id FROM accounts WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '(', ''), ')', ''), '-', ''), ' ', ''), '+1', '') = ? LIMIT 1").bind(p).first());
    if (exists) { dup++; stmts.push(D.prepare("UPDATE engine_results SET state = 'dismissed' WHERE id = ?").bind(r.id)); continue; }
    seen.add(p);
    let made; // one lead the account rules refuse (a malformed email, say) is skipped and stays staged, not allowed to block the rest
    try { made = await createAccount(env, me, { ...lead, contact: lead.contact_name ? { name: lead.contact_name, role: lead.contact_role, phone: lead.contact_phone, email: lead.contact_email } : null }, 'csv'); }
    catch (e) { if (e instanceof Bad) { skipped++; continue; } throw e; }
    stmts.push(...made.stmts, D.prepare("UPDATE engine_results SET state = 'added', account_id = ? WHERE id = ?").bind(made.id, r.id), audit(env, me.email, 'engine_add', 'engine_result', r.id, null, { account: made.id }));
    added++;
  }
  for (let i = 0; i < stmts.length; i += 90) await D.batch(stmts.slice(i, i + 90));
  return { added, duplicates: dup, skipped };
}

async function dispatch(env, { id, zip, niche, cap }) {
  if (!env.ENGINE_DISPATCH_TOKEN || !env.ENGINE_POST_SECRET) return { ok: false, notConnected: true, message: 'Sweeps are not connected yet. The job is saved and will not run until the owner finishes setup.' };
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${env.ENGINE_DISPATCH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'omnisdr-rep-portal', 'content-type': 'application/json' },
      body: JSON.stringify({ ref: REF, inputs: { job_id: id, zip, niche, cap: String(cap) } }) });
    if (r.status === 204) return { ok: true };
    return { ok: false, message: `The sweep could not start (GitHub answered ${r.status}).` };
  } catch { return { ok: false, message: 'The sweep could not start (GitHub did not answer).' }; }
}

/* ---------- /engine/ingest: the runner posts a finished sweep here ---------- */
const FIELD = (v, n) => { const s = String(v ?? '').trim(); return s.length > n ? s.slice(0, n) : s; };
export async function handleIngest(req, env) {
  if (req.method !== 'POST') return json({ ok: false, message: 'Not found' }, 404);
  if (!env.REP_DB || !env.ENGINE_POST_SECRET) return json({ ok: false, message: 'Not available' }, 503); // fail closed: no secret, no door
  if (!safeEqual(req.headers.get('x-engine-secret') || '', env.ENGINE_POST_SECRET)) return json({ ok: false, message: 'Not allowed' }, 401);
  if (!(req.headers.get('content-type') || '').startsWith('application/json')) return json({ ok: false, message: 'Send JSON' }, 415);
  const text = await req.text(); if (text.length > 1_000_000) return json({ ok: false, message: 'Too large' }, 413);
  let b; try { b = JSON.parse(text); } catch { return json({ ok: false, message: 'Not valid JSON' }, 400); }
  const D = env.REP_DB, id = String(b?.job_id || '');
  const job = /^[A-Za-z0-9_-]{3,64}$/.test(id) ? await D.prepare("SELECT id, zip, niche, cap, status FROM engine_jobs WHERE id = ? AND kind = 'sweep'").bind(id).first() : null;
  if (!job || !['queued', 'running'].includes(job.status)) return json({ ok: false, message: 'No open job' }, 409);
  if (b.zip !== job.zip || b.niche !== job.niche) return json({ ok: false, message: 'Job mismatch' }, 409);
  const rows = Array.isArray(b.rows) ? b.rows : []; if (rows.length > job.cap) return json({ ok: false, message: 'Too many rows' }, 400);
  const t = now(), stmts = [], seen = new Set(); let dup = 0, invalid = 0;
  for (const r of rows) {
    const lead = { business: FIELD(r?.business, 160), niche: job.niche, website: FIELD(r?.website, 300), phone: FIELD(r?.phone, 40), email: FIELD(r?.email, 200), address: FIELD(r?.address, 200), city: FIELD(r?.city, 80), state: FIELD(r?.state, 40), zip: FIELD(r?.zip, 20), signal: FIELD(r?.signal, 300), notes: FIELD(r?.notes, 4000),
      contact_name: FIELD(r?.contact_name, 120), contact_role: FIELD(r?.contact_role, 80), contact_phone: FIELD(r?.contact_phone, 40).replace(/^\(/, '').replace(/\)\s*/, '-'), contact_email: FIELD(r?.contact_email, 200), line_type: FIELD(r?.line_type, 20).toLowerCase(), scrubbed_at: FIELD(r?.scrubbed_at, 40) };
    const p = digits(lead.phone);
    if (p.length === 10) lead.phone = `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`; // the rep portal's phone check wants a leading digit
    if (!lead.business || p.length !== 10 || !/^[A-Z]{2}$/.test(lead.state) || !zipState(lead.zip)) { invalid++; continue; }
    if (seen.has(p) || await D.prepare("SELECT 1 x FROM accounts WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '(', ''), ')', ''), '-', ''), ' ', ''), '+1', '') = ? LIMIT 1").bind(p).first()
      || await D.prepare("SELECT 1 x FROM engine_results WHERE phone = ? AND state IN ('staged', 'added') LIMIT 1").bind(p).first()) { dup++; continue; }
    seen.add(p);
    stmts.push(D.prepare("INSERT INTO engine_results (id, job_id, phone, lead, state, created_at) VALUES (?, ?, ?, ?, 'staged', ?)").bind(crypto.randomUUID(), id, p, JSON.stringify(lead), t));
  }
  const summary = { ...(b.summary && typeof b.summary === 'object' ? { funnel: b.summary.funnel, gateHist: b.summary.gateHist, solid: b.summary.solid } : {}), staged: stmts.length, duplicates: dup, invalid };
  stmts.push(D.prepare("UPDATE engine_jobs SET status = 'done', summary = ?, error = NULL, updated_at = ? WHERE id = ?").bind(JSON.stringify(summary), t, id),
    D.prepare('INSERT INTO audit (actor, action, entity, entity_id, before, after, at) VALUES (?, ?, ?, ?, NULL, ?, ?)').bind('engine', 'engine_ingest', 'engine_job', id, JSON.stringify({ staged: summary.staged, duplicates: dup, invalid }), t));
  for (let i = 0; i < stmts.length; i += 90) await D.batch(stmts.slice(i, i + 90));
  return json({ ok: true, staged: summary.staged, duplicates: dup, invalid });
}
