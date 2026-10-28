// Offline, free test of the Retell voice tab. Needs a worker started with a FAKE RETELL_API_KEY, RETELL_AGENT_ID, RETELL_BASE pointing at the mock this
// file starts, RETELL_TEST_CALLS=<CEIL>, IP_CAP/DAILY_CAP high, TURNSTILE_SITEKEY empty, TRYME_GATED=off (tests/run.sh does this). Never talks to Retell.
import http from 'node:http';
import crypto from 'node:crypto';
const BASE = process.env.BASE || 'http://localhost:8787';
const MOCK_PORT = +(process.env.RETELL_MOCK_PORT || 8803);
const CEIL = +(process.env.RETELL_TEST_CALLS || 3);
const KEY = process.env.FAKE_RETELL_KEY || 'retell-test-key-NOT-REAL';
const J = { 'content-type': 'application/json' };
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
let hits = 0, last = null, mode = 'ok', monitorAuth = null, monitorHits = 0;
// minimal server-side websocket frame (unmasked text), enough for the mock monitor stream
const frame = (o) => { const p = Buffer.from(JSON.stringify(o)); return Buffer.concat([Buffer.from([0x81, p.length < 126 ? p.length : 126]), p.length < 126 ? Buffer.alloc(0) : Buffer.from([p.length >> 8, p.length & 255]), p]); };
const mock = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => raw += c);
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v3/create-web-call') {
      hits++; let body = null; try { body = JSON.parse(raw); } catch (e) {} last = { headers: req.headers, body };
      if (mode === 'ok') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ access_token: 'mock-access-' + hits, call_id: 'call_mock', transport: 'gateway', ice_servers: [], expires_at: 1, extra_field: 'must-not-pass' })); }
      res.writeHead(500); return res.end('UPSTREAM-SECRET-DETAIL');
    }
    if (req.method === 'GET' && req.url === '/v2/get-call/call_mock') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ latency: { e2e: { p50: 1234.4, num: 2 }, llm: { p50: 700 }, tts: { p50: 300 }, asr: { p50: 150 } }, secret_field: 'must-not-pass' })); }
    res.writeHead(404); res.end();
  });
});
mock.on('upgrade', (req, sock) => {
  monitorHits++; monitorAuth = req.headers.authorization;
  if (monitorHits === 1) { sock.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; } // first attempt: call not ongoing yet, the Worker must retry
  const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.write(frame({ type: 'transcript_snapshot', transcripts: [{ id: 'agent_0', role: 'agent', content: 'Hi, thanks for calling OmniSDR.', time_sec: 0.1, secret_field: 'must-not-pass' }, { id: 'node_1', role: 'node_transition', new_node_name: 'x' }] }));
  setTimeout(() => sock.write(frame({ type: 'transcript_updated', transcripts: [{ id: 'user_1', role: 'user', content: 'What does OmniSDR do?', time_sec: 3 }] })), 100);
  setTimeout(() => sock.write(frame({ type: 'call_ended', disconnection_reason: 'user_hangup' })), 250);
  setTimeout(() => sock.end(), 400);
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
    ok('mint ok returns an access token and the capped duration', a.status === 200 && aj.ok && /^mock-access-/.test(aj.call.access_token) && aj.call.transport === 'gateway' && !('extra_field' in aj.call) && aj.agentId.startsWith('agent_') && aj.maxSeconds > 0 && aj.maxSeconds <= 180, JSON.stringify(aj));
    ok('request carries the agent id, the Bearer key, and nothing the browser chose', last.body.agent_id.startsWith('agent_') && last.headers.authorization === 'Bearer ' + KEY && Object.keys(last.body).sort().join() === 'agent_id,metadata');
    ok('response never contains the API key', !JSON.stringify(aj).includes(KEY));
    const b = await post('/api/voice', { sid }); ok('second mint on the same session -> 429', b.status === 429);
    // live call panel: server relay of the monitor stream
    ok('stream with a malformed sid -> 400', (await fetch(BASE + '/api/voice/stream?sid=%3Cx%3E')).status === 400);
    ok('stream for an unknown session -> 404', (await fetch(BASE + '/api/voice/stream?sid=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).status === 404);
    const sr = await fetch(BASE + '/api/voice/stream?sid=' + sid), st = await sr.text();
    const ev = st.split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
    ok('stream is server-sent events', sr.status === 200 && /text\/event-stream/.test(sr.headers.get('content-type')));
    ok('transcript turns come through, other roles and extra fields do not', ev.some((e) => e.t === 'tx' && e.role === 'agent' && /OmniSDR/.test(e.text)) && ev.some((e) => e.t === 'tx' && e.role === 'user') && !/node_1|must-not-pass/.test(st), st.slice(0, 200));
    ok('end then latency summary (rounded, trimmed to four fields)', ev.some((e) => e.t === 'end') && ev.some((e) => e.t === 'lat' && e.e2e === 1234 && e.llm === 700 && e.tts === 300 && e.asr === 150 && e.turns === 2));
    ok('monitor upgrade used the Bearer key, retried after the first refusal, and the key never reaches the page', monitorAuth === 'Bearer ' + KEY && monitorHits === 2 && !st.includes(KEY), 'hits ' + monitorHits);
    ok('second stream on the same session -> 429', (await fetch(BASE + '/api/voice/stream?sid=' + sid)).status === 429);
    const before = hits; let n = 1, refused = null;
    for (let i = 0; i < CEIL + 2 && !refused; i++) { const r = await post('/api/voice', { sid: await startSession() }); if (r.status === 200) n++; else refused = r.status; }
    ok('lifetime ceiling stops further mints at ' + CEIL, n === CEIL && refused === 429 && hits === before + (CEIL - 1), 'minted ' + n + ', status ' + refused);
    mode = 'bad'; const ceilReset = await post('/api/voice', { sid: await startSession() });
    ok('over the ceiling the upstream is not called', ceilReset.status === 429 && hits === before + (CEIL - 1));
  } finally { mock.close(); }
  for (const [s, n, d] of R) console.log(s, n, d || ''); const bad = R.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? bad + ' FAILED' : 'voice: all ' + R.length + ' passed'); process.exit(bad ? 1 : 0);
})();
