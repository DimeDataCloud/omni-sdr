// Studio building blocks shared by Create, Library, Projects and the editor.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { Film, Image as ImageIcon, Loader2, Pause, Play, Sparkles, Upload } from 'lucide-react';
import type { Asset, AssetStatus, AssetVersion, Edits, MotionKey } from '@/lib/api/types';
import { MOTIONS, fmtDuration, motionOf, ratio, renderUrl, videoUrl } from '@/lib/media';
import { relTime } from '@/lib/format';
import { Badge, cx } from '@/components/ui';

export const STATUS: Record<AssetStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  draft: { label: 'Draft', tone: 'neutral' }, review: { label: 'In review', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' }, changes_requested: { label: 'Changes requested', tone: 'warning' },
};
export const StatusBadge = ({ status }: { status: AssetStatus }) => <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
export const SampleBadge = () => <Badge tone="neutral" icon={<Sparkles className="size-3" aria-hidden />}>Demo sample</Badge>;

/** Where a version's picture comes from: an uploaded file, or (demo) a render drawn on the device. */
export function srcOf(a: Pick<Asset, 'aspect' | 'kind'>, v: AssetVersion): string | null {
  if (v.src?.startsWith('video:')) return null;
  return v.src ?? (v.render ? renderUrl(v.render, a.aspect, v.scale) : null);
}

/**
 * One piece of media at its (cropped) shape with its edits applied live: filters, rotation, flip, headline, captions.
 * Video plays its camera move over the frame (demo samples) or the uploaded file; nothing plays on its own.
 */
export function AssetFrame({ asset, version, edits, controls = false, className, fit = 'cover', label }: {
  asset: Asset; version?: AssetVersion; edits?: Edits; controls?: boolean; className?: string; fit?: 'cover' | 'contain'; label?: string;
}) {
  const v = version ?? asset.versions[asset.current];
  const e = edits ?? v.edits;
  const shape = e.crop ?? asset.aspect;
  const r = ratio(shape);
  const src = srcOf(asset, v);
  const file = asset.kind === 'video' && v.src?.startsWith('video:') ? videoUrl(v.src) : null;
  const quarter = e.rotate === 90 || e.rotate === 270;
  const imgStyle: CSSProperties = {
    filter: `brightness(${e.brightness}%) contrast(${e.contrast}%) saturate(${e.saturation}%)`,
    transform: `rotate(${e.rotate}deg) scale(${quarter ? Math.max(r, 1 / r) : 1}) scaleX(${e.flipH ? -1 : 1})`,
  };
  const text = e.text?.value.trim();
  const fs = `${(7.5 * Math.min(1, 1 / r)).toFixed(2)}cqw`;
  return (
    // With playback controls inside, the frame is a group (an img role would hide the controls from assistive tech).
    <div className={cx('media-frame relative overflow-hidden bg-sunken', className)} style={{ aspectRatio: String(r) }}
      role={controls ? 'group' : 'img'} aria-label={label ?? asset.name}>
      {asset.rendering ? <Rendering kind={asset.kind} /> : file ? (
        <video src={file} controls={controls} playsInline preload="metadata" className="absolute inset-0 size-full object-contain" style={imgStyle} aria-label={asset.name} />
      ) : asset.kind === 'video' && v.src?.startsWith('video:') ? (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted"><span><Upload className="mx-auto mb-1 size-5" aria-hidden />The demo keeps uploaded video only until the page reloads. Upload it again to preview it.</span></div>
      ) : src ? (
        asset.kind === 'video' ? <Motion src={src} motion={asset.generation?.motion ?? 'static'} durationS={(e.trim ? e.trim.outS - e.trim.inS : asset.durationS) ?? 6} style={imgStyle} controls={controls} fit={fit} />
          : <img src={src} alt="" draggable={false} className={cx('absolute inset-0 size-full', fit === 'cover' ? 'object-cover' : 'object-contain')} style={imgStyle} />
      ) : null}
      {text && !asset.rendering && (
        // White on a photo in both themes (a theme token would turn dark in light mode); the shadow keeps it legible.
        <p aria-hidden className={cx('pointer-events-none absolute inset-x-[8%] text-center [text-shadow:0_2px_12px_rgb(0_0_0/.45)]',
          e.text!.position === 'top' ? 'top-[8%]' : e.text!.position === 'bottom' ? 'bottom-[8%]' : 'top-1/2 -translate-y-1/2',
          e.text!.style === 'serif' ? 'font-display' : 'font-bold')} style={{ color: 'white', fontSize: e.text!.style === 'serif' ? `calc(${fs} * 1.15)` : fs, lineHeight: 1.2 }}>{text}</p>
      )}
      {asset.kind === 'video' && e.captions?.trim() && !asset.rendering && (
        <p aria-hidden className="pointer-events-none absolute inset-x-[10%] bottom-[4%] text-center"><span className="rounded bg-inverse/70 px-1.5 py-0.5 text-fg-inverse" style={{ fontSize: `calc(${fs} * .55)` }}>{e.captions}</span></p>
      )}
    </div>
  );
}

