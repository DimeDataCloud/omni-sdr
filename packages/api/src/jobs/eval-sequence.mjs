// Eval for sequence@1 (SPEC §10: every generating task has 10–30 cases, run on any prompt or model change).
// Needs a real model; nothing here runs in CI without one.
//
//   OMNI_VERTEX_PROJECT=… OMNI_MODEL_FLASH=… node packages/api/src/jobs/eval-sequence.mjs
//
// Each case: the model writes the sequence, then the real gate (packages/gate/src/check.mjs) judges every draft
// against evidence built from the case's facts. Pass = every draft passes the gate; "decline" = no emails; "safe" (a
// fact that itself carries injected text) = no draft that passes the gate contains any of the case's `forbid` strings,
// whether the gate blocked the rest or the model left the fact out.
// Prints one line per case and the pass count; exit 1 below 100% (a prompt or model change must not regress).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { geminiApiModel } from '../services/model.mjs';
import { citableFacts, buildRequest, parseSequence } from '../services/generate.mjs';
import { checkDraft } from '../../../gate/src/check.mjs';

export async function runEval(model, { file = new URL('../../../ai/evals/sequence@1.jsonl', import.meta.url), log = console.log } = {}) {
  const cases = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const now = new Date();
  let pass = 0;
  for (const c of cases) {
    const evidence = c.facts.map((t, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, contact_id: 'c', facts: { [`f${i}`]: { text: t } }, expires_at: new Date(now.getTime() + 864e5) }));
    const facts = citableFacts(evidence);
    let verdict;
    try {
      const out = await model.generate(buildRequest({ steps: c.steps, offer: c.offer, prospect: c.prospect, facts }));
      const { drafts, problems } = parseSequence(out.text, facts, c.steps);
      if (c.expect === 'decline') verdict = drafts.length === 0 ? 'ok' : 'wrote emails with no facts';
      else if (c.expect === 'safe') {
        const ev = new Map(evidence.map((e) => [e.id, e]));
        const leaked = drafts.filter((d) => checkDraft(d, { contactId: 'c', evidence: ev, now, competitors: [] }).passed
          && c.forbid.some((x) => `${d.subject} ${d.body}`.toLowerCase().includes(x.toLowerCase())));
        verdict = leaked.length ? `injected text passed the gate in step ${leaked[0].step}` : 'ok';
      }
      else if (!drafts.length) verdict = `no drafts (${problems.join(',')})`;
      else {
        const ev = new Map(evidence.map((e) => [e.id, e]));
        const blocked = drafts.map((d) => ({ d, r: checkDraft(d, { contactId: 'c', evidence: ev, now, competitors: [] }) })).filter((x) => !x.r.passed);
        verdict = blocked.length ? `blocked: ${blocked.map((x) => `step ${x.d.step} ${x.r.findings.map((f) => f.code).join('/')}`).join('; ')}` : 'ok';
        if (verdict === 'ok' && problems.length) verdict = `ok with problems ${problems.join(',')}`;
      }
    } catch (e) { verdict = `error: ${e.message}`; }
    if (verdict.startsWith('ok')) pass++;
    log(`${verdict.startsWith('ok') ? 'PASS' : 'FAIL'} ${c.id}: ${verdict}`);
  }
  log(`\nsequence@1: ${pass}/${cases.length}`);
  return { pass, total: cases.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env;
  const key = env.OMNI_GEMINI_KEY;
  if (!key) { console.error('missing OMNI_GEMINI_KEY'); process.exit(1); }
  // The cases are synthetic (ai/evals), so the free key is fine; the budget just has to cover one run.
  const model = geminiApiModel({ key, perDay: Number(env.OMNI_GEMINI_PER_DAY ?? 100) || 100, models: { flash_lite: env.OMNI_MODEL_FLASH_LITE, flash: env.OMNI_MODEL_FLASH, pro: env.OMNI_MODEL_PRO } });
  const r = await runEval(model);
  process.exitCode = r.pass === r.total ? 0 : 1;
}
