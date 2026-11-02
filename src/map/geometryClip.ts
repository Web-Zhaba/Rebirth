import type { XY } from "./modelGeometry";

export type Box = [number, number, number, number]; // x0, y0, x1, y1

// Keeps the part of a convex polygon where nx * x + ny * y <= c.
function clipHalf(poly: XY[], nx: number, ny: number, c: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// Clips a convex polygon to an axis-aligned box. Shared by field-cell mesh generation.
export function clipBox(poly: XY[], [x0, y0, x1, y1]: Box): XY[] {
  let p = clipHalf(poly, -1, 0, -x0);
  if (p.length >= 3) p = clipHalf(p, 1, 0, x1);
  if (p.length >= 3) p = clipHalf(p, 0, -1, -y0);
  if (p.length >= 3) p = clipHalf(p, 0, 1, y1);
  return p.length >= 3 ? p : [];
}
