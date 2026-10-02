# Training data for the decider

Christian, 2026-10-01: "Gather data for automated response, booking, ivr, icp, lead generation AI agents to pre train
laya with the knowledge it will need to determine things with high precision."

`fetch.py` downloads the sources below into `~/omni-sdr-training/raw` (outside the Drive-synced Halo folder and
outside git; `MANIFEST.json` there records URL, size and sha256 of each file). `build.py` turns them into laya
training rows in `~/omni-sdr-training/build/<task>/{train,test}.jsonl`, and `tasks.py` holds the exact question
wording each task is trained on, which is the wording production must ask.

## Rules the sources had to pass
- **Commercial use allowed.** Omni is a paid SaaS, so non-commercial or unclear licences are out.
- **No personal data.** Real people's mail or calls (Enron, call recordings) are out, whatever the licence says.
- **No share-alike on the training set** (CC BY-SA): whether share-alike reaches fine-tuned weights is unsettled, so
  those sources are excluded rather than argued.
- **Labels come from the source**, mapped by hand in `build.py`. An intent that is ambiguous for a task is dropped,
  not forced into a label.

## Sources (fetched 2026-10-01)
| Source | Licence | Used for | Rows built | Attribution |
|---|---|---|---|---|
| Banking77 (PolyAI) | CC BY 4.0 | IVR routing | 11,078 | Casanueva et al., 2020, "Efficient Intent Detection with Dual Sentence Encoders" |
| CLINC150 + out-of-scope | CC BY 3.0 | IVR routing, booking | 10,134 + 3,604 | Larson et al., 2019, "An Evaluation Dataset for Intent Classification and Out-of-Scope Prediction" |
| Bitext customer support | CDLA-Sharing 1.0 (sharing duties cover the data, not results such as trained models) | IVR routing, "ask for a person" | 23,458 | Bitext Innovations |
| MASSIVE 1.1, en-US | CC BY 4.0 | booking | 4,532 | FitzGerald et al., 2022, Amazon |
| SNIPS (benayas/snips) | Apache 2.0 | booking | 2,967 | Coucke et al., 2018 |
| NAICS 2022 index file | US Census Bureau, public domain | ICP industry | 8,746 | U.S. Census Bureau |
| O*NET 31.0 job titles | CC BY 4.0 | ICP department | 13,044 | "O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license." |
| LocalLLaMA/typed-decisions | Apache 2.0 | replay (keeps the base skills) | 1,600 | Convai Innovations |

| Taskmaster-1 (self-dialogs + WOZ), added 2026-10-02 | CC BY 4.0 (TM-1-2019/README.md) | booking (`book`, `confirm`, `none`), IVR scheduling | 1,778 + 1,158 | Byrne et al., 2019, "Taskmaster-1: Toward a Realistic and Diverse Dialog Dataset", Google |
| MInDS-14 en-US/en-GB/en-AU, added 2026-10-02 | CC BY 4.0 | IVR routing (spoken transcripts) | 1,058 | Gerz et al., 2021, "Multilingual and Cross-Lingual Intent Detection from Spoken Data", PolyAI. Audio deleted at download; transcripts only |
| O*NET 31.0 Sample of Reported Titles, added 2026-10-02 | CC BY 4.0 (same attribution as above) | ICP department | 4,080 | as O*NET above |
| MASSIVE 1.1 es-ES, fr-FR, de-DE, pt-PT, it-IT, added 2026-10-02 (`build.py --langs`) | CC BY 4.0 | booking, multilingual checkpoint (L9) | 22,037 | as MASSIVE above |
| **Authored** (`authored/`), added 2026-10-02 | Omni's own (hand-written by claude-cloud; no model call) | reply triage, booking `reschedule`/`confirm`, IVR "ask for a person", thin ICP departments | 9,121 + 2,156 + 515 + 518 | — |

