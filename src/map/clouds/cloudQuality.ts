import { FADE_FROM, FADE_TO } from "./constants";
import type { CloudQuality } from "./settings";

// Pure decisions of the cloud layer (PLAN-clouds.md sections 5 and 7): presets, target size, zoom fade and the
// "must the ray-march run again" rule. No three.js, so the main chunk and the tests can import it.

export interface CloudPreset {
  scale: number; // render target size relative to the drawing buffer
  steps: number; // max ray-march steps
  lightSteps: number; // steps of the march toward the sun
  detail: boolean; // erosion by the detail noise
}

export const PRESETS: Record<CloudQuality, CloudPreset> = {
  low: { scale: 0.35, steps: 24, lightSteps: 3, detail: false },
  medium: { scale: 0.5, steps: 48, lightSteps: 5, detail: true },
  high: { scale: 0.75, steps: 80, lightSteps: 6, detail: true },
};

// RGBA16F targets need EXT_color_buffer_float; without it the "high" preset (which relies on HDR accumulation) steps down.
export const effectiveQuality = (q: CloudQuality, floatTargets: boolean): CloudQuality => (q === "high" && !floatTargets ? "medium" : q);

export function targetSize(width: number, height: number, scale: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// 1 far out on the globe, 0 once the map is close enough to see the town.
export const cloudOpacity = (zoom: number): number => 1 - smoothstep(FADE_FROM, FADE_TO, zoom);

// Below this opacity nothing is marched or composited.
export const MIN_OPACITY = 0.004;

export const MARCH_CLOCK_MIN = 5; // game minutes the clock may move before the cached march is stale
export const FLASH_FRAME_MS = 33; // while lightning flashes the march runs at most every 33 ms (30 fps)

// What a march was made for. Two equal keys give the same picture.
export interface MarchKey {
  matrix: ArrayLike<number>; // main matrix of the view
  width: number; // target size
  height: number;
  clock: number; // game minutes
  fade: number; // zoom fade at the time of the march (the density dissolve depends on it)
  version: number; // weather textures version (uploads)
  quality: CloudQuality;
  generation: number; // GL context generation
  flash: boolean; // a lightning flash was part of the picture
}

export interface MadeMarch extends MarchKey {
  at: number; // performance.now() of the march
}

const sameMatrix = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
};

// True when the last render target cannot be reused: the view, size, quality, zoom fade, uploads or context changed,
// the clock moved more than MARCH_CLOCK_MIN game minutes, or a lightning flash is (or just stopped being) part of the picture.
export function needsMarch(prev: MadeMarch | null, next: MarchKey, flashActive: boolean, nowMs: number): boolean {
  if (!prev) return true;
  if (prev.width !== next.width || prev.height !== next.height || prev.quality !== next.quality) return true;
  if (prev.version !== next.version || prev.generation !== next.generation) return true;
  if (prev.fade !== next.fade) return true;
  if (!sameMatrix(prev.matrix, next.matrix)) return true;
  if (Math.abs(next.clock - prev.clock) > MARCH_CLOCK_MIN) return true;
  if (flashActive) return nowMs - prev.at >= FLASH_FRAME_MS;
  return prev.flash; // one more march to wipe the last flash out of the picture
}
