// Studio in the demo: products, projects and media assets, kept on the device beside the main demo world.
// The same rules the API will have (STUDIO-PLAN.md): build to create and edit, approve to approve, generation only
// with the org flag on and enough media credits, and every generated asset is a draft until someone approves it.
// Generation draws a "Demo sample" locally (lib/media.ts); no vendor is called and nothing leaves the device.
import { ApiError, invalidate, type Client, type Scope } from '../client';
import type { Asset, AssetStatus, Aspect, GenMode, Ingredient, MotionKey, Product, Project, RenderSpec, Scene, StudioCaps } from '../types';
import type { World, MemberRow } from './seed';
import { builtAt, newId } from './store';
import { CREDIT_COST, NO_EDITS, costOf } from '@/lib/studio-rules';

const KEY = 'omni-demo-media';
const MEDIA_VERSION = 1;

interface AssetRow extends Omit<Asset, 'createdBy'> { ws: string; createdBy: string; archivedAt: string | null }
interface ProjectRow extends Omit<Project, 'assetCount'> { ws: string }
interface ProductRow extends Product { ws: string }
interface Media { version: number; worldBuiltAt: number; credits: number; products: ProductRow[]; projects: ProjectRow[]; assets: AssetRow[] }

export const MODEL: Record<GenMode, string> = { image: 'Imagen (demo sample)', product: 'Imagen (demo sample)', social: 'Imagen (demo sample)', video: 'Veo (demo sample)' };

const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

let media: Media | null = null;
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(media)); }
  catch { throw new ApiError(507, 'storage_full', 'The demo keeps uploads on this device, and its storage is full. Archive an upload and try again.'); }
}

