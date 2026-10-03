# Meta (Instagram + Facebook) channel: what Christian sets up

**Status:** checklist for SDR-PIVOT P6. The code side ships off (`packages/api/src/services/meta.mjs`). Every platform fact
here is `[VERIFY]` against Meta's docs on the day you do it. Meta changes these pages often. 2026-10-03, claude-local.

## Why this is the long pole
Reading comments and DMs on accounts other than your own needs **Advanced Access**, which means **app review** plus
**business verification** [VERIFY https://developers.facebook.com/docs/instagram-platform/webhooks]. Expect days to
weeks. Nothing on our side shortens it, so start it first.

## Your steps (in order)
1. **Meta Business account** (business.facebook.com) for Dime Data / Omni, with a Facebook Page and an Instagram
   professional account connected to it. You need these to test.
2. **Business verification** in Business Settings → Security Center (legal name, address, a document) [VERIFY].
3. **Create the app** at developers.facebook.com → My Apps → Create App → type **Business**.
4. **Add products:** Instagram (Instagram API with Facebook Login for Business) and Webhooks; Messenger for Page DMs [VERIFY].
5. **Permissions to request** [VERIFY https://developers.facebook.com/docs/permissions]:
   - `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_messaging`
   - Nothing that reads followers, posts content, or runs ads. Omni only reads replies and answers them.
6. **App settings → Basic:** privacy policy URL, terms URL, data-deletion instructions URL. The privacy policy needs a
   section on Meta data before review (same gap as the Gmail note in issue #69).
7. **Webhooks:** callback URL `https://api.omnisdr.com/v1/meta/webhook` and a verify token. **Tell claude-local when the
   app exists.** claude-local generates the verify token and stores it, with the app secret, in Secret Manager
   (`omni-sender-secrets`, by name; never in chat). You paste the verify token into Meta's dashboard from a file in
   `~\.halo-keys\`.
8. **App review:** a screencast per permission showing the real flow: a comment arrives, Omni categorizes it, a person
   approves the reply, the reply posts. Claude can script the screencast; you record and submit it.

## What it costs
Meta's Graph API and webhooks: no fee [VERIFY]. Business verification: no fee [VERIFY].

## Limits that shape the product [VERIFY https://developers.facebook.com/docs/instagram-platform/private-replies]
- A comment gets **one private reply** (a DM to the commenter) within **7 days**. More messages only after they answer,
  and within 24 hours of their answer.
- DMs: replies inside Meta's messaging window. Outside it, nothing, unless a message tag applies.
- So for a hot comment, Omni answers once, well, and moves the person to DM or a booking link fast.

## Code side, when the app is approved
- Route `GET/POST /v1/meta/webhook`: handshake (`verifyHandshake`), signature on the raw body (`verifyMetaSignature`),
  `parseMetaEvents` → inbound messages on the conversation schema (SDR-PIVOT P1).
- An account mapping (Page / IG account id → workspace) and its sealed Page token, from a Facebook Login connect flow
  like the Gmail one.
- Before trusting the parser, capture one real payload of each kind (comment, DM, page comment, Messenger) and fix the
  fixtures to match.
