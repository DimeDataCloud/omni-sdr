// Studio media helpers: drawing the demo's sample renders, camera-move presets, channel sizes and export.
// The demo has no generator and calls no vendor (rails §8): a "generated" picture here is an SVG composed on the device
// from its RenderSpec and always labeled "Demo sample". The real API stores the rendered file and returns its URL instead.
// Colors are hsl() built from the spec's hue (the tokens-only gate forbids hex in components and helpers).
import type { Aspect, Edits, MotionKey, ProductShape, RenderSpec, Scene } from '@/lib/api/types';
export { CREDIT_COST, costOf, NO_EDITS } from './studio-rules';

export const ASPECTS: { value: Aspect; label: string; hint: string; w: number; h: number }[] = [
  { value: '1:1', label: 'Square', hint: 'Feed, LinkedIn', w: 1080, h: 1080 },
  { value: '4:5', label: 'Portrait', hint: 'Instagram feed', w: 1080, h: 1350 },
  { value: '9:16', label: 'Vertical', hint: 'Stories, Reels, Shorts', w: 1080, h: 1920 },
  { value: '16:9', label: 'Wide', hint: 'YouTube, web, ads', w: 1920, h: 1080 },
];
export const ratio = (a: Aspect) => { const x = ASPECTS.find((v) => v.value === a)!; return x.w / x.h; };
export const sizeOf = (a: Aspect) => ASPECTS.find((v) => v.value === a)!;

export const SCENES: { value: Scene; label: string; hint: string }[] = [
  { value: 'studio', label: 'Studio', hint: 'Seamless backdrop, soft light' },
  { value: 'podium', label: 'Podium', hint: 'Product on a plinth' },
  { value: 'counter', label: 'Countertop', hint: 'Lifestyle, window light' },
  { value: 'outdoor', label: 'Outdoor', hint: 'Daylight, open sky' },
  { value: 'flatlay', label: 'Flat lay', hint: 'Top-down with props' },
];

/** Camera moves, Higgsfield-style: picked from tiles, never typed. Each is a keyframe path over the frame. */
export const MOTIONS: { key: MotionKey; label: string; hint: string; frames: Keyframe[] }[] = [
  { key: 'static', label: 'Locked off', hint: 'No camera move', frames: [{ transform: 'none' }, { transform: 'none' }] },
  { key: 'push_in', label: 'Push in', hint: 'Slow dolly toward the subject', frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }] },
  { key: 'pull_out', label: 'Pull out', hint: 'Reveal the scene', frames: [{ transform: 'scale(1.22)' }, { transform: 'scale(1)' }] },
  { key: 'pan_left', label: 'Pan left', hint: 'Slide across the frame', frames: [{ transform: 'scale(1.15) translateX(5%)' }, { transform: 'scale(1.15) translateX(-5%)' }] },
  { key: 'pan_right', label: 'Pan right', hint: 'Slide across the frame', frames: [{ transform: 'scale(1.15) translateX(-5%)' }, { transform: 'scale(1.15) translateX(5%)' }] },
  { key: 'tilt_up', label: 'Tilt up', hint: 'From the base to the top', frames: [{ transform: 'scale(1.15) translateY(-5%)' }, { transform: 'scale(1.15) translateY(5%)' }] },
  { key: 'crane_up', label: 'Crane up', hint: 'Rise and settle', frames: [{ transform: 'scale(1.2) translateY(-6%)' }, { transform: 'scale(1.05) translateY(2%)' }] },
  { key: 'orbit', label: 'Orbit', hint: 'Arc around the product', frames: [{ transform: 'scale(1.12) rotate(-3deg) translateX(-3%)' }, { transform: 'scale(1.12) rotate(3deg) translateX(3%)' }] },
  { key: 'crash_zoom', label: 'Crash zoom', hint: 'Fast punch in', frames: [{ transform: 'scale(1)', offset: 0 }, { transform: 'scale(1)', offset: 0.55 }, { transform: 'scale(1.45)', offset: 0.7 }, { transform: 'scale(1.4)', offset: 1 }] },
  { key: 'handheld', label: 'Handheld', hint: 'UGC feel, a little shake', frames: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ transform: `scale(1.08) translate(${[0, 1, -1, 0.5, -0.5, 1, 0][i]}%, ${[0, -0.6, 0.4, 0.8, -0.4, 0.2, 0][i]}%)` })) },
];
export const motionOf = (k: MotionKey | null) => MOTIONS.find((m) => m.key === (k ?? 'static'))!;


