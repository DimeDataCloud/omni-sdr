// Where to go after sign-in. Only a path on this origin, so a crafted link can't send a signed-in person elsewhere.
// Browsers drop tab, CR and LF while parsing a URL and read `\` as `/`, so "/\t/evil.example" or "/\/evil.example"
// would pass a prefix check and still leave the origin: refuse every control character and backslash, then resolve
// it and compare origins.
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

export function safeNext(n: string | null | undefined, origin: string = window.location.origin): string {
  if (!n || !n.startsWith('/') || UNSAFE.test(n)) return '/';
  try {
    const u = new URL(n, origin);
    return u.origin === origin ? `${u.pathname}${u.search}${u.hash}` : '/';
  } catch { return '/'; }
}
