// The editor: one asset, full screen. Edits are non-destructive and saving makes a new version (the first one is
// never changed). Crop to a channel's shape, rotate, adjust, add a headline, trim and caption video: these always work
// and run on the device. AI tools (background, upscale, expand) are generation, so they show only with the flag on.
// Review happens here too: submit (build), then approve or send back with a note (approve).
import { useEffect, useMemo, useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { Archive, Check, Download, FlipHorizontal2, History, Info, RotateCcw, RotateCw, Save, Scissors, Send, SlidersHorizontal, Sparkles, Type, Undo2, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Asset, Aspect, Edits, Scene, StudioCaps } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { useCommands } from '@/lib/commands';
import { deferAction } from '@/lib/undo';
import { relTime } from '@/lib/format';
import { ASPECTS, CREDIT_COST, NO_EDITS, SCENES, download, exportPng, fileName, fmtDuration, motionOf, videoUrl } from '@/lib/media';
import { Badge, Banner, Button, ErrorState, Field, IconButton, Input, Segmented, Select, SkeletonList, Textarea, cx } from '@/components/ui';
import { AssetFrame, SampleBadge, StatusBadge, srcOf } from './parts';

type Tab = 'adjust' | 'text' | 'video' | 'ai' | 'versions' | 'details';
/** Unsaved edits survive closing the editor for this tab, so nothing typed is lost to a stray Esc. */
const drafts = new Map<string, Edits>();
const same = (a: Edits, b: Edits) => JSON.stringify(a) === JSON.stringify(b);

export default function Editor({ id, caps, onClose }: { id: string; caps: StudioCaps; onClose: () => void }) {
  const { scope, can } = useWorkspace();
  const q = useQuery(() => api.asset(scope, id), [scope.workspaceId, id]);
  const a = q.data;
  const [tab, setTab] = useState<Tab | null>(null); // kept here so saving (a new version remounts the body) stays on the same panel
  return (
    <RDialog.Root open onOpenChange={(v) => !v && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-inverse/30" />
        <RDialog.Content aria-describedby={undefined} className="fixed inset-0 z-50 flex flex-col bg-bg outline-none">
          {q.error ? <div className="p-6"><RDialog.Title className="mb-3 text-lg font-semibold">Editor</RDialog.Title><ErrorState error={q.error} onRetry={q.reload} />
            <Button className="mt-3" onClick={onClose}>Back to Studio</Button></div>
            : !a ? <div className="p-6"><RDialog.Title className="sr-only">Loading</RDialog.Title><SkeletonList rows={4} /></div>
              : <Body key={`${a.id}:${a.current}`} a={a} caps={caps} onClose={onClose} build={can('build')} approve={can('approve')} tab={tab} setTab={setTab} />}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function Body({ a, caps, onClose, build, approve, tab: tabIn, setTab }: { a: Asset; caps: StudioCaps; onClose: () => void; build: boolean; approve: boolean; tab: Tab | null; setTab: (t: Tab) => void }) {
  const { scope, tz } = useWorkspace();
  const cur = a.versions[a.current];
  const [edits, setEditsRaw] = useState<Edits>(() => drafts.get(a.id) ?? structuredClone(cur.edits));
  const setEdits = (e: Edits) => { setEditsRaw(e); if (same(e, cur.edits)) drafts.delete(a.id); else drafts.set(a.id, e); };
  const patch = (p: Partial<Edits>) => setEdits({ ...edits, ...p });
  const dirty = !same(edits, cur.edits);
  const [name, setName] = useState(a.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const projects = useQuery(() => api.projects(scope), [scope.workspaceId]);
  const generated = a.source === 'generated';
  const aiOk = build && caps.imageGeneration && a.kind === 'image';
  const tabs = useMemo(() => [
    ...(build ? [{ value: 'adjust' as Tab, label: <span className="inline-flex items-center gap-1.5"><SlidersHorizontal className="size-3.5" aria-hidden />Adjust</span> }] : []),
    ...(build ? [{ value: 'text' as Tab, label: <span className="inline-flex items-center gap-1.5"><Type className="size-3.5" aria-hidden />Text</span> }] : []),
    ...(build && a.kind === 'video' ? [{ value: 'video' as Tab, label: <span className="inline-flex items-center gap-1.5"><Scissors className="size-3.5" aria-hidden />Trim</span> }] : []),
    ...(aiOk ? [{ value: 'ai' as Tab, label: <span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" aria-hidden />AI tools</span> }] : []),
    { value: 'versions' as Tab, label: <span className="inline-flex items-center gap-1.5"><History className="size-3.5" aria-hidden />Versions</span> },
    { value: 'details' as Tab, label: <span className="inline-flex items-center gap-1.5"><Info className="size-3.5" aria-hidden />Details</span> },
  ], [build, a.kind, aiOk]);
  const tab: Tab = tabIn && tabs.some((t) => t.value === tabIn) ? tabIn : build ? 'adjust' : 'details';

  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try { await fn(); if (ok) toast.success(ok); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const save = () => dirty && run('save', async () => { await api.editAsset(scope, a.id, { edits, note: describe(cur.edits, edits) }); drafts.delete(a.id); },
    a.status === 'approved' || a.status === 'review' ? 'Saved as a new version. It goes back to draft for a fresh review.' : 'Saved as a new version.');
  const rename = () => { const n = name.trim(); if (n && n !== a.name) void run('rename', () => api.patchAsset(scope, a.id, { name: n })); else setName(a.name); };
  const exportIt = () => run('export', async () => {
    if (a.kind === 'video' && cur.src?.startsWith('video:')) { const u = videoUrl(cur.src); if (!u) throw new Error('Upload the video again to download it.'); download(u, fileName(a.name, 'mp4')); return; }
    const src = srcOf(a, cur);
    if (!src) throw new Error('Nothing to download yet.');
    download(await exportPng(src, a.aspect, edits), fileName(a.name, 'png'));
    if (a.kind === 'video') toast('Demo samples are a still with a camera move, so this downloads the frame. A real render downloads as MP4.');
  });
  const archive = () => {
    deferAction({ ids: [a.id], kind: 'archive', workspaceId: scope.workspaceId, message: `${a.name} archived.`, commit: () => api.archiveAsset(scope, a.id) });
    onClose();
  };
  const submit = () => run('submit', () => api.setAssetStatus(scope, a.id, 'review'), 'Sent for review.');
  const approveIt = () => run('approve', () => api.setAssetStatus(scope, a.id, 'approved'), 'Approved.');
  const sendBack = () => run('back', async () => { await api.setAssetStatus(scope, a.id, 'changes_requested', note); setAsking(false); setNote(''); }, 'Sent back with your note.');

  useCommands([
    ...(build && dirty ? [{ id: 'ed-save', label: 'Save as new version', keys: 'Ctrl S', icon: Save, run: () => void save() }] : []),
    { id: 'ed-export', label: 'Download', icon: Download, run: () => void exportIt() },
    ...(build && (a.status === 'draft' || a.status === 'changes_requested') && !dirty ? [{ id: 'ed-submit', label: 'Send for review', icon: Send, run: () => void submit() }] : []),
    ...(approve && a.status === 'review' ? [{ id: 'ed-approve', label: 'Approve', icon: Check, run: () => void approveIt() }] : []),
  ]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (build) void save(); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 md:px-4">
        <RDialog.Close asChild><IconButton label="Close editor"><X className="size-4" aria-hidden /></IconButton></RDialog.Close>
        <RDialog.Title className="sr-only">Edit {a.name}</RDialog.Title>
        {build ? (
          <label className="min-w-0 flex-1 basis-40"><span className="sr-only">Name</span>
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="h-9 border-transparent bg-transparent text-base font-semibold hover:border-line focus:border-control" /></label>
        ) : <p className="min-w-0 flex-1 truncate text-base font-semibold">{a.name}</p>}
        <span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={a.status} />{a.generation?.sample && <SampleBadge />}
          <Badge>v{cur.n}{a.versions.length > 1 ? ` of ${a.versions.length}` : ''}</Badge></span>
        <span className="ml-auto flex items-center gap-2">
          <Button variant="ghost" icon={<Download className="size-4" aria-hidden />} loading={busy === 'export'} onClick={() => void exportIt()} disabled={a.rendering}>Download</Button>
          {build && <Button variant="primary" icon={<Save className="size-4" aria-hidden />} loading={busy === 'save'} disabled={!dirty || a.rendering} onClick={() => void save()} kbd="Ctrl S">Save version</Button>}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden">
        <section aria-label="Preview" className="flex min-h-0 flex-col items-center justify-center gap-3 bg-sunken p-4 lg:overflow-auto">
          {a.status === 'changes_requested' && a.reviewNote && <Banner tone="warning" title="Changes requested">{a.reviewNote}</Banner>}
          <div className="grid w-full flex-1 place-items-center">
            <AssetFrame asset={a} edits={edits} controls fit="cover" className={cx('rounded-lg shadow-lg', wide(edits.crop ?? a.aspect) ? 'w-full max-w-3xl' : 'h-[min(68dvh,820px)] max-w-full')} />
          </div>
          {dirty && <p className="text-sm text-muted" role="status">Unsaved edits. Save makes v{a.versions.length + 1}; v{cur.n} stays as it is.</p>}
        </section>

        <aside aria-label="Edit panel" className="flex min-h-0 flex-col border-line bg-surface lg:border-l">
          <div className="border-b border-line p-3"><Segmented id="ed-tab" size="sm" label="Editor panel" value={tab} onChange={setTab} options={tabs} /></div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {tab === 'adjust' && build && <Adjust a={a} edits={edits} patch={patch} reset={() => setEdits(structuredClone({ ...NO_EDITS, text: edits.text, trim: edits.trim, captions: edits.captions }))} />}
            {tab === 'text' && build && <TextPanel edits={edits} patch={patch} />}
            {tab === 'video' && build && a.kind === 'video' && <Trim a={a} edits={edits} patch={patch} />}
            {tab === 'ai' && aiOk && (generated && cur.render
              ? <AiTools a={a} busy={busy} run={run} />
              : <p className="text-sm text-muted">In the demo, AI tools work on generated images. With the real API they work on your uploads too.</p>)}
            {tab === 'versions' && <Versions a={a} tz={tz} build={build} busy={busy} onRestore={(n) => void run(`restore-${n}`, () => api.restoreVersion(scope, a.id, n), `Restored v${n} as a new version.`)} />}
            {tab === 'details' && <Details a={a} tz={tz} />}
          </div>
          <div className="space-y-2 border-t border-line p-3">
            {asking ? (
              <div className="space-y-2">
                <Field label="What should change?">{(p) => <Textarea id={p.id} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="Keep the product name readable." />}</Field>
                <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
                  <Button variant="primary" disabled={!note.trim()} loading={busy === 'back'} onClick={() => void sendBack()}>Send back</Button></div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {build && (a.status === 'draft' || a.status === 'changes_requested') && (
                  <Button variant="primary" icon={<Send className="size-4" aria-hidden />} loading={busy === 'submit'} disabled={dirty || a.rendering} title={dirty ? 'Save your edits first' : undefined} onClick={() => void submit()}>Send for review</Button>)}
                {approve && a.status === 'review' && <>
                  <Button variant="primary" icon={<Check className="size-4" aria-hidden />} loading={busy === 'approve'} disabled={dirty} onClick={() => void approveIt()}>Approve</Button>
                  <Button icon={<Undo2 className="size-4" aria-hidden />} onClick={() => setAsking(true)}>Request changes</Button></>}
                {a.status === 'review' && !approve && <p className="text-sm text-muted">Waiting for review.</p>}
                {a.status === 'approved' && <p className="text-sm text-muted">Approved. Saving an edit makes a new draft for review.</p>}
                {build && <Button variant="ghost" className="ml-auto" icon={<Archive className="size-4" aria-hidden />} onClick={archive}>Archive</Button>}
              </div>
            )}
            {build && (
              <div className="flex items-center gap-2"><label htmlFor="ed-project" className="text-sm text-muted">Project</label>
                <Select id="ed-project" value={a.projectId ?? ''} onChange={(e) => void run('move', () => api.patchAsset(scope, a.id, { projectId: e.target.value || null }), 'Moved.')} className="flex-1">
                  <option value="">No project</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select></div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

/** Wide shapes size by width; square and tall ones by height, so they never run past the screen. */
const wide = (x: Aspect) => { const d = ASPECTS.find((v) => v.value === x)!; return d.w > d.h; };

function describe(from: Edits, to: Edits) {
  const parts: string[] = [];
  if (from.crop !== to.crop) parts.push(to.crop ? `Cropped to ${to.crop}` : 'Uncropped');
  if (from.rotate !== to.rotate || from.flipH !== to.flipH) parts.push('Rotated');
  if (from.brightness !== to.brightness || from.contrast !== to.contrast || from.saturation !== to.saturation) parts.push('Adjusted');
  if (JSON.stringify(from.text) !== JSON.stringify(to.text)) parts.push(to.text?.value.trim() ? 'Headline' : 'Headline removed');
  if (JSON.stringify(from.trim) !== JSON.stringify(to.trim)) parts.push('Trimmed');
  if (from.captions !== to.captions) parts.push('Captions');
  return parts.join(', ') || 'Edited';
}

function Adjust({ a, edits, patch, reset }: { a: Asset; edits: Edits; patch: (p: Partial<Edits>) => void; reset: () => void }) {
  const slider = (key: 'brightness' | 'contrast' | 'saturation', label: string) => (
    <div key={key}>
      <div className="mb-1 flex items-baseline justify-between"><label htmlFor={`ed-${key}`} className="text-sm font-medium">{label}</label><output htmlFor={`ed-${key}`} className="tabular text-xs text-muted">{edits[key]}%</output></div>
      <input id={`ed-${key}`} type="range" min={50} max={150} step={1} value={edits[key]} onChange={(e) => patch({ [key]: Number(e.target.value) })} className="w-full accent-[var(--accent-ink)]" />
    </div>
  );
  return (
    <>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Crop for a channel</legend>
        <div className="grid grid-cols-2 gap-2">
          {[{ value: null as Aspect | null, label: 'Original', hint: a.aspect }, ...ASPECTS.map((x) => ({ value: x.value as Aspect | null, label: `${x.label} ${x.value}`, hint: x.hint }))].map((o) => (
            <button key={o.label} type="button" aria-pressed={edits.crop === o.value} onClick={() => patch({ crop: o.value === a.aspect ? null : o.value })}
              className={cx('press rounded-lg border px-2.5 py-2 text-left max-md:min-h-11', edits.crop === o.value ? 'border-ink bg-accent-soft' : 'border-line hover:bg-sunken')}>
              <span className="block text-sm font-medium">{o.label}</span><span className="block truncate text-xs text-muted">{o.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <p className="mb-1.5 text-sm font-medium">Rotate and flip</p>
        <div className="flex gap-2">
          <Button icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => patch({ rotate: (((edits.rotate + 270) % 360) as Edits['rotate']) })}>Left</Button>
          <Button icon={<RotateCw className="size-4" aria-hidden />} onClick={() => patch({ rotate: (((edits.rotate + 90) % 360) as Edits['rotate']) })}>Right</Button>
          <Button icon={<FlipHorizontal2 className="size-4" aria-hidden />} aria-pressed={edits.flipH} onClick={() => patch({ flipH: !edits.flipH })}>Flip</Button>
        </div>
      </div>
      <div className="space-y-3">{slider('brightness', 'Brightness')}{slider('contrast', 'Contrast')}{slider('saturation', 'Saturation')}</div>
      <Button variant="ghost" icon={<RotateCcw className="size-4" aria-hidden />} onClick={reset}>Reset adjustments</Button>
    </>
  );
}

function TextPanel({ edits, patch }: { edits: Edits; patch: (p: Partial<Edits>) => void }) {
  const t = edits.text ?? { value: '', position: 'bottom' as const, style: 'sans' as const };
  const set = (p: Partial<NonNullable<Edits['text']>>) => { const n = { ...t, ...p }; patch({ text: n.value ? n : null }); };
  return (
    <>
      <Field label="Headline" hint="Drawn onto the image when you download it.">{(p) => <Textarea id={p.id} aria-describedby={p.describedBy} rows={3} maxLength={140} value={t.value} onChange={(e) => set({ value: e.target.value })} placeholder="Whiter in 14 days" />}</Field>
      <div><p className="mb-1.5 text-sm font-medium">Position</p>
        <Segmented id="ed-pos" size="sm" label="Headline position" value={t.position} onChange={(v) => set({ position: v })} options={[{ value: 'top', label: 'Top' }, { value: 'center', label: 'Center' }, { value: 'bottom', label: 'Bottom' }]} /></div>
      <div><p className="mb-1.5 text-sm font-medium">Type</p>
        <Segmented id="ed-type" size="sm" label="Headline type" value={t.style} onChange={(v) => set({ style: v })} options={[{ value: 'sans', label: 'Bold sans' }, { value: 'serif', label: 'Serif' }]} /></div>
      {edits.text && <Button variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={() => patch({ text: null })}>Remove headline</Button>}
    </>
  );
}

function Trim({ a, edits, patch }: { a: Asset; edits: Edits; patch: (p: Partial<Edits>) => void }) {
  const len = a.durationS ?? 0;
  const tr = edits.trim ?? { inS: 0, outS: len };
  const set = (p: Partial<{ inS: number; outS: number }>) => {
    const n = { ...tr, ...p };
    const inS = Math.max(0, Math.min(n.inS, len - 0.5)), outS = Math.min(len, Math.max(n.outS, inS + 0.5));
    patch({ trim: inS === 0 && outS === len ? null : { inS: Math.round(inS * 10) / 10, outS: Math.round(outS * 10) / 10 } });
  };
  return (
    <>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-1.5 text-sm font-medium">Trim ({fmtDuration(len)} long)</legend>
        <Field label="Starts at (s)">{(p) => <Input id={p.id} type="number" min={0} max={len} step={0.1} value={tr.inS} onChange={(e) => set({ inS: Number(e.target.value) })} />}</Field>
        <Field label="Ends at (s)">{(p) => <Input id={p.id} type="number" min={0} max={len} step={0.1} value={tr.outS} onChange={(e) => set({ outS: Number(e.target.value) })} />}</Field>
      </fieldset>
      <p className="-mt-2 text-xs text-muted">Plays {fmtDuration(tr.outS - tr.inS)}. The original keeps every frame.</p>
      <Field label="Captions" hint="Shown along the bottom, for people watching with the sound off.">{(p) => <Textarea id={p.id} aria-describedby={p.describedBy} rows={2} maxLength={140} value={edits.captions ?? ''} onChange={(e) => patch({ captions: e.target.value || null })} placeholder="Meet the Brightline kit" />}</Field>
    </>
  );
}

function AiTools({ a, busy, run }: { a: Asset; busy: string | null; run: (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const { scope } = useWorkspace();
  const cur = a.versions[a.current];
  const [scene, setScene] = useState<Scene>(cur.render?.scene ?? 'studio');
  const [to, setTo] = useState<Aspect>(ASPECTS.find((x) => x.value !== a.aspect)!.value);
  const cost = <span className="tabular text-xs text-muted">≈ {CREDIT_COST.image} credits</span>;
  const op = (label: string, body: Parameters<typeof api.aiEdit>[2], ok: string) => run(label, () => api.aiEdit(scope, a.id, body), ok);
  return (
    <>
      <p className="text-sm text-muted">Each tool makes a new version. The version you’re on stays as it is.</p>
      <div className="space-y-1.5 rounded-lg border border-line p-3">
        <div className="flex items-center gap-2"><p className="text-sm font-medium">Remove background</p><span className="ml-auto">{cost}</span></div>
        <p className="text-xs text-muted">Keeps the product, makes the rest transparent.</p>
        <Button size="sm" disabled={cur.render?.backdrop === 'cutout' || a.rendering} loading={busy === 'remove_bg'} onClick={() => void op('remove_bg', { op: 'remove_bg' }, 'Removing the background.')}>Remove background</Button>
      </div>
      <div className="space-y-1.5 rounded-lg border border-line p-3">
        <div className="flex items-center gap-2"><p className="text-sm font-medium">Replace background</p><span className="ml-auto">{cost}</span></div>
        <div className="flex gap-2"><label className="sr-only" htmlFor="ai-scene">New background</label>
          <Select id="ai-scene" value={scene} onChange={(e) => setScene(e.target.value as Scene)} className="flex-1">{SCENES.map((s) => <option key={s.value} value={s.value}>{s.label}: {s.hint}</option>)}</Select>
          <Button size="sm" disabled={a.rendering} loading={busy === 'replace_bg'} onClick={() => void op('replace_bg', { op: 'replace_bg', scene }, 'Replacing the background.')}>Replace</Button></div>
      </div>
      <div className="space-y-1.5 rounded-lg border border-line p-3">
        <div className="flex items-center gap-2"><p className="text-sm font-medium">Upscale 2x</p><span className="ml-auto">{cost}</span></div>
        <p className="text-xs text-muted">{cur.scale === 2 ? 'This version is already upscaled.' : 'Sharper detail for print and large screens.'}</p>
        <Button size="sm" disabled={cur.scale === 2 || a.rendering} loading={busy === 'upscale'} onClick={() => void op('upscale', { op: 'upscale' }, 'Upscaling.')}>Upscale</Button>
      </div>
      <div className="space-y-1.5 rounded-lg border border-line p-3">
        <div className="flex items-center gap-2"><p className="text-sm font-medium">Expand to a new shape</p><span className="ml-auto">{cost}</span></div>
        <p className="text-xs text-muted">Extends the scene instead of cropping it.</p>
        <div className="flex gap-2"><label className="sr-only" htmlFor="ai-expand">Expand to</label>
          <Select id="ai-expand" value={to} onChange={(e) => setTo(e.target.value as Aspect)} className="flex-1">{ASPECTS.filter((x) => x.value !== a.aspect).map((x) => <option key={x.value} value={x.value}>{x.label} {x.value}: {x.hint}</option>)}</Select>
          <Button size="sm" disabled={a.rendering} loading={busy === 'expand'} onClick={() => void op('expand', { op: 'expand', aspect: to }, `Expanding to ${to}.`)}>Expand</Button></div>
      </div>
    </>
  );
}

function Versions({ a, tz, build, busy, onRestore }: { a: Asset; tz: string; build: boolean; busy: string | null; onRestore: (n: number) => void }) {
  return (
    <ol className="space-y-2" aria-label="Versions, newest first">
      {[...a.versions].reverse().map((v) => {
        const isCur = v.n === a.versions[a.current].n;
        return (
          <li key={v.n} className={cx('flex items-center gap-3 rounded-lg border p-2', isCur ? 'border-ink/40 bg-accent-soft' : 'border-line')}>
            <AssetFrame asset={{ ...a, rendering: false }} version={v} className="w-14 shrink-0 rounded" label={`Version ${v.n}`} />
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">v{v.n} · {v.note}</p><p className="text-xs text-muted">{relTime(v.createdAt, tz)}{v.scale === 2 ? ' · 2x' : ''}</p></div>
            {isCur ? <Badge tone="info">Current</Badge> : build && <Button size="sm" loading={busy === `restore-${v.n}`} onClick={() => onRestore(v.n)}>Restore</Button>}
          </li>
        );
      })}
    </ol>
  );
}

function Details({ a, tz }: { a: Asset; tz: string }) {
  const g = a.generation;
  const row = (k: string, v: React.ReactNode) => <div className="grid grid-cols-[110px_1fr] gap-2 py-1.5"><dt className="text-sm text-muted">{k}</dt><dd className="min-w-0 text-sm">{v}</dd></div>;
  return (
    <dl className="divide-y divide-line">
      {g ? <>
        {row('Made from', <q className="italic">{g.prompt}</q>)}
        {row('Model', g.model)}
        {g.motion && row('Camera move', motionOf(g.motion).label)}
        {g.ingredients.length > 0 && row('Ingredients', <span className="flex flex-wrap gap-1">{g.ingredients.map((i) => <Badge key={i.id}>{i.label}</Badge>)}</span>)}
        {row('Credits', `${g.credits} media credits`)}
        {g.sample && row('Note', 'Demo sample, drawn on this device. No model was called.')}
      </> : row('Source', 'Uploaded')}
      {row('Shape', `${a.aspect}${a.durationS ? ` · ${fmtDuration(a.durationS)}` : ''}`)}
      {row('Created', relTime(a.createdAt, tz))}
      {row('Updated', relTime(a.updatedAt, tz))}
    </dl>
  );
}
