// Client portal: "Ask us to change this" and "Request a transcript" are prefilled emails, never writes (DESIGN-frontend-3,
// decided defaults). The address is config, not a guess: set VITE_CLIENT_SUPPORT_EMAIL. Unset, the pages say to ask your
// account contact and show no link.
const ADDRESS = (import.meta.env.VITE_CLIENT_SUPPORT_EMAIL as string | undefined)?.trim() || null;

export const askUsLink = (subject: string, body: string): string | null =>
  ADDRESS ? `mailto:${ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;
