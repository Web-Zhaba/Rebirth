import { band, cornerPosts, cylinder, DOOR, Mesh, offsetRing, PATTERN, planeRoof, pointInRing, prism, revolve, rgb, ROOF_FAC, roofOf, roofSurface, shade, shiftRoof, signedArea, square, triangulate, type Model, type RGB, type Roof, type RoofShape, type Tri, type XY } from "./modelGeometry";
import { TOWN_COLORS } from "../ui/palette";

// The shared kit of the town's building models (src/buildings/<id>/model.ts): the context a model draws in, walls,
// roofs, chimneys and porches, the lot split into a building and a yard towards the street, and the yard things.
// Everything is in the lot's box frame (map/modelGeometry.ts framed): u along the lot, v across it.

export interface TownOptions {
  seed?: number; // default: from the ring
  level?: number; // 2: a rebuilt house, a floor higher
  front?: XY | null; // unit vector towards the street in town metres: the door goes on the wall facing it
  tint?: string | null; // overlay colour ("#rrggbb"): walls take it, the roof leans to it
  upgrading?: boolean; // a rebuild in progress: posts stand around the house
}

export type Pal = readonly string[];

// Everything a builder below needs about one building.
export interface Ctx {
  mesh: Mesh;
  uv: XY[];
  tris: Tri[];
  hl: number;
  hw: number;
  cu: number; // centre of the building's box in the lot's box frame (a building on part of the lot: not 0)
  cv: number;
  front: XY | null; // towards the street, in the box frame
  r: () => number;
  door: number; // index of the front edge, -1 when none faces the street
  height: number;
  opts: TownOptions;
  tint: RGB | null;
}

export const pick = (c: Ctx, list: Pal): RGB => rgb(list[Math.min(list.length - 1, Math.floor(c.r() * list.length))]);

export const range = (c: Ctx, a: number, b: number) => a + (b - a) * c.r();

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const inside = (c: Ctx, u: number, v: number) => pointInRing(u, v, c.uv);

export const ccw = (p: XY[]): XY[] => (signedArea(p) < 0 ? p.reverse() : p);

export const rect = (u0: number, v0: number, u1: number, v1: number): XY[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

// Midpoint, unit tangent, outward normal and length of edge i of a counter-clockwise ring.
export function edgeFrame(uv: readonly XY[], i: number): { m: XY; t: XY; n: XY; len: number } {
  const a = uv[i], b = uv[(i + 1) % uv.length];
  const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv) || 1;
  return { m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], t: [du / len, dv / len], n: [dv / len, -du / len], len };
}

// The edge whose outside faces the street best (and is long enough for a door); -1 when none really does.
export function frontEdge(uv: readonly XY[], front: XY | null): number {
  if (!front) return -1;
  let best = -1, score = 0;
  for (let i = 0; i < uv.length; i++) {
    const e = edgeFrame(uv, i);
    const d = e.n[0] * front[0] + e.n[1] * front[1];
    const s = d * Math.min(e.len, 6);
    if (d > 0.5 && e.len >= 1.6 && s > score) (score = s), (best = i);
  }
  return best;
}

// A box standing out of edge i: s along the edge from its middle, o outwards from the wall (negative: inside).
export function edgeBox(uv: readonly XY[], i: number, s0: number, s1: number, o0: number, o1: number): XY[] {
  const e = edgeFrame(uv, i);
  const at = (s: number, o: number): XY => [e.m[0] + e.t[0] * s + e.n[0] * o, e.m[1] + e.t[1] * s + e.n[1] * o];
  return ccw([at(s0, o0), at(s1, o0), at(s1, o1), at(s0, o1)]);
}

export interface Body {
  eaves: number;
  roof: RoofShape;
  rise: number;
  overhang: number;
  wall: RGB;
  roofC: RGB;
  pat: number; // wall pattern
  doorPat: number; // pattern of the front wall (pat + DOOR or GATE), = pat for none
  plinth: boolean;
}

