// Route chunks, shared by React.lazy (App.tsx) and hover/focus prefetch (nav links). A screen module may export
// `prefetch(scope)` to warm the query it opens with, under the same key its useQuery reads.
import type { ComponentType } from 'react';
import type { Scope } from '@/lib/api/client';
import type { PageKey } from './nav';

type ScreenModule = { default: ComponentType; prefetch?: (scope: Scope) => void };
export const screenLoaders: Record<PageKey, () => Promise<ScreenModule>> = {
  home: () => import('@/features/home/HomePage'),
  approvals: () => import('@/features/approvals/ApprovalsPage'),
  inbox: () => import('@/features/inbox/InboxPage'),
  meetings: () => import('@/features/meetings/MeetingsPage'),
  leads: () => import('@/features/leads/LeadsPage'),
  analytics: () => import('@/features/analytics/AnalyticsPage'),
  studio: () => import('@/features/studio/StudioPage'),
  agents: () => import('@/features/agents/AgentsPage'),
  data: () => import('@/features/data/DataPage'),
  connections: () => import('@/features/connections/ConnectionsPage'),
  settings: () => import('@/features/settings/SettingsPage'),
};

const warmed = new Set<string>();
/** Load a screen's chunk and its first query. Cheap to call repeatedly; each workspace+screen warms once. */
export function prefetchScreen(key: PageKey, scope: Scope) {
  const id = `${scope.workspaceId}:${key}`;
  if (warmed.has(id)) return;
  warmed.add(id);
  screenLoaders[key]().then((m) => m.prefetch?.(scope)).catch(() => warmed.delete(id));
}

/** Props for a nav link: prefetch after an 80 ms hover, or at once on keyboard focus / touch start. */
export function prefetchProps(key: PageKey, scope: Scope) {
  let t: number | undefined;
  return {
    onPointerEnter: () => { t = window.setTimeout(() => prefetchScreen(key, scope), 80); },
    onPointerLeave: () => window.clearTimeout(t),
    onFocus: () => prefetchScreen(key, scope),
    onTouchStart: () => prefetchScreen(key, scope),
  };
}
