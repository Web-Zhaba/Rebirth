import { TOWN_COLORS } from "../ui/palette";
import { buildHeritageModel } from "./heritageModels";
import {
  band,
  clamp,
  cornerPosts,
  DOOR,
  framed,
  GATE,
  Mesh,
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

// What a template is drawn as.
export type TownForm = "cabin" | "workshop" | "barn" | "shed" | "pavilion" | "well" | "garden" | "orchard" | "apiary" | "quarry" | "dig" | "tent" | "pier" | "cellar" | "chapel" | "school";

const FORMS: Record<string, TownForm> = {
  izba: "cabin",
  izba5: "cabin",
  shop: "cabin",
  tavern: "cabin",
  healer: "cabin",
  hunter: "cabin",
  smithy: "workshop",
  carpentry: "workshop",
  pottery: "workshop",
  gumno: "barn",
  barn: "barn",
  woodcutter: "shed",
  sawpit: "shed",
  market: "pavilion",
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
  const roof = roofOf(b.roof, c.hl, c.hw, b.rise);
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

// Log house (and the plastered ones: shop, tavern, healer). One floor, two for a rebuilt house and the tavern.
function cabin(c: Ctx): void {
  const t = c.template;
  const wid = c.hw * 2;
  const plastered = t === "shop" || t === "healer" || (t === "tavern" && c.r() < 0.6);
  const twoFloors = (c.opts.level ?? 1) >= 2 || t === "tavern";
  const eaves = twoFloors ? clamp(c.height * 0.82, 4.6, 7) : clamp(c.height * 0.6, 2.4, 4.2);
  const k = c.r();
  const roof: RoofShape = t === "healer" ? "hip" : k < 0.5 ? "gable" : k < 0.72 ? "halfhip" : k < 0.85 && wid >= 6.5 ? "gambrel" : t === "hunter" ? "shed" : "gable";
  const rise = clamp(wid * range(c, 0.36, 0.5), 1.2, 4.5);
  const wall = pick(c, plastered ? TOWN_COLORS.plaster : TOWN_COLORS.logs);
  const pat = plastered ? (t === "tavern" ? PATTERN.hall : PATTERN.house) : PATTERN.cabin;
  const roofC = pick(c, roofPalette(c, wid < 6));
  const r = body(c, { eaves, roof, rise, overhang: range(c, 0.35, 0.6), wall, roofC, pat, doorPat: pat + DOOR, plinth: true });
  const brick = pick(c, TOWN_COLORS.stone);
  const fu = range(c, -0.3, 0.3) * c.hl, fv = (c.r() < 0.5 ? 0.2 : -0.2) * c.hw;
  if (t === "tavern") {
    chimney(c, r, eaves, eaves + rise + 0.5, fu, fv, 0.7, brick);
    chimney(c, r, eaves, eaves + rise + 0.5, -fu, -fv, 0.7, brick);
  } else if (t !== "hunter" ? c.r() < 0.85 : c.r() < 0.4) chimney(c, r, eaves, eaves + rise + 0.5, fu, fv, 0.6, brick);
  const wood = pick(c, TOWN_COLORS.planks);
  if (t === "shop") {
    // a sign board over the door
    if (c.door >= 0) prism(c.mesh, edgeBox(c.uv, c.door, -0.8, 0.8, 0.02, 0.1), 2.3, 2.8, pick(c, TOWN_COLORS.goods), wood);
  } else if (eaves >= 2.4 && c.r() < 0.45) porch(c, wood);
  if (c.opts.upgrading) cornerPosts(c.mesh, c.uv, eaves + rise + 1, wood, 0.18);
}

// Smithy, pottery, carpentry: stone or plank walls, a wide door, a low gable or lean-to roof, a big chimney or a kiln.
function workshop(c: Ctx): void {
  const t = c.template;
  const wid = c.hw * 2;
  const eaves = clamp(c.height * 0.7, 2.6, 4);
  const roof: RoofShape = c.r() < 0.3 ? "shed" : "gable";
  const rise = clamp(wid * range(c, 0.22, 0.32), 0.8, 3);
  const stone = t !== "carpentry";
  const wall = pick(c, stone ? TOWN_COLORS.stone : TOWN_COLORS.planks);
  const pat = stone ? PATTERN.house : PATTERN.boards;
  const r = body(c, { eaves, roof, rise, overhang: range(c, 0.3, 0.5), wall, roofC: pick(c, c.r() < 0.5 ? TOWN_COLORS.roofPlank : TOWN_COLORS.shingle), pat, doorPat: pat + GATE, plinth: stone });
  const brick = pick(c, TOWN_COLORS.stone);
  const cu = range(c, -0.45, 0.45) * c.hl;
  if (t === "smithy") chimney(c, r, eaves, eaves + rise + 1.6, cu, 0, 1.1, shade(brick, 0.85));
  else if (t === "pottery" && inside(c, cu, 0)) {
    // round kiln chimney
    const base = eaves + r.rise(cu, 0) - 0.3;
    revolve(c.mesh, cu, 0, base, [[0.55, 0], [0.5, eaves + rise + 1.2 - base], [0, eaves + rise + 1.2 - base]], brick, 10);
  } else if (t === "carpentry") logPile(c, c.hl * 0.55, c.hw * 0.55, 0.9);
}

// Long low-walled barn with a steep roof and a gate: the farm and the store.
function barn(c: Ctx): void {
  const wid = c.hw * 2;
  const eaves = clamp(c.height * 0.45, 2.4, 3.6);
  const k = c.r();
  const roof: RoofShape = c.template === "barn" && k < 0.35 ? "gambrel" : k < 0.75 ? "gable" : "halfhip";
  const rise = clamp(wid * range(c, 0.45, 0.6), 2, 5.5);
  const logs = c.r() < 0.4;
  const wall = pick(c, logs ? TOWN_COLORS.logs : TOWN_COLORS.planks);
  const pat = logs ? PATTERN.logs : PATTERN.boards;
  body(c, { eaves, roof, rise, overhang: range(c, 0.3, 0.5), wall, roofC: pick(c, c.r() < 0.5 ? TOWN_COLORS.thatch : TOWN_COLORS.roofPlank), pat, doorPat: pat + GATE, plinth: false });
  if (c.template === "gumno" && c.r() < 0.7) haystack(c);
  if (c.opts.upgrading) cornerPosts(c.mesh, c.uv, eaves + rise + 1, pick(c, TOWN_COLORS.planks), 0.18);
}

// A haystack in the ring's free corner, when it has one.
function haystack(c: Ctx): void {
  const cu = c.hl * 0.65, cv = c.hw * 0.6;
  if (!inside(c, cu, cv)) return;
  const r = Math.min(c.hw, c.hl) * 0.3;
  revolve(c.mesh, cu, cv, 0, [[r, 0], [r * 1.05, r * 0.6], [r * 0.7, r * 1.5], [0, r * 2.1]], pick(c, TOWN_COLORS.thatch), 10);
}

// A stack of logs: a box painted with log courses.
function logPile(c: Ctx, cu: number, cv: number, h: number): void {
  const sq = rect(cu - 0.9, cv - 0.5, cu + 0.9, cv + 0.5);
  if (!sq.every(([a, b]) => inside(c, a, b))) return;
  const col = pick(c, TOWN_COLORS.logs);
  prism(c.mesh, sq, 0, h, col, shade(col, 1.15), PATTERN.logs);
}

// Open shed on posts: the woodcutter's (with log piles under it) and the saw pit (with a log on trestles).
function shed(c: Ctx): void {
  const eaves = clamp(c.height * 0.8, 2.2, 3);
  const wid = c.hw * 2;
  const roof = roofOf(c.r() < 0.5 ? "shed" : "gable", c.hl, c.hw, clamp(wid * range(c, 0.2, 0.3), 0.6, 2));
  const wood = pick(c, TOWN_COLORS.planks);
  cornerPosts(c.mesh, c.uv, eaves, wood, 0.2);
  eavesRoof(c, roof, eaves, 0.3, pick(c, c.r() < 0.5 ? TOWN_COLORS.roofPlank : TOWN_COLORS.thatch));
  if (c.template === "sawpit") {
    const col = pick(c, TOWN_COLORS.logs);
    for (const u of [-0.5, 0.5]) prism(c.mesh, rect(u * c.hl - 0.15, -0.5, u * c.hl + 0.15, 0.5), 0, 0.9, wood, wood);
    prism(c.mesh, rect(-c.hl * 0.75, -0.2, c.hl * 0.75, 0.2), 0.9, 1.3, col, shade(col, 1.2));
  } else {
    logPile(c, -c.hl * 0.35, 0, 1.1);
    logPile(c, c.hl * 0.35, 0, 0.8);
  }
}

// Market: a roof on posts over a few stalls with goods.
function pavilion(c: Ctx): void {
  const eaves = clamp(c.height * 0.75, 2.6, 3.4);
  const wid = c.hw * 2;
  const wood = pick(c, TOWN_COLORS.planks);
  const roof = roofOf(c.r() < 0.6 ? "hip" : "gable", c.hl, c.hw, clamp(wid * range(c, 0.2, 0.28), 1, 3.5));
  // posts every ~3 m along the walls
  const inner = offsetRing(c.uv, -0.3) ?? c.uv;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i], b = inner[(i + 1) % inner.length];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
    for (let k = 0; k < n; k++) prism(c.mesh, square(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, 0.22), 0, eaves, wood, wood);
  }
  eavesRoof(c, roof, eaves, 0.4, pick(c, c.r() < 0.5 ? TOWN_COLORS.shingle : TOWN_COLORS.thatch));
  // stalls: counters in two rows with crates on them
  const cols = Math.max(1, Math.floor((c.hl * 2 - 2) / 3.2));
  for (const sv of [-0.45, 0.45])
    for (let k = 0; k < cols; k++) {
      const cu = -c.hl + 1 + 1.6 + k * 3.2, cv = sv * c.hw;
      const top = rect(cu - 1.1, cv - 0.45, cu + 1.1, cv + 0.45);
      if (!top.every(([a, b]) => inside(c, a, b))) continue;
      prism(c.mesh, top, 0, 0.9, wood, shade(wood, 1.1));
      for (const du of [-0.6, 0, 0.6]) if (c.r() < 0.75) prism(c.mesh, square(cu + du, cv, 0.4), 0.9, 0.9 + range(c, 0.2, 0.4), pick(c, TOWN_COLORS.goods), pick(c, TOWN_COLORS.goods));
    }
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

// Orchard: trees in a grid.
function orchard(c: Ctx): void {
  const grass = shade(pick(c, TOWN_COLORS.foliage), 1.15);
  prism(c.mesh, c.uv, 0, 0.04, grass, grass);
  const step = 3.2;
  const nu = Math.max(1, Math.floor((c.hl * 2) / step)), nv = Math.max(1, Math.floor((c.hw * 2) / step));
  const bark = pick(c, TOWN_COLORS.logs);
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const cu = -c.hl + (i + 0.5) * ((c.hl * 2) / nu) + range(c, -0.3, 0.3), cv = -c.hw + (j + 0.5) * ((c.hw * 2) / nv) + range(c, -0.3, 0.3);
      if (!inside(c, cu, cv)) continue;
      const trunk = range(c, 1, 1.5), rr = range(c, 1, 1.5), hh = rr * range(c, 1.4, 1.8);
      prism(c.mesh, square(cu, cv, 0.22), 0, trunk + 0.2, bark, bark);
      revolve(c.mesh, cu, cv, trunk, [[0.3 * rr, 0], [rr, 0.3 * hh], [rr * 0.95, 0.6 * hh], [rr * 0.55, 0.9 * hh], [0, hh]], pick(c, TOWN_COLORS.foliage), 9);
    }
}