// ── Drawing ────────────────────────────────────────────────────────────────────────────────────
const hsl = (h: number, s: number, l: number, a = 1) => `hsl(${Math.round(((h % 360) + 360) % 360)} ${s}% ${l}%${a < 1 ? ` / ${a}` : ''})`;
const esc = (t: string) => t.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
function rand(seed: number) { let x = seed | 0 || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }

function background(scene: Scene, backdrop: RenderSpec['backdrop'], hue: number, W: number, H: number, r: () => number): string {
  if (backdrop === 'cutout') {
    return `<defs><pattern id="mchk" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="${hsl(0, 0, 96)}"/><rect width="20" height="20" fill="${hsl(0, 0, 88)}"/><rect x="20" y="20" width="20" height="20" fill="${hsl(0, 0, 88)}"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#mchk)"/>`;
  }
  if (backdrop === 'clean') {
    return `<defs><radialGradient id="mcl" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${hsl(hue, 10, 99)}"/><stop offset="1" stop-color="${hsl(hue, 8, 90)}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#mcl)"/>`;
  }
  const floor = H * 0.68;
  switch (scene) {
    case 'podium':
      return `<defs><linearGradient id="mpw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(hue + 20, 35, 86)}"/><stop offset="1" stop-color="${hsl(hue + 20, 30, 74)}"/></linearGradient>
        <linearGradient id="mpp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${hsl(hue + 200, 12, 80)}"/><stop offset=".5" stop-color="${hsl(hue + 200, 14, 94)}"/><stop offset="1" stop-color="${hsl(hue + 200, 12, 76)}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#mpw)"/><circle cx="${W * 0.78}" cy="${H * 0.22}" r="${W * 0.26}" fill="${hsl(hue + 40, 50, 92, 0.6)}"/>
        <rect x="${W * 0.2}" y="${floor}" width="${W * 0.6}" height="${H - floor}" fill="url(#mpp)"/><ellipse cx="${W / 2}" cy="${floor}" rx="${W * 0.3}" ry="${W * 0.06}" fill="${hsl(hue + 200, 12, 96)}"/>`;
    case 'counter': {
      const veins = [0, 1, 2, 3].map(() => `<path d="M0 ${floor + r() * (H - floor)} Q ${W * 0.4} ${floor + r() * (H - floor)} ${W} ${floor + r() * (H - floor)}" stroke="${hsl(30, 8, 70, 0.5)}" stroke-width="3" fill="none"/>`).join('');
      return `<defs><linearGradient id="mwl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(35, 40, 90)}"/><stop offset="1" stop-color="${hsl(30, 30, 80)}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#mwl)"/><polygon points="${W * 0.55},0 ${W * 0.95},0 ${W * 0.7},${floor} ${W * 0.25},${floor}" fill="${hsl(45, 100, 98, 0.45)}"/>
        <path d="M${W * 0.12} ${floor} C ${W * 0.05} ${floor - H * 0.2} ${W * 0.2} ${floor - H * 0.32} ${W * 0.1} ${floor - H * 0.42}" stroke="${hsl(130, 30, 35)}" stroke-width="6" fill="none"/>
        <ellipse cx="${W * 0.1}" cy="${floor - H * 0.3}" rx="${W * 0.06}" ry="${W * 0.025}" transform="rotate(-35 ${W * 0.1} ${floor - H * 0.3})" fill="${hsl(130, 35, 40)}"/>
        <ellipse cx="${W * 0.15}" cy="${floor - H * 0.2}" rx="${W * 0.06}" ry="${W * 0.022}" transform="rotate(25 ${W * 0.15} ${floor - H * 0.2})" fill="${hsl(125, 30, 46)}"/>
        <rect y="${floor}" width="${W}" height="${H - floor}" fill="${hsl(30, 10, 94)}"/>${veins}<rect y="${floor}" width="${W}" height="6" fill="${hsl(30, 10, 82)}"/>`;
    }
    case 'outdoor':
      return `<defs><linearGradient id="msk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(205, 70, 72)}"/><stop offset="1" stop-color="${hsl(30, 80, 88)}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#msk)"/><circle cx="${W * (0.2 + r() * 0.6)}" cy="${H * 0.2}" r="${W * 0.07}" fill="${hsl(45, 100, 92)}"/>
        <path d="M0 ${floor - H * 0.08} Q ${W * 0.3} ${floor - H * 0.2} ${W * 0.6} ${floor - H * 0.07} T ${W} ${floor - H * 0.1} V ${H} H 0 Z" fill="${hsl(120, 25, 55)}"/>
        <path d="M0 ${floor} Q ${W * 0.5} ${floor - H * 0.05} ${W} ${floor} V ${H} H 0 Z" fill="${hsl(95, 30, 62)}"/>`;
    case 'flatlay': {
      const props = [0, 1, 2, 3, 4].map((i) => { const x = r() * W, y = r() * H, s = W * (0.03 + r() * 0.05);
        return i % 2 ? `<circle cx="${x}" cy="${y}" r="${s}" fill="${hsl(hue + 140, 30, 82)}"/>` : `<ellipse cx="${x}" cy="${y}" rx="${s * 1.8}" ry="${s * 0.7}" transform="rotate(${r() * 180} ${x} ${y})" fill="${hsl(130, 30, 55)}"/>`; }).join('');
      return `<rect width="${W}" height="${H}" fill="${hsl(hue + 30, 20, 90)}"/>${props}`;
    }
    default:
      return `<defs><radialGradient id="mst" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="${hsl(hue, 45, 93)}"/><stop offset="1" stop-color="${hsl(hue, 35, 78)}"/></radialGradient>
        <linearGradient id="mfl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(hue, 30, 84)}"/><stop offset="1" stop-color="${hsl(hue, 30, 74)}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#mst)"/><rect y="${floor}" width="${W}" height="${H - floor}" fill="url(#mfl)" opacity=".7"/>`;
  }
}

