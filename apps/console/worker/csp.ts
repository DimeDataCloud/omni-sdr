// The one Content-Security-Policy for the app pages. The Worker sends it in production and `vite preview` sends it
// to the local gates, so a CSP break shows up as a console error before deploy, not after.
// - style-src 'unsafe-inline': the toast library injects a <style> element at runtime; scripts stay 'self' only.
// - static.cloudflareinsights.com: the zone's Cloudflare Web Analytics beacon (injected at the edge). Page views
//   only; nothing reaches prospects. Remove both entries if Web Analytics is turned off for omnisdr.com.
// - blob: in img-src and media-src: Studio previews a file the person just picked (URL.createObjectURL) before it is
//   uploaded. A blob: URL can only be minted by this page's own scripts, so it adds no third-party origin.
// - The API and Identity Platform (G5): the app calls the API with an ID token it gets from identitytoolkit and refreshes
//   at securetoken. Exact origins only; a demo build never calls them.
export const API_ORIGINS = ['https://omni-api-885132575622.us-central1.run.app', 'https://api.omnisdr.com'];
const IDP_ORIGINS = ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'];
export function appCsp(styleNonce?: string) {
  return [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    styleNonce ? `style-src 'self' 'nonce-${styleNonce}'` : "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' https://cloudflareinsights.com ${[...API_ORIGINS, ...IDP_ORIGINS].join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}
