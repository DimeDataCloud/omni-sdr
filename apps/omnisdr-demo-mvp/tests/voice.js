// Offline, free test of the Retell voice tab. Needs a worker started with a FAKE RETELL_API_KEY, RETELL_AGENT_ID, RETELL_BASE pointing at the mock this
// file starts, RETELL_TEST_CALLS=<CEIL>, IP_CAP/DAILY_CAP high, TURNSTILE_SITEKEY empty, TRYME_GATED=off (tests/run.sh does this). Never talks to Retell.
import http from 'node:http';
const BASE = process.env.BASE || 'http://localhost:8787';
const MOCK_PORT = +(process.env.RETELL_MOCK_PORT || 8803);
const CEIL = +(process.env.RETELL_TEST_CALLS || 3);
const KEY = process.env.FAKE_RETELL_KEY || 'retell-test-key-NOT-REAL';
const J = { 'content-type': 'application/json' };
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
let hits = 0, last = null, mode = 'ok';
const mock = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => raw += c);
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v2/create-web-call') {
      hits++; let body = null; try { body = JSON.parse(raw); } catch (e) {} last = { headers: req.headers, body };
      if (mode === 'ok') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ access_token: 'mock-access-' + hits, call_id: 'call_mock' })); }
      res.writeHead(500); return res.end('UPSTREAM-SECRET-DETAIL');
    }
    res.writeHead(404); res.end();
  });
});
const post = (u, b, h = {}) => fetch(BASE + u, { method: 'POST', headers: { ...J, ...h }, body: JSON.stringify(b) });
let ipn = 0; const nextIp = () => ({ 'cf-connecting-ip': '77.7.' + Math.floor(++ipn / 250) + '.' + (ipn % 250 + 1) });
const startSession = async () => (await (await post('/api/session', {}, nextIp())).json()).sid;

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
  try {
    const page = await fetch(BASE + '/tryme'), html = await page.text(), csp = page.headers.get('content-security-policy');
    ok('voice configured: tab hook and CSP allow the SDK host and call transport', html.includes('name="voice"') && /script-src[^;]*cdn\.jsdelivr\.net/.test(csp) && /connect-src[^;]*livekit/.test(csp));
    ok('no unsafe-inline even with voice on', !/unsafe-inline/.test(csp));
    ok('no sid -> 400', (await post('/api/voice', {})).status === 400);
    ok('unknown session -> 404', (await post('/api/voice', { sid: 'nope' })).status === 404);
    const sid = await startSession();
    const a = await post('/api/voice', { sid }), aj = await a.json();
    ok('mint ok returns an access token and the capped duration', a.status === 200 && aj.ok && /^mock-access-/.test(aj.accessToken) && aj.maxSeconds > 0 && aj.maxSeconds <= 180, JSON.stringify(aj));
    ok('request carries the agent id, the Bearer key, and nothing the browser chose', last.body.agent_id.startsWith('agent_') && last.headers.authorization === 'Bearer ' + KEY && Object.keys(last.body).sort().join() === 'agent_id,metadata');
    ok('response never contains the API key', !JSON.stringify(aj).includes(KEY));
    const b = await post('/api/voice', { sid }); ok('second mint on the same session -> 429', b.status === 429);
    const before = hits; let n = 1, refused = null;
    for (let i = 0; i < CEIL + 2 && !refused; i++) { const r = await post('/api/voice', { sid: await startSession() }); if (r.status === 200) n++; else refused = r.status; }
    ok('lifetime ceiling stops further mints at ' + CEIL, n === CEIL && refused === 429 && hits === before + (CEIL - 1), 'minted ' + n + ', status ' + refused);
    mode = 'bad'; const ceilReset = await post('/api/voice', { sid: await startSession() });
    ok('over the ceiling the upstream is not called', ceilReset.status === 429 && hits === before + (CEIL - 1));
  } finally { mock.close(); }
  for (const [s, n, d] of R) console.log(s, n, d || ''); const bad = R.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? bad + ' FAILED' : 'voice: all ' + R.length + ' passed'); process.exit(bad ? 1 : 0);
})();
