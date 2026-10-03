// The playbook (0017; SDR-PIVOT P3): the workspace's own replies per category, filled from what we know, and a short
// qualification script. No model writes here: Laya picks the category, the playbook picks the words, a person decides.

/** Categories a playbook reply can answer. Opt-outs and bounces are never answered (the safe side, enforced in 0017). */
export const PLAYBOOK_CATEGORIES = Object.freeze(['meeting_request', 'positive_inquiry', 'question', 'objection', 'referral',
  'out_of_office', 'not_interested', 'wrong_person', 'unclassified']);

/** The fields a reply may use. A reply that uses a field we can't fill is refused, never sent with a {gap}. */
export const FIELDS = Object.freeze(['first_name', 'name', 'company', 'business_name', 'booking_link', 'next_question']);
const FIELD = /\{([a-z_]+)\}/g;

/** Unknown field names in a template (a typo would otherwise reach a person as literal braces). */
export function unknownFields(text) {
  return [...new Set([...String(text ?? '').matchAll(FIELD)].map((m) => m[1]).filter((f) => !FIELDS.includes(f)))];
}

/**
 * Fill a template. Returns { text, missing }: `missing` lists the fields the template uses that have no value here.
 * Values are plain text from our own records; nothing is evaluated.
 */
export function render(template, values) {
  const missing = new Set();
  const text = String(template).replace(FIELD, (all, f) => {
    const val = values[f];
    if (val === undefined || val === null || val === '') { missing.add(f); return all; }
    return String(val);
  });
  return { text, missing: [...missing] };
}

export const firstName = (name) => (String(name ?? '').trim().split(/\s+/)[0] || null);

/** The next qualification question not yet asked in this conversation (asked = in an approved draft). */
export async function nextQuestion(tx, conversationId) {
  return (await tx.query(`SELECT q.key, q.question FROM qualification_questions q
    WHERE NOT EXISTS (SELECT 1 FROM reply_drafts d WHERE d.conversation_id = $1 AND d.status = 'approved' AND d.question_key = q.key)
    ORDER BY q.position LIMIT 1`, [conversationId])).rows[0] ?? null;
}

// Autonomy (SDR-PIVOT §6; proposal): a category earns auto-send after AUTONOMY_RATE of its last AUTONOMY_WINDOW
// decided drafts were approved unedited. Shown only: nothing here sends, and auto-send stays off.
export const AUTONOMY_WINDOW = 50;
export const AUTONOMY_RATE = 0.95;

/** Per category: the last 50 decisions that count (form addresses never do), unedited approvals, and eligibility. */
export async function autonomy(tx) {
  const rows = (await tx.query(`SELECT category, count(*)::int AS decided,
      count(*) FILTER (WHERE status = 'approved' AND edited = false)::int AS unedited,
      count(*) FILTER (WHERE status = 'approved' AND edited = true)::int AS edited,
      count(*) FILTER (WHERE status = 'discarded')::int AS discarded
    FROM (SELECT category, status, edited, row_number() OVER (PARTITION BY category ORDER BY decided_at DESC) AS n
          FROM reply_drafts WHERE status <> 'pending' AND counts_for_autonomy) x
    WHERE n <= $1 GROUP BY category ORDER BY category`, [AUTONOMY_WINDOW])).rows;
  return rows.map((r) => {
    const rate = r.decided ? r.unedited / r.decided : 0;
    return { category: r.category, decided: r.decided, unedited: r.unedited, edited: r.edited, discarded: r.discarded,
      rate: Math.round(rate * 1000) / 1000, eligible: r.decided >= AUTONOMY_WINDOW && rate >= AUTONOMY_RATE };
  });
}
