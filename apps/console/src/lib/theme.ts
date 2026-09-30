// Light ships; dark is the DESIGN 4.1 proposal, a pure token swap behind a toggle. One global store.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'omni-theme';
const subs = new Set<() => void>();
let theme: Theme = (() => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } })();

function apply() {
  document.documentElement.dataset.theme = theme;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', theme === 'dark' ? '#1F1E1C' : '#F7F5F0');
}
apply();

export function setTheme(t: Theme) {
  theme = t; apply();
  try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
  for (const f of subs) f();
}
export const useTheme = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => theme);

// Density: comfortable (default) or compact rows. Compact only applies at >=768px (tokens.css), so phones keep 44px targets.
export type Density = 'comfortable' | 'compact';
const DKEY = 'omni-density';
const dsubs = new Set<() => void>();
let density: Density = (() => { try { return localStorage.getItem(DKEY) === 'compact' ? 'compact' : 'comfortable'; } catch { return 'comfortable'; } })();
document.documentElement.dataset.density = density;
export function setDensity(d: Density) {
  density = d; document.documentElement.dataset.density = d;
  try { localStorage.setItem(DKEY, d); } catch { /* private mode */ }
  for (const f of dsubs) f();
}
export const useDensity = () => useSyncExternalStore((f) => { dsubs.add(f); return () => { dsubs.delete(f); }; }, () => density);
