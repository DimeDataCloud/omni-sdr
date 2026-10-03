# Omni-SDR pivot: the buffer between first touch and the closer

**Status:** the direction is Christian's (DECISIONS 2026-10-03). Everything in this file is a **proposal**, except
what it quotes from him. The five questions in §8 are his to answer. 2026-10-03, claude-local.

## 1. What Christian said
> "we need to focus this product a little further. this needs to be more focused on the real sdr aspect of it. it needs
> to be the buffer between the real closer and the initial outreach whethether that be a comment on an instagram ad, an
> email campaign, linkedin dms anything like that. should be a master at properly categorizing, responding, etc. we can
> use laya for a lot of this"

## 2. What Omni becomes, in one paragraph
Someone answers a business's outreach: a comment on an Instagram ad, a reply to an email campaign, a LinkedIn DM, a
website form. Omni reads it within minutes and decides what it is (interested, a question, an objection, the wrong
person, not now, an opt-out, spam). It answers in the business's voice from an approved playbook, asks the qualifying
questions the closer would ask, and handles the back-and-forth until the lead is either qualified or out. Then it hands
the lead to the human closer: a summary, the conversation, the answers, and a booked time or a hot alert. The closer
only ever talks to people who are ready.

**The product is the conversation, not the campaign.** Omni doesn't need to *send* the first touch. The business's ads,
campaigns and posts do that. Omni owns everything from the first answer to the handoff.

## 3. The loop
```
any channel ──► ingest ──► categorize (Laya) ──► respond (playbook) ──► qualify ──► hand off to the closer
                 │            │                    │ human approves        │            │ summary + booking/alert
                 │            ├─ opt-out ─► suppress, stop (already built: the safe side, enforced twice)
                 │            ├─ spam/abuse ─► hide/ignore, never answered
                 │            └─ out of office / not now ─► snooze, come back later
                 └─ one conversation per person per channel, threaded; dedupe by the channel's message id
```

## 4. What already exists (most of the hard parts)
| Piece | Where | Status |
|---|---|---|
| Inbound ingest for email replies (Reply-To token → email-worker → `/internal/inbound`) | `services/inbox.mjs`, `edge/email-worker` | live in prod |
| Rules triage: opt-out → suppress, any real reply stops the sequence, SLA, OOO snooze, hostile-input cleaning, prompt-injection stripping | `services/reply-rules.mjs` | live |
| Laya decider on the inbound path: two safety questions (stop, meeting) every 10 min, additions only, DB-enforced | `decider` Cloud Run, `jobs/refine.mjs`, 0006 | live |
| 11-way intent taxonomy on `inbound_messages` (meeting_request, positive_inquiry, question, objection, referral, OOO, not_interested, unsubscribe, wrong_person, bounce) | 0005 | schema only; label is shadow-only |
| Inbox, SLA notifications, meetings, the no-show reschedule draft | `routes/inbox.mjs` | live |
| Sending from the business's own Gmail; send guard, caps, ramp, suppression | `packages/sender`, 0001/0007 | live, first send done 2026-10-03 |
| Approvals queue, the claims gate (every claim cites a fact) | `routes/approvals.mjs`, `packages/gate` | live |
| Tenancy, RLS, credits, audit log, agency/client workspaces | `packages/db` | live |

So the pivot is mostly **turning the inbox from a triage screen into the product**, adding channels, and making Laya the
categorizer.

