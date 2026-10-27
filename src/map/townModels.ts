import { TOWN_COLORS } from "../ui/palette";
import { buildHeritageModel } from "./heritageModels";
import {
  band,
  clamp,
  cornerPosts,
  cylinder,
  DOOR,
  framed,
  GATE,
  Mesh,
  NOFAC,
  offsetRing,
  PATTERN,
  planeRoof,
  pointInRing,
  prism,
  pyramid,
  revolve,
  rgb,
  rng,
  ROOF_FAC,
  roofOf,
  roofSurface,
  shade,
  shiftRoof,
  signedArea,
  square,
  triangulate,
  type Model,
  type RGB,
  type Roof,
  type RoofShape,
  type Tri,
  type XY,
} from "./modelGeometry";

// Models of the town's own buildings (the templates of src/sim/buildings.ts): footprint + template height + template ->
// mesh, on the shared geometry of modelGeometry.ts. Each template has a form (a log house, a workshop, a barn, an open
// shed, a garden...), and each building draws its materials, roof shape, pitch, overhang, chimney and porch from a seed
// (the ring by default), so a street of the same template still varies. The door faces the street (`front`).
//
// Recognisable without a label: what a building is for shows in front of it. Workplaces stand at the back of the lot and
// keep their work in a yard towards the street (the forge and anvil, the kiln and pots, haystacks behind a fence, herb
// beds and a drying rack), shops get an awning with goods, the tavern barrels and a hanging sign, the school a belfry.

// What a template is drawn as.
export type TownForm = "cabin" | "shop" | "healer" | "hut" | "workshop" | "farm" | "store" | "logyard" | "sawframe" | "market" | "well" | "garden" | "orchard" | "apiary" | "quarry" | "dig" | "tent" | "pier" | "cellar" | "chapel" | "school";

const FORMS: Record<string, TownForm> = {
  izba: "cabin",
  izba5: "cabin",
  shop: "shop",
  tavern: "cabin",
  healer: "healer",
  hunter: "hut",
  smithy: "workshop",
  carpentry: "workshop",
  pottery: "workshop",
  gumno: "farm",
  barn: "store",
  woodcutter: "logyard",
  sawpit: "sawframe",
  market: "market",
  well: "well",
  garden: "garden",
  orchard: "orchard",
  apiary: "apiary",
  quarry: "quarry",
  dig: "dig",
  forager: "tent",
  fisher: "pier",
  cellar: "cellar",
  chapel: "chapel",
  school: "school",
};

export const townForm = (template: string): TownForm => FORMS[template] ?? "cabin";

export interface TownOptions {
  seed?: number; // default: from the ring
  level?: number; // 2: a rebuilt house, a floor higher
  front?: XY | null; // unit vector towards the street in town metres: the door goes on the wall facing it
  tint?: string | null; // overlay colour ("#rrggbb"): walls take it, the roof leans to it
  upgrading?: boolean; // a rebuild in progress: posts stand around the house
}

type Pal = readonly string[];

// Everything a builder below needs about one building.
interface Ctx {
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
  template: string;
  opts: TownOptions;
  tint: RGB | null;
}

const pick = (c: Ctx, list: Pal): RGB => rgb(list[Math.min(list.length - 1, Math.floor(c.r() * list.length))]);
const range = (c: Ctx, a: number, b: number) => a + (b - a) * c.r();
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const inside = (c: Ctx, u: number, v: number) => pointInRing(u, v, c.uv);
const ccw = (p: XY[]): XY[] => (signedArea(p) < 0 ? p.reverse() : p);
const rect = (u0: number, v0: number, u1: number, v1: number): XY[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

// Midpoint, unit tangent, outward normal and length of edge i of a counter-clockwise ring.
function edgeFrame(uv: readonly XY[], i: number): { m: XY; t: XY; n: XY; len: number } {
  const a = uv[i], b = uv[(i + 1) % uv.length];
  const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv) || 1;
  return { m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], t: [du / len, dv / len], n: [dv / len, -du / len], len };
}

