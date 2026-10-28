// TRYME_GATED=off: /tryme is open without a session; / is still the entry; /sales is still gated.
const BASE = process.env.BASE || 'http://localhost:8787';
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const get = (u) => fetch(BASE + u, { redirect: 'manual' });
(async () => {
  const t = await get('/tryme'); ok('/tryme is open with the flag off', t.status === 200 && /id="start"/.test(await t.text()));
  const e = await get('/'); ok('/ is still the entry page', e.status === 200 && /data-mode="login"/.test(await e.text()));
  const s = await get('/sales'); ok('/sales is still gated', s.status === 302 && s.headers.get('location') === '/');
  let f = 0; for (const [st, n, d] of R) { if (st === 'FAIL') f++; console.log(st, n, d ? '- ' + d : ''); }
  console.log(`\n${R.length - f}/${R.length} passed`); process.exitCode = f ? 1 : 0;
})().catch((x) => { console.error('CRASH', x); process.exit(2); });
