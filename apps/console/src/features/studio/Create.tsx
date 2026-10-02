// Create: describe it, pick the shape and the look, and get drafts back. Modes follow the reference suites:
// a product kit and scene presets (Higgsfield's marketing studio), camera moves picked from tiles (Higgsfield),
// project ingredients that every generation inherits and a start frame for video (Google Flow).
// A mode whose generator flag is off isn't shown; with every flag off, Create is Upload.
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Clapperboard, Image as ImageIcon, Megaphone, Package, Wand2, Check, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import type { Aspect, GenMode, Ingredient, MotionKey, Scene, StudioCaps } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { ASPECTS, MOTIONS, SCENES, costOf, renderUrl } from '@/lib/media';
import { Banner, Button, EmptyState, Field, Input, Segmented, Select, SkeletonList, Textarea, cx } from '@/components/ui';
import { AssetCard, MotionTile, useRadioKeys } from './parts';
import { Uploader } from './Library';
import { assetsKey } from './StudioPage';

const MODES: { value: GenMode; label: string; icon: typeof ImageIcon; hint: string; aspect: Aspect }[] = [
  { value: 'product', label: 'Product shot', icon: Package, hint: 'Your product in a scene', aspect: '4:5' },
  { value: 'image', label: 'Image', icon: ImageIcon, hint: 'Anything from a description', aspect: '1:1' },
  { value: 'social', label: 'Social post', icon: Megaphone, hint: 'Picture plus a headline', aspect: '9:16' },
  { value: 'video', label: 'Video', icon: Clapperboard, hint: 'A short clip with a camera move', aspect: '9:16' },
];
const EXAMPLES: Record<GenMode, (product: string | null) => string[]> = {
  product: (p) => [`${p ?? 'The product'} on a marble counter by a window, morning light`, `${p ?? 'The product'} on a pale stone podium, soft shadows`, `Top-down flat lay of ${p ?? 'the product'} with fresh props`],
  image: () => ['Soft abstract shapes in the brand color, morning light', 'A calm, bright backdrop for a promo', 'Open sky over green hills, hopeful mood'],
  social: (p) => [`Story card announcing ${p ?? 'the launch'}`, 'Feed post inviting people to book this week', `${p ?? 'The product'} centered, clean and bold`],
  video: (p) => [`Slow reveal as light sweeps across ${p ?? 'the product'}`, `${p ?? 'The product'} turns on a podium`, 'Handheld morning-routine feel'],
};
const LENGTHS = ['4', '6', '8'] as const;

