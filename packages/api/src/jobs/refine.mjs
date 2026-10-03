// The follow-up pass (snooze wake-ups, SLA escalation; 0008), then one model pass over undecided replies (docs/claude/DB-ROLLOUT.md, gap G4). Runs as a Cloud Run job that Cloud
// Scheduler starts every minute or two, and exits when the pass is done, so nothing idles between replies.
// Deploying the job and its schedule is Christian's call (rails §3.1).
//
//   DATABASE_URL                  the API login (inbox_svc is one of its four roles)
//   OMNI_DECIDER_URL              the decider service (IAM-only: the job's service account needs run.invoker on it)
//   OMNI_REFINE_LIMIT             replies per pass, default 50
//   OMNI_DECIDER_SHADOW_LABEL=1   also ask the label question; the answer is stored and never acted on
//   OMNI_TRIAGE_CATEGORIES=shadow also ask the reply_triage@3 category questions (~5x the decider time); the chosen
//                                 category is stored in the decision and never acted on (SDR-PIVOT P2)
//
// Exit 1 when the decider failed, so a down decider shows as a failed execution, not a quiet success. Exit 2 on
// missing config. Logs counts only: never a reply's text or address.
import { pathToFileURL } from 'node:url';
import { pgPool } from '../pool.mjs';
import { refinePending, wakeSnoozed, escalateSla } from '../services/inbox.mjs';
import { layaDecider } from '../../../ai/src/decide.mjs';

export async function runRefine(env, { pool, decider, log = (e) => console.log(JSON.stringify(e)) } = {}) {
  const missing = ['DATABASE_URL', 'OMNI_DECIDER_URL'].filter((k) => !env[k] && !(k === 'DATABASE_URL' ? pool : decider));
  if (missing.length) { log({ job: 'refine', error: `missing ${missing.join(', ')}` }); return 2; }
  const limit = Number(env.OMNI_REFINE_LIMIT ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) { log({ job: 'refine', error: 'OMNI_REFINE_LIMIT must be 1..500' }); return 2; }
  const ownPool = !pool;
  pool ??= await pgPool({ connectionString: env.DATABASE_URL, max: 1 });
  decider ??= layaDecider({ url: env.OMNI_DECIDER_URL });
  const { client, release } = await pool.acquire();
  let tally;
  try {
    // Follow-up first (0008): it needs no decider, so a down decider never delays a wake-up or an SLA alert.
    const woke = await wakeSnoozed(client);
    const escalated = await escalateSla(client);
    log({ job: 'followup', woke, escalated });
    tally = await refinePending(client, { decider, limit, shadowLabel: env.OMNI_DECIDER_SHADOW_LABEL === '1',
      categories: env.OMNI_TRIAGE_CATEGORIES === 'shadow' });
  } finally {
    release();
    if (ownPool) await pool.end();
  }
  log({ job: 'refine', ...tally });
  return tally.failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runRefine(process.env);