// The edge whose outside faces the street best (and is long enough for a door); -1 when none really does.
function frontEdge(uv: readonly XY[], front: XY | null): number {
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
function edgeBox(uv: readonly XY[], i: number, s0: number, s1: number, o0: number, o1: number): XY[] {
  const e = edgeFrame(uv, i);
  const at = (s: number, o: number): XY => [e.m[0] + e.t[0] * s + e.n[0] * o, e.m[1] + e.t[1] * s + e.n[1] * o];
  return ccw([at(s0, o0), at(s1, o0), at(s1, o1), at(s0, o1)]);
}

interface Body {
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

// Walls, plinth and roof (with its overhang and fascia) of a closed building; returns the roof.
function body(c: Ctx, b: Body): Roof {
  const { mesh, uv } = c;
  const wall = c.tint ?? b.wall, roofC = c.tint ? mix(b.roofC, c.tint, 0.45) : b.roofC;
  const roof = shiftRoof(roofOf(b.roof, c.hl, c.hw, b.rise), c.cu, c.cv);
  band(mesh, uv, b.eaves, roof, 0, null, wall, b.pat, b.eaves, c.door, b.doorPat);
  const plinth = b.plinth ? offsetRing(uv, 0.08) : null;
  if (plinth) band(mesh, plinth, 0, planeRoof([]), 0.4, null, shade(wall, 0.75), PATTERN.plain, 0);
  eavesRoof(c, roof, b.eaves, b.overhang, roofC);
  return roof;
}

// Roof surface over the ring pushed out by `overhang` (the ring itself when that fails), with a fascia along the edge.
function eavesRoof(c: Ctx, roof: Roof, eaves: number, overhang: number, col: RGB): void {
  const ring = overhang > 0 ? offsetRing(c.uv, overhang) : null;
  const tris = ring ? triangulate(ring) : null;
  if (ring && tris) {
    roofSurface(c.mesh, tris, eaves, roof, col, ROOF_FAC);
    band(c.mesh, ring, eaves, roof, 0, -0.16, shade(col, 0.7), PATTERN.plain, 0);
  } else roofSurface(c.mesh, c.tris, eaves, roof, col, ROOF_FAC);
}

function chimney(c: Ctx, roof: Roof, eaves: number, top: number, cu: number, cv: number, side: number, col: RGB): void {
  const sq = square(cu, cv, side);
  if (!sq.every(([a, b]) => inside(c, a, b))) return;
  const base = eaves + Math.min(...sq.map(([a, b]) => roof.rise(a, b))) - 0.2;
  prism(c.mesh, sq, base, Math.max(base + 1, top), col, shade(col, 0.55));
}

// Steps and a small canopy on two posts in front of the door.
function porch(c: Ctx, wood: RGB): void {
  if (c.door < 0 || edgeFrame(c.uv, c.door).len < 3) return;
  prism(c.mesh, edgeBox(c.uv, c.door, -0.75, 0.75, 0, 0.8), 0, 0.35, wood, shade(wood, 1.08));
  prism(c.mesh, edgeBox(c.uv, c.door, -0.9, 0.9, 0, 1.05), 2.2, 2.32, wood, wood);
  for (const s of [-0.75, 0.75]) prism(c.mesh, edgeBox(c.uv, c.door, s - 0.06, s + 0.06, 0.85, 0.97), 0.35, 2.2, wood, wood);
}

const roofPalette = (c: Ctx, small: boolean): Pal => {
  const t = c.r();
  return t < 0.3 ? TOWN_COLORS.thatch : t < 0.6 ? TOWN_COLORS.shingle : t < 0.9 || !small ? TOWN_COLORS.roofPlank : TOWN_COLORS.turf;
};

// ---- Parts of a lot: a building on the back of it, a yard towards the street ----

type Rect = [number, number, number, number]; // u0, v0, u1, v1 in the box frame

// Which way the street lies in the box frame: along u (0) or v (1), and the sign. No street: towards -v.
function streetSide(c: Ctx): { axis: 0 | 1; sign: 1 | -1 } {
  const f = c.front;
  if (!f) return { axis: 1, sign: -1 };
  return Math.abs(f[0]) > Math.abs(f[1]) ? { axis: 0, sign: f[0] > 0 ? 1 : -1 } : { axis: 1, sign: f[1] > 0 ? 1 : -1 };
}

// Index of the lot's edge facing the street (rect edges: 0 v0, 1 u1, 2 v1, 3 u0).
function streetEdge(c: Ctx): number {
  const { axis, sign } = streetSide(c);
  return axis === 1 ? (sign < 0 ? 0 : 2) : sign > 0 ? 1 : 3;
}

// The lot cut across the street direction: the back share `back` for the building, the rest (towards the street) for the
// yard. `street`: index of the yard's edge facing the street (rect edges: 0 v0, 1 u1, 2 v1, 3 u0); the opposite one
// borders the building.
function splitLot(c: Ctx, back: number): { house: Rect; yard: Rect; street: number } {
  const { axis, sign } = streetSide(c);
  const lo = [c.cu - c.hl, c.cv - c.hw], hi = [c.cu + c.hl, c.cv + c.hw];
  const cut = sign > 0 ? lo[axis] + (hi[axis] - lo[axis]) * back : hi[axis] - (hi[axis] - lo[axis]) * back;
  const house: Rect = [lo[0], lo[1], hi[0], hi[1]], yard: Rect = [lo[0], lo[1], hi[0], hi[1]];
  if (sign > 0) (house[axis + 2] = cut), (yard[axis] = cut);
  else (house[axis] = cut), (yard[axis + 2] = cut);
  return { house, yard, street: streetEdge(c) };
}

// A context for a building standing on part of the lot.
function part(c: Ctx, r: Rect): Ctx {
  const uv = rect(r[0], r[1], r[2], r[3]);
  return { ...c, uv, tris: triangulate(uv) ?? [], hl: (r[2] - r[0]) / 2, hw: (r[3] - r[1]) / 2, cu: (r[0] + r[2]) / 2, cv: (r[1] + r[3]) / 2, door: frontEdge(uv, c.front) };
}

// A point of a yard by fractions along its long side and across it, and the unit vector across.
const longU = (r: Rect) => r[2] - r[0] >= r[3] - r[1];
const inYard = (r: Rect, along: number, across: number): XY => (longU(r) ? inRect(r, along, across) : inRect(r, across, along));
const yardAcross = (r: Rect): XY => (longU(r) ? [0, 1] : [1, 0]);
// A point of a rect by fractions.
const inRect = (r: Rect, fu: number, fv: number): XY => [r[0] + (r[2] - r[0]) * fu, r[1] + (r[3] - r[1]) * fv];
// A point in front of edge i of a ring: s along the edge from its middle, o out from it.
function byEdge(uv: readonly XY[], i: number, s: number, o: number): XY {
  const e = edgeFrame(uv, i);
  return [e.m[0] + e.t[0] * s + e.n[0] * o, e.m[1] + e.t[1] * s + e.n[1] * o];
}

// ---- Yard things ----

function barrel(c: Ctx, p: XY, r = 0.3, h = 0.8): void {
  revolve(c.mesh, p[0], p[1], 0, [[r * 0.88, 0], [r * 1.08, h * 0.5], [r * 0.88, h], [0, h]], pick(c, TOWN_COLORS.planks), 10);
}

function crate(c: Ctx, p: XY, s: number, z0 = 0): void {
  const col = pick(c, TOWN_COLORS.planks);
  prism(c.mesh, square(p[0], p[1], s), z0, z0 + s, col, shade(col, 1.1), PATTERN.boards);
}

function sack(c: Ctx, p: XY): void {
  revolve(c.mesh, p[0], p[1], 0, [[0.25, 0], [0.32, 0.22], [0.22, 0.48], [0, 0.52]], pick(c, TOWN_COLORS.canvas), 8);
}

// A beam between two ground-plan points, from z0 to z1, `th` thick.
function beam(c: Ctx, a: XY, b: XY, z0: number, z1: number, th: number, col: RGB): void {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (-(b[1] - a[1]) / l) * (th / 2), ny = ((b[0] - a[0]) / l) * (th / 2);
  prism(c.mesh, ccw([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]), z0, z1, col, col);
}

// Wooden fence a little inside a yard: posts and two rails on every side but the one at the building (all four when
// `closed`), with a gate gap in the middle of the street side.
function fence(c: Ctx, r: Rect, street: number, closed = false): void {
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
function haystack(c: Ctx, p: XY, r: number): void {
  revolve(c.mesh, p[0], p[1], 0, [[r, 0], [r * 1.05, r * 0.6], [r * 0.7, r * 1.5], [0, r * 2.1]], pick(c, TOWN_COLORS.thatch), 10);
}

// ---- Buildings ----

// Log house; the tavern is one too, two floors high, with barrels and a hanging sign. Two floors for a rebuilt house.
function cabin(c: Ctx): void {
  const tavern = c.template === "tavern";
  const wid = c.hw * 2;
  const plastered = tavern && c.r() < 0.6;
  const twoFloors = (c.opts.level ?? 1) >= 2 || tavern;
  const eaves = twoFloors ? clamp(c.height * 0.82, 4.6, 7) : clamp(c.height * 0.6, 2.4, 4.2);
  const k = c.r();
  const roof: RoofShape = tavern ? (k < 0.5 ? "hip" : "halfhip") : k < 0.5 ? "gable" : k < 0.72 ? "halfhip" : k < 0.85 && wid >= 6.5 ? "gambrel" : "gable";
  const rise = clamp(wid * range(c, tavern ? 0.28 : 0.36, tavern ? 0.36 : 0.5), 1.2, 4.5);
  const wall = pick(c, plastered ? TOWN_COLORS.plaster : TOWN_COLORS.logs);
  const pat = plastered ? PATTERN.hall : PATTERN.cabin;
  const r = body(c, { eaves, roof, rise, overhang: range(c, 0.35, 0.6), wall, roofC: pick(c, roofPalette(c, wid < 6)), pat, doorPat: pat + DOOR, plinth: true });
  const brick = pick(c, TOWN_COLORS.stone);
  const fu = range(c, -0.3, 0.3) * c.hl, fv = (c.r() < 0.5 ? 0.2 : -0.2) * c.hw;
  if (tavern) {
    chimney(c, r, eaves, eaves + rise + 0.5, fu, fv, 0.7, brick);
    chimney(c, r, eaves, eaves + rise + 0.5, -fu, -fv, 0.7, brick);
  } else if (c.r() < 0.85) chimney(c, r, eaves, eaves + rise + 0.5, fu, fv, 0.6, brick);
  const wood = pick(c, TOWN_COLORS.planks);
  if (tavern && c.door >= 0) {
    // barrels by the door, a sign hanging from a bracket
    for (const s of [-1.7, -2.4, 1.8]) barrel(c, byEdge(c.uv, c.door, s, 0.45));
    beam(c, byEdge(c.uv, c.door, 1.1, 0), byEdge(c.uv, c.door, 1.1, 1.0), 3.0, 3.1, 0.08, wood);
    beam(c, byEdge(c.uv, c.door, 1.1, 0.35), byEdge(c.uv, c.door, 1.1, 0.9), 2.25, 2.9, 0.06, pick(c, TOWN_COLORS.goods));
  } else if (eaves >= 2.4 && c.r() < 0.45) porch(c, wood);
  if (c.opts.upgrading) cornerPosts(c.mesh, c.uv, eaves + rise + 1, wood, 0.18);
}

// Shop: a house with a striped awning over its front and goods on crates under it.
function shop(c: Ctx): void {
  const wid = c.hw * 2;
  const eaves = clamp(c.height * 0.6, 2.8, 4.2);
  const plastered = c.r() < 0.6;
  const wall = pick(c, plastered ? TOWN_COLORS.plaster : TOWN_COLORS.logs);
  const pat = plastered ? PATTERN.house : PATTERN.cabin;
  const rise = clamp(wid * range(c, 0.32, 0.42), 1.2, 3.5);
  const r = body(c, { eaves, roof: c.r() < 0.6 ? "gable" : "halfhip", rise, overhang: 0.35, wall, roofC: pick(c, roofPalette(c, false)), pat, doorPat: pat + DOOR, plinth: true });
  if (c.r() < 0.7) chimney(c, r, eaves, eaves + rise + 0.5, range(c, -0.3, 0.3) * c.hl, 0.2 * c.hw, 0.6, pick(c, TOWN_COLORS.stone));
  if (c.door < 0) return;
  const e = edgeFrame(c.uv, c.door);
  const half = e.len / 2 - 0.3, out = 1.1, zw = 2.75, zo = 2.15;
  const stripes = Math.max(2, Math.round((half * 2) / 0.7));
  const a = pick(c, TOWN_COLORS.goods), b = pick(c, TOWN_COLORS.trim);
  for (let k = 0; k < stripes; k++) {
    const s0 = -half + (k * 2 * half) / stripes, s1 = -half + ((k + 1) * 2 * half) / stripes;
    const p = (s: number, o: number, z: number): [number, number, number] => [...byEdge(c.uv, c.door, s, o), z];
    const col = k % 2 ? a : b;
    c.mesh.flat(p(s0, 0.02, zw), p(s1, 0.02, zw), p(s1, out, zo), col);
    c.mesh.flat(p(s0, 0.02, zw), p(s1, out, zo), p(s0, out, zo), col);
  }
  const wood = pick(c, TOWN_COLORS.planks);
  for (const s of [-half, half]) {
    const p = byEdge(c.uv, c.door, s, out - 0.05);
    prism(c.mesh, square(p[0], p[1], 0.08), 0, zo, wood, wood);
  }
  for (const s of [-1.5, 1.5]) {
    if (Math.abs(s) > half - 0.3) continue;
    const p = byEdge(c.uv, c.door, s, 0.5);
    crate(c, p, 0.6);
    prism(c.mesh, square(p[0], p[1], 0.35), 0.6, 0.85, pick(c, TOWN_COLORS.goods), pick(c, TOWN_COLORS.goods));
  }
}

// Healer: a white house with a green roof, a green-cross sign at the gate, an herb garden and a drying rack in front.
function healer(c: Ctx): void {
  const { house, yard, street } = splitLot(c, 0.62);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.7, 2.8, 3.4);
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * range(c, 0.3, 0.38), 1.2, 3);
  const r = body(h, { eaves, roof: c.r() < 0.6 ? "hip" : "halfhip", rise, overhang: 0.4, wall: pick(c, TOWN_COLORS.trim), roofC: pick(c, TOWN_COLORS.healerRoof), pat: PATTERN.house, doorPat: PATTERN.house + DOOR, plinth: true });
  chimney(h, r, eaves, eaves + rise + 0.4, h.cu + h.hl * 0.4, h.cv, 0.5, pick(c, TOWN_COLORS.stone));
  // a white sign with a green cross on a post by the gate, facing the street (on the wall the eaves would hide it)
  const gate = rect(yard[0], yard[1], yard[2], yard[3]);
  const sl = edgeFrame(gate, street).len * 0.32;
  const post = byEdge(gate, street, sl, -0.3), cross = rgb(TOWN_COLORS.cross[0]), board = rgb(TOWN_COLORS.trim[0]);
  prism(c.mesh, square(post[0], post[1], 0.1), 0, 2.3, shade(board, 0.6), shade(board, 0.6));
  prism(c.mesh, edgeBox(gate, street, sl - 0.42, sl + 0.42, -0.26, -0.2), 1.45, 2.3, board, board);
  prism(c.mesh, edgeBox(gate, street, sl - 0.3, sl + 0.3, -0.2, -0.16), 1.78, 1.97, cross, cross);
  prism(c.mesh, edgeBox(gate, street, sl - 0.095, sl + 0.095, -0.2, -0.16), 1.58, 2.17, cross, cross);
  // herb beds in rows across the yard, flowers on some
  const soil = pick(c, TOWN_COLORS.soil);
  for (const fv of [0.28, 0.72])
    for (const [f0, f1] of [[0.08, 0.4], [0.6, 0.92]]) {
      const [u0, v0] = inRect(yard, f0, fv - 0.12), [u1, v1] = inRect(yard, f1, fv + 0.12);
      const bed = rect(Math.min(u0, u1), Math.min(v0, v1), Math.max(u0, u1), Math.max(v0, v1));
      prism(c.mesh, bed, 0, 0.22, soil, pick(c, TOWN_COLORS.foliage));
      const m = inRect(yard, (f0 + f1) / 2, fv);
      if (c.r() < 0.7) prism(c.mesh, square(m[0], m[1], 0.25), 0.22, 0.4, pick(c, TOWN_COLORS.flowers), pick(c, TOWN_COLORS.flowers));
    }
  // drying rack with bundles
  const wood = pick(c, TOWN_COLORS.planks);
  const a = inRect(yard, 0.15, 0.5), b = inRect(yard, 0.85, 0.5);
  for (const p of [a, b]) prism(c.mesh, square(p[0], p[1], 0.1), 0, 1.7, wood, wood);
  beam(c, a, b, 1.6, 1.68, 0.06, wood);
  for (const t of [0.3, 0.5, 0.7]) {
    const p: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    prism(c.mesh, square(p[0], p[1], 0.18), 1.1, 1.6, pick(c, TOWN_COLORS.foliage), pick(c, TOWN_COLORS.foliage));
  }
  fence(c, yard, street);
}

// Hunter's lodge: a small log hut with a lean-to roof, a hide stretched on a frame and a fire pit.
function hut(c: Ctx): void {
  const { house, yard } = splitLot(c, 0.6);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.7, 2, 2.4);
  body(h, { eaves, roof: "shed", rise: 0.9, overhang: 0.3, wall: pick(c, TOWN_COLORS.logs), roofC: pick(c, c.r() < 0.5 ? TOWN_COLORS.turf : TOWN_COLORS.roofPlank), pat: PATTERN.cabin, doorPat: PATTERN.cabin + DOOR, plinth: false });
  const wood = pick(c, TOWN_COLORS.logs);
  const a = inYard(yard, 0.45, 0.5), b = inYard(yard, 0.95, 0.5);
  for (const p of [a, b]) cylinder(c.mesh, [p[0], p[1], 0], [p[0], p[1], 2], 0.07, wood);
  cylinder(c.mesh, [a[0], a[1], 1.9], [b[0], b[1], 1.9], 0.05, wood);
  beam(c, [a[0] + (b[0] - a[0]) * 0.1, a[1] + (b[1] - a[1]) * 0.1], [a[0] + (b[0] - a[0]) * 0.9, a[1] + (b[1] - a[1]) * 0.9], 0.45, 1.85, 0.04, rgb(TOWN_COLORS.hide[0]));
  // antlers over the door
  if (h.door >= 0) {
    const ed = edgeFrame(h.uv, h.door), bone = rgb(TOWN_COLORS.trim[0]);
    const m = byEdge(h.uv, h.door, 0, 0.06);
    for (const s of [-1, 1]) cylinder(c.mesh, [m[0], m[1], 2.0], [m[0] + ed.t[0] * s * 0.35 + ed.n[0] * 0.15, m[1] + ed.t[1] * s * 0.35 + ed.n[1] * 0.15, 2.45], 0.03, bone);
  }
  const fire = inYard(yard, 0.18, 0.5);
  revolve(c.mesh, fire[0], fire[1], 0, [[0.45, 0], [0.45, 0.18], [0.3, 0.18], [0.3, 0.05], [0, 0.05]], pick(c, TOWN_COLORS.stone), 10);
  revolve(c.mesh, fire[0], fire[1], 0.05, [[0.25, 0], [0, 0.02]], rgb(TOWN_COLORS.ember[0]), 8);
}

