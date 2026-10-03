// Decision registry (JEV-PLAN §5, engine per DECISIONS 2026-10-01). One entry per decision: the questions,
// the thresholds, and a pure `effects` function that turns answers into safe-side effects only. An entry can
// add a suppression, a stop, an SLA or a human review. It can never remove one, raise anything toward a send,
// or approve anything. Prospect text arrives as labelled data fields and is treated as hostile.
//
// Thresholds are provisional until a golden set is fitted (n=22 hand-labelled bench, 2026-10-01). Changing a
// threshold or a question changes `version`, which is stored on every row the decision touched.

export const REPLY_TRIAGE = {
  task: 'reply_triage',
  // @3 adds the category questions (SDR-PIVOT P2), shadow-only: asked when the caller asks, recorded, never acted on.
  // The two safety questions, their wording and thresholds are unchanged from @2.
  version: 'reply_triage@3',
  // Golden set 2026-10-01 (89 held-out replies, 17 opt-outs, 14 meetings; services/decider/bench/golden.mjs):
  // stop >= 0.30 catches 16/17 at precision 0.80 (0.20 would catch 17/17 but add 3 more false stops: not worth the
  // lost leads on n=17). meet was 0.5 (@1) and caught 9/14; at 0.30 it catches 13/14 at precision 0.62. A false
  // meeting only puts a reply in front of a human sooner, so recall wins.
  thresholds: { stop: 0.30, meet: 0.30 },
  // The live path asks only the two safety questions. The 9-way label is shadow-only (labels: zero-shot
  // agreement was 14/22, no better than rules-1) and costs ~2x the tokens, so it runs only when asked.
  questions: ({ shadowLabel = false, categories = false } = {}) => ({
    stop: { type: 'noul', instructions: 'Does the sender ask us to stop contacting them or remove them from a list?' },
    meet: { type: 'noul', instructions: 'Does the sender ask for or agree to a meeting, call, demo or times?' },
    ...(shadowLabel ? { label: LABEL_QUESTION } : {}),
    ...(categories ? Object.fromEntries(Object.entries(CATEGORIES).filter(([k]) => k !== 'stop' && k !== 'meet')
      .map(([k, c]) => [k, { type: 'noul', instructions: c.question }])) : {}),
  }),
  // The field names the 2026-10-01 bench measured with.
  state: ({ subject, body }) => ({ subject: String(subject ?? '').slice(0, 998), body: String(body ?? '').slice(0, 8000) }),
  /**
   * @param answers laya answers
   * @param current { intent, suppressed: bool, stopped: bool, slaDueAt: Date|null }  what the rules already did
   * @returns { suppress: bool, stop: bool, startSla: bool, record } effects to ADD; never a removal
   */
  effects(answers, current) {
    const stopP = answers.stop?.noul;
    const meetP = answers.meet?.noul;
    if (typeof stopP !== 'number' || typeof meetP !== 'number') throw new Error('reply_triage: missing safety answers');
    const suppress = stopP >= this.thresholds.stop && !current.suppressed;
    return {
      suppress,
      // An opt-out stops the sequence even when the rules read the reply as an out-of-office.
      stop: suppress && !current.stopped,
      startSla: meetP >= this.thresholds.meet && !current.slaDueAt,
      record: {
        stop: round(stopP), meet: round(meetP),
        ...(answers.label ? { shadow_label: answers.label.choice, shadow_label_p: round(answers.label.answer_confidence) } : {}),
        ...(hasCategories(answers) ? shadowCategory(answers) : {}),
      },
    };
  },
};

const LABEL_QUESTION = {
  type: 'choice', instructions: 'What is the prospect doing in this reply to our sales email?',
  criteria: {
    meeting_request: 'asks for or agrees to a call, meeting, demo or times',
    question: 'asks a question about the product or offer',
    objection_price: 'says it costs too much or there is no budget',
    objection_timing: 'says not now, later, or under contract elsewhere',
    referral: 'points us to a different person',
    out_of_office: 'automatic away or leave reply',
    not_interested: 'declines without asking to stop emails',
    unsubscribe: 'asks us to stop emailing or remove them',
    other: 'none of the above',
  },
};

