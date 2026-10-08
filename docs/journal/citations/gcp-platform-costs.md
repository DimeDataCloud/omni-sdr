# GCP platform costs and limits

## Cloud SQL shared-core machines (db-f1-micro, db-g1-small) are not covered by the SLA and are meant for dev/test only
- Source: https://docs.cloud.google.com/sql/docs/postgres/instance-settings
- Retrieved: 2026-09-28 by claude
- Excerpt: "The `db-f1-micro` and `db-g1-small` machine types aren't included in the Cloud SQL SLA. These machine types are configured to use a shared-core CPU, and are designed to provide low-cost test and development instances only. Don't use them for production instances."
- Also: shared core is offered only in the **Enterprise** edition (not Enterprise Plus).
- Used in: Station 04 (prod sizing), SPEC §4
- Confidence: confirmed (official docs)
- Consequence: the "smallest tier, prod only" decision collides with this. See the Station 04 doc for the trade-off.

## Cloud SQL db-f1-micro costs about $8–11/month in us-central1 (compute only)
- Source: third-party summaries (Bytebase dbcost, Security Boulevard 2026-05). The official page https://cloud.google.com/sql/pricing didn't render in the fetch tool.
- Retrieved: 2026-09-28 by claude
- Excerpt: "db-f1-micro … Approximately $7-10/month (10 GB SSD, no HA, us-central1)"; another 2026 source says "$11.32/month"
- Used in: Station 04 cost floor
- Confidence: partial. The official figure comes from the pricing calculator or the Cloud Billing Catalog API, and the catalog API isn't enabled on the project (enabling it is Christian's call).
- Also: shared-core instances aren't eligible for committed-use discounts. Storage, backups and egress are billed separately.

## Identity Platform: Tier 1 providers (email, social such as Google) are free up to 49,999 MAU
- Source: https://cloud.google.com/identity-platform/pricing (content via a search-engine extract of the official page; direct fetch truncated)
- Retrieved: 2026-09-28 by claude
- Excerpt: free tier "0-49,999 monthly active users" for Tier 1; then "$0.0055 per MAU for 50,000-99,999"; Tier 2 (OIDC/SAML) free "0-49 MAUs", then "$0.015 per MAU"
- Used in: Station 05, SPEC §4 [VERIFY free MAU tier] (resolves it)
- Confidence: partial (official page, but seen through a search extract). Re-check that email-link sign-in counts as Tier 1 before launch.

## Custom domains on Cloud Run: the load balancer is the recommended route; Cloud Run domain mapping is preview and "not recommended for production"
- Source: https://docs.cloud.google.com/run/docs/mapping-custom-domains
- Retrieved: 2026-09-28 by claude
- Excerpt: "Cloud Run domain mappings are in the preview launch stage...they are not production-ready and are not supported at General Availability." / "At the moment, this option is not recommended for production services." (us-central1 is a supported region.)
- Used in: Station 04 (edge options)
- Confidence: confirmed

## External Application Load Balancer: $0.025/hour for up to 5 forwarding rules (~$18/month); Cloud Armor Standard: $5 per policy per month + $1 per rule per month
- Source: https://cloud.google.com/load-balancing/pricing and https://cloud.google.com/armor/pricing (via search extract of the official pages)
- Retrieved: 2026-09-28 by claude
- Excerpt: "You can create up to 5 forwarding rules for the price of $0.025/hour." / "security policies cost $5 per policy per month. Additionally, rules cost $1 per rule per month."
- Used in: Station 04 cost floor (INFRA §21's LB + Armor edge)
- Confidence: partial (search extract; data processing charges not included)