function product(shape: ProductShape, hue: number, label: string | null, cx: number, base: number, size: number): string {
  const body = hsl(hue, 55, 52), dark = hsl(hue, 50, 38), light = hsl(hue, 60, 70), paper = hsl(hue, 20, 97), ink = hsl(hue, 40, 22);
  const max = shape === 'box' || shape === 'jar' ? 26 : 18; // wide labels fit more
  const text = label ? esc(label.length > max ? label.slice(0, max - 1) + '…' : label) : '';
  const shadow = `<ellipse cx="${cx}" cy="${base}" rx="${size * 0.55}" ry="${size * 0.07}" fill="${hsl(0, 0, 0, 0.18)}"/>`;
  switch (shape) {
    case 'box': {
      const w = size * 0.72, h = size * 0.95, d = size * 0.18, x = cx - w / 2, y = base - h;
      return `${shadow}<polygon points="${x + w},${y} ${x + w + d},${y - d * 0.6} ${x + w + d},${base - d * 0.6} ${x + w},${base}" fill="${dark}"/>
        <polygon points="${x},${y} ${x + d},${y - d * 0.6} ${x + w + d},${y - d * 0.6} ${x + w},${y}" fill="${light}"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${body}"/><rect x="${x}" y="${y + h * 0.38}" width="${w}" height="${h * 0.26}" fill="${paper}"/>
        <text x="${cx}" y="${y + h * 0.54}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${size * (text.length > 18 ? 0.055 : 0.075)}" fill="${ink}">${text}</text>`;
    }
    case 'bottle': {
      const w = size * 0.42, h = size * 0.8, x = cx - w / 2, y = base - h;
      return `${shadow}<rect x="${cx - w * 0.16}" y="${y - size * 0.2}" width="${w * 0.32}" height="${size * 0.14}" rx="${w * 0.05}" fill="${hsl(hue, 10, 20)}"/>
        <rect x="${cx - w * 0.22}" y="${y - size * 0.07}" width="${w * 0.44}" height="${size * 0.1}" fill="${light}"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.22}" fill="${body}"/><rect x="${x + w * 0.12}" y="${y + h * 0.08}" width="${w * 0.1}" height="${h * 0.8}" rx="${w * 0.05}" fill="${hsl(0, 0, 100, 0.3)}"/>
        <rect x="${x}" y="${y + h * 0.4}" width="${w}" height="${h * 0.3}" fill="${paper}"/>
        <text x="${cx}" y="${y + h * 0.58}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${size * 0.05}" fill="${ink}">${text}</text>`;
    }
    case 'tube': {
      const w = size * 0.36, h = size * 0.95, y = base - h;
      return `${shadow}<path d="M${cx - w / 2} ${y} H ${cx + w / 2} L ${cx + w * 0.3} ${base - size * 0.12} H ${cx - w * 0.3} Z" fill="${body}"/>
        <rect x="${cx - w * 0.55}" y="${y - size * 0.02}" width="${w * 1.1}" height="${size * 0.05}" fill="${dark}"/>
        <rect x="${cx - w * 0.28}" y="${base - size * 0.13}" width="${w * 0.56}" height="${size * 0.13}" rx="${w * 0.06}" fill="${paper}"/>
        <path d="M${cx - w * 0.42} ${y + h * 0.3} H ${cx + w * 0.42} L ${cx + w * 0.38} ${y + h * 0.55} H ${cx - w * 0.38} Z" fill="${paper}"/>
        <text x="${cx}" y="${y + h * 0.45}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${size * 0.045}" fill="${ink}">${text}</text>`;
    }
    default: {
      const w = size * 0.8, h = size * 0.5, x = cx - w / 2, y = base - h;
      return `${shadow}<rect x="${x - w * 0.03}" y="${y - h * 0.22}" width="${w * 1.06}" height="${h * 0.26}" rx="${h * 0.06}" fill="${dark}"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * 0.12}" fill="${body}"/><ellipse cx="${cx}" cy="${y + h * 0.04}" rx="${w / 2}" ry="${h * 0.06}" fill="${light}"/>
        <rect x="${x}" y="${y + h * 0.3}" width="${w}" height="${h * 0.36}" fill="${paper}"/>
        <text x="${cx}" y="${y + h * 0.54}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${size * 0.06}" fill="${ink}">${text}</text>`;
    }
  }
}

