# CAN-SPAM (US commercial email)

## Commercial email must carry a valid physical postal address; a registered PO box or CMRA private mailbox qualifies
- Source: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- Retrieved: 2026-09-28 by claude
- Excerpt: "Your message must include your valid physical postal address. This can be your current street address, a post office box you've registered with the U.S. Postal Service, or a private mailbox you've registered with a commercial mail receiving agency established under Postal Service regulations."
- Used in: DECISIONS "Postal address" (Station 23), SPEC §8 St.23
- Confidence: confirmed (FTC)
- Consequence: the decision's "revisit when a virtual mailbox is affordable" is legally viable: a USPS PO box or a CMRA mailbox can replace the home address.

## Opt-outs must be honored within 10 business days; the mechanism must work for at least 30 days after sending
- Source: same
- Retrieved: 2026-09-28 by claude
- Excerpt: "You must honor a recipient's opt-out request within 10 business days." / "Any opt-out mechanism you offer must be able to process opt-out requests for at least 30 days after you send your message."
- Used in: Station 14 (unsubscribe), SPEC §11
- Confidence: confirmed
- Consequence: Omni-SDR writes suppression immediately, well inside the limit. Unsubscribe tokens (`/u/[token]`) must stay valid ≥30 days; set them to never expire.

## Transactional/relationship messages are exempt from most CAN-SPAM provisions (including the postal address)
- Source: same
- Retrieved: 2026-09-28 by claude
- Excerpt: "If it contains only transactional or relationship content, its primary purpose is transactional or relationship. In that case, it may not contain false or misleading routing information, but is otherwise exempt from most provisions of the CAN-SPAM Act."
- Used in: DECISIONS "Postal address" (no address on notify. transactional mail)
- Confidence: confirmed
- Consequence: the exemption holds only while notify. mail stays **purely** transactional. Adding promotional content (upsells, "try our new feature") makes it commercial, and then it needs the address and an unsubscribe.
