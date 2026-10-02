// Precision on the held-out reply-triage golden set (training/golden/reply_triage.jsonl): the live decider vs the
// shipped rules (rules-1), at the thresholds REPLY_TRIAGE uses, plus a threshold sweep for stop and meet.
//   node services/decider/bench/golden.mjs <decider-url>
// Auth as in latency.mjs: an https URL gets a gcloud identity token.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { REPLY_TRIAGE } from '../../../packages/ai/src/registry.mjs';
import { classifyReply } from '../../../packages/api/src/services/reply-rules.mjs';

const url = process.argv[2];
if (!url) { console.error('usage: golden.mjs <decider-url>'); process.exit(2); }
const headers = { 'content-type': 'application/json' };
if (url.startsWith('https:')) headers.authorization = `Bearer ${execSync('gcloud auth print-identity-token', { encoding: 'utf8' }).trim()}`;
const rows = readFileSync(new URL('../training/golden/reply_triage.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const questions = REPLY_TRIAGE.questions({ shadowLabel: true });
const out = [];
for (const r of rows) {
  const res = await fetch(`${url}/v1/systemone`, { method: 'POST', headers,
    body: JSON.stringify({ state: REPLY_TRIAGE.state(r), questions, model: 'english' }) });
  if (!res.ok) throw new Error(`decider ${res.status}`);
  const a = (await res.json()).answers;
  const rules = classifyReply({ subject: r.subject, body: r.body }).intent;
  out.push({ ...r, stopP: a.stop.noul, meetP: a.meet.noul, label: a.label.choice, labelP: a.label.answer_confidence, rules });
}

const pr = (pred, truth) => {
  const tp = out.filter((o) => pred(o) && truth(o)).length, fp = out.filter((o) => pred(o) && !truth(o)).length;
  const fn = out.filter((o) => !pred(o) && truth(o)).length;
  return { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
};
const fmt = (m) => `precision ${m.precision === null ? '—' : m.precision.toFixed(2)} · recall ${m.recall === null ? '—' : m.recall.toFixed(2)} (tp ${m.tp}, fp ${m.fp}, fn ${m.fn})`;
const T = REPLY_TRIAGE.thresholds;

console.log(`golden set: ${out.length} replies (${out.filter((o) => o.stop).length} opt-outs, ${out.filter((o) => o.meet).length} meetings)\n`);
console.log(`STOP  laya >= ${T.stop}:            ${fmt(pr((o) => o.stopP >= T.stop, (o) => o.stop))}`);
console.log(`STOP  rules-1 unsubscribe:      ${fmt(pr((o) => o.rules === 'unsubscribe', (o) => o.stop))}`);
console.log(`STOP  rules OR laya (shipped):  ${fmt(pr((o) => o.rules === 'unsubscribe' || o.stopP >= T.stop, (o) => o.stop))}`);
console.log(`MEET  laya >= ${T.meet}:             ${fmt(pr((o) => o.meetP >= T.meet, (o) => o.meet))}`);
console.log(`MEET  rules-1 meeting_request:  ${fmt(pr((o) => o.rules === 'meeting_request', (o) => o.meet))}`);
console.log(`MEET  rules OR laya (shipped):  ${fmt(pr((o) => o.rules === 'meeting_request' || o.meetP >= T.meet, (o) => o.meet))}`);
// `out` spreads the golden row and then overwrites `label` with the model's answer, so read the truth back by id.
const scored = out.map((o) => ({ truth: rows.find((r) => r.id === o.id).label, laya: o.label, rules: o.rules, conf: o.labelP }));
console.log(`
LABEL laya:    ${scored.filter((s) => s.truth === s.laya).length}/${scored.length}`);
console.log(`LABEL rules-1: ${scored.filter((s) => s.truth === s.rules).length}/${scored.length}`);
console.log(`LABEL laya at conf >= 0.8: ${scored.filter((s) => s.conf >= 0.8 && s.truth === s.laya).length}/${scored.filter((s) => s.conf >= 0.8).length} right`);

console.log('\nthreshold sweep');
for (const t of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
  console.log(`  stop >= ${t}: ${fmt(pr((o) => o.stopP >= t, (o) => o.stop))}   |   meet >= ${t}: ${fmt(pr((o) => o.meetP >= t, (o) => o.meet))}`);
}

console.log('\nmisses at the shipped thresholds');
for (const o of out) {
  const stopWrong = (o.stopP >= T.stop || o.rules === 'unsubscribe') !== o.stop;
  const meetWrong = (o.meetP >= T.meet || o.rules === 'meeting_request') !== o.meet;
  if (stopWrong || meetWrong) console.log(`  ${o.id} ${stopWrong ? 'STOP' : ''}${meetWrong ? ' MEET' : ''} stop=${o.stopP.toFixed(2)} meet=${o.meetP.toFixed(2)} rules=${o.rules} | ${o.body.slice(0, 70)}`);
}
