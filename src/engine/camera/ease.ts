// Easing curves for camera animations.

// CSS cubic-bezier(x1, y1, x2, y2) as a function of time 0..1 (MapLibre's flyTo default is (0.25, 0.1, 0.25, 1)).
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - t;
      if (Math.abs(e) < 1e-7) return ((ay * u + by) * u + cy) * u;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < 40; i++) {
      const e = sx(u);
      if (Math.abs(e - t) < 1e-7) break;
      if (t > e) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return ((ay * u + by) * u + cy) * u;
  };
}

export const easeFly = bezier(0.25, 0.1, 0.25, 1);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
