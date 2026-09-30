// Undo instead of "are you sure?" (UI-REVISION-PLAN Phase 1). A decision updates the screen in the same frame
// (the item is hidden through the pending store), shows a toast with Undo (Z), and only reaches the API when the
// window closes. Undo drops it without an API call; a failed commit puts the item back and says why.
// Closing the tab inside the window cancels the action: nothing is sent that the person didn't let through.
import { useSyncExternalStore, createElement } from 'react';
import { toast } from 'sonner';
import { invalidate } from './api';

export type PendingKind = 'approve' | 'reject' | 'handle' | 'archive' | 'cancel';
interface Entry { key: string; ids: string[]; kind: PendingKind; workspaceId: string; toastId: string | number; timer: number; commit: () => Promise<unknown>; onUndo?: () => void; onFail?: (e: Error) => void }

export const UNDO_MS = 6000;
const entries = new Map<string, Entry>();   // open windows, newest last
const hidden = new Map<string, PendingKind>(); // id -> why it is hidden right now (open window or committing)
const subs = new Set<() => void>();
let version = 0;
const emit = () => { version++; for (const f of subs) f(); };

/** Re-renders when anything is hidden or shown again. */
export function usePending() {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version);
  return { isHidden: (id: string) => hidden.has(id), kindOf: (id: string) => hidden.get(id), count: (workspaceId: string, kind: PendingKind) => countPending(workspaceId, kind) };
}
function countPending(workspaceId: string, kind: PendingKind) {
  let n = 0;
  for (const e of entries.values()) if (e.workspaceId === workspaceId && e.kind === kind) n += e.ids.length;
  return n;
}

function Drain() {
  // A ring that empties over the undo window. CSS only; gone under reduced motion.
  return createElement('svg', { className: 'undo-ring', viewBox: '0 0 20 20', width: 18, height: 18, 'aria-hidden': true },
    createElement('circle', { cx: 10, cy: 10, r: 8, pathLength: 100 }));
}

/**
 * Hide `ids` now; run `commit` after the undo window unless the person undoes it first.
 * `message` is the toast text (it stays the confirmation screen readers hear).
 */
export function deferAction(o: { ids: string[]; kind: PendingKind; workspaceId: string; message: string; commit: () => Promise<unknown>; onUndo?: () => void; onFail?: (e: Error) => void; ms?: number }) {
  const key = `${o.kind}:${o.ids.join(',')}:${Date.now()}`;
  for (const id of o.ids) hidden.set(id, o.kind);
  const undo = () => undoKey(key);
  const toastId = toast(o.message, { duration: o.ms ?? UNDO_MS, icon: createElement(Drain), action: { label: 'Undo (Z)', onClick: undo }, className: 'undo-toast' });
  const timer = window.setTimeout(() => void commitKey(key), o.ms ?? UNDO_MS);
  entries.set(key, { key, ids: o.ids, kind: o.kind, workspaceId: o.workspaceId, toastId, timer, commit: o.commit, onUndo: o.onUndo, onFail: o.onFail });
  emit();
  return undo;
}

async function commitKey(key: string) {
  const e = entries.get(key);
  if (!e) return;
  entries.delete(key);
  emit();
  try {
    await e.commit();
    // Keep the ids hidden until the lists have refetched without them, so nothing flashes back.
    invalidate();
    window.setTimeout(() => { for (const id of e.ids) if (hidden.get(id) === e.kind) hidden.delete(id); emit(); }, 1500);
  } catch (err) {
    for (const id of e.ids) hidden.delete(id);
    emit();
    const error = err as Error;
    if (e.onFail) e.onFail(error); else toast.error(error.message);
  }
}

function undoKey(key: string) {
  const e = entries.get(key);
  if (!e) return false;
  window.clearTimeout(e.timer);
  entries.delete(key);
  for (const id of e.ids) hidden.delete(id);
  toast.dismiss(e.toastId);
  e.onUndo?.();
  emit();
  toast('Undone. Nothing was sent.', { duration: 2500 });
  return true;
}

/** Undo the most recent open window (the Z key). Returns false when there is nothing to undo. */
export function undoLatest() {
  const last = [...entries.keys()].pop();
  return last ? undoKey(last) : false;
}
