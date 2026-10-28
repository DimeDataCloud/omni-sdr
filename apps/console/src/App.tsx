import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { Toaster } from 'sonner';
import { SessionProvider, useSession, WorkspaceProvider, useWorkspace } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { AppShell } from '@/components/shell/AppShell';
import { NAV, homeFor, type PageKey } from '@/components/shell/nav';
import { Button, ErrorState, NoAccess, Page, SkeletonList, TipProvider } from '@/components/ui';
import { isDemo, invalidate } from '@/lib/api';
import { FINISH_PATH, safeNext, signOut } from '@/lib/auth';
import { FinishPage, InvitePage, Onboarding, SignInPage } from '@/features/signin/SignIn';
import { CONNECT_PATH, ConnectGooglePage } from '@/features/connections/ConnectGoogle';

import { screenLoaders } from '@/components/shell/prefetch';

const screens = Object.fromEntries(Object.entries(screenLoaders).map(([k, load]) => [k, lazy(load)])) as Record<PageKey, React.LazyExoticComponent<ComponentType>>;
const WorkspacesPage = lazy(() => import('@/features/workspaces/WorkspacesPage'));

const Loading = () => <Page><SkeletonList rows={5} className="mt-10" /></Page>;

function Screen() {
  const { page } = useParams();
  const { role, can, settings } = useWorkspace();
  const item = NAV.find((n) => n.key === page);
  if (!item) return <Navigate to={`../${homeFor(role)}`} replace />;
  if (!settings) return <Loading />;
  if (!item.visible(role, can)) return <Page><NoAccess what={item.label} client={role === 'client_viewer'} /></Page>;
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

// G5: with the real API, nothing below renders until the person is signed in and belongs to an org.
// The demo is always signed in, so it never reaches these screens.
function AuthGate({ children }: { children: React.ReactNode }) {
  const { signedIn, me, loading, meError, reloadMe } = useSession();
  if (isDemo) return children;
  const { pathname, search } = window.location;
  if (pathname === FINISH_PATH) return <FinishPage onDone={(next) => window.location.replace(safeNext(next))} />;
  // Before the sign-in check: Google's code must never ride along in a sign-in link's `next`.
  if (pathname === CONNECT_PATH) return <ConnectGooglePage signedIn={signedIn} />;
  if (!signedIn) return <SignInPage next={pathname + search} />;
  const invite = /^\/invite\/([A-Za-z0-9_-]{16,200})$/.exec(pathname);
  if (invite) return <InvitePage token={invite[1]} onAccepted={() => { invalidate(); window.location.replace('/'); }} />;
  if (meError) {
    return (
      <Page className="max-w-md pt-16">
        <ErrorState error={meError} onRetry={reloadMe} />
        <Button variant="ghost" className="mt-4" onClick={signOut}>Sign out</Button>
      </Page>
    );
  }
  if (loading || !me) return <Loading />;
  if (!me.orgs.length) return <Onboarding email={me.user.email} onCreated={() => { invalidate(); window.location.replace('/'); }} />;
  return children;
}

export function App() {
  const theme = useTheme();
  return (
    <SessionProvider>
      <TipProvider>
        <AuthGate>
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
        </AuthGate>
        <Toaster position="bottom-center" theme={theme} offset={{ bottom: 88 }} mobileOffset={{ bottom: 88 }}
          toastOptions={{ classNames: { toast: '!rounded-xl !border-line !shadow-lg !font-sans' } }} />
      </TipProvider>
    </SessionProvider>
  );
}