// Smithy, pottery, carpentry: a closed workshop at the back, the work in the yard: an open forge under a lean-to with an
// anvil, a beehive kiln with pots, or a sawhorse with stacks of planks and logs.
function workshop(c: Ctx): void {
  const t = c.template;
  const { house, yard, street } = splitLot(c, t === "pottery" ? 0.5 : 0.58);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.7, 2.6, 3.4);
  const stone = t !== "carpentry";
  const wall = pick(c, stone ? TOWN_COLORS.stone : TOWN_COLORS.planks);
  const pat = stone ? PATTERN.house : PATTERN.boards;
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * range(c, 0.25, 0.35), 0.8, 2.5);
  // the potter's roof is of his own tiles
  const roofC = pick(c, t === "smithy" ? TOWN_COLORS.roofPlank : t === "pottery" ? TOWN_COLORS.clay : TOWN_COLORS.shingle);
  const r = body(h, { eaves, roof: "gable", rise, overhang: 0.3, wall, roofC: t === "smithy" ? shade(roofC, 0.7) : roofC, pat, doorPat: pat + GATE, plinth: stone });
  const brick = pick(c, TOWN_COLORS.stone);
  if (t === "smithy") {
    // a tall wide chimney, and in the yard a forge under a lean-to with an anvil
    chimney(h, r, eaves, eaves + rise + 1.8, h.cu, h.cv, 1.1, shade(brick, 0.8));
    const wood = pick(c, TOWN_COLORS.planks);
    // the lean-to: high at the workshop wall (the yard edge opposite the street), low at the street; posts at its low corners
    const wallEdge = (street + 2) % 4;
    const P = rect(yard[0], yard[1], yard[2], yard[3]).map((p, i): [number, number, number] => [p[0], p[1], i === wallEdge || i === (wallEdge + 1) % 4 ? eaves - 0.2 : 2.3]);
    c.mesh.flat(P[0], P[1], P[2], roofC, ROOF_FAC);
    c.mesh.flat(P[0], P[2], P[3], roofC, ROOF_FAC);
    for (const p of P) if (p[2] < eaves - 0.3) prism(c.mesh, square(p[0], p[1], 0.14), 0, p[2], wood, wood);
    const hearth = inRect(yard, 0.3, 0.5), anvil = inRect(yard, 0.72, 0.5);
    prism(c.mesh, square(hearth[0], hearth[1], 1.1), 0, 0.85, brick, rgb(TOWN_COLORS.ember[0]));
    revolve(c.mesh, anvil[0], anvil[1], 0, [[0.28, 0], [0.28, 0.5], [0, 0.5]], pick(c, TOWN_COLORS.logs), 8);
    prism(c.mesh, rect(anvil[0] - 0.35, anvil[1] - 0.14, anvil[0] + 0.35, anvil[1] + 0.14), 0.5, 0.78, rgb(TOWN_COLORS.iron[0]), rgb(TOWN_COLORS.iron[0]));
  } else if (t === "pottery") {
    // a domed kiln with a stub chimney, pots on a board and on the ground
    const k = inRect(yard, 0.32, 0.5);
    const kr = Math.min(1.25, Math.min(yard[2] - yard[0], yard[3] - yard[1]) * 0.42);
    const clay = pick(c, TOWN_COLORS.clay);
    revolve(c.mesh, k[0], k[1], 0, [[kr, 0], [kr, 0.4], [kr * 0.9, kr * 0.9], [kr * 0.5, kr * 1.35], [0, kr * 1.5]], clay, 12);
    prism(c.mesh, square(k[0], k[1], 0.35), kr * 1.3, kr * 1.5 + 0.5, shade(clay, 0.8), shade(clay, 0.5));
    const a = inRect(yard, 0.62, 0.3), b = inRect(yard, 0.62, 0.7);
    const wood = pick(c, TOWN_COLORS.planks);
    beam(c, a, b, 0.7, 0.78, 0.4, wood);
    for (const p of [a, b]) prism(c.mesh, square(p[0], p[1], 0.1), 0, 0.7, wood, wood);
    for (const tt of [0.2, 0.5, 0.8]) pot(c, [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt], 0.78);
    for (const [fu, fv] of [[0.85, 0.3], [0.88, 0.62]]) pot(c, inRect(yard, fu, fv), 0, 1.4);
  } else {
    // carpentry, laid out along the yard: a sawhorse with a log on it, a tall stack of planks and a pile of logs
    const wood = pick(c, TOWN_COLORS.planks), light = shade(pick(c, TOWN_COLORS.logs), 1.25);
    const [ax, ay] = yardAcross(yard);
    for (const fl of [0.08, 0.3]) {
      const m = inYard(yard, fl, 0.5);
      for (const s of [-1, 1]) cylinder(c.mesh, [m[0] + ax * s * 0.3, m[1] + ay * s * 0.3, 0.05], [m[0], m[1], 0.8], 0.05, wood);
    }
    const s0 = inYard(yard, 0.03, 0.5), s1 = inYard(yard, 0.35, 0.5);
    cylinder(c.mesh, [s0[0], s0[1], 0.95], [s1[0], s1[1], 0.95], 0.16, pick(c, TOWN_COLORS.logs), light);
    for (let k = 0; k < 4; k++) beam(c, inYard(yard, 0.42, 0.5), inYard(yard, 0.66, 0.5), k * 0.22, k * 0.22 + 0.18, 0.95 - k * 0.08, k % 2 ? light : shade(light, 0.92));
    logStack(c, inYard(yard, 0.72, 0.5), inYard(yard, 0.97, 0.5), 3, 0.16);
  }
}

