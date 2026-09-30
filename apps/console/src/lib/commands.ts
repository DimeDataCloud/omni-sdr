// Actions the current screen offers (UI-REVISION-PLAN Phase 2). A screen registers them with useCommands; Ctrl K
// lists them under "This page" and the ? sheet lists their keys first, so the palette, the shortcut sheet and the
// page's own hotkeys can't drift apart: one list, three readers.
// A page and a component inside it (Approvals and its open draft) may both register; their lists concatenate in
// mount order, page first.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface Command { id: string; label: string; keys?: string; icon?: LucideIcon; run: () => void; tone?: 'danger' }
const regs = new Map<symbol, Command[]>();
let snapshot: Command[] = [];
const subs = new Set<() => void>();
const emit = () => { snapshot = [...regs.values()].flat(); for (const f of subs) f(); };

/** Register actions while mounted. `commands` may change every render; the newest closures always run. */
export function useCommands(commands: Command[]) {
  const ref = useRef(commands);
  ref.current = commands;
  const me = useRef<symbol>(null);
  me.current ??= Symbol('commands');
  const sig = commands.map((c) => `${c.id}:${c.label}:${c.keys ?? ''}:${c.tone ?? ''}`).join('|');
  useEffect(() => {
    const key = me.current!;
    // Re-register only when the visible list changes; `run` goes through the ref so it never goes stale.
    regs.set(key, ref.current.map((c) => ({ ...c, run: () => ref.current.find((x) => x.id === c.id)?.run() })));
    emit();
    return () => { regs.delete(key); emit(); };
  }, [sig]);
}

export function usePageCommands() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snapshot);
}

// Recents: the last few things opened from the palette. A per-viewer convenience, so browser storage is fine.
const RKEY = 'omni-palette-recent';
export interface Recent { value: string; label: string; to: string; kind: 'page' | 'draft' | 'contact' | 'agent' | 'meeting' }
export function readRecents(): Recent[] {
  try { const v = JSON.parse(localStorage.getItem(RKEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function pushRecent(r: Recent) {
  try { localStorage.setItem(RKEY, JSON.stringify([r, ...readRecents().filter((x) => x.to !== r.to)].slice(0, 5))); } catch { /* storage blocked */ }
}
