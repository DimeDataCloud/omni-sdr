// Who is signed in, which workspace is open, and what their role lets them do here.
// can() is the backend's own matrix (packages/db/src/permissions.mjs); the UI hides what it denies (DESIGN §5.3).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can as canDo } from '@db/permissions.mjs';
import { api, invalidate, isDemo, type ApiError, type Scope } from './api';
import type { Me, Role, Settings } from './api/types';
import { useQuery } from './hooks';
import { personaEmail, setPersonaEmail, reset as resetDemo } from './api/demo/store';
import { onAuthChange, signedInEmail } from './auth';

export type Action = 'billing' | 'members' | 'connections' | 'workspace_settings' | 'build' | 'approve' | 'inbox_read' | 'inbox_draft' | 'clear_hold' | 'reports_view' | 'team_view' | 'export_pii' | 'handoff' | 'handoff_work';

interface SessionValue {
  me: Me | undefined;
  loading: boolean;
  /** The demo is always signed in; the real API needs an Identity Platform session (G5). */
  signedIn: boolean;
  meError: ApiError | null;
  reloadMe: () => void;
  org: Me['orgs'][number] | undefined;
  persona: string;
  switchPersona: (email: string) => void;
  resetDemo: () => void;
}
const SessionCtx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [persona, setPersona] = useState(personaEmail);
  const [account, setAccount] = useState(signedInEmail);
  useEffect(() => onAuthChange(() => setAccount(signedInEmail())), []);
  const signedIn = isDemo || Boolean(account);
  const me = useQuery(() => api.me(), [persona, account], { enabled: signedIn });
  const value = useMemo<SessionValue>(() => ({
    me: signedIn ? me.data : undefined, loading: signedIn && me.loading, org: signedIn ? me.data?.orgs[0] : undefined, persona,
    signedIn, meError: me.error, reloadMe: me.reload,
    switchPersona: (email) => { setPersonaEmail(email); setPersona(email); invalidate(); },
    resetDemo: () => { resetDemo(); invalidate(); },
  }), [me.data, me.loading, me.error, me.reload, persona, signedIn]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
export function useSession() {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

interface WorkspaceValue {
  scope: Scope;
  name: string;
  role: Role;
  settings: Settings | undefined;
  tz: string;
  can: (a: Action) => boolean;
}
const WorkspaceCtx = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const { org } = useSession();
  const scope = useMemo(() => ({ orgId: org?.id ?? '', workspaceId }), [org?.id, workspaceId]);
  const settings = useQuery(() => api.settings(scope), [scope.orgId, scope.workspaceId], { enabled: Boolean(org) });
  const role = org?.role ?? 'client_viewer';
  const value = useMemo<WorkspaceValue>(() => ({
    scope, role, settings: settings.data,
    name: org?.workspaces.find((w) => w.id === workspaceId)?.name ?? '',
    tz: settings.data?.workspace.timezone ?? 'America/Chicago',
    can: (a) => canDo({ role, clientApprovalsEnabled: settings.data?.workspace.clientApprovalsEnabled ?? false }, a),
  }), [scope, role, settings.data, org, workspaceId]);
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}
export function useWorkspace() {
  const v = useContext(WorkspaceCtx);
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider');
  return v;
}
