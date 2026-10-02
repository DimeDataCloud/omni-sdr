// For score.py: each golden reply as production would see it. Adds `clean` (cleanReplyBody, what the state builder
// sends the decider since PR #31) and `rules` (the shipped rules' intent), so the scorer can compare raw vs cleaned
// input and laya vs rules without a Node dependency in Python.
//   node services/decider/bench/prep.mjs > <file>.json
import { readFileSync, readdirSync } from 'node:fs';
import { cleanReplyBody, classifyReply } from '../../../packages/api/src/services/reply-rules.mjs';

const dir = new URL('../training/golden/', import.meta.url);
const out = {};
for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
  out[f] = readFileSync(new URL(f, dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((r) => ({
    ...r, clean: cleanReplyBody(r.body), rules: classifyReply({ subject: r.subject, body: r.body }).intent,
  }));
}
process.stdout.write(JSON.stringify(out));
