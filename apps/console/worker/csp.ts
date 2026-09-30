// The one Content-Security-Policy for the app pages. The Worker sends it in production and `vite preview` sends it
// to the local gates, so a CSP break shows up as a console error before deploy, not after.
// - style-src 'unsafe-inline': the toast library injects a <style> element at runtime; scripts stay 'self' only.
// - static.cloudflareinsights.com: the zone's Cloudflare Web Analytics beacon (injected at the edge). Page views
//   only; nothing reaches prospects. Remove both entries if Web Analytics is turned off for omnisdr.com.
export function appCsp(styleNonce?: string) {
  return [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    styleNonce ? `style-src 'self' 'nonce-${styleNonce}'` : "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}