// A clay pot standing at z.
function pot(c: Ctx, p: XY, z: number, k = 1): void {
  revolve(c.mesh, p[0], p[1], z, [[0.12 * k, 0], [0.2 * k, 0.15 * k], [0.16 * k, 0.32 * k], [0.1 * k, 0.38 * k], [0, 0.38 * k]], pick(c, TOWN_COLORS.clay), 8);
}

// Farm: a long barn with low walls under a steep thatched roof, haystacks in a fenced yard in front of its gate.
function farm(c: Ctx): void {
  const { house, yard, street } = splitLot(c, 0.6);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.32, 1.7, 2.2);
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * range(c, 0.6, 0.72), 3, 5.5);
  const logs = c.r() < 0.4;
  const pat = logs ? PATTERN.logs : PATTERN.boards;
  body(h, { eaves, roof: c.r() < 0.6 ? "gable" : "halfhip", rise, overhang: 0.5, wall: pick(c, logs ? TOWN_COLORS.logs : TOWN_COLORS.planks), roofC: pick(c, TOWN_COLORS.thatch), pat, doorPat: pat + GATE, plinth: false });
  const rr = Math.min(yard[2] - yard[0], yard[3] - yard[1]) * 0.22;
  haystack(c, inRect(yard, 0.27, 0.55), rr);
  haystack(c, inRect(yard, 0.73, 0.45), rr * 0.85);
  fence(c, yard, street);
  if (c.opts.upgrading) cornerPosts(c.mesh, h.uv, eaves + rise + 1, pick(c, TOWN_COLORS.planks), 0.18);
}

