# Omni-SDR — Color palette and design system (from Christian, 2026-09-28)

| Element | Color name | Hex | RGBA / CSS value | Usage |
| --- | --- | --- | --- | --- |
| Main background | Translucent Sand | `#F7F5F0` | `rgba(247, 245, 240, 0.85)` | Base layer. Slight frosted-glass blur (`backdrop-filter: blur`) when layered over other elements. |
| Containers & cards | Frosted White | `#FFFFFF` | `rgba(255, 255, 255, 0.65)` | Cards, forms and input fields; keeps the translucent, airy look. |
| Primary text | Satin Black | `#1A1A1A` | `rgb(26, 26, 26)` | All headings, labels, paragraph text. |
| Primary accent | Pastel Neon Green | `#A3FFB4` | `rgb(163, 255, 180)` | CTA buttons, checkmarks, success states, glowing accents. |
| Hover & focus | Electric Mint | `#7BFF93` | `rgb(123, 255, 147)` | Button hover, field focus. |
| Borders & dividers | Pale Sand | `#E8E4D9` | `rgb(232, 228, 217)` | Input outlines, dividers. |

## Styling rules

- **Typography:** sans-serif (Inter or Roboto). Body light/regular; headers semi-bold ("satin" feel).
- **Shadows:** extremely soft and diffuse, e.g. `box-shadow: 0 8px 32px rgba(0, 0, 0, 0.04)`.
- **Buttons:** Pastel Neon Green with `#1A1A1A` text; subtle Electric Mint glow on hover.
- **Glassmorphism:** containers carry a slight `backdrop-blur` so the sand shows through.

## Accessibility constraints (added in review, binding)

- Green (`#A3FFB4`, `#7BFF93`) is a **fill only**, always with `#1A1A1A` text on it. Never green text or a green-only icon on sand/white; contrast is about 1.2:1.
- A dark green token (`--accent-ink`) for links, success text and focus rings, derived in Station 3 and verified ≥ 4.5:1 on `#F7F5F0` and `#FFFFFF`.
- Focus rings: 2px `--accent-ink` plus an offset; never rely on the mint glow alone.
- Glass: when content under a translucent card makes text drop below 4.5:1, raise the card's opacity. `prefers-reduced-transparency` → opaque cards.
- Dark mode: not specified; Station 3 proposes one for approval.
