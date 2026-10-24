import type { Street, XY } from "./oldworld";

export interface OldSnap {
  x: number;
  y: number;
  name?: string;
  vertex: boolean;
}

// Snap a point to the revealed old streets: the nearest polyline vertex within `tol` first, otherwise the
// nearest point on a segment within `tol`; null when no street is that close. Pure.
export function snapToOldStreets(p: { x: number; y: number }, streets: readonly Pick<Street, "pts" | "name">[], tol: number): OldSnap | null {
  let best: OldSnap | null = null;
  let bd = tol;
  for (const s of streets) {
    for (const [x, y] of s.pts) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bd) {
        bd = d;
        best = { x, y, vertex: true, ...(s.name ? { name: s.name } : {}) };
      }
    }
  }
  if (best) return best;
  bd = tol;
  for (const s of streets) {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const [ax, ay] = s.pts[i] as XY;
      const [bx, by] = s.pts[i + 1] as XY;
      const dx = bx - ax;
      const dy = by - ay;
      const L = dx * dx + dy * dy;
      const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / L));
      const x = ax + t * dx;
      const y = ay + t * dy;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bd) {
        bd = d;
        best = { x, y, vertex: false, ...(s.name ? { name: s.name } : {}) };
      }
    }
  }
  return best;
}