// Store: a tall plank barn with a gambrel roof, a gate with a loft door above it, crates and sacks in front.
function store(c: Ctx): void {
  const { house, yard } = splitLot(c, 0.75);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.58, 3.3, 4);
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * 0.42, 1.8, 4);
  const wall = pick(c, TOWN_COLORS.planks);
  body(h, { eaves, roof: "gambrel", rise, overhang: 0.35, wall, roofC: pick(c, c.r() < 0.5 ? TOWN_COLORS.roofPlank : TOWN_COLORS.shingle), pat: PATTERN.boards, doorPat: PATTERN.boards + GATE, plinth: false });
  if (h.door >= 0) prism(c.mesh, edgeBox(h.uv, h.door, -0.5, 0.5, 0.01, 0.06), 2.75, 3.2, shade(wall, 0.45), shade(wall, 0.45));
  crate(c, inRect(yard, 0.15, 0.5), 0.7);
  crate(c, inRect(yard, 0.15, 0.5), 0.55, 0.7);
  crate(c, inRect(yard, 0.32, 0.5), 0.6);
  for (const fu of [0.72, 0.84]) sack(c, inRect(yard, fu, 0.5));
}

// School: a tall plastered hall with big windows, a hip roof with a little belfry and a porch.
function school(c: Ctx): void {
  const wid = c.hw * 2;
  const eaves = clamp(c.height * 0.85, 3.6, 4.6);
  const rise = clamp(wid * 0.24, 1.2, 3);
  const r = body(c, { eaves, roof: "hip", rise, overhang: 0.5, wall: pick(c, TOWN_COLORS.plaster), roofC: pick(c, c.r() < 0.5 ? TOWN_COLORS.shingle : TOWN_COLORS.roofPlank), pat: PATTERN.hall, doorPat: PATTERN.hall + DOOR, plinth: true });
  const wood = pick(c, TOWN_COLORS.planks), trim = pick(c, TOWN_COLORS.trim);
  porch(c, trim);
  // belfry on the ridge: four posts under a tent roof, a bell between them
  const top = eaves + r.rise(0, 0);
  const s = 1.3;
  prism(c.mesh, square(0, 0, s), top - 0.6, top + 0.3, trim, trim);
  for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) prism(c.mesh, square((du * (s - 0.12)) / 2, (dv * (s - 0.12)) / 2, 0.12), top + 0.3, top + 1.5, wood, wood);
  pyramid(c.mesh, square(0, 0, s + 0.3), top + 1.5, 1.1, pick(c, TOWN_COLORS.shingle));
  revolve(c.mesh, 0, 0, top + 0.65, [[0.32, 0], [0.24, 0.25], [0.16, 0.6], [0, 0.65]], rgb(TOWN_COLORS.bell[0]), 10);
}

