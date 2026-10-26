// Offline, free token lock-down suite (ENGINE-REVIEW-CHECKLIST section F, plus A1 and G2).
// Needs a worker started with: ENGINE_B=1, a FAKE GEMINI_API_KEY, GEMINI_BASE pointing at the mock this file starts,
// SESSION_SECONDS=3, ENGINE_B_TEST_MINTS=<CEIL>, IP_CAP/DAILY_CAP high, TURNSTILE_SITEKEY empty, DEV_PASSCODE=test-passcode (tests/run.sh does this).
// It never talks to Google. The mock stands in for the auth_tokens endpoint and records the exact request the worker sends.
import http from 'node:http';
const BASE = process.env.BASE || 'http://localhost:8787';
const MOCK_PORT = +(process.env.MOCK_PORT || 8802);
const CEIL = +(process.env.ENGINE_B_TEST_MINTS || 12);
const FAKE_KEY = process.env.FAKE_KEY || 'test-key-NOT-REAL';
const PASS = 'test-passcode';
const J = { 'content-type': 'application/json' };
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);

// ---- mock Google ----
let mode = 'ok', hits = 0, last = null;
const mock = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => raw += c);
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v1beta/auth_tokens') {
      hits++; let body = null; try { body = JSON.parse(raw); } catch (e) {}
      last = { headers: req.headers, body, raw };
      if (mode === 'ok') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ name: 'auth_tokens/mock-' + hits })); }
      if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>UPSTREAM-SECRET-DETAIL</html>'); }
      res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'UPSTREAM-SECRET-DETAIL' }));
    }
    res.writeHead(404); res.end();
  });
});

