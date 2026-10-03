// Fit reply_triage@3 per-category thresholds on golden sets and report 5-fold CV honestly (SDR-PIVOT P2).
// node fit_categories.mjs <golden.jsonl>:::<bench.out> [more pairs]   env CATS=… to restrict, OUT=… to write thresholds, SHOW=1 misses
import { readFileSync, writeFileSync } from 'node:fs';
const MAP = { meeting_request: 'meet', question: 'question', objection_price: 'price', objection_timing: 'timing', referral: 'referral',
  out_of_office: 'ooo', not_interested: 'decline', unsubscribe: 'stop', other: 'none', interested: 'interested', spam: 'spam' };
const S = [];
for (const pair of process.argv.slice(2)) {
  const [g, o] = pair.split(':::');
  const ans = new Map(readFileSync(o, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((x) => [x.id, x.answers]));
  for (const r of readFileSync(g, 'utf8').trim().split('\n').map((l) => JSON.parse(l))) if (ans.has(r.id)) S.push({ id: r.id, t: MAP[r.label], a: ans.get(r.id), body: r.body });
}
const CATS = (process.env.CATS ?? 'stop,ooo,spam,meet,interested,question,price,timing,referral,decline').split(',');
const SAFETY = ['stop', 'ooo', 'spam'].filter((c) => CATS.includes(c));
const pick = (a, t) => {
  for (const c of SAFETY) if (a[c] >= t[c]) return c;
  let best = 'none', bs = 0;
  for (const c of CATS) if (!SAFETY.includes(c) && a[c] >= t[c]) { const s = (a[c] - t[c]) / (1 - t[c] + 1e-9); if (s > bs || best === 'none') { best = c; bs = s; } }
  return best;
};
const acc = (rows, t) => rows.filter((s) => pick(s.a, t) === s.t).length;
const GRID = [0.05, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.99];
function fitT(rows) {
  const t = Object.fromEntries(CATS.map((c) => [c, 0.5]));
  for (let pass = 0; pass < 4; pass++) for (const c of CATS) {
    let bestV = t[c], bestA = acc(rows, t);
    for (const g of GRID) { t[c] = g; const a = acc(rows, t); if (a > bestA) { bestA = a; bestV = g; } }
    t[c] = bestV;
  }
  return t;
}
// 5-fold CV, deterministic split by index.
let cvRight = 0;
for (let k = 0; k < 5; k++) {
  const test = S.filter((_, i) => i % 5 === k), train = S.filter((_, i) => i % 5 !== k);
  cvRight += acc(test, fitT(train));
}
const T = fitT(S);
console.log(`n=${S.length}  fitted-on-all ${acc(S, T)}/${S.length}  5-fold CV ${cvRight}/${S.length} (${(100 * cvRight / S.length).toFixed(0)}%)`);
console.log('thresholds', JSON.stringify(T));
const pred = S.map((s) => ({ ...s, p: pick(s.a, T) }));
for (const c of [...CATS, 'none']) {
  const tp = pred.filter((s) => s.p === c && s.t === c).length, fp = pred.filter((s) => s.p === c && s.t !== c).length, fn = pred.filter((s) => s.p !== c && s.t === c).length;
  if (tp + fp + fn) console.log(`  ${c.padEnd(10)} n=${String(tp + fn).padStart(2)} precision ${tp + fp ? (tp / (tp + fp)).toFixed(2) : ' — '} recall ${tp + fn ? (tp / (tp + fn)).toFixed(2) : ' — '}`);
}
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(T));
if (process.env.SHOW) for (const s of pred.filter((s) => s.p !== s.t)) console.log(`  ✗ ${s.id} truth=${s.t} pred=${s.p} | ${s.body.slice(0, 70)}`);
