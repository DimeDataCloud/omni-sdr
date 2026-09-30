import { useCallback, useEffect, useRef, useState } from 'react';
import { onInvalidate, ApiError } from './api';

export interface Query<T> { data: T | undefined; error: ApiError | null; loading: boolean; reload: () => void }

/** Fetch on mount and whenever deps change; refetch on any mutation (invalidate) and, optionally, on an interval while visible. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[], opts: { pollMs?: number; enabled?: boolean } = {}): Query<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const enabled = opts.enabled ?? true;
  const run = useCallback(() => {
    if (!enabled) { setLoading(false); return; }
    const n = ++seq.current;
    fn().then((d) => { if (n === seq.current) { setData(d); setError(null); setLoading(false); } })
      .catch((e) => { if (n === seq.current) { setError(e instanceof ApiError ? e : new ApiError(500, 'internal', 'Something went wrong. Try again.')); setLoading(false); } });
  }, [...deps, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); run(); }, [run]);
  useEffect(() => onInvalidate(run), [run]);
  useEffect(() => {
    if (!opts.pollMs) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') run(); }, opts.pollMs);
    return () => clearInterval(t);
  }, [run, opts.pollMs]);
  return { data, error, loading: loading && data === undefined, reload: run };
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
