import { MODEL_COLORS, type ModelFamily } from "../ui/palette";
import { band, clamp, domed, framed, Mesh, ledge, merlons, MIN_SIDE, NOFAC, offsetRing, PATTERN, planeRoof, pointInRing, prism, rgb, rng, ROOF_FAC, roofOf, roofSurface, shade, square, tower, triangulate, type DomeShape, type Model, type RGB, type RoofShape, type TowerCap, type XY } from "./modelGeometry";

// Models of restored old buildings (PLAN-research.ru.md section 8): real ring + eaves height + OSM kind -> mesh, on the
// shared geometry of modelGeometry.ts. Each building draws its roof shape, pitch, overhang, colours, chimneys, domes and
// tower caps from a seed (the ring by default), so neighbours differ and a building keeps its look.

// Roof family of an OSM kind (the `cls` of src/sim/heritage.ts).
export function modelFamily(kind: string): ModelFamily {
  switch (kind) {
    case "place_of_worship":
    case "monastery":
      return "worship";
    case "castle":
    case "town_hall":
    case "monument":
      return "tower";
    case "school":
    case "college":
    case "museum":
    case "library":
    case "theatre":
    case "hospital":
      return "hip";
    case "station":
    case "halt":
    case "bus_station":
    case "harbor":
    case "ferry_terminal":
    case "car_repair":
    case "marketplace":
    case "department_store":
    case "mall":
    case "wholesale":
      return "flat";
    default:
      return "house";
  }
}

// Every random choice of one building, made up front so the geometry below is a plain function of it.
export interface Variant {
  roof: RoofShape;
  pitch: number; // ridge rise / building width
  overhang: number; // m the roof reaches past the walls (pitched roofs)
  wall: RGB;
  roofC: RGB;
  accent: RGB;
  chimneys: XY[]; // (u, v) as fractions of the half length / half width
  dome: DomeShape; // worship: shape of the domes
  fiveDomes: boolean; // worship: four small domes around the main one
  cap: TowerCap; // top of a tower
  boxes: [number, number, number, number][]; // flat roofs: (u, v) fractions, side m, height m of rooftop boxes
}


// The random choices for an OSM kind on a box of `len` x `wid` metres.
export function pickVariant(kind: string, seed: number, len: number, wid: number): Variant {
  const r = rng(seed);
  const range = (a: number, b: number) => a + (b - a) * r();
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
  const family = modelFamily(kind);
  const pal = MODEL_COLORS[family];
  const v: Variant = {
    roof: "gable",
    pitch: 0.3,
    overhang: 0,
    wall: rgb(pick(pal.wall)),
    roofC: rgb(pick(pal.roof)),
    accent: rgb(pick(pal.accent)),
    chimneys: [],
    dome: "helmet",
    fiveDomes: false,
    cap: "spire",
    boxes: [],
  };
  const slender = len / Math.max(wid, 1e-6);
  switch (family) {
    case "house": {
      const t = r();
      v.roof = t < 0.45 ? "gable" : t < 0.65 ? "halfhip" : t < 0.85 ? (slender < 2.4 ? "hip" : "gable") : wid >= 6.5 ? "gambrel" : "gable";
      v.pitch = range(0.28, 0.42);
      v.overhang = range(0.3, 0.55);
      if (r() < 0.75) {
        const fu = range(-0.5, 0.5);
        v.chimneys.push([fu, r() < 0.5 ? 0.4 : -0.4]);
        if (len > 16 && r() < 0.5) v.chimneys.push([-fu, -0.4]);
      }
      break;
    }
    case "hip":
      v.roof = r() < 0.7 ? "hip" : "halfhip";
      v.pitch = range(0.2, 0.3);
      v.overhang = range(0.4, 0.6);
      if (r() < 0.6) v.chimneys.push([0.55, 0.42], [-0.55, -0.42]);
      break;
    case "worship": {
      v.roof = "gable";
      v.pitch = range(0.24, 0.32);
      v.overhang = 0.35;
      const t = r();
      v.dome = t < 0.45 ? "onion" : t < 0.8 ? "helmet" : "tent";
      v.fiveDomes = wid >= 9 && r() < 0.45;
      v.cap = r() < 0.5 ? "spire" : "onion";
      break;
    }
    case "tower":
      if (kind === "town_hall") {
        v.roof = "hip";
        v.pitch = range(0.18, 0.26);
        v.overhang = 0.4;
        v.cap = r() < 0.6 ? "spire" : "onion";
      } else {
        v.roof = "flat";
        v.cap = kind === "castle" && r() < 0.6 ? "merlons" : "spire";
      }
      break;
    case "flat": {
      v.roof = "flat";
      const n = Math.floor(r() * 3) + (len * wid > 300 ? 1 : 0);
      for (let i = 0; i < n; i++) v.boxes.push([range(-0.6, 0.6), range(-0.5, 0.5), range(1.6, 3.2), range(0.8, 2)]);
      break;
    }
  }
  return v;
}

const WALL_PATTERN: Record<ModelFamily, number> = { house: PATTERN.house, hip: PATTERN.hall, worship: PATTERN.worship, tower: PATTERN.tower, flat: PATTERN.wide, scaffold: PATTERN.logs };