/** Abstract hero shapes for a prompt with no product: a few soft forms in the spec's hue. */
function forms(hue: number, W: number, H: number, r: () => number): string {
  const base = H * 0.7;
  return [0, 1, 2].map((i) => {
    const x = W * (0.3 + i * 0.2 + (r() - 0.5) * 0.08), s = W * (0.08 + r() * 0.1);
    return i === 1
      ? `<path d="M${x - s} ${base} V ${base - s * 1.6} A ${s} ${s} 0 0 1 ${x + s} ${base - s * 1.6} V ${base} Z" fill="${hsl(hue + 25, 45, 62)}"/>`
      : `<circle cx="${x}" cy="${base - s}" r="${s}" fill="${hsl(hue + i * 40, 50, 58 + i * 6)}"/>`;
  }).join('') + `<ellipse cx="${W / 2}" cy="${base}" rx="${W * 0.38}" ry="${W * 0.03}" fill="${hsl(0, 0, 0, 0.12)}"/>`;
}

/** The SVG markup for a render at an aspect. Pure: same spec, same picture, on every device. */
export function renderSvg(spec: RenderSpec, aspect: Aspect, scale: 1 | 2 = 1): string {
  const W = 1000, H = Math.round(W / ratio(aspect));
  const r = rand(spec.seed);
  const floor = spec.scene === 'flatlay' && spec.backdrop === 'scene' ? H * 0.62 : H * 0.7;
  const size = Math.min(W, H) * 0.62;
  const subject = spec.shape ? product(spec.shape, spec.hue, spec.label, W / 2 + (r() - 0.5) * W * 0.08, floor + size * 0.02, size) : forms(spec.hue, W, H, r);
  const tilt = spec.scene === 'flatlay' && spec.backdrop === 'scene' ? ` transform="rotate(${-18 + r() * 10} ${W / 2} ${floor - size / 2})"` : '';
  // Upscaled versions draw a little finer detail (thinner grain), so "2x" is visible, not just a label.
  const grain = `<filter id="mgr"><feTurbulence type="fractalNoise" baseFrequency="${scale === 2 ? 1.6 : 0.9}" numOctaves="2" seed="${spec.seed % 97}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .05 0"/></filter>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}">${background(spec.scene, spec.backdrop, spec.hue, W, H, r)}<g${tilt}>${subject}</g><defs>${grain}</defs><rect width="${W}" height="${H}" filter="url(#mgr)"/></svg>`;
}

