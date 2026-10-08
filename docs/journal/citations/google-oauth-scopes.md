# Google OAuth scopes (Gmail, Calendar)

## `gmail.send` is Sensitive (verification, no security assessment); `gmail.readonly` and `gmail.modify` are Restricted (security assessment)
- Source: https://developers.google.com/workspace/gmail/api/auth/scopes
- Retrieved: 2026-09-28 by claude
- Excerpt: gmail.send, **Sensitive**, "Send email on your behalf." gmail.readonly, **Restricted**. gmail.modify, **Restricted**. "If you store restricted scope data on servers (or transmit), then you must go through a security assessment."
- Used in: DECISIONS "No Google Workspace; OAuth plan", SPEC §4
- Confidence: confirmed
- Consequence: confirms the plan. Send-only plus Reply-To routing avoids the restricted scopes and the assessment (CASA). **Never add a Gmail read scope** without Christian deciding to take on the assessment.

## Calendar scopes for native booking
- Source: https://developers.google.com/workspace/calendar/api/auth
- Retrieved: 2026-09-28 by claude
- Excerpt: `calendar.freebusy`, "View your availability in your calendars." `calendar.events.owned`, "See, create, change, and delete events on Google calendars you own." `calendar.events`, "View and edit events on all your calendars."
- Used in: Station 16 (3 slots from free/busy + booking)
- Confidence: partial. The page doesn't show the sensitivity class; check the OAuth consent screen in the console.
- Recommendation: request `calendar.freebusy` + `calendar.events.owned` (the narrowest pair that covers it) rather than `calendar.events`.