// Logs stacked in a pyramid (rows of `rows`, rows - 1, ... logs) lying from a to b on the ground, side by side across.
function logStack(c: Ctx, a: XY, b: XY, rows: number, r = 0.18): void {
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

// A chopping block with an axe in it.
function choppingBlock(c: Ctx, p: XY): void {
  const wood = pick(c, TOWN_COLORS.logs);
  revolve(c.mesh, p[0], p[1], 0, [[0.28, 0], [0.28, 0.5], [0, 0.5]], wood, 9);
  cylinder(c.mesh, [p[0], p[1], 0.5], [p[0] + 0.25, p[1] + 0.1, 1.1], 0.03, shade(wood, 1.3));
  prism(c.mesh, rect(p[0] - 0.12, p[1] - 0.02, p[0] + 0.05, p[1] + 0.02), 0.45, 0.62, rgb(TOWN_COLORS.iron[0]), rgb(TOWN_COLORS.iron[0]));
}

// Woodcutter's: an open log yard: two stacks of logs, a chopping block, a small lean-to for the tools.
function logYard(c: Ctx): void {
  const L = c.hl, W = c.hw;
  logStack(c, [-L * 0.85, -W * 0.45], [L * 0.85, -W * 0.45], 3);
  logStack(c, [-L * 0.85, W * 0.25], [L * 0.2, W * 0.25], 2);
  choppingBlock(c, [L * 0.55, W * 0.45]);
}

// Saw pit: a log on a tall trestle frame for two sawyers, sawn planks and a heap of sawdust.
function sawFrame(c: Ctx): void {
  const L = c.hl, W = c.hw, H = 1.6;
  const wood = pick(c, TOWN_COLORS.planks);
  for (const u of [-L * 0.55, L * 0.55]) {
    // an A-frame across the pit
    cylinder(c.mesh, [u, -W * 0.45, 0.07], [u, 0, H], 0.07, wood);
    cylinder(c.mesh, [u, W * 0.45, 0.07], [u, 0, H], 0.07, wood);
    cylinder(c.mesh, [u, -W * 0.25, H * 0.45], [u, W * 0.25, H * 0.45], 0.05, wood);
  }
  cylinder(c.mesh, [-L * 0.9, 0, H + 0.2], [L * 0.9, 0, H + 0.2], 0.22, pick(c, TOWN_COLORS.logs), shade(pick(c, TOWN_COLORS.logs), 1.35));
  const plank = shade(pick(c, TOWN_COLORS.logs), 1.3);
  beam(c, [-L * 0.7, W * 0.75], [L * 0.7, W * 0.75], 0, 0.4, 0.5, plank);
  pyramid(c.mesh, square(-L * 0.1, -W * 0.7, 0.9), 0, 0.3, shade(plank, 1.1));
}

// Market: stalls in two rows facing the middle, each a counter with goods under a striped canopy on four posts.
function market(c: Ctx): void {
  const wood = pick(c, TOWN_COLORS.planks);
  const dust = shade(pick(c, TOWN_COLORS.soil), 1.5);
  prism(c.mesh, c.uv, 0, 0.03, dust, dust);
  const cols = Math.max(1, Math.floor((c.hl * 2 - 0.6) / 3));
  const sw = (c.hl * 2 - 0.6) / cols;
  for (const side of [-1, 1])
    for (let k = 0; k < cols; k++) {
      const cu = -c.hl + 0.3 + sw * (k + 0.5), back = side * (c.hw - 0.3), front = side * (c.hw - 2.2);
      const hw = sw / 2 - 0.25;
      const stripeA = pick(c, TOWN_COLORS.goods), stripeB = pick(c, TOWN_COLORS.trim);
      const n = 4;
      for (let s = 0; s < n; s++) {
        const u0 = cu - hw + (2 * hw * s) / n, u1 = cu - hw + (2 * hw * (s + 1)) / n;
        const col = s % 2 ? stripeA : stripeB;
        c.mesh.flat([u0, back, 2.5], [u1, back, 2.5], [u1, front - side * 0.3, 2.0], col);
        c.mesh.flat([u0, back, 2.5], [u1, front - side * 0.3, 2.0], [u0, front - side * 0.3, 2.0], col);
      }
      for (const u of [cu - hw, cu + hw]) for (const [v, z] of [[back, 2.5], [front - side * 0.3, 2.0]] as const) prism(c.mesh, square(u, v, 0.1), 0, z, wood, wood);
      const counter = rect(cu - hw + 0.1, Math.min(front, front + side * 0.7), cu + hw - 0.1, Math.max(front, front + side * 0.7));
      prism(c.mesh, counter, 0, 0.9, wood, shade(wood, 1.1), PATTERN.boards);
      for (const du of [-0.6, 0, 0.6]) if (Math.abs(du) < hw - 0.2 && c.r() < 0.8) prism(c.mesh, square(cu + du, front + side * 0.35, 0.38), 0.9, 0.9 + range(c, 0.15, 0.35), pick(c, TOWN_COLORS.goods), pick(c, TOWN_COLORS.goods));
      if (c.r() < 0.6) barrel(c, [cu + hw - 0.35, back - side * 0.5]);
    }
}

// Apiary: straw skeps on low benches.
function apiary(c: Ctx): void {
  const grass = shade(pick(c, TOWN_COLORS.foliage), 1.15);
  prism(c.mesh, c.uv, 0, 0.04, grass, grass);
  const wood = pick(c, TOWN_COLORS.planks);
  for (const v of [-c.hw * 0.45, c.hw * 0.45]) {
    beam(c, [-c.hl * 0.8, v], [c.hl * 0.8, v], 0.35, 0.45, 0.6, wood);
    for (const u of [-c.hl * 0.7, c.hl * 0.7]) prism(c.mesh, square(u, v, 0.12), 0, 0.35, wood, wood);
    for (let u = -c.hl * 0.55; u <= c.hl * 0.55 + 1e-6; u += Math.max(0.9, c.hl * 0.55)) {
      const r = range(c, 0.32, 0.4);
      revolve(c.mesh, u, v, 0.45, [[r, 0], [r * 1.02, r * 0.5], [r * 0.85, r * 1.1], [r * 0.45, r * 1.55], [0, r * 1.7]], pick(c, TOWN_COLORS.hive), 10);
    }
  }
}

// Quarry: rubble, cut blocks and a lifting tripod with a block hanging from it.
function quarry(c: Ctx): void {
  const base = pick(c, TOWN_COLORS.stone);
  prism(c.mesh, c.uv, 0, 0.12, shade(base, 0.9), shade(base, 0.9));
  const n = 3 + Math.floor(c.r() * 3);
  for (let k = 0; k < n; k++) {
    const cu = range(c, -0.7, 0.2) * c.hl, cv = range(c, -0.7, 0.7) * c.hw, s = range(c, 0.8, 1.8);
    const sq = rect(cu - s / 2, cv - s * 0.35, cu + s / 2, cv + s * 0.35);
    if (!sq.every(([a, b]) => inside(c, a, b))) continue;
    const col = shade(pick(c, TOWN_COLORS.stone), range(c, 0.85, 1.1));
    prism(c.mesh, sq, 0.12, 0.12 + range(c, 0.5, 1.4), col, shade(col, 1.1));
  }
  // tripod over the last block
  const p: XY = [c.hl * 0.5, 0], H = 4.2, R = Math.min(c.hw, c.hl) * 0.5;
  const wood = pick(c, TOWN_COLORS.logs);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3;
    cylinder(c.mesh, [p[0] + Math.cos(a) * R, p[1] + Math.sin(a) * R, 0.08], [p[0], p[1], H], 0.08, wood); // lifted by its radius: a slanted end dips
  }
  cylinder(c.mesh, [p[0], p[1], H], [p[0], p[1], 1.6], 0.02, rgb(TOWN_COLORS.iron[0]));
  const block = shade(base, 1.08);
  prism(c.mesh, square(p[0], p[1], 0.8), 0.9, 1.6, block, block);
}

// Well: a round stone curb with water, two posts and a small roof.
function well(c: Ctx): void {
  const r = clamp(Math.min(c.hl, c.hw) * 0.55, 0.45, 0.8);
  const stone = pick(c, TOWN_COLORS.stone), wood = pick(c, TOWN_COLORS.planks);
  revolve(c.mesh, 0, 0, 0, [[r, 0], [r, 0.8], [r * 0.8, 0.8]], stone, 12);
  revolve(c.mesh, 0, 0, 0.6, [[r * 0.8, 0], [0, 0]], pick(c, TOWN_COLORS.water), 12);
  for (const u of [-r - 0.1, r + 0.1]) prism(c.mesh, square(u, 0, 0.12), 0, 2, wood, wood);
  prism(c.mesh, rect(-r - 0.1, -0.05, r + 0.1, 0.05), 1.6, 1.7, wood, wood); // the windlass
  const hl = r + 0.4, hw = 0.6;
  const roof = roofOf("gable", hl, hw, 0.6);
  const tris = triangulate(rect(-hl, -hw, hl, hw));
  if (tris) roofSurface(c.mesh, tris, 2, roof, pick(c, TOWN_COLORS.shingle), ROOF_FAC);
}

// Kitchen garden: soil with beds in rows.
function garden(c: Ctx): void {
  const soil = pick(c, TOWN_COLORS.soil);
  prism(c.mesh, c.uv, 0, 0.06, soil, soil);
  const rows = Math.max(1, Math.floor((c.hw * 2 - 0.4) / 0.9));
  for (let k = 0; k < rows; k++) {
    const cv = -c.hw + 0.2 + 0.45 + k * 0.9;
    const bed = rect(-c.hl + 0.25, cv - 0.25, c.hl - 0.25, cv + 0.25);
    if (bed.every(([a, b]) => inside(c, a, b))) prism(c.mesh, bed, 0.06, range(c, 0.2, 0.35), soil, pick(c, TOWN_COLORS.foliage));
  }
}

