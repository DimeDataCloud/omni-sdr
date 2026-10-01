// Library: every image and video in the workspace, uploaded or generated, with where each one stands in review.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { Images, Search, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import type { AssetKind, AssetStatus, StudioCaps } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { keepVideo, readImage, readVideoMeta } from '@/lib/media';
import { Button, EmptyState, ErrorState, Input, Segmented, Select, SkeletonList, cx } from '@/components/ui';
import { AssetCard, STATUS } from './parts';
import { assetsKey } from './StudioPage';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_IMAGE_MB = 20, MAX_VIDEO_MB = 200;

type KindFilter = 'all' | AssetKind;
type StatusFilter = 'all' | AssetStatus;

export function LibraryView({ onOpen, upload, onUploadDone }: { onOpen: (id: string) => void; caps: StudioCaps; upload: boolean; onUploadDone: () => void }) {
  const { scope, can, tz } = useWorkspace();
  const ws = scope.workspaceId;
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>(can('build') ? 'all' : 'review');
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const all = useQuery(() => api.assets(scope), [ws], { key: assetsKey(ws) });
  const projects = useQuery(() => api.projects(scope), [ws]);
  const t = q.trim().toLowerCase();
  const items = (all.data ?? []).filter((a) => (kind === 'all' || a.kind === kind) && (status === 'all' || a.status === status) && (!projectId || a.projectId === projectId)
    && (!t || `${a.name} ${a.generation?.prompt ?? ''}`.toLowerCase().includes(t)));
  const counts = (s: StatusFilter) => (all.data ?? []).filter((a) => s === 'all' || a.status === s).length;

  return (
    <div className="space-y-4">
      {can('build') && <Uploader focus={upload} onFocused={onUploadDone} />}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented id="lib-status" label="Review state" value={status} onChange={setStatus}
          options={(['all', 'draft', 'review', 'changes_requested', 'approved'] as StatusFilter[]).map((s) => ({ value: s, label: s === 'all' ? 'All' : STATUS[s].label, count: counts(s) }))} />
        <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:w-full">
          <label className="relative max-sm:flex-1"><span className="sr-only">Search media</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names and prompts" className="w-56 pl-8 max-sm:w-full" /></label>
          <Segmented id="lib-kind" size="sm" label="Kind" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'image', label: 'Images' }, { value: 'video', label: 'Videos' }]} />
          <label className="sr-only" htmlFor="lib-project">Project</label>
          <Select id="lib-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-auto max-w-52">
            <option value="">All projects</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
      </div>
      {all.error ? <ErrorState error={all.error} onRetry={all.reload} /> : all.loading ? <SkeletonList rows={4} /> : !items.length ? (
        <EmptyState icon={<Images className="size-5" aria-hidden />} title={all.data?.length ? 'Nothing matches these filters' : 'No media yet'}
          body={all.data?.length ? 'Try another state, kind or project.' : 'Upload images or video, or make some in Create.'} />
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" aria-label="Media">
          {items.map((a) => <li key={a.id}><AssetCard asset={a} tz={tz} onOpen={() => onOpen(a.id)} /></li>)}
        </ul>
      )}
    </div>
  );
}

/** Pick or drop images and video. Images are scaled and kept on the device in the demo; video stays in this tab. */
export function Uploader({ focus = false, onFocused, projectId = null }: { focus?: boolean; onFocused?: () => void; projectId?: string | null }) {
  const { scope } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  // Browsers only open a file picker from a direct click, so a palette or shortcut "Upload" brings the zone into view instead.
  useEffect(() => { if (focus) { zone.current?.scrollIntoView({ block: 'center' }); btn.current?.focus(); onFocused?.(); } }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const take = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    setBusy((n) => n + list.length);
    let ok = 0;
    for (const f of list) {
      try {
        const name = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Upload';
        if (IMAGE_TYPES.includes(f.type)) {
          if (f.size > MAX_IMAGE_MB * 1e6) throw new Error(`${f.name} is over ${MAX_IMAGE_MB} MB.`);
          const { src, aspect } = await readImage(f);
          await api.uploadAsset(scope, { name, kind: 'image', src, aspect, projectId });
        } else if (VIDEO_TYPES.includes(f.type)) {
          if (f.size > MAX_VIDEO_MB * 1e6) throw new Error(`${f.name} is over ${MAX_VIDEO_MB} MB.`);
          const meta = await readVideoMeta(f);
          await api.uploadAsset(scope, { name, kind: 'video', src: keepVideo(f), aspect: meta.aspect, durationS: meta.durationS, projectId });
        } else throw new Error(`${f.name}: upload PNG, JPEG, WebP, GIF, MP4, WebM or MOV.`);
        ok++;
      } catch (e) { toast.error((e as Error).message); } finally { setBusy((n) => n - 1); }
    }
    if (ok) toast.success(`${ok === 1 ? '1 file' : `${ok} files`} added to the Library as drafts.`);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files); };
  return (
    <div ref={zone} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
      className={cx('flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4 transition-colors', over ? 'border-ink bg-accent-soft' : 'border-control bg-surface')}>
      <Upload className="size-5 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">Drop images or video here</p>
        <p className="text-xs text-muted">PNG, JPEG, WebP, GIF up to {MAX_IMAGE_MB} MB · MP4, WebM, MOV up to {MAX_VIDEO_MB} MB. Demo: uploads stay on this device.</p>
      </div>
      <input ref={input} id="studio-upload" type="file" multiple accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(',')} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { void take(e.target.files ?? []); e.target.value = ''; }} />
      <Button ref={btn} type="button" icon={<Upload className="size-4" aria-hidden />} loading={busy > 0} onClick={() => input.current?.click()}>
        {busy > 0 ? `Adding ${busy}…` : 'Choose files'}</Button>
    </div>
  );
}