function seed(w: World): Media {
  const at = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();
  const [w0, w1, w2] = w.workspaces;
  const maya = w.members[0].userId;
  const products: ProductRow[] = [
    { id: newId(), ws: w0.id, name: 'Brightline Whitening Kit', tagline: 'Whiter in 14 days', shape: 'box', hue: 195, description: 'At-home whitening kit with trays and gel.' },
    { id: newId(), ws: w0.id, name: 'Fresh Mint Paste', tagline: 'Daily enamel care', shape: 'tube', hue: 160, description: 'Fluoride toothpaste, fresh mint.' },
    { id: newId(), ws: w0.id, name: 'Calm Gum Rinse', tagline: 'Alcohol-free', shape: 'bottle', hue: 262, description: 'Alcohol-free rinse for sensitive gums.' },
    { id: newId(), ws: w2.id, name: 'Summit Shingle Sample Kit', tagline: 'See it on your roof', shape: 'box', hue: 18, description: 'Five shingle colors to hold up against the house.' },
  ];
  const [kit, paste, rinse] = products;
  const ing = (kind: Ingredient['kind'], label: string, productId: string | null = null): Ingredient => ({ id: newId(), kind, label, assetId: null, productId });
  const launch: ProjectRow = { id: newId(), ws: w0.id, name: 'Whitening kit launch', productId: kit.id, createdAt: at(60 * 24 * 6), sequence: [],
    ingredients: [ing('product', kit.name, kit.id), ing('brand', 'Brightline brand kit: teal, white, rounded sans'), ing('style', 'Soft daylight, clean bathroom counter')] };
  const promo: ProjectRow = { id: newId(), ws: w0.id, name: 'Spring check-up promo', productId: null, createdAt: at(60 * 24 * 3), sequence: [],
    ingredients: [ing('brand', 'Brightline brand kit: teal, white, rounded sans'), ing('style', 'Warm, friendly, bright')] };
  const legal: ProjectRow = { id: newId(), ws: w1.id, name: 'Free consultation posts', productId: null, createdAt: at(60 * 24 * 4), sequence: [],
    ingredients: [ing('brand', 'Harbor Legal: navy and sand, serif headlines')] };
  const roof: ProjectRow = { id: newId(), ws: w2.id, name: 'Storm season ads', productId: products[3].id, createdAt: at(60 * 24 * 2), sequence: [],
    ingredients: [ing('product', products[3].name, products[3].id)] };

  let n = 0;
  const mk = (ws: string, o: { name: string; mode: GenMode; prompt: string; aspect: Aspect; scene: Scene; product?: ProductRow | null; project?: ProjectRow;
    status?: AssetStatus; motion?: MotionKey; durationS?: number; text?: string; note?: string; hue?: number; minAgo: number }): AssetRow => {
    const p = o.product ?? null;
    const render: RenderSpec = { shape: p?.shape ?? null, hue: p?.hue ?? o.hue ?? 30, scene: o.scene, seed: 7919 * ++n + 13, label: p?.name ?? null, backdrop: 'scene' };
    const edits = o.text ? { ...NO_EDITS, text: { value: o.text, position: 'bottom' as const, style: 'sans' as const } } : NO_EDITS;
    const versions = [{ n: 1, render, src: null, edits: NO_EDITS, note: 'Generated', scale: 1 as const, createdAt: at(o.minAgo), createdBy: maya }];
    if (o.text) versions.push({ n: 2, render, src: null, edits, note: 'Added headline', scale: 1, createdAt: at(o.minAgo - 5), createdBy: maya });
    return {
      id: newId(), ws, kind: o.mode === 'video' ? 'video' : 'image', name: o.name, status: o.status ?? 'draft', source: 'generated', aspect: o.aspect,
      durationS: o.mode === 'video' ? o.durationS ?? 6 : null, projectId: o.project?.id ?? null, productId: p?.id ?? null, versions, current: versions.length - 1,
      generation: { mode: o.mode, prompt: o.prompt, model: MODEL[o.mode], ingredients: o.project?.ingredients ?? [], motion: o.motion ?? null, startFrame: null, endFrame: null,
        credits: costOf(o.mode, 1, o.durationS), sample: true },
      rendering: false, reviewNote: o.status === 'changes_requested' ? o.note ?? null : null, createdBy: maya, createdAt: at(o.minAgo), updatedAt: at(o.minAgo - 5), archivedAt: null,
    };
  };
  const assets: AssetRow[] = [
    mk(w0.id, { name: 'Whitening kit on the podium', mode: 'product', prompt: 'Whitening kit on a pale stone podium, soft studio light', aspect: '4:5', scene: 'podium', product: kit, project: launch, status: 'approved', minAgo: 60 * 24 * 5 }),
    mk(w0.id, { name: 'Whitening kit, bathroom counter', mode: 'product', prompt: 'On a marble bathroom counter by a window, morning light', aspect: '1:1', scene: 'counter', product: kit, project: launch, status: 'approved', minAgo: 60 * 24 * 5 - 30 }),
    mk(w0.id, { name: 'Kit reveal, push in', mode: 'video', prompt: 'Slow push in on the kit, light sweeps across the box', aspect: '9:16', scene: 'studio', product: kit, project: launch, motion: 'push_in', durationS: 6, status: 'review', minAgo: 60 * 24 * 4 }),
    mk(w0.id, { name: 'Kit orbit', mode: 'video', prompt: 'Orbit around the kit on the podium', aspect: '9:16', scene: 'podium', product: kit, project: launch, motion: 'orbit', durationS: 5, status: 'draft', minAgo: 60 * 24 * 4 - 20 }),
    mk(w0.id, { name: 'Whiter in 14 days', mode: 'social', prompt: 'Story card for the launch, product centered', aspect: '9:16', scene: 'studio', product: kit, project: launch, text: 'Whiter in 14 days', status: 'review', minAgo: 60 * 24 * 2 }),
    mk(w0.id, { name: 'Fresh Mint flat lay', mode: 'product', prompt: 'Top-down flat lay with mint leaves', aspect: '4:5', scene: 'flatlay', product: paste, status: 'changes_requested', note: 'Leaves cover the label. Keep the name readable.', minAgo: 60 * 24 * 2 - 40 }),
    mk(w0.id, { name: 'Gum rinse, outdoors', mode: 'product', prompt: 'Rinse bottle outdoors, bright morning sky', aspect: '16:9', scene: 'outdoor', product: rinse, status: 'draft', minAgo: 60 * 26 }),
    mk(w0.id, { name: 'Spring check-up', mode: 'social', prompt: 'Warm, friendly shapes for a spring check-up reminder', aspect: '1:1', scene: 'studio', project: promo, hue: 40, text: 'Spring check-ups are open', status: 'approved', minAgo: 60 * 20 }),
    mk(w0.id, { name: 'Check-up backdrop', mode: 'image', prompt: 'Soft abstract shapes, sunny, calm', aspect: '16:9', scene: 'outdoor', project: promo, hue: 50, status: 'draft', minAgo: 60 * 3 }),
    mk(w1.id, { name: 'Free consultation', mode: 'social', prompt: 'Calm abstract forms in navy and sand', aspect: '1:1', scene: 'studio', project: legal, hue: 220, text: 'Free 20-minute consultation', status: 'approved', minAgo: 60 * 24 * 3 }),
    mk(w2.id, { name: 'Shingle kit on the porch', mode: 'product', prompt: 'Sample kit on a porch step, late afternoon', aspect: '4:5', scene: 'outdoor', product: products[3], project: roof, status: 'draft', minAgo: 60 * 30 }),
  ];
  // The launch's sequence: the reveal, then the orbit.
  const reveal = assets[2], orbit = assets[3];
  launch.sequence = [{ id: newId(), assetId: reveal.id, inS: 0, outS: 6, caption: 'Meet the Brightline kit' }, { id: newId(), assetId: orbit.id, inS: 0, outS: 4, caption: 'Whiter in 14 days' }];
  return { version: MEDIA_VERSION, worldBuiltAt: builtAt(), credits: 600, products, projects: [launch, promo, legal, roof], assets };
}

