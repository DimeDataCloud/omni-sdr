// The bot check must fail closed. Needs a server with TURNSTILE_SITEKEY set and TURNSTILE_SECRET unset (tests/run.sh starts one).
// If the secret goes missing in production, session start must refuse (503) and must not consume a daily or per-ip slot.
const BASE = process.env.BASE || 'http://localhost:8787';
const J = { 'content-type': 'application/json' };
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
(async () => {
  const r = await fetch(BASE + '/api/session', { method: 'POST', headers: { ...J, 'cf-connecting-ip': '44.4.4.4' }, body: '{}' });
  const j = await r.json();
  ok('session start refused when the site key is set but the secret is missing', r.status === 503 && j.ok === false, 'status ' + r.status);
  ok('refusal does not hand out a session id', !j.sid);
  const r2 = await fetch(BASE + '/api/session', { method: 'POST', headers: { ...J, 'cf-connecting-ip': '44.4.4.4' }, body: JSON.stringify({ turnstile: 'junk' }) });
  ok('a junk token does not get around it', r2.status === 503 && !(await r2.json()).sid);
  let f = 0; for (const [s, n, d] of R) { if (s === 'FAIL') f++; console.log(s, n, d ? '— ' + d : ''); }
  console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
