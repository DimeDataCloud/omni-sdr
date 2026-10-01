// Latency of a deployed decider, end to end and server-side (laya-serve's X-Inference-Time-Ms).
//   node services/decider/bench/latency.mjs <service-url> [rounds]
// Auth: the service is IAM-only. Point this at `gcloud run services proxy <svc> --port N` (http://localhost:N),
// which signs requests for you; an https URL gets an identity token from gcloud instead.
// The questions are JEV-PLAN #1 reply triage: one 9-way choice and two noul safety questions.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const [url, roundsArg = '3', batchArg = 'batch'] = process.argv.slice(2);
if (!url) { console.error('usage: latency.mjs <service-url> [rounds]'); process.exit(2); }
const rounds = Number(roundsArg);
const headers = { 'content-type': 'application/json' };
if (url.startsWith('https:')) headers.authorization = `Bearer ${execSync('gcloud auth print-identity-token', { encoding: 'utf8' }).trim()}`;
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));

export const TRIAGE = {
  label: { type: 'choice', instructions: 'What is the prospect doing in this reply to our sales email?',
    criteria: {
      meeting_request: 'asks for or agrees to a call, meeting, demo or times',
      question: 'asks a question about the product or offer',
      objection_price: 'says it costs too much or there is no budget',
      objection_timing: 'says not now, later, or under contract elsewhere',
      referral: 'points us to a different person',
      out_of_office: 'automatic away or leave reply',
      not_interested: 'declines without asking to stop emails',
      unsubscribe: 'asks us to stop emailing or remove them',
      other: 'none of the above' } },
  stop: { type: 'noul', instructions: 'Does the sender ask us to stop contacting them or remove them from a list?' },
  meet: { type: 'noul', instructions: 'Does the sender ask for or agree to a meeting, call, demo or times?' },
};

// QSET=safety drops the 9-way label and asks only the two safety questions the MVP acts on.
const QUESTIONS = process.env.QSET === 'safety' ? { stop: TRIAGE.stop, meet: TRIAGE.meet } : TRIAGE;
const MODEL = process.env.MODEL; // e.g. multilingual
const req = (state) => ({ state, questions: QUESTIONS, ...(MODEL ? { model: MODEL } : {}) });

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (xs) => `p50 ${pct(xs, 0.5).toFixed(0)} · p95 ${pct(xs, 0.95).toFixed(0)} · max ${Math.max(...xs).toFixed(0)} ms (n=${xs.length})`;

async function call(path, body) {
  const t0 = performance.now();
  const res = await fetch(url + path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const json = await res.json();
  const total = performance.now() - t0;
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return { total, server: Number(res.headers.get('x-inference-time-ms') ?? NaN), json };
}

// Cold start: the first request after the service has scaled to zero.
const first = await call('/v1/systemone', req({ subject: 'warm', body: 'warm up' }));
console.log(`first request: ${first.total.toFixed(0)} ms end to end, ${first.server.toFixed(0)} ms inference`);
const health = await call('/health');
console.log('health:', JSON.stringify(health.json));

const rtt = [];
for (let i = 0; i < 10; i++) rtt.push((await call('/health')).total);
console.log(`network floor (/health): ${fmt(rtt)}`);

const total = [], server = [];
let correct = 0;
const usage = [];
for (let r = 0; r < rounds; r++) for (const c of cases) {
  const out = await call('/v1/systemone', req({ subject: c.subject, body: c.body }));
  total.push(out.total); server.push(out.server);
  if (r === 0 && out.json.answers.label?.choice === c.label) correct++;
  if (r === 0) usage.push(out.json.usage?.input_tokens);
}
console.log(`triage, 3 questions, end to end: ${fmt(total)}`);
console.log(`triage, 3 questions, inference:  ${fmt(server)}`);
if (QUESTIONS.label) console.log(`label agreement with hand labels: ${correct}/${cases.length}`);
console.log(`input tokens per call: mean ${(usage.reduce((a, b) => a + b, 0) / usage.length).toFixed(0)}`);

if (batchArg !== 'nobatch') {
const b = await call('/v1/systemone/batch', { states: cases.map((c) => ({ subject: c.subject, body: c.body })), questions: QUESTIONS, ...(MODEL ? { model: MODEL } : {}) });
console.log(`batch of ${cases.length}: ${b.total.toFixed(0)} ms end to end, ${b.server.toFixed(0)} ms inference (${(b.server / cases.length).toFixed(1)} ms/email)`);
}
