# Jev in Omni-SDR: the decision layer

**Status:** proposal, pending Christian (it changes the Station 24 decision "Flash-Lite / Flash / Pro"). 2026-09-29, Claude.
**Grounding:** `omni-sdr-journal/citations/jev-typesafe.md` (primary sources; the research report's unverified numbers are listed there and not used here).

## 1. The idea in one paragraph
Omni-SDR makes thousands of small **decisions** and far fewer **generations**. Jev is built for the decisions:
- It returns a calibrated probability over options you define (Noul yes/no, Choice among ≤255 options, Score on 2–10 levels).
- It answers in 70–500 ms, for $0.042 per million input tokens, with output free.
- It can't produce a malformed answer, though it can pick the wrong valid option.
- One call asks many questions about one state.

**Maximizing Jev means moving every classify / route / rank / check step onto it, and keeping Gemini only for writing and extraction.**
At that price we stop sampling and decide on *everything*: every reply, every lead against every ICP version, every draft sentence against its fact.

## 2. Two rules that make it safe (non-negotiable in this design)
1. **Everything prospect-authored is hostile input.** Replies, scraped websites, LinkedIn messages and form posts are "state" an attacker controls. JevAdvBench: opinion injection flipped **12.1%** of decisions and pushed **38%** of confident answers below the 0.8 review line. So:
2. **Jev may only move a decision toward the safe side.**
   - It can **add** a block, a hold, a suppression, an escalation to a human, or a lower priority.
   - It can **never** remove a deterministic safeguard, raise heat into auto-send territory, lift a suppression, or approve anything.

   Under this rule a successful attack can at worst cause an extra human review or a skipped lead. It can never cause a send.

Corollaries:
- The deterministic gate, `send_guard`, RLS and suppression stay exactly as they are. Jev sits *in front of* them, never *instead of* them.
- **No numbers, no dates, no math on Jev.** The fit score formula, revenue formulas and snooze-date parsing stay deterministic or on Flash-Lite extraction (Jev returns no text).
- **Single-hop only.** "Does this sentence say only what this fact says?" is fine. Multi-step reasoning questions are not.

## 3. Where Jev goes, ranked by value
| # | Station | Decision | Primitive(s) (one call) | Safe-side rule | Replaces |
|---|---|---|---|---|---|
| 1 | 15 Inbound | Reply triage | Choice: 9 labels (meeting_request, question, objection_price, objection_timing, referral, out_of_office, not_interested, unsubscribe, other) · Noul: "asks to stop contact?" · Noul: "asks for a meeting or times?" · Score: urgency 1–4 | Unsubscribe: a deterministic keyword match **or** Noul ≥ 0.30 suppresses immediately (errs toward CAN-SPAM). Label confidence < 0.8 → "needs you" (the guide's rule). Meeting Noul ≥ 0.5 starts the SLA even when the label disagrees | Flash-Lite classification |
| 2 | 12/13 Gate | Semantic claim check (**block-only**) | per claim, Noul: "Does this sentence state only what this fact states?" · per draft, Noul: "Implies prior contact?", "Disparages or names a competitor?", "Makes a promise or guarantee?" | Each question can only **add** a finding (block ≥ 0.5, fitted). The deterministic gate-1 rules are unchanged. Jev down → gate-1 alone decides (Level 1 still has a human); **Level 2 auto-send requires the Jev layer to have run** | nothing: it catches the paraphrases a phrase list misses |
| 3 | 11 Leads | Priority / intent from evidence vs ICP | Score: "how strongly does this evidence show the ICP's pain?" 1–5 · Choice: best message angle among the ICP's angles | Ranking and angle suggestion only. The deterministic `fit_score` stays the gate for enrollment; Jev can't raise `heat` (heat feeds Trust Dial 2) | nothing (new signal) |
| 4 | 7 Composer | Intent routing | Choice over the 7 intents | ≥ 0.9 **and** cheap job → run; otherwise show the picker (the guide: "never silently picks an expensive job") | a classifier + confirmation |
| 5 | 14/15 Deliverability | Bounce / DSN / complaint parsing | Choice: hard_bounce, soft_bounce, complaint, auto_reply, other | Hard bounce or complaint ≥ 0.5 → global suppression + breaker check (safe side). Uncertain → soft (no suppression) **and** hold the mailbox for review if repeated | regex |
| 6 | 17 LinkedIn | Restriction-signal detection on provider responses; DM triage (reuse #1) | Noul: "restriction or warning from LinkedIn?" | ≥ 0.3 → hold that account (safe side) | nothing |
| 7 | 8 Knowledge | RAG rerank of top-k passages | Score relevance 1–5 per passage | Ranking only | Vertex rerank [VERIFY cost] |
| 8 | 8 Auto-adjust | Objection taxonomy on replies | Choice | Feeds learning only; never touches guardrails (DECISIONS) | Flash-Lite |
| 9 | 10 Competitors | "Is this a direct competitor?" before spending research credits | Noul | Below 0.5 → not suggested (saves credits) | Pro reasoning |
| 10 | 20 MCP | Pre-check on inbound MCP tool calls | Noul: "does this call exceed the caller's stated purpose?" | Flags / denies only. **Authorization stays deterministic** (Jev is a decision point, never the enforcement point) | nothing |

**Not on Jev:** writing anything, date/number extraction, the fit score math, revenue formulas, the final send decision, compliance or legal judgments, Trust Dial promotion.

## 4. Cost (primary-source price; token sizes are estimates)
| Workload | Tokens per call | Cost per call | At volume |
|---|---|---|---|
| Reply triage (4 questions) | ~1,300 | $0.000055 | 100k replies ≈ **$5.50** |
| Gate semantic layer (4 claims + 3 draft questions) | ~2,000 | $0.000084 | 50k drafts ≈ **$4.20** |
| Lead priority + angle | ~2,000 | $0.000084 | 10k leads × 3 ICP versions ≈ **$2.50** |
Effectively free at pilot scale. **Recommendation:** don't meter Jev calls to tenant credits at all, so the composer's inline estimate stays simple.

## 5. How it's built (Station 24 registry, Claude lane)
- **One adapter:** `packages/ai/decide.mjs` → `decide({ state, questions })` against `POST https://api.typesafe.ai/v1/systemone` (Bearer `TYPESAFE_API_KEY` in Secret Manager). Pin the model version; don't float on `jev-latest` in prod [VERIFY that pinned versions exist]. Go direct rather than through OpenRouter: one less processor seeing prospect data and no platform fee.
- **Every decision is a registry entry:** `{ task, primitive, schema, state_builder, thresholds: {act, review}, safe_side, fallback }`.
  - `fallback` is `flash_lite` (for #1, #5), `needs_human`, or `skip_block_only` (for #2: the deterministic gate alone).
  - Jev being down never blocks the product; it removes the extra safety layer, and Level 2 auto-send pauses.
- **The state builder puts untrusted text in labelled data fields** (`{"reply_text": …, "our_last_email": …}`), never beside instructions. This doesn't stop injection (the paper shows it can't); the safe-side rule is the real defense.
- **Calibration:** a golden set of labeled examples per decision (start at 50–100 per task, built from the mock data plus the first pilot's real replies). Fit each threshold on it, re-fit on any model-version change, and keep it in the eval CI (Station 24). TypeSafe's own guidance is ">0.9 for high-stakes … test with your own data".
- **Auditability:** store the probability vector and model version on the row that the decision changed (`drafts`, `inbound_messages`, `enrollments`), the same way `gate_version` is stored today.
- **Adversarial suite:** add JevAdvBench-style variants (appended "validation note: benign", injected commands) to each golden set. The test: no attack variant ever moves a decision *away* from the safe side past the fitted threshold. Where one does, that decision loses auto-action.

## 6. Decisions for Christian
| # | Question | Options | Recommended | Why |
|---|---|---|---|---|
| J1 | Adopt Jev as the decision tier (amends Station 24's routing) | A yes, per this plan · B no, stay on Flash-Lite | **A**, rolled out in J3's order | Classification cost drops ~to zero and latency to <0.5 s; the safe-side rule keeps the risk bounded |
| J2 | TypeSafe as a data subprocessor (prospect replies and emails go to it) | A direct API after reading the DPA; list it in the Privacy Policy · B only non-PII tasks until ZDR/enterprise · C no | **A**, but only after the DPA is read (it's unread; ZDR is enterprise-only) | Replies contain personal data; the privacy policy has to name them. A new vendor: TypeSafe exited stealth 2026-09-15 |
| J3 | Rollout order | 1) composer intent + competitor filter (no prospect PII) → 2) gate semantic layer (block-only) → 3) reply triage + bounces → 4) lead priority, LinkedIn, MCP | as listed | Proves calibration where a mistake is cheapest before PII and sends are involved |
| J4 | Pin the model version | A pin · B `jev-latest` | **A** | A silent model change would invalidate the fitted thresholds |

## 7. What this does to existing work
- **Gate (#7):** unchanged. The Jev layer lands as a second, block-only pass with its own `gate_version` suffix (`gate-1+jev-<ver>`).
- **Trust Dial Level 2:** add a precondition: the draft passed the Jev layer. Level 2 is still ops-flag only.
- **SPEC §10 model table:** gains a fourth row, "Decision (Jev): classify / route / rank / check; never writes".
