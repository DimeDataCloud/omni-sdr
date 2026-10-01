// "Ask about this" (UI-REVISION-PLAN Phase 3). An object's screen hands the object to Home's composer as an
// attachment; the person still writes (or takes the suggested) question and presses Ask, so nothing spends a credit
// on its own. One hook per object: a button, Q, and a "This page" entry in Ctrl K, from one registration.
import { useNavigate } from 'react-router';
import { Sparkles } from 'lucide-react';
import type { About, AboutKind, Agent, AskMode } from './api/types';
import { useWorkspace } from './session';
import { useCommands } from './commands';
import { useHotkeys } from './hooks';
import { Button } from '@/components/ui';

/** What another screen (or the palette) hands Home in history state. `submit` is an ask the person already made. */
export interface AskHandoff { ask?: string; about?: About; mode?: AskMode; submit?: { text: string; tier: string; about: About | null; mode: AskMode } }

// Which agent answers about each kind of object, by station. Falls back to the Chief of Staff, then to any agent.
const STATION: Record<AboutKind, string> = { contact: 'sales_outbound', draft: 'sales_outbound', reply: 'inbox_triage', meeting: 'ea_dispatch', analytics: 'chief_of_staff' };
export function agentFor(agents: Agent[], kind?: AboutKind | null): Agent | undefined {
  const live = agents.filter((a) => !a.archivedAt);
  return (kind && live.find((a) => a.station === STATION[kind])) || live.find((a) => a.station === 'chief_of_staff') || live[0];
}

/** Where the attached object lives, so its chip can open it. */
export function aboutHref(base: string, a: About): string {
  switch (a.kind) {
    case 'contact': return `${base}/leads?c=${a.id}`;
    case 'draft': return `${base}/approvals?d=${a.id}`;
    case 'reply': return `${base}/inbox?s=all&r=${a.id}`;
    case 'meeting': return `${base}/meetings`;
    default: return `${base}/analytics`;
  }
}
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Offer "Ask about <object>". `keys` registers Q and the palette entry: one object per screen may have them (the
 * open draft, the open reply); list rows pass keys: false and get only the button. Null when the role can't ask.
 */
export function useAskAbout(about: About | null, keys = true) {
  const { scope, can } = useWorkspace();
  const nav = useNavigate();
  const on = Boolean(about) && can('build');
  const ask = () => { if (about) nav(`/w/${scope.workspaceId}/home`, { state: { about } satisfies AskHandoff, viewTransition: true }); };
  useCommands(on && keys ? [{ id: 'ask', label: `Ask an agent about ${about!.label}`, keys: 'Q', icon: Sparkles, run: ask }] : []);
  useHotkeys({ q: ask }, [about?.kind, about?.id], on && keys);
  return on ? ask : null;
}

export function AskButton({ about, keys = true, size = 'sm', label = 'Ask', className }: { about: About | null; keys?: boolean; size?: 'sm' | 'md'; label?: string; className?: string }) {
  const ask = useAskAbout(about, keys);
  if (!ask || !about) return null;
  return (
    <Button size={size} variant="secondary" kbd={keys ? 'Q' : undefined} icon={<Sparkles className="size-4" aria-hidden />} onClick={ask}
      aria-label={`${label} an agent about ${about.label}`} className={className}>{label}</Button>
  );
}
