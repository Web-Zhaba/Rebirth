import { BUILDINGS } from "./buildings";
import { isHeritage, restoreCost, restoredHeight, workTemplate } from "./heritage";
import { distToEdge } from "./roads";
import { lockReason } from "./tech";
import type { Building, FoundFoundation, Finds, RestoreMode, RoadGraph, SimState } from "./types";
import { CELL_SIZE, pointInPolygon } from "./zones";

// Geometry and checks of restoring an old building (PLAN-research.ru.md section 7). Pure; shared by the worker
// (which enforces them) and the heritage panel (which shows the reasons).

type Pt = [number, number];

export const RESTORE = { roadReach: 30, maxPoints: 64 }; // m from the ring to a road; points of a restored footprint

export const ringArea = (r: readonly Pt[]): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};

// Open ring (no repeated closing point), counter-clockwise, at most `max` points: the vertex whose corner adds the
// least area goes first.
export function simplifyRing(ring: readonly Pt[], max = RESTORE.maxPoints): Pt[] {
  let p: Pt[] = ring.map((q): Pt => [q[0], q[1]]);
  if (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p = p.slice(0, -1);
  if (ringArea(p) < 0) p.reverse();
  const tri = (a: Pt, b: Pt, c: Pt) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (p.length > Math.max(3, max)) {
    let k = 0;
    let best = Infinity;
    for (let i = 0; i < p.length; i++) {
      const t = tri(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length]);
      if (t < best) {
        best = t;
        k = i;
      }
    }
    p.splice(k, 1);
  }
  return p;
}

// Smallest oriented bounding box of a ring over the directions of its edges: centre, direction of the long side
// `angle` (radians), `w` along it and `d` across it, metres.
export function orientedBox(ring: readonly Pt[]): { cx: number; cy: number; angle: number; w: number; d: number } {
  let best = { cx: 0, cy: 0, angle: 0, w: 0, d: 0 };
  let bestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, y] of ring) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area >= bestArea) continue;
    bestArea = area;
    const mu = (u0 + u1) / 2;
    const mv = (v0 + v1) / 2;
    best = { cx: mu * ux - mv * uy, cy: mu * uy + mv * ux, angle: Math.atan2(uy, ux), w: u1 - u0, d: v1 - v0 };
  }
  return best;
}

const bbox = (r: readonly Pt[]): [number, number, number, number] => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of r) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

function segCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

// Do two polygons share any ground: a corner of one inside the other, or crossing sides.
export function polysOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  const [a0, b0, a1, b1] = bbox(a);
  const [c0, d0, c1, d1] = bbox(b);
  if (a1 < c0 || c1 < a0 || b1 < d0 || d1 < b0) return false;
  if (a.some(([x, y]) => pointInPolygon(x, y, b as Pt[])) || b.some(([x, y]) => pointInPolygon(x, y, a as Pt[]))) return true;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  return false;
}

// The point of the ring nearest to a road, and its distance; null when there is no road at all.
export function ringDoor(ring: readonly Pt[], roads: RoadGraph): { door: Pt; dist: number } | null {
  const edges = Object.values(roads.edges);
  if (edges.length === 0) return null;
  let best: { door: Pt; dist: number } | null = null;
  const probe = (x: number, y: number) => {
    for (const e of edges) {
      const d = distToEdge(roads, e, x, y);
      if (!best || d < best.dist) best = { door: [x, y], dist: d };
    }
  };
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
    for (let k = 0; k < n; k++) probe(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
  }
  return best;
}

// Typed foundations that still block building (everything but those lost).
export const standing = (finds: Pick<Finds, "foundations">): FoundFoundation[] => finds.foundations.filter((f) => isHeritage(f) && f.state !== "lost");

// Does a polygon lie on an old typed foundation that has not been lost? (Placing and growing refuse such ground.)
export function overlapsHeritage(old: readonly FoundFoundation[], poly: readonly Pt[]): boolean {
  for (const f of old) if (polysOverlap(poly, f.ring)) return true;
  return false;
}

// The square a zone cell covers.
export function cellSquare(c: { cx: number; cy: number; angle: number }): Pt[] {
  const h = CELL_SIZE / 2;
  const ux = Math.cos(c.angle);
  const uy = Math.sin(c.angle);
  return ([[-h, -h], [h, -h], [h, h], [-h, h]] as Pt[]).map(([u, v]): Pt => [c.cx + ux * u - uy * v, c.cy + uy * u + ux * v]);
}

export const HERITAGE_TAKEN = "Здесь старая постройка: восстановите её или стройте рядом";

// Russian reason a site cannot be ordered in this mode now, or null. `mode` absent: only the checks of any mode.
export function restoreBlocker(s: Pick<SimState, "finds" | "buildings" | "roads" | "progress">, siteId: string, mode?: RestoreMode): string | null {
  const f = s.finds.foundations.find((x) => x.id === siteId);
  if (!f || !isHeritage(f)) return "Это не значимая постройка";
  if (f.state === "restoring") return "Уже восстанавливается";
  if (f.state === "restored") return "Уже восстановлена";
  if (f.state === "lost") return "Постройка утрачена, восстановить нельзя";
  if (mode === "working") {
    const tpl = workTemplate(f.cls);
    if (!tpl) return "Эту постройку можно только сохранить как памятник";
    const t = BUILDINGS[tpl];
    const locked = lockReason(s, t.zone === "placed" ? tpl : t.zone);
    if (locked) return `Назначение закрыто: ${locked.toLowerCase()}`;
  }
  const ring = simplifyRing(f.ring);
  for (const b of Object.values(s.buildings)) if (polysOverlap(ring, b.footprint)) return "Место занято зданием";
  const door = ringDoor(ring, s.roads);
  if (!door || door.dist > RESTORE.roadReach) return "Нужна дорога";
  return null;
}

// The planned building of a restoration; `id` and `now` are the caller's.
export function restoredBuilding(f: FoundFoundation, mode: RestoreMode, roads: RoadGraph, id: number, now: number): Building | null {
  const ring = simplifyRing(f.ring);
  const door = ringDoor(ring, roads);
  if (!door) return null;
  const tpl = BUILDINGS[mode === "working" ? (workTemplate(f.cls) ?? "restored") : "restored"];
  const box = orientedBox(ring);
  const cost = restoreCost(f.area);
  return {
    id,
    template: tpl.id,
    zone: tpl.zone,
    lot: { cx: box.cx, cy: box.cy, angle: box.angle, w: box.w / CELL_SIZE, d: box.d / CELL_SIZE },
    side: 1,
    footprint: ring,
    height: restoredHeight(f.height, tpl.height),
    state: "planned",
    labor: cost.labor,
    done: 0,
    created: now,
    paid: false,
    level: 1,
    streak: 0,
    siteId: f.id,
    restoreMode: mode,
    door: [Math.round(door.door[0] * 100) / 100, Math.round(door.door[1] * 100) / 100],
    materials: { logs: cost.logs, planks: cost.planks, stone: cost.stone },
  };
}

