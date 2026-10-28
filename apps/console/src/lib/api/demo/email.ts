// The one email shape check the demo store uses (PR #154 audit P2: the first version lost its backslashes).
export const looksLikeEmail = (s: string): boolean => s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