const post = (u, b, h = {}) => fetch(BASE + u, { method: 'POST', headers: { ...J, ...h }, body: JSON.stringify(b) });
let ipn = 0; const nextIp = () => ({ 'cf-connecting-ip': '66.6.' + Math.floor(++ipn / 250) + '.' + (ipn % 250 + 1) });
const startSession = async () => (await (await post('/api/session', {}, nextIp())).json()).sid;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secsFromNow = (iso) => (Date.parse(iso) - Date.now()) / 1000;

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
  try {
    // 1 request validation
    ok('no sid -> 400', (await post('/api/token', {})).status === 400);
    ok('unknown sid -> 404', (await post('/api/token', { sid: 'nope-' + Date.now() })).status === 404);
    ok('cross-origin POST -> 403', (await post('/api/token', { sid: 'x' }, { origin: 'https://evil.example' })).status === 403);
    ok('no upstream call for rejected requests', hits === 0, 'hits ' + hits);

    // 2 happy path + the exact body sent to "Google"
    const sid = await startSession();
    const hostile = { sid, model: 'HOSTILE-model', systemInstruction: 'HOSTILE-instruction', tenant: 'HOSTILE-tenant', tools: [{ HOSTILE: 1 }], uses: 99, expireTime: '2099-01-01T00:00:00Z', newSessionExpireTime: '2099-01-01T00:00:00Z', generationConfig: { HOSTILE: 1 } };
    const t0 = Date.now();
    const r = await post('/api/token', hostile); const raw = await r.text(); let j = {}; try { j = JSON.parse(raw); } catch (e) {}
    ok('mint succeeds with a live session', r.status === 200 && j.ok === true && typeof j.token === 'string', 'status ' + r.status);
    ok('response is no-store', /no-store/i.test(r.headers.get('cache-control') || ''));
    ok('api key never in the response', !raw.includes(FAKE_KEY));
    const b = last && last.body, g = b && b.bidiGenerateContentSetup;
    ok('worker sent the key only as a header, to the mock', !!last && last.headers['x-goog-api-key'] === FAKE_KEY && !last.raw.includes(FAKE_KEY));
    ok('uses is exactly 1', b && b.uses === 1, String(b && b.uses));
    ok('expireTime is at most 180 s out', b && secsFromNow(b.expireTime) <= 180 + 2, b && String(secsFromNow(b.expireTime)));
    ok('expireTime is at most the remaining session (A1)', b && secsFromNow(b.expireTime) <= 3 + 2, b && String(secsFromNow(b.expireTime)));
    ok('newSessionExpireTime is at most 60 s out', b && secsFromNow(b.newSessionExpireTime) <= 60 + 2);
    ok('model is pinned', g && g.model === 'models/gemini-3.8-live', g && g.model);
    ok('responseModalities is exactly [AUDIO]', g && JSON.stringify(g.generationConfig && g.generationConfig.responseModalities) === '["AUDIO"]');
    ok('no resumption or compression in the locked setup', g && !('sessionResumption' in g) && !('contextWindowCompression' in g));
    const tools = g && g.tools, decl = tools && tools[0] && tools[0].functionDeclarations;
    ok('exactly one tool: book_slot', Array.isArray(tools) && tools.length === 1 && Array.isArray(decl) && decl.length === 1 && decl[0].name === 'book_slot');
    const slotEnum = decl && decl[0].parameters && decl[0].parameters.properties && decl[0].parameters.properties.slot && decl[0].parameters.properties.slot.enum;
    ok('book_slot.slot is an enum of the tenant slots', Array.isArray(slotEnum) && slotEnum.length === 3 && slotEnum.includes('Tuesday at 10:00 AM'));
    const si = (g && g.systemInstruction && g.systemInstruction.parts && g.systemInstruction.parts.map((p) => p.text).join(' ')) || '';
    const clauses = [['AI disclosure', /automated|AI assistant/i], ['transcribed', /transcrib/i], ['no prices', /never (state|quote|give).{0,40}(price|cost|dollar)/i], ['no start date or warranty', /warrant/i], ['no payment', /payment/i], ['out of scope', /out of scope|not a bathroom|decline/i], ['never claim human', /never.{0,30}(human|person)|not a human/i], ['reveal instructions', /(never|do not).{0,30}(reveal|share).{0,30}instruction/i], ['911', /911/], ['STOP', /\bstop\b/i], ['book via tool only', /book_slot/]];
    for (const [n, re] of clauses) ok('instruction has clause: ' + n, re.test(si));
    ok('no request field reached Google', !!last && !last.raw.includes('HOSTILE') && !last.raw.includes('2099'));
    ok('mint latency sane', Date.now() - t0 < 5000);

    // 3 one per sid, and a race
    ok('second mint, same sid -> 429', (await post('/api/token', { sid })).status === 429);
    const sid2 = await startSession(); const hitsBefore = hits;
    const race = await Promise.all(Array.from({ length: 20 }, () => post('/api/token', { sid: sid2 }).then((x) => x.status)));
    ok('20 parallel mints -> exactly one success', race.filter((s) => s === 200).length === 1 && race.filter((s) => s === 429).length === 19, JSON.stringify(race.reduce((a, s) => (a[s] = (a[s] || 0) + 1, a), {})));
    ok('and exactly one upstream call', hits === hitsBefore + 1, 'delta ' + (hits - hitsBefore));

    // 4 upstream failures leak nothing
    mode = 'fail'; const sid3 = await startSession(); const f1 = await post('/api/token', { sid: sid3 }); const f1t = await f1.text();
    ok('upstream 500 -> 502, no upstream text', f1.status === 502 && !f1t.includes('UPSTREAM-SECRET-DETAIL') && !f1t.includes(FAKE_KEY), 'status ' + f1.status);
    mode = 'html'; const sid4 = await startSession(); const f2 = await post('/api/token', { sid: sid4 }); const f2t = await f2.text();
    ok('upstream non-JSON -> 502, no upstream text', f2.status === 502 && !f2t.includes('UPSTREAM-SECRET-DETAIL'), 'status ' + f2.status);
    mode = 'ok';

    // 5 session age (A1) and kill switch
    const sid5 = await startSession(); await sleep(3600);
    const hb = hits; const old = await post('/api/token', { sid: sid5 });
    ok('expired session -> 410 (A1)', old.status === 410, 'status ' + old.status);
    ok('expired session makes no upstream call', hits === hb);
    const login = await post('/api/dev/login', { passcode: PASS }, nextIp()); const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const dev = (u, bd) => post(u, bd || {}, { cookie }); const stats = () => fetch(BASE + '/api/dev/stats', { headers: { cookie } }).then((x) => x.json());
    const sid6 = await startSession(); await dev('/api/dev/kill', { on: true });
    ok('kill switch -> 503', (await post('/api/token', { sid: sid6 })).status === 503);
    await dev('/api/dev/kill', { on: false });

    // 6 secrets never show up anywhere visible
    const page = await (await fetch(BASE + '/')).text(); const st = JSON.stringify(await stats());
    ok('key not in page or stats', !page.includes(FAKE_KEY) && !st.includes(FAKE_KEY));
    ok('token not in stats', !st.includes('auth_tokens/mock-'));

    // 7 lifetime test-mint ceiling (G2): visible in /dev, not cleared by reset-today, no further upstream calls once reached
    let refused = null, guard = 0;
    while (!refused && guard++ < CEIL + 5) {
      const s = await startSession(); const x = await post('/api/token', { sid: s });
      if (x.status === 429 || x.status === 503) { const body = await x.json(); if (body.reason === 'test-ceiling' || /test/i.test(body.message || '')) refused = { status: x.status, body }; }
    }
    ok('ceiling reached and refused', !!refused, refused ? JSON.stringify(refused) : 'never refused');
    ok('upstream calls stop exactly at the ceiling', hits === CEIL, hits + ' of ' + CEIL);
    const sc = await stats();
    ok('/dev shows the ceiling and usage', sc.testMints && sc.testMints.ceiling === CEIL && sc.testMints.used === CEIL, JSON.stringify(sc.testMints));
    await dev('/api/dev/reset-today');
    const s7 = await startSession(); const hb2 = hits; const after = await post('/api/token', { sid: s7 });
    ok('reset-today does NOT clear the ceiling', after.status !== 200 && hits === hb2, 'status ' + after.status);
  } catch (e) { ok('suite crashed', false, String(e && e.stack || e)); }
  mock.close();
  let f = 0; for (const [s, n, d] of R) { if (s === 'FAIL') f++; console.log(s, n, d ? '— ' + d : ''); }
  console.log(`\n${R.length - f}/${R.length} passed`); process.exitCode = f ? 1 : 0;
})();
