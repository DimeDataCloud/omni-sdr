import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { Toaster } from 'sonner';
import { SessionProvider, useSession, WorkspaceProvider, useWorkspace } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { AppShell } from '@/components/shell/AppShell';
import { NAV, homeFor, type PageKey } from '@/components/shell/nav';
import { NoAccess, Page, SkeletonList, TipProvider } from '@/components/ui';

const screens: Record<PageKey, React.LazyExoticComponent<ComponentType>> = {
  home: lazy(() => import('@/features/home/HomePage')),
  approvals: lazy(() => import('@/features/approvals/ApprovalsPage')),
  inbox: lazy(() => import('@/features/inbox/InboxPage')),
  meetings: lazy(() => import('@/features/meetings/MeetingsPage')),
  leads: lazy(() => import('@/features/leads/LeadsPage')),
  analytics: lazy(() => import('@/features/analytics/AnalyticsPage')),
  studio: lazy(() => import('@/features/studio/StudioPage')),
  connections: lazy(() => import('@/features/connections/ConnectionsPage')),
  settings: lazy(() => import('@/features/settings/SettingsPage')),
};
const WorkspacesPage = lazy(() => import('@/features/workspaces/WorkspacesPage'));

const Loading = () => <Page><SkeletonList rows={5} className="mt-10" /></Page>;

function Screen() {
  const { page } = useParams();
  const { role, can, settings } = useWorkspace();
  const item = NAV.find((n) => n.key === page);
  if (!item) return <Navigate to={`../${homeFor(role)}`} replace />;
  if (!settings) return <Loading />;
  if (!item.visible(role, can)) return <Page><NoAccess what={item.label} /></Page>;
  const S = screens[item.key];
  return <Suspense fallback={<Loading />}><S /></Suspense>;
}

function WorkspaceRoute() {
  const { ws } = useParams();
  const { org, loading } = useSession();
  if (loading || !org) return <Loading />;
  if (!org.workspaces.some((w) => w.id === ws)) return <Navigate to="/" replace />;
  return <WorkspaceProvider workspaceId={ws!}><AppShell /></WorkspaceProvider>;
}

function Root() {
  const { org, loading } = useSession();
  if (loading || !org) return <Loading />;
  const first = org.workspaces[0];
  if (!first) return <Navigate to="/workspaces" replace />;
  return <Navigate to={`/w/${first.id}/${homeFor(org.role)}${window.location.search}`} replace />;
}

export function App() {
  const theme = useTheme();
  return (
    <SessionProvider>
      <TipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Root />} />
            <Route path="/workspaces" element={<Suspense fallback={<Loading />}><WorkspacesPage /></Suspense>} />
            <Route path="/w/:ws" element={<WorkspaceRoute />}>
              <Route index element={<Navigate to="home" replace />} />
              <Route path=":page" element={<Screen />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="bottom-center" theme={theme} offset={{ bottom: 88 }} mobileOffset={{ bottom: 88 }}
          toastOptions={{ classNames: { toast: '!rounded-xl !border-line !shadow-lg !font-sans' } }} />
      </TipProvider>
    </SessionProvider>
  );
}