// Walls, plinth and roof (with its overhang and fascia) of a closed building, a step at its door; returns the roof.
export function body(c: Ctx, b: Body): Roof {
  const { mesh, uv } = c;
  const wall = c.tint ?? b.wall, roofC = c.tint ? mix(b.roofC, c.tint, 0.45) : b.roofC;
  const roof = shiftRoof(roofOf(b.roof, c.hl, c.hw, b.rise), c.cu, c.cv);
  band(mesh, uv, b.eaves, roof, 0, null, wall, b.pat, b.eaves, c.door, b.doorPat);
  const plinth = b.plinth ? offsetRing(uv, 0.08) : null;
  if (plinth) band(mesh, plinth, 0, planeRoof([]), 0.4, null, shade(wall, 0.75), PATTERN.plain, 0);
  if (c.door >= 0 && b.doorPat === b.pat + DOOR && edgeFrame(uv, c.door).len >= 2) prism(mesh, edgeBox(uv, c.door, -0.65, 0.65, 0, 0.42), 0, 0.16, shade(wall, 0.7), shade(wall, 0.85));
  eavesRoof(c, roof, b.eaves, b.overhang, roofC);
  return roof;
}

// Roof surface over the ring pushed out by `overhang` (the ring itself when that fails), with a fascia along the edge.
export function eavesRoof(c: Ctx, roof: Roof, eaves: number, overhang: number, col: RGB): void {
  const ring = overhang > 0 ? offsetRing(c.uv, overhang) : null;
  const tris = ring ? triangulate(ring) : null;
  if (ring && tris) {
    roofSurface(c.mesh, tris, eaves, roof, col, ROOF_FAC);
    band(c.mesh, ring, eaves, roof, 0, -0.16, shade(col, 0.7), PATTERN.plain, 0);
  } else roofSurface(c.mesh, c.tris, eaves, roof, col, ROOF_FAC);
}

export function chimney(c: Ctx, roof: Roof, eaves: number, top: number, cu: number, cv: number, side: number, col: RGB): void {
  const sq = square(cu, cv, side);
  if (!sq.every(([a, b]) => inside(c, a, b))) return;
  const base = eaves + Math.min(...sq.map(([a, b]) => roof.rise(a, b))) - 0.2;
  const z = Math.max(base + 1, top);
  prism(c.mesh, sq, base, z, col, shade(col, 0.4));
  // a collar a little under the top, so the stack ends in a cap and not in a cut
  prism(c.mesh, square(cu, cv, side + 0.18), z - 0.34, z - 0.14, shade(col, 0.88), shade(col, 0.95));
  c.mesh.emit(cu, cv, z);
}

// Steps and a small canopy on two posts in front of the door.
export function porch(c: Ctx, wood: RGB): void {
  if (c.door < 0 || edgeFrame(c.uv, c.door).len < 3) return;
  prism(c.mesh, edgeBox(c.uv, c.door, -0.75, 0.75, 0, 0.8), 0, 0.35, wood, shade(wood, 1.08));
  prism(c.mesh, edgeBox(c.uv, c.door, -0.9, 0.9, 0, 1.05), 2.2, 2.32, wood, wood);
  for (const s of [-0.75, 0.75]) prism(c.mesh, edgeBox(c.uv, c.door, s - 0.06, s + 0.06, 0.85, 0.97), 0.35, 2.2, wood, wood);
}

export const roofPalette = (c: Ctx, small: boolean): Pal => {
  const t = c.r();
  return t < 0.3 ? TOWN_COLORS.thatch : t < 0.6 ? TOWN_COLORS.shingle : t < 0.9 || !small ? TOWN_COLORS.roofPlank : TOWN_COLORS.turf;
};

export type Rect = [number, number, number, number]; // u0, v0, u1, v1 in the box frame

// Which way the street lies in the box frame: along u (0) or v (1), and the sign. No street: towards -v.
export function streetSide(c: Ctx): { axis: 0 | 1; sign: 1 | -1 } {
  const f = c.front;
  if (!f) return { axis: 1, sign: -1 };
  return Math.abs(f[0]) > Math.abs(f[1]) ? { axis: 0, sign: f[0] > 0 ? 1 : -1 } : { axis: 1, sign: f[1] > 0 ? 1 : -1 };
}