**Excluded:** Schema-Guided Dialogue (CC BY-SA 4.0), Enron and Enron-spam (real people's mail, no licence),
ATIS (LDC licence), SNIPS original repo copies with no licence file.

## What the tasks cover now (v1, 2026-10-01; v2 below)
| Task | Questions | Rows (train / test) | Gaps |
|---|---|---|---|
| `ivr_route@1` | department (random 4–7 of: sales, billing, support, scheduling, account, cancel, other) · ask for a person | 38,603 / 6,067 | sales and scheduling thin (1.8k / 1.0k); "ask for a person" positives come from Bitext only (1,966) |
| `booking@1` | action (book, reschedule, cancel, availability, confirm, none) · wants a time | 9,814 / 1,289 | **no reschedule or confirm examples**: no licensed source labels them, and calendar_set rows that move an event were dropped rather than guessed |
| `icp_industry@1` | industry among a random 4–10 of the 20 NAICS sectors + other | 7,868 / 878 | index entries are short noun phrases, not website text |
| `icp_department@1` | department among a random 4–10 of 11 | 11,698 / 1,346 | executive (84), marketing (294) and hr (260) thin; codes like purchasing-agent titles land in finance even when the title reads otherwise |
| `reply_triage@1` | stop · meet · label | **0** | **no licensed public corpus of replies to sales email exists**; this is the task the product runs first |
| lead generation | — | 0 | the useful checks (business vs personal address, title seniority) are cheaper as rules than as model calls; not a laya task until a decision needs judgment |

Every choice question is trained on random option subsets (always including `other`; 15% of rows leave the right
answer out so the answer is `other`), so the model learns to choose from whatever menu or ICP list a customer
configures, and never sees more than 10 options (the shipped checkpoint's temperatures for 11+ are uncalibrated).

## v2 (2026-10-02, `LAYA-DATA-2026-10-02.md`)
`python fetch.py && python build.py --langs es-ES,fr-FR,de-DE,pt-PT,it-IT` builds **121,584 rows** (v1: 79,163); every
v1 row is still produced, byte for byte (checked against the v1 build). `python build.py` without `--langs` is the
English-only build. `test_authored.py` holds the invariants (stop/meet follow the label, a core never in both splits,
no golden body trained on, test rows use held-out wrappers).

| Task | v1 rows | v2 rows | What changed |
|---|---|---|---|
| `reply_triage@1` | 0 | **9,121** (7,505 / 1,616) | Authored: 234 English + 31 Spanish hand-written cores (4 one-word cores equal to golden bodies are dropped), each wrapped as real mail (greeting, signature, phone footer, disclaimer, our pitch quoted in 5 client styles with "Reply STOP" and an unsubscribe link) or left clean; 8% carry an injected instruction. Unsubscribe 1,120 · meeting 1,700 |
| `booking@1` | 11,103 | **37,074** | `confirm` 0 → 498 (Taskmaster accepts + authored), `reschedule` 0 → 481 (authored), Taskmaster bookings, 22,037 rows in 5 more languages |
| `ivr_route@1` | 44,670 | **47,401** | MInDS-14 spoken transcripts, Taskmaster scheduling calls, "ask for a person" positives 1,966 → 2,212 incl. hard negatives ("the person I spoke to yesterday…") |
| `icp_department@1` | 13,044 | **17,642** | O*NET reported titles; authored titles: executive 84 → 123, marketing 294 → 531, hr 260 → 450 |
| `icp_industry@1` | 8,746 | 8,746 | unchanged; no licensed website-text source found |

**Honest limits of the authored rows.** They are written by one author, so they share one voice; the model can learn
the author's phrasing instead of the intent. The guard is the split: a core and a fifth of every wrapper list are
test-only, and the two golden sets (written separately, by hand, never from the cores) are what thresholds are fitted
on. Taskmaster `confirm` labels are rule-derived from the source's accept annotations: 36 of 40 read right on a
manual pass (the rest are near-confirms such as "I will be there in 20 minutes").

## Next, in order
1. **Reply triage and the booking gaps need authored data.** The held-out golden set exists:
   `golden/reply_triage.jsonl`, 89 hand-written replies (all 9 labels, 17 opt-outs, 5 with injected instructions,
   Spanish, one-word replies, mixed signals), never trained on. Still needed: a generated training set (~5,000 replies across the 9 labels, plus
   reschedule/confirm messages and executive/marketing/hr titles), generated by a model and spot-checked. Generation
   costs model spend, so it needs Christian's OK; the golden set does not.
2. **Fine-tune `laya-multilingual`, not `laya`.** On Cloud Run CPU it costs 0.50 vCPU-seconds per decision at
   1 thread against 1.48 for the English checkpoint (bench 2026-10-01), and its encoder (mmBERT-base) is smaller, so
   training is cheaper too. Zero-shot it got 39 of the bench's 44 safety decisions right against 42 for the English
   checkpoint; fine-tuning is where that is won back.
3. **Training needs a GPU.** The vendor's notebook runs on Kaggle's free 2x T4 (the data here is public, no personal
   data, so it can leave our project); an L4 on Cloud Run needs quota we don't have.
4. **Precision is measured per task on the held-out test split and the golden set**, against the thresholds the
   registry uses, before any fine-tuned checkpoint replaces the shipped one.