const cache = new Map<string, string>();
/** A data: URL (the CSP allows data: images). Cached, since the same spec is drawn in many places. */
export function renderUrl(spec: RenderSpec, aspect: Aspect, scale: 1 | 2 = 1): string {
  const k = `${JSON.stringify(spec)}|${aspect}|${scale}`;
  let u = cache.get(k);
  if (!u) { u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSvg(spec, aspect, scale))}`; cache.set(k, u); if (cache.size > 300) cache.delete(cache.keys().next().value!); }
  return u;
}

// ── Uploads ──────────────────────────────────────────────────────────────────────────────────
/** Reads an image file, scales it to at most 1600px and re-encodes it as JPEG, so the demo can keep it on the device. */
export async function readImage(file: File): Promise<{ src: string; aspect: Aspect }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return { src: c.toDataURL('image/jpeg', 0.85), aspect: nearestAspect(bmp.width / bmp.height) };
}
export function nearestAspect(r: number): Aspect {
  return ASPECTS.reduce((best, a) => (Math.abs(Math.log(a.w / a.h / r)) < Math.abs(Math.log(ratio(best) / r)) ? a.value : best), '1:1' as Aspect);
}
/** Uploaded video stays in memory for this tab only: the demo has nowhere to keep video files. */
const videoFiles = new Map<string, string>();
export function keepVideo(file: File): string { const key = `video:${crypto.randomUUID()}`; videoFiles.set(key, URL.createObjectURL(file)); return key; }
export const videoUrl = (key: string | null) => (key ? videoFiles.get(key) ?? null : null);
export async function readVideoMeta(file: File): Promise<{ durationS: number; aspect: Aspect }> {
  const v = document.createElement('video');
  v.preload = 'metadata'; v.src = URL.createObjectURL(file);
  await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('That video could not be read.')); });
  const out = { durationS: Math.round(v.duration * 10) / 10, aspect: nearestAspect(v.videoWidth / Math.max(1, v.videoHeight)) };
  URL.revokeObjectURL(v.src);
  return out;
}

// ── Export ───────────────────────────────────────────────────────────────────────────────────
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be drawn.')); i.src = src; });

/** Draws an image version with its edits into a PNG at the target channel size. Runs entirely on the device. */
export async function exportPng(src: string, srcAspect: Aspect, edits: Edits): Promise<string> {
  const img = await loadImg(src);
  const outAspect = edits.crop ?? srcAspect;
  const quarter = edits.rotate === 90 || edits.rotate === 270;
  const { w, h } = sizeOf(outAspect);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.filter = `brightness(${edits.brightness}%) contrast(${edits.contrast}%) saturate(${edits.saturation}%)`;
  g.translate(w / 2, h / 2);
  g.rotate((edits.rotate * Math.PI) / 180);
  if (edits.flipH) g.scale(-1, 1);
  // Cover the output frame (center crop), measured in the rotated frame.
  const fw = quarter ? h : w, fh = quarter ? w : h;
  const iw = img.naturalWidth || 1000, ih = img.naturalHeight || 1000;
  const k = Math.max(fw / iw, fh / ih);
  g.drawImage(img, (-iw * k) / 2, (-ih * k) / 2, iw * k, ih * k);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.filter = 'none';
  if (edits.text?.value.trim()) drawText(g, edits.text, w, h);
  return c.toDataURL('image/png');
}

function drawText(g: CanvasRenderingContext2D, t: NonNullable<Edits['text']>, w: number, h: number) {
  const size = Math.round(Math.min(w, h) * 0.075);
  g.font = t.style === 'serif' ? `400 ${size * 1.15}px "Instrument Serif", Georgia, serif` : `700 ${size}px "Inter Variable", Inter, Helvetica, Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = wrap(g, t.value.trim(), w * 0.84);
  const lh = size * 1.25;
  const y0 = t.position === 'top' ? h * 0.12 : t.position === 'bottom' ? h * 0.88 - (lines.length - 1) * lh : h / 2 - ((lines.length - 1) * lh) / 2;
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = size * 0.4;
  g.fillStyle = 'white';
  lines.forEach((l, i) => g.fillText(l, w / 2, y0 + i * lh));
}
function wrap(g: CanvasRenderingContext2D, text: string, max: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > max && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out.slice(0, 6);
}

/** Starts a download of a data: URL (no network). */
export function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
export const fileName = (name: string, ext: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'asset'}.${ext}`;

export const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