// Index of the lot's edge facing the street (rect edges: 0 v0, 1 u1, 2 v1, 3 u0).
export function streetEdge(c: Ctx): number {
  const { axis, sign } = streetSide(c);
  return axis === 1 ? (sign < 0 ? 0 : 2) : sign > 0 ? 1 : 3;
}

// The lot cut across the street direction: the back share `back` for the building, the rest (towards the street) for the
// yard. `street`: index of the yard's edge facing the street (rect edges: 0 v0, 1 u1, 2 v1, 3 u0); the opposite one
// borders the building.
export function splitLot(c: Ctx, back: number): { house: Rect; yard: Rect; street: number } {
  const { axis, sign } = streetSide(c);
  const lo = [c.cu - c.hl, c.cv - c.hw], hi = [c.cu + c.hl, c.cv + c.hw];
  const cut = sign > 0 ? lo[axis] + (hi[axis] - lo[axis]) * back : hi[axis] - (hi[axis] - lo[axis]) * back;
  const house: Rect = [lo[0], lo[1], hi[0], hi[1]], yard: Rect = [lo[0], lo[1], hi[0], hi[1]];
  if (sign > 0) (house[axis + 2] = cut), (yard[axis] = cut);
  else (house[axis] = cut), (yard[axis + 2] = cut);
  return { house, yard, street: streetEdge(c) };
}

// A context for a building standing on part of the lot.
export function part(c: Ctx, r: Rect): Ctx {
  const uv = rect(r[0], r[1], r[2], r[3]);
  return { ...c, uv, tris: triangulate(uv) ?? [], hl: (r[2] - r[0]) / 2, hw: (r[3] - r[1]) / 2, cu: (r[0] + r[2]) / 2, cv: (r[1] + r[3]) / 2, door: frontEdge(uv, c.front) };
}

// A point of a yard by fractions along its long side and across it, and the unit vector across.
export const longU = (r: Rect) => r[2] - r[0] >= r[3] - r[1];

export const inYard = (r: Rect, along: number, across: number): XY => (longU(r) ? inRect(r, along, across) : inRect(r, across, along));

export const yardAcross = (r: Rect): XY => (longU(r) ? [0, 1] : [1, 0]);

// A point of a rect by fractions.
export const inRect = (r: Rect, fu: number, fv: number): XY => [r[0] + (r[2] - r[0]) * fu, r[1] + (r[3] - r[1]) * fv];

// A point in front of edge i of a ring: s along the edge from its middle, o out from it.
export function byEdge(uv: readonly XY[], i: number, s: number, o: number): XY {
  const e = edgeFrame(uv, i);
  return [e.m[0] + e.t[0] * s + e.n[0] * o, e.m[1] + e.t[1] * s + e.n[1] * o];
}

// A rect of the lot seen from the street: at(s, d) is s metres along the street from its middle and d metres in from the
// street edge; L is the length along the street, D the depth. `street`: index of the rect's edge facing the street.
export function frameOf(r: Rect, street: number): { L: number; D: number; at: (s: number, d: number) => XY } {
  const ring = rect(r[0], r[1], r[2], r[3]);
  return { L: edgeFrame(ring, street).len, D: edgeFrame(ring, (street + 1) % 4).len, at: (s, d) => byEdge(ring, street, s, -d) };
}

// A box standing in such a frame: s0..s1 along the street, d0..d1 in from it, z0..z1 high.
export function slabIn(c: Ctx, F: ReturnType<typeof frameOf>, s0: number, s1: number, d0: number, d1: number, z0: number, z1: number, col: RGB, top: RGB = shade(col, 1.1), pat: number = PATTERN.plain): void {
  prism(c.mesh, ccw([F.at(s0, d0), F.at(s1, d0), F.at(s1, d1), F.at(s0, d1)]), z0, z1, col, top, pat);
}

// A ground-plan point lifted to z.
export const up = (p: XY, z: number): [number, number, number] => [p[0], p[1], z];

export function barrel(c: Ctx, p: XY, r = 0.3, h = 0.8, z = 0): void {
  revolve(c.mesh, p[0], p[1], z, [[r * 0.88, 0], [r * 1.08, h * 0.5], [r * 0.88, h], [0, h]], pick(c, TOWN_COLORS.planks), 10);
}

