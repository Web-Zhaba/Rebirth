import type { CloudQuality } from "./settings";

// Numbers the cloud volume and the ground shadows must agree on (PLAN-clouds.md sections 4-6).

// Weather cube face size per quality; both layers must ask for the same size or they refill each other's cubes.
export const CUBE_SIZE: Record<CloudQuality, number> = { low: 128, medium: 192, high: 192 };

// Real cloud layer, metres above sea level; the globe view stretches it by GLOBE_EXAGGERATION so the volume reads.
export const CLOUD_BASE_M = 2000; // real 2 km; x4 on the globe leaves 8 km under the cloud for precipitation shafts
export const CLOUD_TOP_M = 12000;
export const GLOBE_EXAGGERATION = 4;

// The volume is fully drawn below FADE_FROM and gone from FADE_TO up; the ground shadows take over from there.
// The band is deliberately wide: over 2.5 zoom levels the deck thins out instead of switching off.
export const FADE_FROM = 4;
export const FADE_TO = 6.5;

// Time constant of the fade easing, ms: a wheel tick or a fly-to changes the zoom at once, the clouds follow smoothly.
export const FADE_TAU_MS = 260;

// Upper bounds of the ray-march loops (the presets choose within them).
export const MAX_MARCH_STEPS = 80;
export const MAX_LIGHT_STEPS = 6;

export const REBUILD_MIN = 30; // game minutes between two weather cubes

// Interval of game minute t and how far through it we are (0..1).
export function interval(t: number): { k: number; f: number } {
  const k = Math.floor(t / REBUILD_MIN);
  return { k, f: t / REBUILD_MIN - k };
}
