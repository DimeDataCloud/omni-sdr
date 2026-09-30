// Light ships; dark is the DESIGN 4.1 proposal, a pure token swap behind a toggle. One global store.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'omni-theme';
const subs = new Set<() => void>();
let theme: Theme = (() => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } })();

function apply() {
  document.documentElement.dataset.theme = theme;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', theme === 'dark' ? '#0F100E' : '#F7F5F0');
}
apply();

export function setTheme(t: Theme) {
  theme = t; apply();
  try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
  for (const f of subs) f();
}
export const useTheme = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => theme);