// Fishing pier: a deck on posts with a small hut and a drying rack.
function pier(c: Ctx): void {
  const wood = pick(c, TOWN_COLORS.planks);
  const deck = 0.6;
  cornerPosts(c.mesh, c.uv, deck, shade(wood, 0.8), 0.2);
  prism(c.mesh, c.uv, deck - 0.12, deck, wood, wood, PATTERN.boards);
  // the hut on the back half; a lean-to roof depends on v only, so it fits any part of the box
  const hut = rect(-c.hl + 0.2, -c.hw + 0.2, 0, c.hw - 0.2);
  const roof = roofOf("shed", c.hl, c.hw - 0.2, 0.8);
  const top = deck + 1.9;
  band(c.mesh, hut, top, roof, 0, null, pick(c, TOWN_COLORS.logs), PATTERN.cabin, top, -1, PATTERN.cabin, deck);
  const tris = triangulate(hut);
  if (tris) roofSurface(c.mesh, tris, top, roof, pick(c, TOWN_COLORS.roofPlank), ROOF_FAC);
  for (const v of [-c.hw * 0.6, c.hw * 0.6]) prism(c.mesh, square(c.hl * 0.55, v, 0.1), deck, deck + 1.6, wood, wood);
  prism(c.mesh, rect(c.hl * 0.55 - 0.05, -c.hw * 0.6, c.hl * 0.55 + 0.05, c.hw * 0.6), deck + 1.5, deck + 1.6, wood, wood);
}

// Orchard: one kind of fruit tree in straight rows inside a fence, trunks whitewashed, fruit on the crowns, a ladder
// against one tree and a basket under it.
function orchard(c: Ctx): void {
  const grass = shade(pick(c, TOWN_COLORS.foliage), 1.2);
  prism(c.mesh, c.uv, 0, 0.04, grass, grass);
  const step = 3;
  const nu = Math.max(1, Math.floor((c.hl * 2 - 0.6) / step)), nv = Math.max(1, Math.floor((c.hw * 2 - 0.6) / step));
  const leaf = pick(c, TOWN_COLORS.foliage), fruit = pick(c, TOWN_COLORS.fruit);
  const bark = pick(c, TOWN_COLORS.logs), white = rgb(TOWN_COLORS.trim[0]);
  const rr = range(c, 1.05, 1.25), trunk = 1.1;
  const trees: XY[] = [];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const cu = -c.hl + 0.3 + (i + 0.5) * ((c.hl * 2 - 0.6) / nu), cv = -c.hw + 0.3 + (j + 0.5) * ((c.hw * 2 - 0.6) / nv);
      if (!inside(c, cu, cv)) continue;
      trees.push([cu, cv]);
      cylinder(c.mesh, [cu, cv, 0], [cu, cv, 0.7], 0.11, white);
      cylinder(c.mesh, [cu, cv, 0.7], [cu, cv, trunk + 0.3], 0.1, bark);
      const r = rr * range(c, 0.92, 1.05);
      revolve(c.mesh, cu, cv, trunk, [[0.35 * r, 0], [r * 0.95, 0.35 * r], [r, 0.8 * r], [r * 0.75, 1.3 * r], [0, 1.6 * r]], shade(leaf, range(c, 0.92, 1.08)), 10);
      // fruit around the crown's widest ring
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + c.r(), z = trunk + r * (0.5 + 0.5 * c.r());
        const rad = r * 1.0;
        prism(c.mesh, square(cu + Math.cos(a) * rad, cv + Math.sin(a) * rad, 0.17), z, z + 0.17, fruit, fruit);
      }
    }
  if (trees.length) {
    const [tu, tv] = trees[0];
    const wood = pick(c, TOWN_COLORS.planks);
    for (const s of [-0.22, 0.22]) cylinder(c.mesh, [tu + 1.1, tv + s, 0.04], [tu + 0.25, tv + s, 2.2], 0.035, wood);
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      cylinder(c.mesh, [tu + 1.1 - 0.85 * t, tv - 0.22, 2.2 * t], [tu + 1.1 - 0.85 * t, tv + 0.22, 2.2 * t], 0.02, wood);
    }
    revolve(c.mesh, tu + 1.4, tv + 0.7, 0, [[0.22, 0], [0.3, 0.32], [0, 0.32]], pick(c, TOWN_COLORS.thatch), 8);
    revolve(c.mesh, tu + 1.4, tv + 0.7, 0.32, [[0.28, 0], [0, 0.06]], fruit, 8);
  }
  fence(c, [-c.hl, -c.hw, c.hl, c.hw], streetEdge(c), true);
}

// Excavation: a dark trench lined with planks under a grid of strings on pegs, rounded spoil heaps, a sieve on legs, a
// bucket and a ladder down into the trench.
function dig(c: Ctx): void {
  const soil = pick(c, TOWN_COLORS.soil);
  prism(c.mesh, c.uv, 0, 0.03, shade(soil, 1.15), shade(soil, 1.15));
  const tu = c.hl * 0.62, tv = c.hw * 0.55, cu = -c.hl * 0.12;
  const pit = rgb(TOWN_COLORS.pit[0]), wood = pick(c, TOWN_COLORS.planks);
  prism(c.mesh, rect(cu - tu, -tv, cu + tu, tv), 0.03, 0.05, pit, pit);
  const T = rect(cu - tu, -tv, cu + tu, tv);
  for (let i = 0; i < 4; i++) beam(c, T[i], T[(i + 1) % 4], 0.03, 0.16, 0.22, wood);
  // pegs on the rim and strings across, every metre or so
  const n = Math.max(2, Math.round((tu * 2) / 1.2)), m = Math.max(2, Math.round((tv * 2) / 1.2));
  const peg = (p: XY) => cylinder(c.mesh, [p[0], p[1], 0.03], [p[0], p[1], 0.55], 0.035, wood);
  const str = rgb(TOWN_COLORS.trim[0]);
  for (let k = 0; k <= n; k++) {
    const u = cu - tu + (2 * tu * k) / n;
    peg([u, -tv - 0.2]);
    peg([u, tv + 0.2]);
    cylinder(c.mesh, [u, -tv - 0.2, 0.5], [u, tv + 0.2, 0.5], 0.012, str, str, 4);
  }
  for (let k = 0; k <= m; k++) {
    const v = -tv + (2 * tv * k) / m;
    peg([cu - tu - 0.2, v]);
    peg([cu + tu + 0.2, v]);
    cylinder(c.mesh, [cu - tu - 0.2, v, 0.5], [cu + tu + 0.2, v, 0.5], 0.012, str, str, 4);
  }
  // spoil heaps, rounded, beside the trench
  const side = cu + tu + (c.hl - (cu + tu)) / 2;
  for (const [v, k] of [[-c.hw * 0.5, 1], [c.hw * 0.45, 0.8]] as const) {
    const r = Math.min(0.9, (c.hl - (cu + tu)) * 0.55) * k;
    revolve(c.mesh, side, v, 0.03, [[r, 0], [r * 0.85, r * 0.35], [r * 0.5, r * 0.62], [0, r * 0.72]], soil, 10);
  }
  // the sieve on four legs and a bucket in front of the trench
  const sv = -c.hw + 0.55, su = cu - tu * 0.4;
  for (const [du, dv] of [[-0.35, -0.25], [0.35, -0.25], [0.35, 0.25], [-0.35, 0.25]]) cylinder(c.mesh, [su + du, sv + dv, 0], [su + du, sv + dv, 0.7], 0.03, wood);
  prism(c.mesh, rect(su - 0.42, sv - 0.32, su + 0.42, sv + 0.32), 0.7, 0.8, wood, shade(pit, 1.6));
  revolve(c.mesh, su + 1, sv, 0, [[0.16, 0], [0.2, 0.32], [0, 0.32]], rgb(TOWN_COLORS.iron[0]), 8);
  // a ladder standing in the trench
  for (const s of [-0.2, 0.2]) cylinder(c.mesh, [cu - tu * 0.5 + s, 0.2, 0.05], [cu - tu * 0.5 + s, -0.25, 1.3], 0.03, wood);
}

