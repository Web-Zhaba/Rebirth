import { MIN_SEGMENT } from "../sim/roads";

export type Pt = [number, number];

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// Target spacing of resampled curve points, metres.
const CURVE_STEP = 10;
// Cap for one arc: the worker rejects roads with more points, and longer arcs are rare.
const MAX_PIECES = 400;
const ANGLE_STEP = 15;

// Drops consecutive duplicates (and points closer than eps).
export function dedupePath(pts: readonly Pt[], eps = 0.01): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (out.length === 0 || dist(out[out.length - 1], p) >= eps) out.push([p[0], p[1]]);
  return out;
}

// Even arc-length resampling. Keeps both ends and never makes a piece shorter than MIN_SEGMENT,
// so the road graph accepts every piece.
export function resamplePath(pts: readonly Pt[], target = CURVE_STEP): Pt[] {
  const clean = dedupePath(pts);
  if (clean.length < 2) return clean;
  const cum = [0];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + dist(clean[i - 1], clean[i]));
  const total = cum[cum.length - 1];
  if (total < 1e-6) return [clean[0]];
  let pieces = Math.max(1, Math.min(MAX_PIECES, Math.round(total / target)));
  while (pieces > 1 && total / pieces < MIN_SEGMENT) pieces--;
  const step = total / pieces;
  const out: Pt[] = [clean[0]];
  let seg = 1;
  for (let i = 1; i < pieces; i++) {
    const d = i * step;
    while (seg < cum.length - 1 && cum[seg] < d) seg++;
    const a = clean[seg - 1];
    const b = clean[seg];
    const span = cum[seg] - cum[seg - 1];
    const t = span < 1e-9 ? 0 : (d - cum[seg - 1]) / span;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(clean[clean.length - 1]);
  return out;
}

const wrap = (v: number): number => {
  let x = v;
  while (x <= -Math.PI) x += 2 * Math.PI;
  while (x > Math.PI) x -= 2 * Math.PI;
  return x;
};

// Circular arc from `a` to `b` through the point `c` (the cursor while bending), resampled to valid road pieces.
// Nearly collinear points give a straight line.
export function arcPath(a: Pt, c: Pt, b: Pt, target = CURVE_STEP): Pt[] {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-6) return resamplePath([a, b], target);
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  const r = Math.hypot(a[0] - ux, a[1] - uy);
  if (!Number.isFinite(r) || r < 1e-6) return resamplePath([a, b], target);
  const ang = (p: Pt) => Math.atan2(p[1] - uy, p[0] - ux);
  const aA = ang(a);
  const dAB = wrap(ang(b) - aA);
  const dAC = wrap(ang(c) - aA);
  if (Math.abs(dAB) < 1e-9) return resamplePath([a, b], target);
  // Take the sweep that passes through C: the short way when C lies between A and B, the long way otherwise.
  const sweep = Math.sign(dAB) === Math.sign(dAC) && Math.abs(dAC) <= Math.abs(dAB) ? dAB : dAB - Math.sign(dAB) * 2 * Math.PI;
  const arcLen = Math.abs(sweep) * r;
  if (arcLen < 1e-6) return resamplePath([a, b], target);
  let pieces = Math.max(1, Math.min(MAX_PIECES, Math.round(arcLen / target)));
  while (pieces > 1 && arcLen / pieces < MIN_SEGMENT) pieces--;
  const out: Pt[] = [];
  for (let i = 0; i <= pieces; i++) {
    const t = aA + sweep * (i / pieces);
    out.push([ux + r * Math.cos(t), uy + r * Math.sin(t)]);
  }
  out[0] = [a[0], a[1]];
  out[out.length - 1] = [b[0], b[1]];
  return out;
}

// Nearest point on a ray from `a` whose direction is a multiple of `stepDeg`; also that direction in degrees.
export function snapAngle(a: Pt, b: Pt, stepDeg = ANGLE_STEP): { x: number; y: number; deg: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (Math.hypot(dx, dy) < 1e-9) return { x: b[0], y: b[1], deg: 0 };
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const along = Math.max(0, dx * Math.cos(angle) + dy * Math.sin(angle));
  const deg = ((Math.round((angle * 180) / Math.PI) % 360) + 360) % 360;
  return { x: a[0] + Math.cos(angle) * along, y: a[1] + Math.sin(angle) * along, deg };
}
