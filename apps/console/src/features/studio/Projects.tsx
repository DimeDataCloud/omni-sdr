// Projects: a campaign or a product launch. Each holds its ingredients (product, brand kit, style: Google Flow's idea,
// inherited by every generation made in it), its media, and a sequence: clips in order with trims and captions,
// played back as one cut (Flow's Scenebuilder).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { ArrowLeft, ChevronLeft, ChevronRight, Clapperboard, FolderOpen, FolderPlus, Layers, Pause, Play, Plus, Trash2, Wand2, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Asset, Ingredient, Project, SequenceClip } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { fmtDuration, motionOf } from '@/lib/media';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, Select, Sheet, SkeletonList } from '@/components/ui';
import { AssetCard, AssetFrame, srcOf } from './parts';
import { assetsKey } from './StudioPage';

const KIND: Record<Ingredient['kind'], string> = { product: 'Product', brand: 'Brand kit', style: 'Style', character: 'Character' };

export function ProjectsView({ projectId, creating, onCreated, onProject, onOpen, onCreateIn }: {
  projectId: string | null; creating: boolean; onCreated: (id: string) => void; onProject: (id: string | null) => void; onOpen: (id: string) => void; onCreateIn: (id: string) => void;
}) {
  const { scope, can } = useWorkspace();
  const ws = scope.workspaceId;
  const projects = useQuery(() => api.projects(scope), [ws]);
  const assets = useQuery(() => api.assets(scope), [ws], { key: assetsKey(ws) });
  const products = useQuery(() => api.products(scope), [ws]);
  const [open, setOpen] = useState(creating);
  useEffect(() => { if (creating) setOpen(true); }, [creating]);
  const p = projectId ? projects.data?.find((x) => x.id === projectId) : null;

  if (projects.error) return <ErrorState error={projects.error} onRetry={projects.reload} />;
  if (projects.loading) return <SkeletonList rows={3} />;
  if (projectId && p) return <ProjectDetail p={p} assets={assets.data ?? []} productName={products.data?.find((x) => x.id === p.productId)?.name ?? null}
    onBack={() => onProject(null)} onOpen={onOpen} onCreateIn={() => onCreateIn(p.id)} />;
  return (
    <>
      {can('build') && <div className="mb-4 flex justify-end"><Button variant="primary" icon={<FolderPlus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>New project</Button></div>}
      {!projects.data?.length ? <EmptyState icon={<FolderOpen className="size-5" aria-hidden />} title="No projects yet" body="A project keeps a campaign's product, brand kit and style together, so everything made for it matches." /> : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.data.map((x) => {
            const mine = (assets.data ?? []).filter((a) => a.projectId === x.id).slice(0, 3);
            return (
              <li key={x.id}>
                <button type="button" onClick={() => onProject(x.id)} className="card lift flex h-full w-full flex-col overflow-hidden text-left">
                  <div className="grid h-36 grid-cols-3 gap-px bg-line">
                    {[0, 1, 2].map((i) => mine[i] && srcOf(mine[i], mine[i].versions[mine[i].current])
                      ? <img key={i} src={srcOf(mine[i], mine[i].versions[mine[i].current])!} alt="" className="size-full object-cover" draggable={false} />
                      : <div key={i} className="bg-sunken" />)}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-4">
                    <p className="font-semibold">{x.name}</p>
                    <p className="text-sm text-muted">{x.assetCount === 1 ? '1 item' : `${x.assetCount} items`}{x.sequence.length ? ` · ${x.sequence.length}-clip sequence` : ''}</p>
                    <div className="mt-auto flex flex-wrap gap-1 pt-1">{x.ingredients.slice(0, 3).map((i) => <Badge key={i.id}>{KIND[i.kind]}</Badge>)}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <NewProject open={open} onClose={() => { setOpen(false); if (creating) onCreated(''); }} products={products.data ?? []} onCreated={(id) => { setOpen(false); onCreated(id); }} />
    </>
  );
}

function NewProject({ open, onClose, products, onCreated }: { open: boolean; onClose: () => void; products: { id: string; name: string }[]; onCreated: (id: string) => void }) {
  const { scope } = useWorkspace();
  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try { const p = await api.createProject(scope, { name, productId: productId || null }); toast.success(`${p.name} is ready.`); setName(''); setProductId(''); onCreated(p.id); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title="New project" description="Everything made in a project inherits its ingredients."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void create()}>Create project</Button></>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
        <Field label="Name">{(p) => <Input id={p.id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Summer whitening push" autoFocus />}</Field>
        <Field label="Product" hint="Optional. Product shots in this project start from it.">{(p) => (
          <Select id={p.id} aria-describedby={p.describedBy} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">No product</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>)}</Field>
      </form>
    </Sheet>
  );
}

function ProjectDetail({ p, assets, productName, onBack, onOpen, onCreateIn }: { p: Project; assets: Asset[]; productName: string | null; onBack: () => void; onOpen: (id: string) => void; onCreateIn: () => void }) {
  const { scope, can, tz } = useWorkspace();
  const build = can('build');
  const mine = assets.filter((a) => a.projectId === p.id);
  const save = (patch: Parameters<typeof api.patchProject>[2], ok?: string) => api.patchProject(scope, p.id, patch).then(() => ok && toast.success(ok)).catch((e) => toast.error(e.message));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={onBack}>All projects</Button>
        <h2 className="text-xl font-semibold">{p.name}</h2>
        {productName && <Badge>{productName}</Badge>}
        {build && <Button variant="primary" className="ml-auto" icon={<Wand2 className="size-4" aria-hidden />} onClick={onCreateIn}>Create in this project</Button>}
      </div>
      <Ingredients p={p} build={build} onSave={(ingredients) => save({ ingredients }, 'Ingredients saved.')} />
      <Sequence p={p} videos={assets.filter((a) => a.kind === 'video' && !a.rendering)} build={build} onSave={(sequence) => save({ sequence }, 'Sequence saved.')} />
      <section aria-labelledby="pm-h">
        <h3 id="pm-h" className="mb-3 text-base font-semibold">Media in this project</h3>
        {!mine.length ? <EmptyState title="Nothing here yet" body="Create in this project, or move an item here from the editor." /> : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{mine.map((a) => <li key={a.id}><AssetCard asset={a} tz={tz} onOpen={() => onOpen(a.id)} /></li>)}</ul>
        )}
      </section>
    </div>
  );
}

function Ingredients({ p, build, onSave }: { p: Project; build: boolean; onSave: (i: Ingredient[]) => void }) {
  const [kind, setKind] = useState<Ingredient['kind']>('style');
  const [label, setLabel] = useState('');
  const add = () => { if (!label.trim()) return; onSave([...p.ingredients, { id: crypto.randomUUID(), kind, label: label.trim(), assetId: null, productId: null }]); setLabel(''); };
  return (
    <section aria-labelledby="ing-h" className="card p-4">
      <h3 id="ing-h" className="flex items-center gap-2 text-base font-semibold"><Layers className="size-4" aria-hidden />Ingredients</h3>
      <p className="mt-0.5 text-sm text-muted">Locked into the project: every image and video made here inherits them, so the campaign stays consistent.</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {p.ingredients.map((i) => (
          <li key={i.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-1 pl-3 text-sm">
            <span className="text-xs text-muted">{KIND[i.kind]}</span><span className="truncate">{i.label}</span>
            {build && <button type="button" onClick={() => onSave(p.ingredients.filter((x) => x.id !== i.id))} aria-label={`Remove ${i.label}`}
              className="press grid size-6 place-items-center rounded-full hover:bg-sunken max-md:size-9"><X className="size-3.5" aria-hidden /></button>}
          </li>
        ))}
        {!p.ingredients.length && <li className="text-sm text-muted">None yet.</li>}
      </ul>
      {build && (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <label className="sr-only" htmlFor="ing-kind">Kind</label>
          <Select id="ing-kind" value={kind} onChange={(e) => setKind(e.target.value as Ingredient['kind'])} className="w-auto">{(Object.keys(KIND) as Ingredient['kind'][]).filter((k) => k !== 'product').map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</Select>
          <label className="sr-only" htmlFor="ing-label">Describe it</label>
          <Input id="ing-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Soft daylight, clean bathroom counter" className="min-w-0 flex-1 basis-56" />
          <Button type="submit" icon={<Plus className="size-4" aria-hidden />} disabled={!label.trim()}>Add</Button>
        </form>
      )}
    </section>
  );
}

function Sequence({ p, videos, build, onSave }: { p: Project; videos: Asset[]; build: boolean; onSave: (s: SequenceClip[]) => void }) {
  const [clips, setClips] = useState<SequenceClip[]>(p.sequence);
  useEffect(() => setClips(p.sequence), [JSON.stringify(p.sequence)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState('');
  const byId = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);
  const dirty = JSON.stringify(clips) !== JSON.stringify(p.sequence);
  const total = clips.reduce((n, c) => n + (c.outS - c.inS), 0);
  const move = (i: number, d: number) => setClips((cs) => { const n = [...cs]; const [c] = n.splice(i, 1); n.splice(i + d, 0, c); return n; });
  const set = (i: number, patch: Partial<SequenceClip>) => setClips((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => { const v = byId.get(pick); if (!v) return; setClips((cs) => [...cs, { id: crypto.randomUUID(), assetId: v.id, inS: 0, outS: v.durationS ?? 4, caption: '' }]); setPick(''); };
  const ordered = [...videos].sort((a, b) => Number(b.projectId === p.id) - Number(a.projectId === p.id));
  return (
    <section aria-labelledby="seq-h" className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="seq-h" className="flex items-center gap-2 text-base font-semibold"><Clapperboard className="size-4" aria-hidden />Sequence</h3>
        <span className="tabular text-sm text-muted">{clips.length === 1 ? '1 clip' : `${clips.length} clips`} · {fmtDuration(total)}</span>
        {build && dirty && <span className="ml-auto flex gap-2"><Button variant="ghost" onClick={() => setClips(p.sequence)}>Discard</Button><Button variant="primary" onClick={() => onSave(clips)}>Save sequence</Button></span>}
      </div>
      <p className="mt-0.5 text-sm text-muted">Put clips in order, trim them and add captions. Play runs them as one cut.</p>
      {clips.length > 0 && <Player clips={clips} byId={byId} />}
      <ol className="mt-3 flex gap-3 overflow-x-auto pb-2" aria-label="Clips in order">
        {clips.map((c, i) => {
          const v = byId.get(c.assetId);
          if (!v) return null;
          const len = v.durationS ?? 0;
          return (
            <li key={c.id} className="w-60 shrink-0 rounded-lg border border-line p-2">
              <div className="flex items-center gap-2">
                <span className="tabular grid size-6 place-items-center rounded-full bg-sunken text-xs font-semibold">{i + 1}</span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium" title={v.name}>{v.name}</p>
              </div>
              <AssetFrame asset={v} className="mt-2 w-full rounded" label={`Clip ${i + 1}: ${v.name}`} />
              <fieldset disabled={!build} className="mt-2 grid grid-cols-2 gap-2">
                <legend className="sr-only">Trim clip {i + 1}</legend>
                <Field label="In (s)">{(f) => <Input id={f.id} type="number" min={0} max={len} step={0.1} value={c.inS} onChange={(e) => set(i, { inS: Math.max(0, Math.min(Number(e.target.value), c.outS - 0.5)) })} />}</Field>
                <Field label="Out (s)">{(f) => <Input id={f.id} type="number" min={0} max={len} step={0.1} value={c.outS} onChange={(e) => set(i, { outS: Math.min(len, Math.max(Number(e.target.value), c.inS + 0.5)) })} />}</Field>
                <div className="col-span-2"><Field label="Caption">{(f) => <Input id={f.id} maxLength={140} value={c.caption} onChange={(e) => set(i, { caption: e.target.value })} />}</Field></div>
              </fieldset>
              {build && (
                <div className="mt-2 flex items-center gap-1">
                  <IconButton size="sm" label={`Move clip ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronLeft className="size-4" aria-hidden /></IconButton>
                  <IconButton size="sm" label={`Move clip ${i + 1} later`} disabled={i === clips.length - 1} onClick={() => move(i, 1)}><ChevronRight className="size-4" aria-hidden /></IconButton>
                  <IconButton size="sm" label={`Remove clip ${i + 1}`} className="ml-auto" onClick={() => setClips((cs) => cs.filter((x) => x.id !== c.id))}><Trash2 className="size-4" aria-hidden /></IconButton>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {build && (
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="seq-add">Video to add</label>
          <Select id="seq-add" value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 basis-56">
            <option value="">{videos.length ? 'Pick a video to add' : 'No videos in this workspace yet'}</option>
            {ordered.map((v) => <option key={v.id} value={v.id}>{v.name}{v.projectId === p.id ? '' : ' (other project)'}</option>)}
          </Select>
          <Button icon={<Plus className="size-4" aria-hidden />} disabled={!pick} onClick={add}>Add clip</Button>
        </div>
      )}
    </section>
  );
}

/** Plays the sequence as one cut: each clip's camera move for its trimmed length, with its caption. */
function Player({ clips, byId }: { clips: SequenceClip[]; byId: Map<string, Asset> }) {
  const [at, setAt] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const clip = at === null ? null : clips[at];
  const v = clip ? byId.get(clip.assetId) : null;
  useEffect(() => {
    if (!clip || !v) return;
    const ms = (clip.outS - clip.inS) * 1000;
    const anim = reduce ? null : frame.current?.animate(motionOf(v.generation?.motion ?? 'static').frames, { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    const t = window.setTimeout(() => setAt((i) => (i !== null && i + 1 < clips.length ? i + 1 : null)), ms);
    return () => { window.clearTimeout(t); anim?.cancel(); };
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = byId.get(clips[0].assetId);
  const show = v ?? first;
  if (!show) return null;
  const src = srcOf(show, show.versions[show.current]);
  return (
    <div className="mt-3 flex flex-wrap items-start gap-4">
      <div className="relative aspect-[9/16] w-40 overflow-hidden rounded-lg bg-sunken shadow-md" role="img" aria-label={clip ? `Playing clip ${at! + 1} of ${clips.length}` : 'Sequence preview'}>
        <div ref={frame} className="absolute inset-0">{src && <img src={src} alt="" className="size-full object-cover" draggable={false} />}</div>
        {clip?.caption && <p className="absolute inset-x-2 bottom-2 text-center"><span className="rounded bg-inverse/70 px-1.5 py-0.5 text-xs text-fg-inverse">{clip.caption}</span></p>}
      </div>
      <div className="space-y-2">
        <Button icon={at === null ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />} onClick={() => setAt(at === null ? 0 : null)}>{at === null ? 'Play sequence' : 'Stop'}</Button>
        <p className="text-sm text-muted" aria-live="polite">{at === null ? 'Stopped' : `Clip ${at + 1} of ${clips.length}`}</p>
        {reduce && <p className="max-w-56 text-xs text-muted">Reduced motion is on, so clips play as stills.</p>}
      </div>
    </div>
  );
}