// Forager's camp: a shelter of poles and bark like a cone, baskets of berries, a tray of mushrooms and a small fire.
function tent(c: Ctx): void {
  const r = Math.min(c.hl, c.hw) * 0.55, cu = -c.hl * 0.3, cv = -c.hw * 0.25, H = clamp(c.height + 0.6, 2.2, 3);
  const bark = pick(c, TOWN_COLORS.logs), pole = shade(bark, 1.2);
  revolve(c.mesh, cu, cv, 0, [[r, 0], [r * 0.55, H * 0.45], [r * 0.18, H * 0.78]], shade(bark, 0.85), 9);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const base: [number, number, number] = [cu + Math.cos(a) * r * 1.02, cv + Math.sin(a) * r * 1.02, 0.05];
    const apex: [number, number, number] = [cu - Math.cos(a) * 0.15, cv - Math.sin(a) * 0.15, H];
    cylinder(c.mesh, base, apex, 0.04, pole);
  }
  // baskets full of berries
  const basket = pick(c, TOWN_COLORS.thatch);
  for (const [fu, fv] of [[0.55, 0.55], [0.85, 0.2]]) {
    const u = fu * c.hl, v = fv * c.hw;
    revolve(c.mesh, u, v, 0, [[0.22, 0], [0.3, 0.32], [0, 0.32]], basket, 8);
    revolve(c.mesh, u, v, 0.32, [[0.28, 0], [0, 0.07]], pick(c, TOWN_COLORS.berries), 8);
  }
  // a tray of mushrooms
  const tu = c.hl * 0.6, tv = -c.hw * 0.55;
  prism(c.mesh, rect(tu - 0.45, tv - 0.3, tu + 0.45, tv + 0.3), 0, 0.12, basket, basket);
  for (const [du, dv] of [[-0.25, -0.12], [0, 0.1], [0.25, -0.08], [0.15, 0.15], [-0.2, 0.15]]) {
    revolve(c.mesh, tu + du, tv + dv, 0.12, [[0.04, 0], [0.04, 0.07], [0.12, 0.08], [0, 0.14]], rgb(TOWN_COLORS.mushroom[0]), 6);
  }
  const fire: XY = [c.hl * 0.2, c.hw * 0.55];
  revolve(c.mesh, fire[0], fire[1], 0, [[0.35, 0], [0.35, 0.15], [0.22, 0.15], [0.22, 0.04], [0, 0.04]], pick(c, TOWN_COLORS.stone), 9);
  revolve(c.mesh, fire[0], fire[1], 0.04, [[0.2, 0], [0, 0.03]], rgb(TOWN_COLORS.ember[0]), 8);
}

// Cellar: a rounded earth mound with grass on it, an entrance of stone at the street end with a plank door and steps,
// and a vent pipe on top.
function cellar(c: Ctx): void {
  const { axis } = streetSide(c);
  // the mound's ridge runs towards the street; its profile across is an arch, the lowest of planes tangent to it
  const a = axis === 1 ? c.hl : c.hw, b = clamp(a * 0.9, 1, 2.2);
  const planes: [number, number, number][] = [];
  for (const deg of [-78, -60, -38, -14, 14, 38, 60, 78]) {
    const t = (deg * Math.PI) / 180, k = (b * Math.tan(t)) / a;
    planes.push(axis === 1 ? [-k, 0, b / Math.cos(t)] : [0, -k, b / Math.cos(t)]);
  }
  const roof = planeRoof(planes);
  const turf = pick(c, TOWN_COLORS.turf), earth = pick(c, TOWN_COLORS.soil);
  band(c.mesh, c.uv, 0, roof, 0, null, earth, PATTERN.plain, 0);
  roofSurface(c.mesh, c.tris, 0, roof, turf, NOFAC);
  if (c.door >= 0) {
    const stone = pick(c, TOWN_COLORS.stone), wood = pick(c, TOWN_COLORS.planks);
    prism(c.mesh, edgeBox(c.uv, c.door, -1, -0.65, 0, 0.35), 0, 1.75, stone, shade(stone, 1.1));
    prism(c.mesh, edgeBox(c.uv, c.door, 0.65, 1, 0, 0.35), 0, 1.75, stone, shade(stone, 1.1));
    prism(c.mesh, edgeBox(c.uv, c.door, -1.1, 1.1, 0, 0.4), 1.75, 2.05, stone, shade(stone, 1.1));
    prism(c.mesh, edgeBox(c.uv, c.door, -0.65, 0.65, 0.02, 0.12), 0, 1.7, shade(wood, 0.7), shade(wood, 0.7), PATTERN.boards);
    prism(c.mesh, edgeBox(c.uv, c.door, -0.7, 0.7, 0.35, 0.75), 0, 0.15, stone, shade(stone, 1.1));
    prism(c.mesh, edgeBox(c.uv, c.door, -0.7, 0.7, 0.75, 1.1), 0, 0.07, stone, shade(stone, 1.1));
    const e = edgeFrame(c.uv, c.door), half = axis === 1 ? c.hw : c.hl;
    const v: XY = [e.m[0] - e.n[0] * half * 1.3, e.m[1] - e.n[1] * half * 1.3];
    cylinder(c.mesh, [v[0], v[1], b * 0.8], [v[0], v[1], b + 0.6], 0.1, shade(wood, 0.8));
    prism(c.mesh, square(v[0], v[1], 0.32), b + 0.6, b + 0.68, shade(wood, 0.6), shade(wood, 0.6));
  }
}

// Builds the model of a building of the town. `height` is the template height in metres (after any upgrade).
export function buildTownModel(ringIn: readonly XY[], height: number, template: string, opts: TownOptions = {}): Model {
  const form = townForm(template);
  const h = clamp(Number.isFinite(height) ? height : 5, 1, 30);
  if (form === "chapel") return buildHeritageModel(ringIn, h * 0.75, "place_of_worship", opts.seed);
  const { box, uv, tris, seed } = framed(ringIn);
  const toUV = (p: XY): XY => [p[0] * box.ux + p[1] * box.uy, -p[0] * box.uy + p[1] * box.ux];
  const front = opts.front ? toUV(opts.front) : null;
  const c: Ctx = {
    mesh: new Mesh(box),
    uv,
    tris,
    hl: Math.max(box.len, 1) / 2,
    hw: Math.max(box.wid, 1) / 2,
    cu: 0,
    cv: 0,
    front,
    r: rng(opts.seed ?? seed),
    door: frontEdge(uv, front),
    height: h,
    template,
    opts,
    tint: opts.tint ? rgb(opts.tint) : null,
  };
  BUILDERS[form](c);
  return c.mesh.m;
}

const BUILDERS: Record<Exclude<TownForm, "chapel">, (c: Ctx) => void> = { cabin, shop, healer, hut, workshop, farm, store, school, logyard: logYard, sawframe: sawFrame, market, well, garden, orchard, apiary, quarry, dig, tent, pier, cellar };