const round = (p) => Math.round(p * 1e4) / 1e4;

// ─── reply_triage@3 categories (SDR-PIVOT P2) ────────────────────────────────────────────────────────────────────
// One yes/no question per category instead of one 11-way label: Laya's yes/no answers are where it is strong (the
// single label agreed 14/22, no better than the rules). Laya's probabilities are not calibrated across questions (a
// true "question" averaged 0.25, a true "opt-out" 0.85), so each category has its own threshold, fitted on the golden
// sets (services/decider/training/golden: 89 email replies + 70 social/DM messages, laptop bench 2026-10-03): 5-fold CV
// 104/159 (65%; rules alone 46/89 on the email set). Provisional and shadow-only. spam at 0.99 is effectively off: a
// false 'spam' would hide a real lead, and its AUC (0.91) isn't enough yet at n=8. Safety
// categories are checked first and in order; otherwise the category furthest above its own threshold wins; nothing above
// its threshold means 'unclassified' (a human reads it). `intent` is the inbound_messages value the category maps to.
export const CATEGORIES = {
  stop:       { intent: 'unsubscribe',      safety: true, threshold: 0.5,  question: 'Does the sender ask us to stop contacting them or remove them from a list?' },
  ooo:        { intent: 'out_of_office',    safety: true, threshold: 0.8,   question: 'Is this an automatic out-of-office or away reply?' },
  spam:       { intent: 'spam',             safety: true, threshold: 0.99,  question: 'Is the message spam, abuse, a joke or unrelated to the offer?' },
  meet:       { intent: 'meeting_request',  threshold: 0.25, question: 'Does the sender ask for or agree to a meeting, call, demo or times?' },
  interested: { intent: 'positive_inquiry', threshold: 0.6,  question: 'Does the sender say they are interested or want to know more?' },
  question:   { intent: 'question',         threshold: 0.12, question: 'Does the sender ask a question about the product, service, price or how it works?' },
  price:      { intent: 'objection',        threshold: 0.12, question: 'Does the sender say it costs too much or that they have no budget?' },
  timing:     { intent: 'objection',        threshold: 0.15, question: 'Does the sender say now is not a good time, or ask us to follow up later?' },
  referral:   { intent: 'referral',         threshold: 0.05, question: 'Does the sender tell us to contact a different person instead?' },
  decline:    { intent: 'not_interested',   threshold: 0.5, question: 'Does the sender say no, no thanks, or that this is not a fit for them?' },
};

/** The category for a set of category answers ({ key: { noul } }), or 'unclassified'. Pure; never an effect. */
export function pickCategory(answers, cats = CATEGORIES) {
  const p = (k) => answers[k]?.noul;
  for (const [k, c] of Object.entries(cats)) if (c.safety && typeof p(k) === 'number' && p(k) >= c.threshold) return { category: k, intent: c.intent, p: round(p(k)) };
  let best = null, score = -1;
  for (const [k, c] of Object.entries(cats)) {
    if (c.safety || typeof p(k) !== 'number' || p(k) < c.threshold) continue;
    const s = (p(k) - c.threshold) / (1 - c.threshold + 1e-9);
    if (s > score) { best = k; score = s; }
  }
  return best ? { category: best, intent: cats[best].intent, p: round(p(best)) } : { category: 'unclassified', intent: 'unclassified', p: null };
}

const hasCategories = (answers) => Object.keys(CATEGORIES).every((k) => typeof answers[k]?.noul === 'number');
function shadowCategory(answers) {
  const pick = pickCategory(answers);
  return { category: pick.category, category_p: pick.p,
    category_scores: Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, round(answers[k].noul)])) };
}
