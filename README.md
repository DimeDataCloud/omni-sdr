# Omni-SDR: Autonomous Multi-Channel AI Sales Representative

**Omni-SDR** is a Google-native, multi-tenant AI SDR platform engineered specifically for **B2B Agencies and High-Ticket Service Providers** ($3,000 – $25,000+ ACV).

Unlike commodity cold email tools that spray unpersonalized templates and burn domains, Omni-SDR operates on a precision, evidence-grounded architecture:

1. **Hybrid Intelligence & Pain Mining:** Scrapes Google Places, Skool communities, and prospective websites to isolate dated, verifiable operational bottlenecks (e.g. unanswered 1-star to 3-star reviews, slow quote turnaround, broken mobile scheduling).
2. **Code-Enforced Claims-Gate:** Eliminates hallucinated sales copy. Every outreach message must bind to a verified evidence anchor before it can be queued or dispatched.
3. **Dynamic Hosted Proof Assets:** Automatically compiles and hosts bespoke, branded audit landing pages (`/audit/[slug]`) demonstrating estimated monthly revenue bleed and embedding a 1-click Google Calendar booking flow.
4. **Omnichannel Execution:** Coordinates warm Google Workspace (Gmail API) cold emails, Twilio SMS follow-ups, LinkedIn touches, and social authority content generation.
5. **The Trust Dial:** Calibrates agency autonomy from Level 1 (Tinder-style 1-click mobile/web swipe review) to Level 2 (Guarded Autonomy with confidence thresholds and rate caps) to Level 3 (Full 24/7 Unattended Autonomy).
6. **Sub-Minute Inbound Triage:** Google Gemini 2.5 Flash classifies replies into discrete intents (Meeting Requested, Pricing Objection, Timing, Wrong Person, Unsubscribe) and delivers framed rebuttals instantly.

---

## Architecture & Technology Stack

- **Framework:** Next.js 16+ (App Router, Turbopack, React 19, TypeScript)
- **Styling:** Tailwind CSS v4, Lucide icons, Dark-mode glassmorphic interface
- **Intelligence Core:** Google Gemini 2.5 (`@google/genai` Flash & Pro)
- **Database & Storage:** Google Cloud Firestore / Firebase multi-tenant collections
- **Google Integrations:** Google Places API, Gmail API, Google Calendar API
- **Telephony & SMS:** Twilio REST API

---

## Directory Structure

```
projects/omni-sdr/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Command Center (KPIs, Trust Dial, Active Campaigns)
│   │   ├── approval-queue/page.tsx     # Full-Screen Swipe Deck & 1-Click Batch Approval
│   │   ├── prospects/page.tsx          # Hybrid Lead Miner (Google Places, Skool, Web)
│   │   ├── audit/[slug]/page.tsx       # Public Dynamic Hosted Audit & Calendar Booking
│   │   ├── social-engine/page.tsx      # Social Authority & Inbound Teardown Flywheel
│   │   ├── inbound/page.tsx            # Sub-Minute Reply Triage & Objection Closer
│   │   ├── settings/page.tsx           # Google Native API Keys & Workspace Config
│   │   ├── layout.tsx                  # Global Navbar & Aesthetics
│   │   └── globals.css                 # Tailwind CSS v4 Theme
│   ├── components/
│   │   ├── Navbar.tsx                  # Top Navigation & Status Bar
│   │   ├── TrustDialSwitch.tsx         # L1 / L2 / L3 Autonomy Switcher
│   │   ├── KPICards.tsx                # Pipeline Value, Evidence Anchors, Bookings
│   │   └── SwipeCardQueue.tsx          # Card Swipe Review & Multi-Channel Copy Viewer
│   ├── lib/
│   │   ├── gemini.ts                   # Google Gen AI Client & Generation Services
│   │   ├── claims-gate.ts              # Anti-Hallucination & Evidence Verification
│   │   ├── mock-data.ts                # Realistic B2B Agency & Contractor Seed Data
│   │   └── store.ts                    # Client-side State & Storage Engine
│   └── types/
│       └── index.ts                    # Full TypeScript Domain Models
```

---

## Getting Started

```bash
# 1. Navigate to directory
cd projects/omni-sdr

# 2. Run development server
npm run dev -- -p 3005

# 3. Open in your browser
http://localhost:3005
```

---

## Core Routes & Workflow

- **Command Center:** `http://localhost:3005/`
- **Approval Queue:** `http://localhost:3005/approval-queue`
- **Prospect Miner:** `http://localhost:3005/prospects`
- **Live Sample Audit:** `http://localhost:3005/audit/stone-timber-commercial-roofing`
- **Social Authority Engine:** `http://localhost:3005/social-engine`
- **Inbound Triage:** `http://localhost:3005/inbound`
- **Settings:** `http://localhost:3005/settings`