// Apiary: rows of hives with little roofs.
function apiary(c: Ctx): void {
  const grass = shade(pick(c, TOWN_COLORS.foliage), 1.15);
  prism(c.mesh, c.uv, 0, 0.04, grass, grass);
  for (let u = -c.hl + 0.8; u <= c.hl - 0.8; u += 1.3)
    for (let v = -c.hw + 0.8; v <= c.hw - 0.8; v += 1.5) {
      const sq = square(u, v, 0.55);
      if (!sq.every(([a, b]) => inside(c, a, b))) continue;
      const col = pick(c, TOWN_COLORS.hive), h = range(c, 0.55, 0.75);
      prism(c.mesh, sq, 0, h, col, col, PATTERN.logs);
      pyramid(c.mesh, square(u, v, 0.68), h, 0.18, pick(c, TOWN_COLORS.roofPlank));
    }
}

// Quarry: rubble with stone blocks of random sizes.
function quarry(c: Ctx): void {
  const base = pick(c, TOWN_COLORS.stone);
  prism(c.mesh, c.uv, 0, 0.12, shade(base, 0.9), shade(base, 0.9));
  const n = 4 + Math.floor(c.r() * 4);
  for (let k = 0; k < n; k++) {
    const cu = range(c, -0.7, 0.7) * c.hl, cv = range(c, -0.7, 0.7) * c.hw, s = range(c, 0.8, 2.2);
    const sq = rect(cu - s / 2, cv - s * 0.35, cu + s / 2, cv + s * 0.35);
    if (!sq.every(([a, b]) => inside(c, a, b))) continue;
    const col = shade(pick(c, TOWN_COLORS.stone), range(c, 0.85, 1.1));
    prism(c.mesh, sq, 0.12, 0.12 + range(c, 0.5, 1.8) * Math.min(1, c.height / 3), col, shade(col, 1.1));
  }
}

