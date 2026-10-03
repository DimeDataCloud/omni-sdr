# reply_triage@3 categories: laptop bench, 2026-10-03 (claude-local)

Laya `convaiinnovations/laya` (english), run in-process on the Windows laptop (`categories_local.py`, $0, no cloud).
Golden sets: `training/golden/reply_triage.jsonl` (89 email replies, 2026-10-01) and `training/golden/inbound_social.jsonl`
(70 IG/FB comment, IG DM and LinkedIn DM messages, authored and labelled 2026-10-03 before any run). Answers per message:
`categories-2026-10-03.jsonl` (the shipped wording; timing/decline from the variant run).

| | n | result |
|---|---|---|
| rules alone (classifyReply), email set | 89 | 46 right (52%), 41 unclassified |
| 10 questions, flat 0.5 thresholds, email set | 89 | 44 (49%) |
| fitted per-category thresholds, 5-fold CV, both sets | 159 | **104 (65%)** |
| same thresholds fitted on all 159 (optimistic) | 159 | 119 (75%): email 72/89 (81%), social 45/70 (64%) |

Per-question AUC on the 159 (does the question separate its own category?): stop 1.00, price 0.99, ooo 0.97, meet 0.96,
spam 0.91, question 0.89, referral 0.89, interested 0.86, decline 0.81 (reworded from 0.73), timing 0.79 (reworded from 0.68).

Reading: opt-outs, meeting asks, price objections and questions are reliable now. Timing, decline and interested need
more examples. Spam is held off (threshold 0.99) until it has more than 8 examples, because a false "spam" hides a real lead.
Every number here comes from small sets, so the categories ship **shadow-only** (`OMNI_TRIAGE_CATEGORIES=shadow`): recorded on
each decision, never acted on.

Reproduce: `python categories_local.py <golden.jsonl> <questions.json> <out.jsonl>`, then
`node fit_categories.mjs <golden.jsonl>:::<out.jsonl>`.
