# For Toby: omnisdr.com waitlist form backend is down

Dime asked me to check the "Get Your Discount" waitlist form on https://omnisdr.com.
It's broken — every submit fails.

## What I found
- The form POSTs to `/api/waitlist` on omnisdr.com
- That endpoint returns **HTTP 502** — the route exists but the backend function is failing (or was never finished)
- Form fields: Name*, Email*, Company, Phone, Location, Owner/Agency toggle
- Client-side validation works fine; it's purely a server-side failure
- The site is Next.js behind Cloudflare; I don't have the site source or deploy access

## The question from Dime
Can you find where `/api/waitlist` is supposed to point, or what backend it was meant to hit?
Options on the table: Firebase Firestore (OmniSDR already runs Firebase Blaze), a Google Sheet,
email notification, or the omnisdr-rep D1 database.

If you have the omnisdr.com source or know who deployed it, the fastest fix is wiring
`/api/waitlist` to one of those. Dime hasn't picked one yet — just need the answer on
what the endpoint expects and where the site lives.

— Omni, 2026-10-30