/** The media store follows the main world: a demo reset (or a rebuilt world) rebuilds it too. */
function load(w: World): Media {
  const b = builtAt();
  if (media && media.worldBuiltAt === b) return media;
  const raw = safeGet(KEY);
  if (raw) {
    try { const m = JSON.parse(raw) as Media; if (m.version === MEDIA_VERSION && m.worldBuiltAt === b) media = m; } catch { /* rebuild */ }
  }
  if (!media || media.worldBuiltAt !== b) { media = seed(w); try { localStorage.setItem(KEY, JSON.stringify(media)); } catch { /* private mode */ } }
  // A tab closed mid-render: the render finished while it was away.
  for (const a of media.assets) a.rendering = false;
  return media;
}

type Tenant = (w: World, s: Scope, action: string) => { m: MemberRow };
type Rw = <T>(fn: (w: World) => T) => Promise<T>;
interface Helpers { tenant: Tenant; read: Rw; write: Rw; audit: (w: World, ws: string | null, actor: string, action: string, entityType: string, entityId: string) => void }

const nf = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
const out = (a: AssetRow): Asset => { const { ws: _ws, archivedAt: _a, ...rest } = a; return structuredClone(rest); };

export function studioDemo({ tenant, read, write, audit }: Helpers): Pick<Client, 'studioCaps' | 'assets' | 'asset' | 'uploadAsset' | 'generate' | 'editAsset' | 'aiEdit'
  | 'restoreVersion' | 'patchAsset' | 'setAssetStatus' | 'archiveAsset' | 'products' | 'projects' | 'createProject' | 'patchProject'> {
  // Writes that touch only the media store still go through `write`, so latency, invalidation and the world's audit log stay the same.
  const mw = <T>(s: Scope, action: string, fn: (m: Media, w: World, who: MemberRow) => T) => write((w) => {
    const { m: who } = tenant(w, s, action);
    const m = load(w);
    const r = fn(m, w, who);
    // Storage full: drop the in-memory change by reloading the last saved state, then say so.
    try { persist(); } catch (e) { media = null; load(w); throw e; }
    return r;
  });
  const mr = <T>(s: Scope, fn: (m: Media, w: World) => T) => read((w) => { tenant(w, s, 'reports_view'); return fn(load(w), w); });
  const find = (m: Media, s: Scope, id: string) => { const a = m.assets.find((x) => x.id === id && x.ws === s.workspaceId && !x.archivedAt); if (!a) throw nf('asset'); return a; };
  const caps = (w: World, m: Media): StudioCaps => ({ imageGeneration: Boolean(w.org.featureFlags.imageGeneration), videoGeneration: Boolean(w.org.featureFlags.videoGeneration), mediaCredits: m.credits, sample: true });
  const charge = (m: Media, cost: number) => {
    if (cost > m.credits) throw new ApiError(402, 'insufficient_credits', `This needs ${cost} media credits and ${m.credits} are left.`);
    m.credits -= cost;
  };
  /** Renders finish a moment later, the way a render job would: the cards show progress, then the picture. */
  const finish = (ids: string[], ms: number) => setTimeout(() => {
    if (!media) return;
    for (const a of media.assets) if (ids.includes(a.id)) { a.rendering = false; a.updatedAt = new Date().toISOString(); }
    try { localStorage.setItem(KEY, JSON.stringify(media)); } catch { /* ignore */ }
    invalidate();
  }, ms);
  const version = (a: AssetRow, who: string, patch: Partial<Asset['versions'][number]>, note: string) => {
    const cur = a.versions[a.current];
    a.versions.push({ ...structuredClone(cur), ...patch, n: a.versions.length + 1, note, createdAt: new Date().toISOString(), createdBy: who });
    a.current = a.versions.length - 1; a.updatedAt = new Date().toISOString();
    // A changed asset needs a fresh look: approval is for the version someone saw.
    if (a.status === 'approved' || a.status === 'review') a.status = 'draft';
  };

  return {
    studioCaps: (s) => mr(s, (m, w) => caps(w, m)),
    assets: (s, q = {}) => mr(s, (m) => {
      const t = q.q?.trim().toLowerCase();
      return m.assets.filter((a) => a.ws === s.workspaceId && !a.archivedAt && (!q.kind || a.kind === q.kind) && (!q.status || a.status === q.status)
        && (!q.projectId || a.projectId === q.projectId) && (!t || `${a.name} ${a.generation?.prompt ?? ''}`.toLowerCase().includes(t)))
        .sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map(out);
    }),
    asset: (s, id) => mr(s, (m) => out(find(m, s, id))),
    uploadAsset: (s, body) => mw(s, 'build', (m, w, who) => {
      const name = body.name.trim().slice(0, 120) || 'Upload';
      if (body.kind === 'image' && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(body.src)) throw new ApiError(400, 'bad_request', 'Images upload as PNG, JPEG, WebP or GIF.');
      const now = new Date().toISOString();
      const a: AssetRow = { id: newId(), ws: s.workspaceId, kind: body.kind, name, status: 'draft', source: 'upload', aspect: body.aspect, durationS: body.durationS ?? null,
        projectId: body.projectId ?? null, productId: null, versions: [{ n: 1, render: null, src: body.src, edits: NO_EDITS, note: 'Uploaded', scale: 1, createdAt: now, createdBy: who.userId }],
        current: 0, generation: null, rendering: false, reviewNote: null, createdBy: who.userId, createdAt: now, updatedAt: now, archivedAt: null };
      m.assets.push(a);
      audit(w, s.workspaceId, who.userId, 'upload', 'asset', a.id);
      return out(a);
    }),
    generate: (s, body) => mw(s, 'build', (m, w, who) => {
      const c = caps(w, m);
      const flag = body.mode === 'video' ? c.videoGeneration : c.imageGeneration;
      if (!flag) throw new ApiError(403, 'feature_disabled', `${body.mode === 'video' ? 'Video' : 'Image'} generation is off for this workspace.`);
      const prompt = body.prompt.trim();
      if (prompt.length < 3) throw new ApiError(400, 'bad_request', 'Describe what to make.');
      const count = body.mode === 'video' ? 1 : Math.min(4, Math.max(1, body.count));
      const durationS = body.mode === 'video' ? Math.min(10, Math.max(3, body.durationS ?? 6)) : undefined;
      charge(m, costOf(body.mode, count, durationS));
      const p = body.productId ? m.products.find((x) => x.id === body.productId && x.ws === s.workspaceId) ?? null : null;
      const start = body.startFrame ? m.assets.find((x) => x.id === body.startFrame && x.ws === s.workspaceId) : null;
      const now = new Date().toISOString();
      const words = prompt.replace(/[^\w\s'-]/g, '').split(/\s+/).slice(0, 6).join(' ');
      const made = Array.from({ length: count }, (_, i): AssetRow => {
        // A start frame carries its composition into the video, as Flow's frames-to-video does.
        const base = start?.versions[start.current].render;
        const render: RenderSpec = base ? { ...base, seed: base.seed } : {
          shape: p?.shape ?? null, hue: p?.hue ?? (prompt.length * 37) % 360, scene: body.scene ?? (body.mode === 'product' ? 'studio' : 'outdoor'),
          seed: Math.floor(Math.random() * 1e6) + i, label: p?.name ?? null, backdrop: 'scene' };
        const edits = body.mode === 'social' && body.caption?.trim() ? { ...NO_EDITS, text: { value: body.caption.trim().slice(0, 140), position: 'bottom' as const, style: 'sans' as const } } : NO_EDITS;
        return {
          id: newId(), ws: s.workspaceId, kind: body.mode === 'video' ? 'video' : 'image', name: `${words.charAt(0).toUpperCase()}${words.slice(1)}${count > 1 ? ` (${i + 1})` : ''}`,
          status: 'draft', source: 'generated', aspect: body.aspect, durationS: durationS ?? null, projectId: body.projectId ?? null, productId: p?.id ?? null,
          versions: [{ n: 1, render, src: null, edits, note: 'Generated', scale: 1, createdAt: now, createdBy: who.userId }], current: 0,
          generation: { mode: body.mode, prompt: prompt.slice(0, 2000), model: MODEL[body.mode], ingredients: body.ingredients ?? [], motion: body.mode === 'video' ? body.motion ?? 'static' : null,
            startFrame: body.startFrame ?? null, endFrame: body.endFrame ?? null, credits: costOf(body.mode, 1, durationS), sample: true },
          rendering: true, reviewNote: null, createdBy: who.userId, createdAt: now, updatedAt: now, archivedAt: null,
        };
      });
      m.assets.push(...made);
      for (const a of made) audit(w, s.workspaceId, who.userId, 'generate', 'asset', a.id);
      finish(made.map((a) => a.id), body.mode === 'video' ? 3200 : 1800);
      return made.map(out);
    }),
    editAsset: (s, id, body) => mw(s, 'build', (m, w, who) => {
      const a = find(m, s, id);
      if (a.rendering) throw new ApiError(409, 'conflict', 'This is still rendering.');
      version(a, who.userId, { edits: structuredClone(body.edits) }, body.note.slice(0, 80) || 'Edited');
      audit(w, s.workspaceId, who.userId, 'edit', 'asset', id);
      return out(a);
    }),
    aiEdit: (s, id, body) => mw(s, 'build', (m, w, who) => {
      if (!caps(w, m).imageGeneration) throw new ApiError(403, 'feature_disabled', 'Generative edits are off for this workspace.');
      const a = find(m, s, id);
      const cur = a.versions[a.current];
      if (a.kind !== 'image' || !cur.render) throw new ApiError(400, 'bad_request', 'In the demo, generative edits work on generated images.');
      charge(m, CREDIT_COST.image);
      const r = { ...cur.render };
      let note = '';
      if (body.op === 'remove_bg') { r.backdrop = 'cutout'; note = 'Background removed'; }
      else if (body.op === 'replace_bg') { r.backdrop = 'scene'; r.scene = body.scene ?? 'studio'; note = `Background: ${r.scene}`; }
      else if (body.op === 'upscale') { note = 'Upscaled 2x'; }
      else { if (!body.aspect || body.aspect === a.aspect) throw new ApiError(400, 'bad_request', 'Pick a different shape to expand to.'); a.aspect = body.aspect; note = `Expanded to ${body.aspect}`; }
      version(a, who.userId, { render: r, scale: body.op === 'upscale' ? 2 : cur.scale, edits: body.op === 'expand' ? { ...cur.edits, crop: null } : cur.edits }, note);
      a.rendering = true;
      finish([a.id], 1400);
      audit(w, s.workspaceId, who.userId, `ai_${body.op}`, 'asset', id);
      return out(a);
    }),
    restoreVersion: (s, id, n) => mw(s, 'build', (m, w, who) => {
      const a = find(m, s, id);
      const v = a.versions.find((x) => x.n === n);
      if (!v) throw nf('version');
      version(a, who.userId, structuredClone({ render: v.render, src: v.src, edits: v.edits, scale: v.scale }), `Restored v${n}`);
      audit(w, s.workspaceId, who.userId, 'restore', 'asset', id);
      return out(a);
    }),
    patchAsset: (s, id, patch) => mw(s, 'build', (m, w, who) => {
      const a = find(m, s, id);
      if (patch.name !== undefined) { const nm = patch.name.trim().slice(0, 120); if (!nm) throw new ApiError(400, 'bad_request', 'Give it a name.'); a.name = nm; }
      if (patch.projectId !== undefined) {
        if (patch.projectId && !m.projects.some((p) => p.id === patch.projectId && p.ws === s.workspaceId)) throw nf('project');
        a.projectId = patch.projectId;
      }
      a.updatedAt = new Date().toISOString();
      audit(w, s.workspaceId, who.userId, 'update', 'asset', id);
      return out(a);
    }),
    setAssetStatus: (s, id, status, note) => {
      // Submitting for review is part of building; approving or sending back is the approve action.
      const action = status === 'approved' || status === 'changes_requested' ? 'approve' : 'build';
      return mw(s, action, (m, w, who) => {
        const a = find(m, s, id);
        if (a.rendering) throw new ApiError(409, 'conflict', 'This is still rendering.');
        if ((status === 'approved' || status === 'changes_requested') && a.status !== 'review') throw new ApiError(409, 'conflict', 'Only an asset in review can be approved or sent back.');
        if (status === 'changes_requested' && !note?.trim()) throw new ApiError(400, 'bad_request', 'Say what to change.');
        a.status = status; a.reviewNote = status === 'changes_requested' ? note!.trim().slice(0, 500) : status === 'review' ? null : a.reviewNote;
        a.updatedAt = new Date().toISOString();
        audit(w, s.workspaceId, who.userId, status === 'review' ? 'submit' : status, 'asset', id);
        return out(a);
      });
    },
    archiveAsset: (s, id) => mw(s, 'build', (m, w, who) => {
      const a = find(m, s, id);
      a.archivedAt = new Date().toISOString();
      for (const p of m.projects) p.sequence = p.sequence.filter((c) => c.assetId !== id);
      audit(w, s.workspaceId, who.userId, 'archive', 'asset', id);
    }),
    products: (s) => mr(s, (m) => m.products.filter((p) => p.ws === s.workspaceId).map(({ ws: _ws, ...p }) => p)),
    projects: (s) => mr(s, (m) => m.projects.filter((p) => p.ws === s.workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ ws: _ws, ...p }) => ({ ...structuredClone(p), assetCount: m.assets.filter((a) => a.projectId === p.id && !a.archivedAt).length }))),
    createProject: (s, body) => mw(s, 'build', (m, w, who) => {
      const name = body.name.trim().slice(0, 80);
      if (!name) throw new ApiError(400, 'bad_request', 'Give the project a name.');
      const prod = body.productId ? m.products.find((p) => p.id === body.productId && p.ws === s.workspaceId) : null;
      if (body.productId && !prod) throw nf('product');
      const p: ProjectRow = { id: newId(), ws: s.workspaceId, name, productId: prod?.id ?? null, createdAt: new Date().toISOString(), sequence: [],
        ingredients: prod ? [{ id: newId(), kind: 'product', label: prod.name, assetId: null, productId: prod.id }] : [] };
      m.projects.push(p);
      audit(w, s.workspaceId, who.userId, 'create', 'project', p.id);
      const { ws: _ws, ...rest } = p;
      return { ...structuredClone(rest), assetCount: 0 };
    }),
    patchProject: (s, id, patch) => mw(s, 'build', (m, w, who) => {
      const p = m.projects.find((x) => x.id === id && x.ws === s.workspaceId);
      if (!p) throw nf('project');
      if (patch.name !== undefined) { const nm = patch.name.trim().slice(0, 80); if (!nm) throw new ApiError(400, 'bad_request', 'Give the project a name.'); p.name = nm; }
      if (patch.ingredients) p.ingredients = patch.ingredients.slice(0, 12).map((i) => ({ ...i, label: i.label.trim().slice(0, 120) })).filter((i) => i.label);
      if (patch.sequence) {
        const clips = patch.sequence.slice(0, 20);
        for (const c of clips) {
          const a = m.assets.find((x) => x.id === c.assetId && x.ws === s.workspaceId && !x.archivedAt);
          if (!a || a.kind !== 'video') throw new ApiError(400, 'bad_request', 'A sequence holds this workspace\'s videos only.');
          const len = a.durationS ?? 0;
          if (!(c.inS >= 0 && c.outS <= len && c.outS - c.inS >= 0.5)) throw new ApiError(400, 'bad_request', 'Each clip needs at least half a second inside the video.');
        }
        p.sequence = clips.map((c) => ({ ...c, caption: c.caption.slice(0, 140) }));
      }
      audit(w, s.workspaceId, who.userId, 'update', 'project', id);
      const { ws: _ws, ...rest } = p;
      return { ...structuredClone(rest), assetCount: m.assets.filter((a) => a.projectId === p.id && !a.archivedAt).length };
    }),
  };
}

/** Sizes of the Studio datasets for Setup → Data: products, brand kits (project ingredients) and the media library. */
export function mediaCounts(w: World, ws: string) {
  const m = load(w);
  const latest = (xs: string[]) => xs.sort().at(-1) ?? null;
  const assets = m.assets.filter((a) => a.ws === ws && !a.archivedAt);
  const brand = m.projects.filter((p) => p.ws === ws).flatMap((p) => p.ingredients.filter((i) => i.kind !== 'product').map(() => p.createdAt));
  return {
    products: { count: m.products.filter((p) => p.ws === ws).length, updatedAt: null as string | null },
    brand: { count: brand.length, updatedAt: latest(brand) },
    media: { count: assets.length, updatedAt: latest(assets.map((a) => a.updatedAt)) },
  };
}
