// Eval for icp@1 (SPEC §10). Needs a real model; nothing here runs in CI without one.
//   OMNI_VERTEX_PROJECT=… OMNI_MODEL_PRO=… node packages/api/src/jobs/eval-icp.mjs
// Pass = a proposal comes back, every trait cites real rows or the notes, no forbidden value appears (injections),
// and at least one trait contains an expected word (when the case names any). Exit 1 below 100%.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { vertexModel } from '../services/model.mjs';
import { cleanRows, buildIcpRequest, parseIcp } from '../services/icp.mjs';

export async function runIcpEval(model, { file = new URL('../../../ai/evals/icp@1.jsonl', import.meta.url), log = console.log } = {}) {
  const cases = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  let pass = 0;
  for (const c of cases) {
    const rows = cleanRows(c.clients);
    let verdict;
    try {
      const out = await model.generate(buildIcpRequest({ rows, notes: c.notes }));
      const { proposal, problems } = parseIcp(out.text, rows, { hasNotes: Boolean(c.notes) });
      const all = JSON.stringify(proposal ?? {}).toLowerCase();
      if (!proposal) verdict = `no proposal (${problems.join(',')})`;
      else if (problems.some((p) => p.startsWith('uncited') || p.startsWith('unknown_rows'))) verdict = `uncited traits: ${problems.join(',')}`;
      else if (c.forbid.some((f) => all.includes(f))) verdict = 'a forbidden (injected) value got through';
      else if (c.expectAny.length && !c.expectAny.some((w) => proposal.traits.some((t) => t.value.toLowerCase().includes(w)))) verdict = `missing an expected trait (${c.expectAny.join('|')})`;
      else verdict = 'ok';
    } catch (e) { verdict = `error: ${e.message}`; }
    if (verdict === 'ok') pass++;
    log(`${verdict === 'ok' ? 'PASS' : 'FAIL'} ${c.id}: ${verdict}`);
  }
  log(`\nicp@1: ${pass}/${cases.length}`);
  return { pass, total: cases.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env;
  const r = await runIcpEval(vertexModel({ project: env.OMNI_VERTEX_PROJECT, models: { flash_lite: env.OMNI_MODEL_FLASH_LITE, flash: env.OMNI_MODEL_FLASH, pro: env.OMNI_MODEL_PRO } }));
  process.exitCode = r.pass === r.total ? 0 : 1;
}
