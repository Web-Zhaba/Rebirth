import type { CloudQuality } from "./settings";

// Numbers the cloud volume and the ground shadows must agree on (PLAN-clouds.md sections 4-6). No three.js here.

// Weather cube face size per quality; both layers must ask for the same size or they refill each other's cubes.
export const CUBE_SIZE: Record<CloudQuality, number> = { low: 128, medium: 192, high: 192 };

// Real cloud layer, metres above sea level; the globe view stretches it by GLOBE_EXAGGERATION so the volume reads.
export const CLOUD_BASE_M = 2000; // real 2 km; x4 on the globe leaves 8 km under the cloud for precipitation shafts
export const CLOUD_TOP_M = 12000;
export const GLOBE_EXAGGERATION = 4;

// The volume is fully drawn below FADE_FROM and gone from FADE_TO up; the ground shadows take over from there.
export const FADE_FROM = 5;
export const FADE_TO = 6.5;

// MapLibre switches custom layers from the globe matrix to the mercator one at this zoom (measured by the spike).
export const MERCATOR_ZOOM = 12;
