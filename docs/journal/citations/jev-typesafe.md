# Jev (TypeSafe AI), the "System One" decision model

Context: Christian supplied a research report (`Downloads/Jev AI by Typesafe Analysis.docx`, 2026-09-29). Its load-bearing claims were
re-checked against primary sources below; where they disagree, the primary source wins and the difference is noted.

## Jev returns typed decisions, never text: Noul (yes/no probability), Choice (≤255 options: pick + distribution + confidence), Score (2–10 ordered levels: weighted value + distribution + confidence)
- Source: https://docs.typesafe.ai/api.md
- Retrieved: 2026-09-29 by claude
- Excerpt: `POST https://api.typesafe.ai/v1/systemone`, Bearer auth; body `state` + `model: "jev-latest"` + `questions` (a map of typed questions). Noul "Returns the probability the answer is yes." Choice "Maximum 255 options per question." Score "Requires 2-10 ordered level descriptions". Errors 401/422/429/529, "exponential backoff".
- Used in: docs/claude/JEV-PLAN.md
- Confidence: confirmed
- Note: one request carries **many questions over one state**, so a reply can get its label, unsubscribe check and urgency in one call.

## Price $0.042 per million input tokens; output free; 70–500 ms end to end; cardinality up to 255
- Source: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Retrieved: 2026-09-29 by claude
- Excerpt: "$0.042 / MTok ($42 per billion tokens)"; output "FREE (too cheap to meter)"; "End-to-end response time is 70ms-500ms"; "Jev supports a cardinality up to 255"
- Confidence: confirmed

## 32,000-token context (state + questions); OpenRouter route `POST https://openrouter.ai/api/alpha/decisions`
- Source: https://openrouter.ai/docs/guides/community/jev
- Retrieved: 2026-09-29 by claude
- Confidence: confirmed. The report's OpenRouter fees (5.5% on credits; BYOK 5% after 1M requests) are **not** verified.

## Data: TypeSafe commits not to train on user data; a DPA exists; zero data retention is enterprise-only
- Source: https://docs.typesafe.ai/legal.md (links: typesafe.ai/legal/privacy-policy, /legal/data-processing, /legal/mca)
- Retrieved: 2026-09-29 by claude
- Excerpt: Privacy Policy covers "our commitment not to train models on user data"; "zero data retention (ZDR) for enterprise customers"
- Confidence: partial (summary page; the DPA text itself is unread). **Read the DPA before any prospect data goes to TypeSafe.**

## Confidence thresholds are per decision and must be fitted on your own data
- Source: https://docs.typesafe.ai/confidence.md
- Retrieved: 2026-09-29 by claude
- Excerpt: ">0.9 for high-stakes decisions: Act automatically … <0.5: Do not act; route to human"; "Different actions within the same system should be gated at different levels depending on the consequences of getting it wrong"; "Start with conservative thresholds, test with your own data"
- Confidence: confirmed

## The input state is attackable: opinion injection flipped 12.1% of decisions and pushed 38% of confident answers below the 0.8 review threshold
- Source: https://arxiv.org/abs/2609.31142 (JevAdvBench: 812 questions, 66 scenarios, 9,744 attack variants)
- Retrieved: 2026-09-29 by claude
- Excerpt: opinion injection "flipping 12.1% of decisions"; command injection 10.1%; "pushes 38% of confident answers below the 0.8 confidence threshold that routes them to human review"; "applications built on RLCD models should therefore treat the state as untrusted, argued input"
- Confidence: confirmed
- **Contradicts the report:** it says 16.4% flips vs a 4.0% floor and 47.7% degraded. Use the paper's numbers.
- Consequence for Omni-SDR: replies, scraped websites and prospect text are attacker-controlled. Jev may only move a decision toward the safe side (see JEV-PLAN).

## Unverified report claims (don't build on them)
- Benchmarks: 67.8% workflow accuracy, the 80.1% vs 93.2% fine-tuned BERT figure on Banking77, and RAG MRR 0.719→0.869.
- "Jaggedness": no math, weak on numeric formats, degrades with noisy context. Plausible and consistent with the design, but the primary source hasn't been read.
- Vendor maturity: TypeSafe exited stealth 2026-09-15 with a $40M seed (press only). Two weeks of public history.
