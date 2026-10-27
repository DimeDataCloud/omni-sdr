// Shared bits for the client record screens (6a-shaped data).
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/client';
import type { ClientStatus, Id } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export const STATUS: Record<ClientStatus, { label: string; tone: Tone }> = {
  lead: { label: 'Lead', tone: 'neutral' }, closed: { label: 'Closed', tone: 'info' }, onboarding: { label: 'Onboarding', tone: 'warning' }, building: { label: 'Building', tone: 'warning' },
  ready: { label: 'Ready', tone: 'info' }, live: { label: 'Live', tone: 'success' }, paused: { label: 'Paused', tone: 'neutral' }, ended: { label: 'Ended', tone: 'neutral' },
};
export const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;

/** The message to show for an API error. A refused transition lists what is still missing. */
export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const unmet = e.details?.unmet;
    if (Array.isArray(unmet) && unmet.length) return `${e.message}. Still needed: ${unmet.join('; ')}.`;
    return e.message;
  }
  return (e as Error).message;
}

/** Names for user and rep ids. Demo only: real data resolves ids through a users endpoint. */
export function usePeople(orgId: string) {
  const q = useQuery(() => api.demoPeople(orgId), [orgId], { key: `client-people:${orgId}` });
  return (id: Id | null | undefined) => (id ? q.data?.[id] ?? 'Someone' : 'The system');
}
