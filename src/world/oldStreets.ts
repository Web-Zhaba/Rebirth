import type { Street, XY } from "./oldworld";

// A street as the snap sees it: id and class say which old street a road end sits on.
type SnapStreet = Pick<Street, "pts" | "name" | "bridge"> & Partial<Pick<Street, "id" | "cls">>;

export interface OldSnap {
  x: number;
  y: number;
  name?: string;
  id?: string;
  cls?: string;
  bridge?: true;
  vertex: boolean;
}

// Snap a point to the revealed old streets: the nearest polyline vertex within `tol` first, otherwise the
// nearest point on a segment within `tol`; null when no street is that close. Pure.
export function snapToOldStreets(p: { x: number; y: number }, streets: readonly SnapStreet[], tol: number): OldSnap | null {
  let best: OldSnap | null = null;
  let bd = tol;
  for (const s of streets) {
    const tag = tagOf(s);
    for (const [x, y] of s.pts) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bd) {
        bd = d;
        best = { x, y, vertex: true, ...tag };
      }
    }
  }
  if (best) return best;
  bd = tol;
  for (const s of streets) {
    const tag = tagOf(s);
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
        best = { x, y, vertex: false, ...tag };
      }
    }
  }
  return best;
}

const tagOf = (s: SnapStreet): Pick<OldSnap, "name" | "id" | "cls" | "bridge"> => ({
  ...(s.name ? { name: s.name } : {}),
  ...(s.id !== undefined ? { id: s.id } : {}),
  ...(s.cls !== undefined ? { cls: s.cls } : {}),
  ...(s.bridge ? { bridge: true as const } : {}),
});

// The revealed polylines of the old street called `name` (one street can be several ways), with their class. Pure.
export function streetPolylines(streets: readonly Pick<Street, "pts" | "name" | "cls">[], name: string): { pts: XY[]; cls: string }[] {
  return streets.filter((s) => s.name === name && s.pts.length >= 2).map((s) => ({ pts: s.pts, cls: s.cls }));
}

const ptKey = (p: XY): string => `${p[0]},${p[1]}`;

// The ends of every old street: where ways meet, so a restored street has to keep these vertices. Pure.
export function streetJunctions(streets: readonly Pick<Street, "pts">[]): Set<string> {
  const out = new Set<string>();
  for (const s of streets) {
    if (s.pts.length === 0) continue;
    out.add(ptKey(s.pts[0]));
    out.add(ptKey(s.pts[s.pts.length - 1]));
  }
  return out;
}

// An old street as a road can follow it. A surveyed line is denser than the road graph accepts, so every
// segment is made at least `minSeg` long: plain vertices too close are dropped, while the ends and the `keep`
// junctions stay (of two pins too close the later goes, but the end only gives way to nothing but the start).
// Null when the whole line is shorter than one segment. Pure.
export function roadLine(pts: readonly XY[], minSeg: number, keep: ReadonlySet<string>): XY[] | null {
  const out: XY[] = [];
  const fixed: boolean[] = [];
  const far = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]) >= minSeg;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const end = i === pts.length - 1;
    const pin = i === 0 || end || keep.has(ptKey(p));
    let skip = false;
    while (out.length > 0 && !far(out[out.length - 1], p)) {
      if (!pin || (fixed[fixed.length - 1] && !(end && out.length > 1))) {
        skip = true;
        break;
      }
      out.pop();
      fixed.pop();
    }
    if (skip) continue;
    out.push(p);
    fixed.push(pin);
  }
  return out.length >= 2 ? out : null;
}
