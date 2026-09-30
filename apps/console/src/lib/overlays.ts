// Open/closed state for app-wide overlays (command palette, shortcut sheet), kept outside the shell's React state.
// Opening the palette used to set state on AppShell, which re-rendered the whole current page with it
// (Ctrl K took 111-159 ms of script on a 4x CPU). Now only the overlay's own host re-renders.
import { useCallback, useSyncExternalStore } from 'react';

export type Overlay = 'palette' | 'help';
const state: Record<Overlay, boolean> = { palette: false, help: false };
const subs = new Set<() => void>();

export function setOverlay(name: Overlay, open: boolean) {
  if (state[name] === open) return;
  state[name] = open;
  for (const f of subs) f();
}
export const openOverlay = (name: Overlay) => setOverlay(name, true);
export const toggleOverlay = (name: Overlay) => setOverlay(name, !state[name]);

export function useOverlay(name: Overlay): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state[name]);
  return [open, useCallback((v: boolean) => setOverlay(name, v), [name])];
}
