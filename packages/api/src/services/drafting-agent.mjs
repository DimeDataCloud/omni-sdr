// Which agent a system-made draft is credited to (the console's per-agent counts, the Approvals "who wrote this").
// The workspace's oldest live agent with the SDR badge, else none: a workspace with no SDR agent has nobody to credit,
// and NULL is honest ("An agent" is only a display fallback). Runs inside the caller's tenant transaction, so RLS
// scopes it to one workspace; archived agents are never picked.
export async function draftingAgentId(tx) {
  return (await tx.query(`SELECT id FROM agents WHERE badge = 'SDR' AND archived_at IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0]?.id ?? null;
}