// Builds the model of a restored building. `height` is the eaves height of the main volume in metres; `seed` picks the
// variant (default: from the ring, so a building keeps its look).
export function buildHeritageModel(ringIn: readonly XY[], height: number, kind: string, seed?: number): Model {
  const family = modelFamily(kind);
  const h = clamp(Number.isFinite(height) ? height : 6, 2, 60);
  const { box, uv, tris, seed: ringS } = framed(ringIn);
  const hl = Math.max(box.len, MIN_SIDE) / 2, hw = Math.max(box.wid, MIN_SIDE) / 2;
  const wid = hw * 2, len = hl * 2;
  const v = pickVariant(kind, seed ?? ringS, len, wid);
  const mesh = new Mesh(box);
  const inside = (u: number, w: number) => pointInRing(u, w, uv);

  // Interior point for towers and domes: the box centre if it is inside the ring, else the ring centroid.
  const spot = (): [number, number] | null => {
    if (inside(0, 0)) return [0, 0];
    const cx = uv.reduce((s, p) => s + p[0], 0) / uv.length, cy = uv.reduce((s, p) => s + p[1], 0) / uv.length;
    return inside(cx, cy) ? [cx, cy] : null;
  };

  const riseMax = family === "worship" ? clamp(wid * v.pitch, 1.2, 4.5) : clamp(wid * v.pitch, 1, 5.5);
  const roof = roofOf(v.roof, hl, hw, riseMax);
  const parapet = v.roof !== "flat" ? 0 : kind === "castle" ? 0.9 : 0.6;
  const wallPat = WALL_PATTERN[family];
  band(mesh, uv, h, roof, parapet, null, v.wall, wallPat, h);
  // plinth course: a slightly darker, wider base
  const plinth = offsetRing(uv, 0.08);
  if (plinth) band(mesh, plinth, 0, planeRoof([]), 0.45, null, shade(v.wall, 0.78), PATTERN.plain, 0);

  if (v.roof === "flat") {
    roofSurface(mesh, tris, h, roof, v.roofC, NOFAC);
    const top = h + parapet;
    const cornice = offsetRing(uv, 0.18);
    if (cornice) {
      band(mesh, cornice, top, roof, 0, -0.28, v.accent, PATTERN.plain, 0);
      ledge(mesh, uv, cornice, top, v.accent);
    }
    if (v.cap === "merlons" && family === "tower") merlons(mesh, uv, top, v.wall);
    for (const [fu, fv, side, bh] of v.boxes) {
      const sq = square(fu * hl, fv * hw, Math.min(side, wid * 0.4));
      if (sq.every(([a, b]) => inside(a, b))) prism(mesh, sq, h, h + bh, shade(v.wall, 0.9), shade(v.roofC, 0.85));
    }
  } else {
    // the roof reaches past the walls when the offset ring is sane; a thin fascia gives it an edge
    const eaves = (v.overhang > 0 && offsetRing(uv, v.overhang)) || null;
    const roofTris = eaves ? triangulate(eaves) : null;
    if (eaves && roofTris) {
      roofSurface(mesh, roofTris, h, roof, v.roofC, ROOF_FAC);
      band(mesh, eaves, h, roof, 0, -0.18, shade(v.roofC, 0.7), PATTERN.plain, 0);
    } else roofSurface(mesh, tris, h, roof, v.roofC, ROOF_FAC);
    for (const [fu, fv] of v.chimneys) {
      const cu = fu * hl, cv = fv * hw, side = 0.7;
      const sq = square(cu, cv, side);
      if (!sq.every(([a, b]) => inside(a, b))) continue;
      const base = h + Math.min(...sq.map(([a, b]) => roof.rise(a, b))) - 0.2;
      prism(mesh, sq, base, Math.max(base + 1, h + riseMax + 0.5), v.accent, shade(v.accent, 0.6));
    }
  }

  const ridge = h + roof.rise(0, 0);
  const at = spot();
  if (family === "worship" && at) {
    // Drum and dome over the main volume, shifted towards one end of a long church; four small domes around it on wide
    // ones; a slim bell tower at the other, narrow end when the ring is long enough.
    const shift = len / wid > 1.8 ? len * 0.15 : 0;
    const du = inside(at[0] + shift, at[1]) ? shift : 0;
    const cu = at[0] + du, cv = at[1];
    const r = clamp(wid * 0.26, 1.1, 4.5);
    const drumH = clamp(r * 0.9, 1, 3.5);
    const shape = r < 1.8 ? "tent" : v.dome;
    domed(mesh, cu, cv, r, h, ridge + drumH, shape, v.wall, v.accent, v.accent);
    if (v.fiveDomes) {
      const r2 = r * 0.45, d = r * 1.55;
      for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
        if (inside(cu + su * d, cv + sv * d)) domed(mesh, cu + su * d, cv + sv * d, r2, h, ridge + drumH * 0.55, shape, v.wall, v.accent, v.accent);
    }
    if (len >= 14 && wid >= 5) {
      const side = clamp(wid * 0.28, 2, 3.2);
      const tu = -hl + side / 2 + 0.3;
      if (inside(tu, 0) && inside(tu - side / 2, 0) && inside(tu + side / 2, 0)) {
        const top = ridge + clamp(len * 0.35, 5, 14);
        tower(mesh, tu, 0, side, 0, top, v.cap === "merlons" ? "spire" : v.cap, v.wall, v.roofC, v.accent);
      }
    }
  } else if (family === "tower" && at) {
    if (kind === "monument") {
      const side = clamp(wid * 0.6, 1.5, 8);
      tower(mesh, at[0], at[1], side, h, h + clamp(h * 0.3, 1, 6), "spire", v.wall, v.accent, v.accent);
    } else {
      const side = clamp(wid * 0.4, 2.4, 7);
      tower(mesh, at[0], at[1], side, h, ridge + clamp(wid * 0.8, 4, 12), v.cap, v.wall, v.roofC, v.accent);
    }
  }
  return mesh.m;
}

