// Decision registry (JEV-PLAN §5, engine per DECISIONS 2026-10-01). One entry per decision: the questions,
// the thresholds, and a pure `effects` function that turns answers into safe-side effects only. An entry can
// add a suppression, a stop, an SLA or a human review. It can never remove one, raise anything toward a send,
// or approve anything. Prospect text arrives as labelled data fields and is treated as hostile.
//
// Thresholds are provisional until a golden set is fitted (n=22 hand-labelled bench, 2026-10-01). Changing a
// threshold or a question changes `version`, which is stored on every row the decision touched.

export const REPLY_TRIAGE = {
  task: 'reply_triage',
  version: 'reply_triage@2',
  // Golden set 2026-10-01 (89 held-out replies, 17 opt-outs, 14 meetings; services/decider/bench/golden.mjs):
  // stop >= 0.30 catches 16/17 at precision 0.80 (0.20 would catch 17/17 but add 3 more false stops: not worth the
  // lost leads on n=17). meet was 0.5 (@1) and caught 9/14; at 0.30 it catches 13/14 at precision 0.62. A false
  // meeting only puts a reply in front of a human sooner, so recall wins.
  thresholds: { stop: 0.30, meet: 0.30 },
  // The live path asks only the two safety questions. The 9-way label is shadow-only (labels: zero-shot
  // agreement was 14/22, no better than rules-1) and costs ~2x the tokens, so it runs only when asked.
  questions: ({ shadowLabel = false } = {}) => ({
    stop: { type: 'noul', instructions: 'Does the sender ask us to stop contacting them or remove them from a list?' },
    meet: { type: 'noul', instructions: 'Does the sender ask for or agree to a meeting, call, demo or times?' },
    ...(shadowLabel ? { label: LABEL_QUESTION } : {}),
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