export function CreateView({ caps, onOpen, projectId: initialProject }: { caps: StudioCaps; onOpen: (id: string) => void; projectId: string | null }) {
  const { scope, can, tz } = useWorkspace();
  const ws = scope.workspaceId;
  const modes = MODES.filter((m) => (m.value === 'video' ? caps.videoGeneration : caps.imageGeneration));
  const products = useQuery(() => api.products(scope), [ws]);
  const projects = useQuery(() => api.projects(scope), [ws]);
  const assets = useQuery(() => api.assets(scope), [ws], { key: assetsKey(ws) });
  const [mode, setMode] = useState<GenMode>(modes[0]?.value ?? 'product');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<Aspect>(MODES.find((m) => m.value === mode)!.aspect);
  const [count, setCount] = useState<'1' | '2' | '3' | '4'>('2');
  const [scene, setScene] = useState<Scene>('studio');
  const [motion, setMotion] = useState<MotionKey>('push_in');
  const [length, setLength] = useState<(typeof LENGTHS)[number]>('6');
  const [caption, setCaption] = useState('');
  const [startFrame, setStartFrame] = useState('');
  const [projectId, setProjectId] = useState(initialProject ?? '');
  const [productId, setProductId] = useState('');
  const [off, setOff] = useState<Set<string>>(new Set()); // ingredients switched off for this run
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<string[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const project = projects.data?.find((p) => p.id === projectId) ?? null;
  // A project with a product picks it; the person can still change it for this run.
  useEffect(() => { if (project?.productId) setProductId(project.productId); }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialProject) setProjectId(initialProject); }, [initialProject]);
  useEffect(() => { if (!modes.some((m) => m.value === mode) && modes[0]) setMode(modes[0].value); }, [modes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Product shot needs a product: start on the first one, so the first Generate works and the scene tiles show it.
  useEffect(() => { if (mode === 'product' && !productId && products.data?.[0]) setProductId(products.data[0].id); }, [products.data, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const product = products.data?.find((p) => p.id === productId) ?? null;
  const ingredients: Ingredient[] = (project?.ingredients ?? []).filter((i) => !off.has(i.id));
  const durationS = Number(length);
  const n = mode === 'video' ? 1 : Number(count);
  const cost = costOf(mode, n, durationS);
  const stills = useMemo(() => (assets.data ?? []).filter((a) => a.kind === 'image' && !a.rendering), [assets.data]);
  const needProduct = mode === 'product' && !product;
  const short = cost > caps.mediaCredits;
  const canGo = prompt.trim().length >= 3 && !needProduct && !short && !busy;

  const pickMode = (m: GenMode) => { setMode(m); setAspect(MODES.find((x) => x.value === m)!.aspect); if (m === 'product' && !productId && products.data?.[0]) setProductId(products.data[0].id); };
  const modeKeys = useRadioKeys(modes.map((m) => m.value), mode, pickMode);
  const sceneKeys = useRadioKeys(SCENES.map((s) => s.value), scene, setScene, 5);
  const motionKeys = useRadioKeys(MOTIONS.map((m) => m.key), motion, setMotion, 2);

  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    try {
      const made = await api.generate(scope, { mode, prompt, aspect, count: n, scene: mode === 'video' ? undefined : scene, motion: mode === 'video' ? motion : null,
        durationS: mode === 'video' ? durationS : undefined, productId: product?.id ?? null, projectId: projectId || null, ingredients,
        startFrame: mode === 'video' && startFrame ? startFrame : null, caption: mode === 'social' ? caption : null });
      setMine((x) => [...made.map((a) => a.id), ...x]);
      toast.success(`Rendering ${made.length === 1 ? (mode === 'video' ? 'your video' : 'your image') : `${made.length} images`}. They land in the Library as drafts.`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (!can('build')) return <EmptyState icon={<Wand2 className="size-5" aria-hidden />} title="Your role reviews media here" body="Open the Library to see what's waiting for review." />;
  if (!modes.length) return (
    <div className="space-y-4">
      <Banner title="Generation is off for this workspace">Upload your own images and video, then crop, caption and send them for approval.</Banner>
      <Uploader />
    </div>
  );

  const results = (assets.data ?? []).filter((a) => a.source === 'generated').sort((a, b) => Number(mine.includes(b.id)) - Number(mine.includes(a.id))).slice(0, 12);
  const preview = (sc: Scene) => renderUrl({ shape: product?.shape ?? null, hue: product?.hue ?? 200, scene: sc, seed: 11, label: product?.name ?? null, backdrop: 'scene' }, '16:9');
  const frameSrc = renderUrl({ shape: product?.shape ?? null, hue: product?.hue ?? 200, scene: 'studio', seed: 5, label: product?.name ?? null, backdrop: 'scene' }, '16:9');

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
      <form className="card space-y-5 p-4 md:p-5 xl:sticky xl:top-20 xl:self-start" onSubmit={(e) => { e.preventDefault(); void go(); }} aria-label="Create media">
        <div role="radiogroup" aria-label="What to make" className="grid grid-cols-2 gap-2">
          {modes.map((m, i) => (
            <button key={m.value} ref={modeKeys.ref(i)} type="button" role="radio" aria-checked={mode === m.value} tabIndex={modeKeys.tabIndex(m.value, i)}
              onKeyDown={(e) => modeKeys.onKey(e, i)} onClick={() => pickMode(m.value)}
              className={cx('press flex items-start gap-2.5 rounded-lg border p-3 text-left', mode === m.value ? 'border-ink bg-accent-soft' : 'border-line hover:bg-sunken')}>
              <m.icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0"><span className="block text-sm font-medium">{m.label}</span><span className="block text-xs text-muted">{m.hint}</span></span>
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project">{(p) => (
            <Select id={p.id} value={projectId} onChange={(e) => { setProjectId(e.target.value); setOff(new Set()); }}>
              <option value="">No project</option>{projects.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>)}</Field>
          <Field label={mode === 'product' ? 'Product (required)' : 'Product'}>{(p) => (
            <Select id={p.id} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{products.data?.length ? 'No product' : 'No products in this workspace'}</option>{products.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>)}</Field>
        </div>

        {project && project.ingredients.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><Layers className="size-4" aria-hidden />Ingredients from {project.name}</legend>
            <p className="mb-2 text-xs text-muted">Every result inherits these, so a campaign stays consistent. Tap one to leave it out of this run.</p>
            <div className="flex flex-wrap gap-1.5">
              {project.ingredients.map((i) => {
                const on = !off.has(i.id);
                return (
                  <button key={i.id} type="button" aria-pressed={on} onClick={() => setOff((s) => { const n2 = new Set(s); if (on) n2.add(i.id); else n2.delete(i.id); return n2; })}
                    className={cx('press inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm max-md:min-h-11', on ? 'border-ink/40 bg-accent-soft text-ink' : 'border-line text-muted line-through')}>
                    {on && <Check className="size-3.5 shrink-0" aria-hidden />}<span className="truncate">{i.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <Field label="Describe it" hint={`${prompt.length} / 2000 · Ctrl Enter to generate`}>{(p) => (
          <Textarea ref={promptRef} id={p.id} aria-describedby={p.describedBy} rows={3} maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void go(); } }}
            placeholder={EXAMPLES[mode](product?.name ?? null)[0]} />)}</Field>
        <div className="-mt-3 flex flex-wrap gap-1.5" aria-label="Example prompts">
          {EXAMPLES[mode](product?.name ?? null).map((x) => (
            <button key={x} type="button" onClick={() => { setPrompt(x); promptRef.current?.focus(); }} className="press max-w-full truncate rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:bg-sunken hover:text-fg max-md:min-h-11">{x}</button>
          ))}
        </div>

        {mode === 'social' && (
          <Field label="Headline on the image" hint="Optional. You can change it later in the editor.">{(p) => (
            <Input id={p.id} aria-describedby={p.describedBy} maxLength={140} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Book your spring check-up" />)}</Field>
        )}

        {mode !== 'video' && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Scene</legend>
            <div role="radiogroup" aria-label="Scene" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {SCENES.map((sc, i) => (
                <button key={sc.value} ref={sceneKeys.ref(i)} type="button" role="radio" aria-checked={scene === sc.value} tabIndex={sceneKeys.tabIndex(sc.value, i)}
                  onKeyDown={(e) => sceneKeys.onKey(e, i)} onClick={() => setScene(sc.value)} title={sc.hint}
                  className={cx('press overflow-hidden rounded-lg border text-left', scene === sc.value ? 'border-ink ring-2 ring-ring/40' : 'border-line hover:border-control')}>
                  <img src={preview(sc.value)} alt="" className="aspect-video w-full object-cover" draggable={false} />
                  <span className="block truncate px-1.5 py-1 text-xs font-medium">{sc.label}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {mode === 'video' && (
          <>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Camera move</legend>
              <p className="mb-2 text-xs text-muted">Hover or focus a move to preview it.</p>
              <div role="radiogroup" aria-label="Camera move" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MOTIONS.map((m, i) => <MotionTile key={m.key} motion={m.key} src={frameSrc} selected={motion === m.key} onSelect={() => setMotion(m.key)} name="motion"
                  tabIndex={motionKeys.tabIndex(m.key, i)} onKeyDown={(e) => motionKeys.onKey(e, i)} refCb={motionKeys.ref(i)} />)}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start frame" hint="Optional: the video opens on this picture.">{(p) => (
                <Select id={p.id} aria-describedby={p.describedBy} value={startFrame} onChange={(e) => setStartFrame(e.target.value)}>
                  <option value="">From the description</option>{stills.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>)}</Field>
              <div><p className="mb-1.5 text-sm font-medium" id="len-l">Length</p>
                <Segmented id="len" label="Length in seconds" value={length} onChange={setLength} options={LENGTHS.map((l) => ({ value: l, label: `${l}s` }))} /></div>
            </div>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div><p className="mb-1.5 text-sm font-medium">Shape</p>
            <Segmented id="aspect" label="Shape" value={aspect} onChange={setAspect} options={ASPECTS.map((a) => ({ value: a.value, label: <span title={a.hint}>{a.value}</span> }))} />
            <p className="mt-1 text-xs text-muted">{ASPECTS.find((a) => a.value === aspect)!.label}: {ASPECTS.find((a) => a.value === aspect)!.hint}</p></div>
          {mode !== 'video' && <div><p className="mb-1.5 text-sm font-medium">How many</p>
            <Segmented id="count" label="How many" value={count} onChange={setCount} options={(['1', '2', '3', '4'] as const).map((c) => ({ value: c, label: c }))} /></div>}
        </div>

        <div className="space-y-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="tabular text-sm"><span className="font-medium">≈ {cost} media credits</span> <span className="text-muted">· {caps.mediaCredits.toLocaleString('en-US')} left</span></p>
            <Button type="submit" variant="primary" className="ml-auto" loading={busy} disabled={!canGo} icon={<Wand2 className="size-4" aria-hidden />}>
              Generate {mode === 'video' ? 'video' : n === 1 ? 'image' : `${n} images`}</Button>
          </div>
          {needProduct && <p className="text-xs text-warning">Pick a product for a product shot.</p>}
          {short && <p className="text-xs text-danger">Not enough media credits for this run.</p>}
          {caps.sample && <p className="text-xs text-muted">Demo: this draws a labeled sample on your device. No model is called and nothing is sent anywhere.</p>}
        </div>
      </form>

      <section aria-labelledby="results-h" className="min-w-0">
        <div className="mb-3 flex items-baseline gap-2"><h2 id="results-h" className="text-base font-semibold">Recent results</h2><span className="text-sm text-muted">Drafts until approved</span></div>
        {assets.loading ? <SkeletonList rows={3} /> : !results.length ? <EmptyState icon={<Wand2 className="size-5" aria-hidden />} title="Nothing generated yet" body="Describe what you want on the left. Results show up here and in the Library." /> : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {results.map((a) => <li key={a.id}><AssetCard asset={a} tz={tz} onOpen={() => onOpen(a.id)} /></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
