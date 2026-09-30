# Omni-SDR — Design System

This document outlines the core design language, components, and layout principles for Omni-SDR. It is a **proposal pending Christian's approval** for building screens in `apps/web/`, combining Christian's initial brand palette with the architectural layout rules defined in `SPEC.md`.

## 1. Brand Palette & Color System

Our aesthetic relies on an airy, frosted-glass feel with high-contrast text and striking neon green accents.

| Role | Color Name | Hex | Usage | shadcn/ui Variable |
|---|---|---|---|---|
| **Base Background** | Translucent Sand | `#F7F5F0` | Base layer of the app. | `--background` |
| **Containers/Cards** | Frosted White | `rgba(255, 255, 255, 0.65)` | Cards, panels, inputs (glassy overlay). | `--card` / `--popover` |
| **Primary Text** | Satin Black | `#1A1A1A` | Primary headers, body copy. | `--foreground` / `--card-foreground` |
| **Primary CTA Fill** | Pastel Neon Green | `#A3FFB4` | Primary buttons, active toggles. | `--primary` |
| **Hover Fill** | Electric Mint | `#7BFF93` | Hover state for buttons. | `--primary-hover` (custom) |
| **Borders** | Pale Sand | `#E8E4D9` | Dividers, input borders. | `--border` / `--input` |
| **Accent Text/Links** | Accent Ink | `#166534` | Links, success text, focus rings. Contrast: 6.5:1 on sand, 7.1:1 on white, 6.0:1 on #A3FFB4. | `--ring` / `--accent-foreground` |

### Proposed Dark Palette (Pending Approval)
| Role | Hex | Notes |
|---|---|---|
| **Base Background** | `#0D0D0D` | Deep black/charcoal. |
| **Containers/Cards** | `rgba(26, 26, 26, 0.65)` | Frosted dark glass. |
| **Primary Text** | `#F7F5F0` | Translucent Sand used for high-contrast light text. |
| **Primary CTA Fill** | `#7BFF93` | Electric Mint becomes the primary fill in dark mode. |
| **Borders** | `#333333` | Subtle dark borders. |

### Status Colors (Contrast Ratios)
- **Success:** `#166534` (Accent Ink, ≥4.5:1 on light backgrounds).
- **Warning:** `#854D0E` (Dark Yellow/Orange, ≥4.5:1 on light backgrounds).
- **Destructive/Error:** `#B91C1C` (Dark Red, ≥4.5:1 on light backgrounds). `--destructive`

### Chart Palette
- Sequential/Categorical: `#166534`, `#22C55E`, `#A3FFB4`, `#1D4ED8`, `#93C5FD`. (All verified for distinctiveness and contrast).

### Accessibility Rules
1. **Green is a fill, never text:** `#A3FFB4` and `#7BFF93` must never be used for typography or standalone icons on a light background. Always use them as fills underneath `#1A1A1A` text.
2. **Focus Rings:** Use 2px `Accent Ink` (`#166534`) with an offset. Do not rely solely on mint glows.
3. **Glass Constraints:** If the background image or content beneath a glass card causes text contrast to drop below WCAG 2.2 AA (4.5:1), increase the card's opacity.
4. **Reduced Transparency & Motion:** 
   - Honor `prefers-reduced-transparency` by making cards fully opaque (`#FFFFFF`).
   - Honor `prefers-reduced-motion` by disabling UI animations and transitions.
5. **Keyboard Support:** High-velocity queues (like Approvals) must support keyboard shortcuts (A=Approve, E=Edit, D=Discard, S=Skip).

## 2. Typography, Spacing & Motion Scales

- **Font Family:** `Inter` or `Roboto` (sans-serif).
- **Body:** Light or Regular weight. Air out line-heights (1.5 - 1.6).
- **Headers:** Semi-bold to provide a solid, "satin" anchor to the airy glassmorphism.
- **Spacing Scale:** 4px baseline (`p-1`, `p-2`, `p-4`, `p-8` in Tailwind).
- **Shadows:** Extremely soft and diffuse: `box-shadow: 0 8px 32px rgba(0, 0, 0, 0.04)`.
- **Radii:** Rounded, friendly corners (`12px` or `16px` for cards, `8px` for buttons/inputs).
- **Motion Scale:** Fast, snappy transitions (150ms ease-out for hovers, 200ms ease-out for modals/drawers).

## 3. Structural Layouts (The Composer)

Omni-SDR is not a traditional dashboard of charts; it is **Composer-first**.

### The Composer View (`/app/[ws]/home`)
- The central hub where users spend their time.
- Operates like a chat or step-by-step generative form.
- **Proactive but Skippable:** It asks for missing context (website, offer, voice note, ICP) one at a time. The user can skip any of them.
- **Estimates Inline:** Every generative action (e.g., "Draft campaign") displays an inline cost/time estimate *before* running. No modals are used for this. The click of the "Run" button acts as consent.

### The Queue View
- **Today Cards:** Approvals, Replies, and Meeting SLAs sit beside or below the composer.
- **Mobile-First:** The Approval queue, Inbox, and Meeting requests must be designed mobile-first, recognizing that SDR operators swipe through approvals on the go.

### Settings & Connectors
- Connectors are treated as modular connection cards.
- **Connector States:** `Connected`, `Pending Auth`, `Setup Now (Activates Later)`, `Reauth needed`, `Error`, `LinkedIn consent`.

## 4. White-Labeling (Agency Accounts)

When `orgs.account_type` is `agency`, the design system must gracefully swap to the agency's configuration:
- **Logo swap:** The top-left logo is replaced.
- **Domain:** Hosted on the agency's custom domain (Cloudflare for SaaS).
- **Color Overrides:** The neon green CTAs and sand backgrounds can be overridden by the agency's brand colors. **The system auto-picks text color (white or black) on agency color overrides to guarantee ≥4.5:1 contrast, with a fallback to `#1A1A1A`.**
- **No Omni-SDR branding & Postal Address Rule:** Absolutely zero watermarks or mentions of Omni-SDR. No postal address appears in the app, reports, audit pages, or client-facing notify emails. Customer outreach carries the sending customer's own address.

## 5. UI Interaction Patterns

- **No Dead Buttons:** If a generator feature flag is off in prod (e.g., Video generation), the button is completely hidden, or alternatively offers a manual upload/picker. Do not show "Coming Soon" or disabled buttons.
- **Destructive Actions & Archiving:** Require a secondary confirmation for disconnecting critical mailboxes. **ICPs are archived, never deleted.**
- **SLA Warnings:** Meeting SLA escalations turn UI elements red/urgent when the 2-business-hour window is closing.

---
*Drafted by Gemini (Station Drafts/UI Lane)*