export function crate(c: Ctx, p: XY, s: number, z0 = 0): void {
  const col = pick(c, TOWN_COLORS.planks);
  prism(c.mesh, square(p[0], p[1], s), z0, z0 + s, col, shade(col, 1.1), PATTERN.boards);
}

export function sack(c: Ctx, p: XY): void {
  revolve(c.mesh, p[0], p[1], 0, [[0.25, 0], [0.32, 0.22], [0.22, 0.48], [0, 0.52]], pick(c, TOWN_COLORS.canvas), 8);
}

// A beam between two ground-plan points, from z0 to z1, `th` thick.
export function beam(c: Ctx, a: XY, b: XY, z0: number, z1: number, th: number, col: RGB): void {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (-(b[1] - a[1]) / l) * (th / 2), ny = ((b[0] - a[0]) / l) * (th / 2);
  prism(c.mesh, ccw([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]), z0, z1, col, col);
}

// Wooden fence a little inside a yard: posts and two rails on every side but the one at the building (all four when
// `closed`), with a gate gap in the middle of the street side.
export function fence(c: Ctx, r: Rect, street: number, closed = false): void {
  const wood = pick(c, TOWN_COLORS.planks);
  const ring = rect(r[0] + 0.1, r[1] + 0.1, r[2] - 0.1, r[3] - 0.1);
  const house = (street + 2) % 4;
  for (let i = 0; i < 4; i++) {
    if (i === house && !closed) continue;
    const a = ring[i], b = ring[(i + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lerp = (t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const runs: [number, number][] = i === street && len > 3 ? [[0, 0.5 - 0.8 / len], [0.5 + 0.8 / len, 1]] : [[0, 1]];
    for (const [t0, t1] of runs) {
      const n = Math.max(1, Math.round(((t1 - t0) * len) / 1.6));
      for (let k = 0; k <= n; k++) {
        const p = lerp(t0 + ((t1 - t0) * k) / n);
        prism(c.mesh, square(p[0], p[1], 0.1), 0, 1, wood, wood);
      }
      for (const z of [0.45, 0.85]) beam(c, lerp(t0), lerp(t1), z, z + 0.07, 0.05, wood);
    }
  }
}

// A haystack standing at p.
export function haystack(c: Ctx, p: XY, r: number): void {
  revolve(c.mesh, p[0], p[1], 0, [[r, 0], [r * 1.05, r * 0.6], [r * 0.7, r * 1.5], [0, r * 2.1]], pick(c, TOWN_COLORS.thatch), 10);
}

// Posts around a house being rebuilt: just outside the walls, under the roof overhang so none pierces the roof.
export function rebuildPosts(c: Ctx, uv: readonly XY[], eaves: number, col: RGB): void {
  cornerPosts(c.mesh, offsetRing(uv, 0.45) ?? uv, Math.max(1, eaves - 0.7), col, 0.18);
}

// Logs stacked in a pyramid (rows of `rows`, rows - 1, ... logs) lying from a to b on the ground, side by side across.
export function logStack(c: Ctx, a: XY, b: XY, rows: number, r = 0.18): void {
  const col = pick(c, TOWN_COLORS.logs), end = shade(pick(c, TOWN_COLORS.logs), 1.35);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
  for (let row = 0; row < rows; row++) {
    const n = rows - row, z = r + row * r * 1.72;
    for (let k = 0; k < n; k++) {
      const o = (k - (n - 1) / 2) * r * 2;
      cylinder(c.mesh, [a[0] + nx * o, a[1] + ny * o, z], [b[0] + nx * o, b[1] + ny * o, z], r, col, end);
    }
  }
}

// What a building's model is (src/buildings/<id>/model.ts): it draws into the framed lot, or makes the whole model
// itself (the temple is an old-style hall, map/heritageModels.ts). `smoke`: its chimney smokes through the working day
// ("furnace") or cooks into the evening ("tavern"), map/smokeMath.ts. `seat: "piles"`: it stands on piles reaching down
// to the ground under each (map/groundSeat.ts seatPier), not on a plinth.
export type TownModel = { build: (c: Ctx) => void; smoke?: "furnace" | "tavern"; seat?: "piles" } | { whole: (ring: readonly XY[], height: number, opts: TownOptions) => Model };
