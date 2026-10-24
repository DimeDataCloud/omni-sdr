// Gemini Live smoke test: mint an ephemeral token the same way src/worker.js mintToken does, open the constrained websocket,
// send one text turn, and report whether audio came back. Costs a fraction of a cent. Prints no secret values.
//
//   node tools/gemini-live-smoke.mjs            (key from GEMINI_API_KEY, else from C:\Users\cdsec\.halo-keys\gemini-live.md)
//   node tools/gemini-live-smoke.mjs --models   (list models that support bidiGenerateContent, then exit)
//
// Verified 2026-10-24: mint 200, setupComplete, 12 audio chunks, first audio 1.3 s, model models/gemini-3.8-live.
import fs from 'fs';

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // The key file may have editor-escaped underscores (GEMINI\_API\_KEY) and surrounding quotes; parse tolerantly.
  const raw = fs.readFileSync('C:/Users/cdsec/.halo-keys/gemini-live.md', 'utf8').split(String.fromCharCode(92)).join('');
  const m = raw.match(/^GEMINI_API_KEY=(.+)$/m);
  if (!m) throw new Error('GEMINI_API_KEY not found in env or gemini-live.md');
  return m[1].trim().replace(/["'`*\r]/g, '');
}

const K = loadKey();
const API = 'https://generativelanguage.googleapis.com';
const model = 'models/gemini-3.8-live';

if (process.argv.includes('--models')) {
  const j = await (await fetch(API + '/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': K } })).json();
  console.log((j.models || []).filter((x) => (x.supportedGenerationMethods || []).includes('bidiGenerateContent')).map((x) => x.name));
  process.exit(0);
}

const t0 = Date.now();
const body = {
  uses: 1,
  expireTime: new Date(Date.now() + 3 * 60000).toISOString(),
  newSessionExpireTime: new Date(Date.now() + 60000).toISOString(),
  // REST name is bidiGenerateContentSetup; the SDK calls it liveConnectConstraints. Endpoint is v1beta.
  bidiGenerateContentSetup: {
    model,
    generationConfig: { responseModalities: ['AUDIO'] },
    systemInstruction: { parts: [{ text: 'You are Jess, an automated assistant for Riverbend Bath, a fictional bathroom remodeler. Speak English. Keep replies to one short sentence.' }] },
  },
};
const r = await fetch(API + '/v1beta/auth_tokens', { method: 'POST', headers: { 'x-goog-api-key': K, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const txt = await r.text();
console.log('mint status', r.status, r.ok ? '' : txt.slice(0, 300));
if (!r.ok) process.exit(1);
const tok = JSON.parse(txt).name;

const ws = new WebSocket(API.replace('https', 'wss') + '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=' + encodeURIComponent(tok));
let audioChunks = 0, setupDone = false, firstAudioMs = null, turnComplete = false;
const done = (why) => { console.log('RESULT', JSON.stringify({ why, setupDone, audioChunks, firstAudioMs, turnComplete, totalMs: Date.now() - t0 })); try { ws.close(); } catch (e) {} setTimeout(() => process.exit(setupDone && audioChunks ? 0 : 1), 300); };
const timer = setTimeout(() => done('timeout'), 25000);
ws.addEventListener('open', () => ws.send(JSON.stringify({ setup: { model } })));
ws.addEventListener('close', (e) => { clearTimeout(timer); if (!turnComplete) { console.log('ws close', e.code, (e.reason || '').slice(0, 200)); done('closed'); } });
ws.addEventListener('message', async (ev) => {
  let d = ev.data; if (typeof d !== 'string') d = typeof d.text === 'function' ? await d.text() : Buffer.from(d).toString();
  let j; try { j = JSON.parse(d); } catch (e) { return; }
  if (j.setupComplete) { setupDone = true; ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Hi, I want to turn my tub into a walk-in shower.' }] }], turnComplete: true } })); return; }
  const sc = j.serverContent;
  if (sc && sc.modelTurn) for (const p of sc.modelTurn.parts || []) if (p.inlineData) { audioChunks++; if (firstAudioMs === null) firstAudioMs = Date.now() - t0; }
  if (sc && sc.turnComplete) { turnComplete = true; clearTimeout(timer); done('turnComplete'); }
  if (j.error) console.log('server error', JSON.stringify(j.error).slice(0, 300));
});