function Rendering({ kind }: { kind: Asset['kind'] }) {
  return (
    <div className="skeleton absolute inset-0 grid place-items-center" role="status">
      <span className="flex items-center gap-2 rounded-full bg-surface/85 px-3 py-1 text-sm font-medium"><Loader2 className="size-4 animate-spin" aria-hidden />Rendering {kind === 'video' ? 'video' : 'image'}…</span>
    </div>
  );
}

/** A demo video: the frame with its camera move, played on request. Under reduced motion it stays a still. */
function Motion({ src, motion, durationS, style, controls, fit }: { src: string; motion: MotionKey; durationS: number; style: CSSProperties; controls: boolean; fit: 'cover' | 'contain' }) {
  const img = useRef<HTMLImageElement>(null);
  const anim = useRef<Animation | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => () => anim.current?.cancel(), []);
  useEffect(() => { anim.current?.cancel(); anim.current = null; setPlaying(false); setT(0); }, [motion, durationS, src]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setT(Math.min(durationS, ((anim.current?.currentTime as number | null) ?? 0) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [playing, durationS]);
  const toggle = () => {
    if (reduce) return;
    if (playing) { anim.current?.pause(); setPlaying(false); return; }
    if (!anim.current || anim.current.playState === 'finished') {
      anim.current?.cancel();
      // The move goes on a wrapper so the image's own edits (rotation, flip) stay as they are.
      anim.current = img.current!.parentElement!.animate(motionOf(motion).frames, { duration: durationS * 1000, easing: motion === 'handheld' ? 'linear' : 'ease-in-out', fill: 'forwards' });
      anim.current.onfinish = () => { setPlaying(false); setT(durationS); };
    } else anim.current.play();
    setPlaying(true);
  };
  return (
    <>
      <div className="absolute inset-0"><img ref={img} src={src} alt="" draggable={false} className={cx('size-full', fit === 'cover' ? 'object-cover' : 'object-contain')} style={style} /></div>
      {controls ? (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-lg bg-inverse/70 px-2 py-1 text-fg-inverse">
          <button type="button" onClick={toggle} disabled={Boolean(reduce)} aria-label={playing ? 'Pause' : 'Play'} title={reduce ? 'Motion preview is off while reduced motion is on' : undefined}
            className="press grid size-8 place-items-center rounded-full hover:bg-surface/20 disabled:opacity-60 max-md:size-11">{playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}</button>
          <span className="tabular text-xs">{fmtDuration(t)} / {fmtDuration(durationS)}</span>
          <span className="ml-auto truncate text-xs">{motionOf(motion).label}</span>
        </div>
      ) : (
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-sm bg-inverse/70 px-1.5 py-0.5 text-xs text-fg-inverse"><Film className="size-3" aria-hidden />{fmtDuration(durationS)}</span>
      )}
    </>
  );
}

/** A library card: the media at its own shape inside a fixed box, the name, and its state. */
export function AssetCard({ asset, onOpen, tz, selected, extra }: { asset: Asset; onOpen: () => void; tz: string; selected?: boolean; extra?: ReactNode }) {
  const KindIcon = asset.kind === 'video' ? Film : ImageIcon;
  return (
    <div className={cx('card lift group flex h-full flex-col overflow-hidden', selected && 'ring-2 ring-ring')}>
      <button type="button" onClick={onOpen} aria-label={`Open ${asset.name}`} className="relative block w-full bg-sunken text-left">
        <div className="grid aspect-square place-items-center p-3">
          {/* Wide media fills the width; square and tall media fill the height, so every card is the same size. */}
          <AssetFrame asset={asset} fit="cover" className={cx('rounded-md shadow-sm', ratio(asset.versions[asset.current].edits.crop ?? asset.aspect) > 1 ? 'w-full' : 'h-full')} label={`${asset.name}, ${asset.kind}`} />
        </div>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <p className="truncate text-sm font-medium" title={asset.name}>{asset.name}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted"><KindIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{asset.aspect} · {asset.source === 'upload' ? 'Uploaded' : 'Generated'} · {relTime(asset.createdAt, tz)}</span></p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1"><StatusBadge status={asset.status} />{asset.generation?.sample && <SampleBadge />}{extra}</div>
      </div>
    </div>
  );
}

/** A camera-move tile: previews its move on hover or focus only, so nothing loops while idle. */
export function MotionTile({ motion, src, selected, onSelect, name, tabIndex, onKeyDown, refCb }: {
  motion: MotionKey; src: string; selected: boolean; onSelect: () => void; name: string; tabIndex: number;
  onKeyDown: (e: React.KeyboardEvent) => void; refCb: (el: HTMLButtonElement | null) => void;
}) {
  const m = MOTIONS.find((x) => x.key === motion)!;
  const inner = useRef<HTMLDivElement>(null);
  const a = useRef<Animation | null>(null);
  const reduce = useReducedMotion();
  const start = () => { if (reduce || !inner.current) return; a.current?.cancel(); a.current = inner.current.animate(m.frames, { duration: 1600, iterations: 1, easing: 'ease-in-out', fill: 'forwards' }); };
  const stop = () => { a.current?.cancel(); a.current = null; };
  useEffect(() => stop, []);
  return (
    <button ref={refCb} type="button" role="radio" aria-checked={selected} tabIndex={tabIndex} name={name} onClick={onSelect} onKeyDown={onKeyDown}
      onPointerEnter={start} onPointerLeave={stop} onFocus={start} onBlur={stop} title={m.hint}
      className={cx('press flex flex-col overflow-hidden rounded-lg border text-left', selected ? 'border-ink ring-2 ring-ring/40' : 'border-line hover:border-control')}>
      <div className="relative aspect-video w-full overflow-hidden bg-sunken"><div ref={inner} className="absolute inset-0"><img src={src} alt="" draggable={false} className="size-full object-cover" /></div></div>
      <span className="px-2 pt-1.5 text-sm font-medium">{m.label}</span>
      <span className="truncate px-2 pb-1.5 text-xs text-muted">{m.hint}</span>
    </button>
  );
}

/** Arrow keys move and choose inside a radio group of tiles or chips (WAI-ARIA radio pattern). */
export function useRadioKeys<T>(items: T[], value: T, onChange: (v: T) => void, cols = 1) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (!d) return;
    e.preventDefault();
    const n = (i + d + items.length) % items.length;
    onChange(items[n]); refs.current[n]?.focus();
  };
  // With nothing chosen yet, the first item takes the group's one tab stop.
  const any = items.includes(value);
  return { onKey, ref: (i: number) => (el: HTMLButtonElement | null) => { refs.current[i] = el; }, tabIndex: (v: T, i: number) => (any ? (v === value ? 0 : -1) : i === 0 ? 0 : -1) };
}