// Excavation: dug-out earth, spoil heaps at the edges and a plank walk.
function dig(c: Ctx): void {
  const soil = pick(c, TOWN_COLORS.soil);
  prism(c.mesh, c.uv, 0, 0.05, shade(soil, 0.8), shade(soil, 0.8));
  for (const [su, sv] of [[0.6, 0.6], [-0.6, 0.55], [0.55, -0.6]]) {
    const cu = su * c.hl, cv = sv * c.hw, s = Math.min(c.hl, c.hw) * range(c, 0.5, 0.7);
    if (inside(c, cu, cv)) pyramid(c.mesh, square(cu, cv, s), 0.05, s * 0.45, soil);
  }
  prism(c.mesh, rect(-c.hl * 0.8, -0.3, c.hl * 0.8, 0.3), 0.05, 0.15, pick(c, TOWN_COLORS.planks), pick(c, TOWN_COLORS.planks));
}

// Forager's camp: a canvas tent and baskets.
function tent(c: Ctx): void {
  const s = Math.min(c.hl, c.hw) * 1.3;
  pyramid(c.mesh, square(0, 0, s), 0, clamp(c.height, 1.6, 2.4), pick(c, TOWN_COLORS.canvas));
  const basket = pick(c, TOWN_COLORS.thatch);
  for (const [u, v] of [[0.75, 0.7], [0.75, -0.7]]) if (inside(c, u * c.hl, v * c.hw)) revolve(c.mesh, u * c.hl, v * c.hw, 0, [[0.25, 0], [0.32, 0.4], [0, 0.4]], basket, 8);
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

// Cellar: a turf-covered mound with a door.
function cellar(c: Ctx): void {
  const eaves = 0.5;
  const rise = clamp(c.hw * 2 * 0.42, 1, 2.4);
  const wall = pick(c, TOWN_COLORS.planks);
  body(c, { eaves, roof: "gable", rise, overhang: 0.2, wall, roofC: pick(c, TOWN_COLORS.turf), pat: PATTERN.plain, doorPat: PATTERN.plain, plinth: false });
  if (c.door >= 0) prism(c.mesh, edgeBox(c.uv, c.door, -0.6, 0.6, 0.01, 0.08), 0, 1.5, shade(wall, 0.5), shade(wall, 0.5));
}

// Builds the model of a building of the town. `height` is the template height in metres (after any upgrade).
export function buildTownModel(ringIn: readonly XY[], height: number, template: string, opts: TownOptions = {}): Model {
  const form = townForm(template);
  const h = clamp(Number.isFinite(height) ? height : 5, 1, 30);
  if (form === "chapel") return buildHeritageModel(ringIn, h * 0.75, "place_of_worship", opts.seed);
  if (form === "school") return buildHeritageModel(ringIn, h * 0.75, "school", opts.seed);
  const { box, uv, tris, seed } = framed(ringIn);
  const toUV = (p: XY): XY => [p[0] * box.ux + p[1] * box.uy, -p[0] * box.uy + p[1] * box.ux];
  const c: Ctx = {
    mesh: new Mesh(box),
    uv,
    tris,
    hl: Math.max(box.len, 1) / 2,
    hw: Math.max(box.wid, 1) / 2,
    r: rng(opts.seed ?? seed),
    door: frontEdge(uv, opts.front ? toUV(opts.front) : null),
    height: h,
    template,
    opts,
    tint: opts.tint ? rgb(opts.tint) : null,
  };
  BUILDERS[form](c);
  return c.mesh.m;
}

const BUILDERS: Record<Exclude<TownForm, "chapel" | "school">, (c: Ctx) => void> = { cabin, workshop, barn, shed, pavilion, well, garden, orchard, apiary, quarry, dig, tent, pier, cellar };

