import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { onInvalidate, ApiError } from './api';

export interface Query<T> { data: T | undefined; error: ApiError | null; loading: boolean; reload: () => void }

// Stale-while-revalidate cache (UI-REVISION-PLAN Phase 1). A screen you have seen before renders from here in the
// first frame, then refreshes; skeletons appear only on a cold load. The key is the query's own source plus its
// deps, or an explicit `key` when a page prefetches it (see prefetchQuery).
const cache = new Map<string, unknown>();
function put(key: string, v: unknown) { cache.delete(key); cache.set(key, v); if (cache.size > 200) cache.delete(cache.keys().next().value!); }
const keyOf = (fn: () => unknown, deps: unknown[]) => `${fn.toString()}|${JSON.stringify(deps)}`;

/** Warm the cache for a query a screen is about to make (hover/focus on its nav link). */
export function prefetchQuery<T>(key: string, fn: () => Promise<T>) {
  if (cache.has(key)) return;
  fn().then((d) => { if (!cache.has(key)) put(key, d); }).catch(() => { /* the screen will fetch and show the error itself */ });
}

/** Fetch on mount and whenever deps change; refetch on any mutation (invalidate) and, optionally, on an interval while visible. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[], opts: { pollMs?: number; enabled?: boolean; key?: string } = {}): Query<T> {
  const key = useMemo(() => opts.key ?? keyOf(fn, deps), [opts.key, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<{ key: string; data: T | undefined }>(() => ({ key, data: cache.get(key) as T | undefined }));
  // A new key (another tab, another workspace) never shows the previous key's data: cached or nothing.
  const data = state.key === key ? state.data : (cache.get(key) as T | undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const enabled = opts.enabled ?? true;
  const run = useCallback(() => {
    if (!enabled) { setLoading(false); return; }
    const n = ++seq.current;
    fn().then((d) => { if (n === seq.current) { put(key, d); setState({ key, data: d }); setError(null); setLoading(false); } })
      .catch((e) => { if (n === seq.current) { setError(e instanceof ApiError ? e : new ApiError(500, 'internal', 'Something went wrong. Try again.')); setLoading(false); } });
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); run(); }, [run]);
  useEffect(() => onInvalidate(run), [run]);
  useEffect(() => {
    if (!opts.pollMs) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') run(); }, opts.pollMs);
    return () => clearInterval(t);
  }, [run, opts.pollMs]);
  return { data, error, loading: loading && data === undefined, reload: run };
}

/** Height from where `ref`'s parent starts in the page down to the window's bottom edge (macOS split view: list and
 *  detail panes fill the window and scroll on their own, so a pane's footer actions are always on screen). Exposed as
 *  the CSS variable --fill, so a breakpoint class decides where it applies: `lg:max-h-[var(--fill)]`. */
export function useFillHeight<T extends HTMLElement>(gap = 16, min = 360) {
  const [el, ref] = useState<T | null>(null); // a callback ref: the pane often mounts after the data loads
  const [h, setH] = useState(0);
  useEffect(() => {
    const host = el?.parentElement; // the parent, not the element: a stuck sticky element reports its stuck position
    if (!host) return;
    const fit = () => setH(Math.max(min, Math.round(window.innerHeight - (host.getBoundingClientRect().top + window.scrollY) - gap)));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(document.documentElement);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [el, gap, min]);
  return [ref, (h ? { '--fill': `${h}px` } : {}) as CSSProperties] as const;
}

export function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on(); m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Re-render every `ms` so relative times and SLA countdowns stay current. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Single-key shortcuts; ignored while typing, with modifiers, or while a dialog is open. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, deps: unknown[] = [], enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const fn = map[e.key] ?? map[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(e); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [...deps, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Multi-select over an ordered list of ids (UI-REVISION-PLAN Phase 1): click toggles, Shift-click selects the range
 * from the last clicked row, Ctrl/Cmd A selects everything visible, Esc clears. Ids that leave the list drop out.
 */
export function useSelection(order: string[], enabled = true) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const live = useMemo(() => new Set([...sel].filter((id) => order.includes(id))), [sel, order]);
  const toggle = useCallback((id: string, e?: { shiftKey?: boolean }) => {
    // Read the anchor now: the updater runs later, after anchor.current has moved to this row.
    const a = anchor.current ? order.indexOf(anchor.current) : -1;
    const b = order.indexOf(id);
    setSel((cur) => {
      const next = new Set([...cur].filter((x) => order.includes(x)));
      if (e?.shiftKey && a >= 0 && b >= 0) {
        const on = !next.has(id);
        for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) { if (on) next.add(x); else next.delete(x); }
      } else if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    anchor.current = id;
  }, [order]);
  const clear = useCallback(() => { setSel(new Set()); anchor.current = null; }, []);
  const selectAll = useCallback(() => setSel(new Set(order)), [order]);
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && (t as HTMLInputElement).type !== 'checkbox')) return;
      if (document.querySelector('[role="dialog"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && order.length) { e.preventDefault(); selectAll(); }
      else if (e.key === 'Escape' && live.size) { e.preventDefault(); clear(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [enabled, order.length, live.size, selectAll, clear]);
  return { has: (id: string) => live.has(id), size: live.size, ids: [...live], toggle, clear, selectAll };
}

// Focus handoff (UI-REVISION-PLAN Phase 2). A keyboard or screen-reader user must land on the new thing, not on
// <body> after the old thing unmounts. `requestArrival()` marks the next mounting target as the destination.
let arriving = false;
export function requestArrival() { arriving = true; setTimeout(() => { arriving = false; }, 1000); } // unclaimed requests expire
/** On mount, focus `ref` if an arrival was requested or focus was lost to <body>. */
export function useArrivalFocus(ref: { current: HTMLElement | null }, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const a = document.activeElement;
    if (arriving || !a || a === document.body) { arriving = false; ref.current?.focus({ preventScroll: true }); }
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** J/K past the end of a keyboard list (`[data-kbd-list]`): bump the open row so the key visibly answered. */
export function bumpEdge(dir: 1 | -1) {
  const row = document.querySelector<HTMLElement>('[data-kbd-list] [aria-current="true"]')?.closest<HTMLElement>('li');
  if (!row) return;
  row.dataset.bump = dir > 0 ? 'down' : 'up';
  row.addEventListener('animationend', () => { delete row.dataset.bump; }, { once: true });
}
