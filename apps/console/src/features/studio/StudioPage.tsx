// Studio: the image and video marketing suite (DECISIONS 2026-10-01, STUDIO-PLAN.md). Create, Library, Projects and the
// editor. Generation runs server-side behind per-org flags; the demo draws labeled samples on the device instead.
// Agents, routines and Auto-adjust moved to the Agents page; their old Studio links redirect there.
import { lazy, Suspense } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { FolderPlus, Upload, Wand2 } from 'lucide-react';
import { api, type Scope } from '@/lib/api';
import { useHotkeys, useQuery, prefetchQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { useCommands } from '@/lib/commands';
import { Badge, Page, PageHeader, Segmented, SkeletonList } from '@/components/ui';
import { CreateView } from './Create';
import { LibraryView } from './Library';
import { ProjectsView } from './Projects';

// The editor is the heaviest part (export, versions, AI tools); it loads when an asset is opened.
const Editor = lazy(() => import('./Editor'));

export type View = 'create' | 'library' | 'projects';
const VIEWS: { value: View; label: string }[] = [{ value: 'create', label: 'Create' }, { value: 'library', label: 'Library' }, { value: 'projects', label: 'Projects' }];
const AGENT_TABS = ['agents', 'routines', 'learning'];

export const capsKey = (ws: string) => `studio-caps:${ws}`;
export const assetsKey = (ws: string) => `studio-assets:${ws}:all`;
export function prefetch(scope: Scope) {
  prefetchQuery(capsKey(scope.workspaceId), () => api.studioCaps(scope));
  prefetchQuery(assetsKey(scope.workspaceId), () => api.assets(scope));
}

export default function StudioPage() {
  const [params, setParams] = useSearchParams();
  const { scope, can } = useWorkspace();
  const caps = useQuery(() => api.studioCaps(scope), [scope.workspaceId], { key: capsKey(scope.workspaceId) });
  // Links from before 2026-10-01 (Studio's agent tabs, Home's "New agent") land on Agents.
  const old = params.get('tab');
  const toAgents = (old && AGENT_TABS.includes(old)) || params.get('new') === 'agent';
  // A reviewer can't make media, so Studio opens on the Library (its review queue) for them.
  const home: View = can('build') ? 'create' : 'library';
  const view = (VIEWS.some((v) => v.value === params.get('view')) ? params.get('view') : home) as View;
  const set = (patch: Record<string, string | null>) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v === null) n.delete(k); else n.set(k, v); } return n; });
  const go = (v: View, extra: Record<string, string | null> = {}) => set({ view: v === home ? null : v, project: null, ...extra });
  const openAsset = (id: string) => set({ asset: id });
  const assetId = params.get('asset');
  const build = can('build');
  useCommands([
    ...(build ? [{ id: 'studio-create', label: 'Create media', icon: Wand2, keys: 'c', run: () => go('create') }] : []),
    ...(build ? [{ id: 'studio-upload', label: 'Upload images or video', icon: Upload, keys: 'u', run: () => go('library', { upload: '1' }) }] : []),
    ...(build ? [{ id: 'studio-project', label: 'New project', icon: FolderPlus, run: () => go('projects', { new: 'project' }) }] : []),
  ]);
  useHotkeys(build ? { c: () => go('create'), u: () => go('library', { upload: '1' }) } : {}, [build, params]);
  if (toAgents) {
    const q = new URLSearchParams(); if (old && old !== 'agents') q.set('tab', old); if (params.get('new') === 'agent') q.set('new', 'agent');
    return <Navigate to={`../agents${q.size ? `?${q}` : ''}`} replace />;
  }
  return (
    <Page wide>
      <PageHeader title="Studio" subtitle="Make product shots, social posts and short video. Everything you make is a draft until someone approves it."
        actions={caps.data && <span className="flex items-center gap-2 text-sm text-muted">
          {caps.data.sample && <Badge tone="info">Demo: samples drawn on this device</Badge>}
          <span className="tabular" aria-label={`${caps.data.mediaCredits} media credits left`}>{caps.data.mediaCredits.toLocaleString('en-US')} media credits</span></span>}>
        <div className="w-full"><Segmented id="studio-view" label="Studio view" value={view} onChange={(v) => go(v)} options={VIEWS} /></div>
      </PageHeader>
      {!caps.data ? <SkeletonList rows={4} /> : view === 'create' ? <CreateView caps={caps.data} onOpen={openAsset} projectId={params.get('project')} />
        : view === 'library' ? <LibraryView onOpen={openAsset} caps={caps.data} upload={params.get('upload') === '1'} onUploadDone={() => set({ upload: null })} />
          : <ProjectsView projectId={params.get('project')} creating={params.get('new') === 'project'} onCreated={(id) => set({ new: null, project: id || null })}
              onProject={(id) => set({ project: id, new: null })} onOpen={openAsset} onCreateIn={(id) => go('create', { project: id })} />}
      {assetId && caps.data && <Suspense fallback={null}><Editor id={assetId} caps={caps.data} onClose={() => set({ asset: null })} /></Suspense>}
    </Page>
  );
}