## 5. Laya's job, and its honest numbers
- Laya is a **decider**, not a writer. It answers typed questions about a text with a confidence ("Does the sender ask
  us to stop?" yes 0.91). It doesn't write replies.
- **Measured** (LAYA-PLAN.md): the two safety questions are good: stop catches 16/17 at 0.80 precision on the 89-reply
  golden set. The 9-way *label* in one question agreed 14/22, no better than the rules. That is why it's shadow-only.
- **Proposal: categorize with one yes/no question per category, not one 11-way label.** Laya's yes/no answers are where it's
  strong. Ask "Does the sender ask about price?", "Does the sender say they already have a provider?", "Is this aimed at
  someone else in the company?", and so on. Take the highest-confidence yes above each category's threshold. Below every
  threshold → `unclassified` → a human.
- **Cost estimate (UNVERIFIED, extrapolated from 2 questions = ~2.5 vCPU-s):** ~10 questions ≈ 8 vCPU-s per message,
  so the Cloud Run free tier (180k vCPU-s/month [VERIFY https://cloud.google.com/run/pricing]) covers roughly 20k
  messages/month at $0. Measure before relying on it.
- **Accuracy plan:** a golden set per channel. Instagram comments read nothing like email replies: short, emoji, slang,
  trolls. Thresholds are chosen on it, the way `reply_triage@2` was. The fine-tune target is `laya-multilingual`
  (3x cheaper, LAYA-PLAN). No category goes live until its golden-set precision is measured.
- **Safe side stays:** opt-out and spam can only ever *add* a restriction. A model answer never un-suppresses anything.

## 6. Responding without a paid model
The model stays off in prod until the first paying customer (DECISIONS 2026-10-02). So replies come from a **playbook**:
- Each workspace keeps approved responses per category, with fields filled from what we know (first name, the business's
  booking link, an answer from its FAQ). Laya picks the category, the playbook picks the reply, and a person approves it.
- Qualification is a short per-workspace script of 2–4 questions (need, timing, budget or size, decision-maker). Laya
  checks each answer ("Did they give a timeframe?").
- **Autonomy is earned per category.** Everything is approved by a person at first. A category moves to auto-send only
  after its replies are approved unedited N times in a row (proposed: 95% over the last 50). The existing workspace
  `trust_level` carries this.
- When there is a model (Vertex, after the first customer), it drafts free-form answers to `question` and `objection`.
  The claims gate still checks every factual claim.

## 7. Channels: what's possible, in recommended order
| Channel | How | Gatekeeper / risk | Order |
|---|---|---|---|
| Email replies | built (reply.omnisdr.com) | none | now |
| Website form / chat | a signed webhook per workspace (`channel = 'form'` already exists) | none | 1 |
| Instagram + Facebook comments and DMs (incl. ad comments) | Meta Graph API: comment webhooks, private replies to comments, Instagram messaging [VERIFY https://developers.facebook.com/docs/instagram-platform] | **Meta app review + business verification** (weeks; Christian's accounts). DMs only inside Meta's messaging window [VERIFY] | 2 (start the review early) |
| LinkedIn DMs | **No general messaging API**; LinkedIn restricts messaging to approved partners [VERIFY https://learn.microsoft.com/linkedin/]. Automating a personal inbox breaks its User Agreement | ToS / account-ban risk | manual: paste or forward a DM into Omni, and Omni drafts the answer for the person to send |
| SMS | Twilio (paid per message) | spend + 10DLC registration | later |

## 8. Decisions for Christian (each with the recommended default)
1. **Scope.** Park new outbound work (lead finding by place, campaign builder, competitor battlecards), but keep what's
   built running. *Default: yes, park it.* Every hour goes to the conversation layer.
2. **Replies.** Playbook replies chosen by Laya now ($0), model-written replies after the first customer. *Default: yes.*
3. **Channel order.** Email → website form → Instagram/Facebook (start Meta's app review now) → LinkedIn as paste-in only.
   *Default: yes.* Meta's review needs your Meta Business account. It's the long pole.
4. **Autonomy.** A person approves every reply until a category earns auto-send (95% unedited over 50). *Default: yes.*
5. **The waitlist site.** Re-point the demo and copy to the inbound buffer story (#77 is on hold). *Default: yes.*

## 9. Build plan (after §8), split between the sessions
| # | Work | Owner (proposal) |
|---|---|---|
| P1 | Conversations: threads across channels; `channel` adds `instagram`, `facebook`, `chat`; a closer role + handoff record | claude-cloud (schema) · claude-local audits |
| P2 | Laya category questions (`reply_triage@3`): one question per category, thresholds from a golden set; golden set ≥ 30/category for email | claude-local (owns the decider) |
| P3 | Playbook: per-workspace responses + qualification script; approve/edit/send from the inbox; autonomy counter | claude-cloud |
| P4 | Handoff: closer view, summary card, booking link, SLA alert to the closer; CRM push later | claude-cloud |
| P5 | Website form/chat webhook channel | claude-local |
| P6 | Meta channel adapter (comments + DMs) behind a flag; Meta app review checklist for Christian | claude-local |
| P7 | LinkedIn paste-in (manual) | claude-cloud |
| P8 | Waitlist demo + copy re-pointed | claude-cloud (#77) |
| P9 | Acceptance script rewritten around the new loop | both |
