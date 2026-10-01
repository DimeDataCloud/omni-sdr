// Studio constants the demo store shares with the screens. Kept apart from lib/media.ts so the drawing code
// loads with the Studio route, not with the app.
import type { Edits, GenMode } from '@/lib/api/types';

/** Media credits per output, shown before generating; the server charges. Demo estimates until Station 22 sets prices [VERIFY Vertex Imagen/Veo pricing]. */
export const CREDIT_COST: Record<GenMode, number> = { image: 4, product: 6, social: 5, video: 6 }; // video: per second
export const costOf = (mode: GenMode, count: number, durationS = 6) => (mode === 'video' ? CREDIT_COST.video * durationS : CREDIT_COST[mode] * count);

export const NO_EDITS: Edits = { crop: null, rotate: 0, flipH: false, brightness: 100, contrast: 100, saturation: 100, text: null, trim: null, captions: null };
