// Wheel zoom amounts. Zoom is expressed in octaves of distance (one octave = distance halved) so the numbers read like
// MapLibre's zoom levels.

const WHEEL_RATE = 1 / 450; // MapLibre's defaultZoomRate
const PINCH_RATE = 1 / 100; // MapLibre's wheelZoomRate for ctrl+wheel (trackpad pinch)
const MAX_PER_EVENT = 1;

export interface WheelZoomInput {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}

// Octaves to zoom IN for one wheel event (negative = out). MapLibre squashes the delta with a logistic curve so a
// single event never zooms more than a doubling; a mouse notch (large pixel delta or line mode) moves ~0.4 octave.
export function wheelZoomOctaves(e: WheelZoomInput): number {
  let dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
  if (dy === 0) return 0;
  const pinch = e.ctrlKey;
  const rate = pinch ? PINCH_RATE : WHEEL_RATE;
  if (!pinch && Math.abs(dy) >= 50) dy *= 2; // discrete mouse notch
  const x = Math.abs(dy) * rate;
  const scale = 2 / (1 + Math.exp(-x)); // 1..2
  const oct = Math.min(MAX_PER_EVENT, Math.log2(scale));
  return dy < 0 ? oct : -oct;
}

// Smoothing: each frame applies the share of the pending zoom that a ~150 ms ease would cover. Returns the part to
// apply now.
export function wheelSmoothStep(pending: number, dtMs: number, tauMs = 50): number {
  const f = 1 - Math.exp(-dtMs / tauMs);
  const part = pending * f;
  return Math.abs(pending - part) < 0.002 ? pending : part;
}
