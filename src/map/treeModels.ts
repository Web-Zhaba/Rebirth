import { calendar, DAYS_PER_SEASON } from "../sim/clock";
import { TREE_COLORS } from "../ui/palette";
import { Mesh, revolve, rgb, type Model, type XY } from "./modelGeometry";
import type { TreeKind } from "./treeScatter";

// One tree of each kind, 1 m tall, on the shared mesh of modelGeometry.ts; the tree layer (treeLayer.ts) scales, turns
// and sways each instance. `crown` marks the vertices of the foliage (1) against the trunk (0): the layer recolours
// seasonal crowns and whitens snow on them. The small details (a bush, a clump of reeds, a boulder) are built the same
// way and drawn by the same layer: a boulder is all "crown" (snow lies on its top), its colour kept through the year.

export interface TreeModel extends Model {
  crown: number[]; // per vertex
}

// How the layer treats each kind: a typical height (m, sets how far it is drawn), what turns its crown with the year
// (leaves, reeds, nothing) and how much it sways in the wind.
export const KIND_INFO: Record<TreeKind, { tall: number; season: "leaf" | "reed" | "grass" | null; sway: number }> = {
  conifer: { tall: 12, season: null, sway: 1 },
  broadleaf: { tall: 12, season: "leaf", sway: 1 },
  birch: { tall: 12, season: "leaf", sway: 1 },
  bush: { tall: 1.5, season: "leaf", sway: 1.5 },
  reed: { tall: 1.8, season: "reed", sway: 5 },
  boulder: { tall: 1.2, season: null, sway: 0 },
  grass: { tall: 0.9, season: "grass", sway: 7 },
};

// The colour a kind's crown is built with (seasonal crowns keep its light and shade when recoloured).
export const leafOf = (kind: TreeKind): string =>
  kind === "conifer"
    ? TREE_COLORS.conifer
    : kind === "reed"
      ? TREE_COLORS.reed
      : kind === "boulder"
        ? TREE_COLORS.stone
        : kind === "grass"
          ? TREE_COLORS.grassSummer
          : TREE_COLORS.summer;

type Shaped = "conifer" | "broadleaf" | "birch" | "bush";
// Profiles of revolution: (radius, height) bottom to top, in tree heights.
const SHAPES: Record<Shaped, { trunk: XY[]; bark: string; crowns: { at: XY; z: number; prof: XY[] }[] }> = {
  // a spruce: three stacked cones
  conifer: {
    trunk: [[0.035, 0], [0.022, 0.3]],
    bark: TREE_COLORS.bark,
    crowns: [
      { at: [0, 0], z: 0.1, prof: [[0.27, 0], [0, 0.45]] },
      { at: [0, 0], z: 0.34, prof: [[0.21, 0], [0, 0.42]] },
      { at: [0, 0], z: 0.58, prof: [[0.14, 0], [0, 0.42]] },
    ],
  },
  // an oak or a lime: a broad round crown and a smaller lump on one side
  broadleaf: {
    trunk: [[0.05, 0], [0.035, 0.45]],
    bark: TREE_COLORS.bark,
    crowns: [
      { at: [0, 0], z: 0.3, prof: [[0.06, 0], [0.3, 0.08], [0.38, 0.25], [0.34, 0.45], [0.2, 0.62], [0, 0.7]] },
      { at: [0.17, 0.08], z: 0.4, prof: [[0.05, 0], [0.2, 0.08], [0.22, 0.2], [0.13, 0.33], [0, 0.38]] },
    ],
  },
  // a birch: a pale slim trunk and a narrow crown
  birch: {
    trunk: [[0.028, 0], [0.018, 0.62]],
    bark: TREE_COLORS.birchBark,
    crowns: [{ at: [0, 0], z: 0.35, prof: [[0.04, 0], [0.17, 0.1], [0.2, 0.3], [0.14, 0.5], [0, 0.65]] }],
  },
  // a bush: three leafy lumps from the ground, no trunk to see
  bush: {
    trunk: [],
    bark: TREE_COLORS.bark,
    crowns: [
      { at: [0, 0], z: 0, prof: [[0.12, 0], [0.4, 0.15], [0.45, 0.45], [0.32, 0.8], [0, 1]] },
      { at: [0.32, 0.12], z: 0, prof: [[0.1, 0], [0.3, 0.12], [0.32, 0.35], [0.2, 0.6], [0, 0.7]] },
      { at: [-0.22, -0.28], z: 0, prof: [[0.1, 0], [0.26, 0.1], [0.28, 0.3], [0.17, 0.5], [0, 0.58]] },
    ],
  },
};

const hash1 = (k: number) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// A clump of reeds: thin blades leaning out from the middle, a few with a brown head (not recoloured, no snow).
function reeds(mesh: Mesh): number {
  const green = rgb(TREE_COLORS.reed), head = rgb(TREE_COLORS.cattail);
  for (let b = 0; b < 12; b++) {
    const a = hash1(b) * Math.PI * 2, r0 = 0.05 * hash1(b + 50), lean = 0.1 + 0.3 * hash1(b + 100), h = 0.6 + 0.4 * hash1(b + 150);
    const c = Math.cos(a), s = Math.sin(a), w = 0.11; // blades are drawn broader than real leaves: thinner than a pixel they would vanish
    const bx = c * r0, by = s * r0, tx = c * (r0 + lean), ty = s * (r0 + lean);
    const n: [number, number, number] = [c, s, 0.3];
    const p = [mesh.vert(bx - s * w, by + c * w, 0, n, green), mesh.vert(bx + s * w, by - c * w, 0, n, green), mesh.vert(tx, ty, h, n, green)];
    mesh.idx(p[0], p[1], p[2]);
  }
  const first = mesh.m.positions.length / 3;
  for (let b = 0; b < 2; b++) {
    const a = hash1(b + 200) * Math.PI * 2, r = 0.06 + 0.1 * hash1(b + 250), h = 0.68 + 0.14 * hash1(b + 300);
    revolve(mesh, Math.cos(a) * r, Math.sin(a) * r, h, [[0.02, 0], [0.028, 0.04], [0.028, 0.12], [0, 0.16]], head, 4);
  }
  return first; // the heads start here
}



// A meadow tuft: a cheap cluster of broad grass blades. One instance represents a small patch, not one blade.
function grassTuft(mesh: Mesh): void {
  const green = rgb(TREE_COLORS.grassSummer);
  for (let b = 0; b < 10; b++) {
    const a = hash1(b + 500) * Math.PI * 2;
    const r = 0.06 + 0.22 * hash1(b + 550);
    const h = 0.45 + 0.55 * hash1(b + 600);
    const lean = 0.05 + 0.18 * hash1(b + 650);
    const w = 0.055 + 0.035 * hash1(b + 700);
    const c = Math.cos(a), s = Math.sin(a);
    const bx = c * r, by = s * r;
    const tx = bx + c * lean, ty = by + s * lean;
    const n: [number, number, number] = [c * 0.35, s * 0.35, 0.94];
    const l = mesh.vert(bx - s * w, by + c * w, 0, n, green);
    const rgt = mesh.vert(bx + s * w, by - c * w, 0, n, green);
    const top = mesh.vert(tx, ty, h, n, green);
    mesh.idx(l, rgt, top);
  }
}

// A boulder: a squat faceted lump.
function boulder(mesh: Mesh): void {
  revolve(mesh, 0, 0, -0.1, [[0.5, 0], [0.62, 0.3], [0.55, 0.65], [0.3, 1.0], [0, 1.1]], rgb(TREE_COLORS.stone), 6);
  // knock it out of round: each vertex in or out by its angle and height
  const p = mesh.m.positions;
  for (let i = 0; i < p.length; i += 3) {
    const k = 1 + 0.18 * Math.sin(Math.atan2(p[i + 1], p[i]) * 3 + p[i + 2] * 5) + 0.08 * Math.sin(Math.atan2(p[i + 1], p[i]) * 5);
    (p[i] *= k), (p[i + 1] *= k * 0.85), (p[i + 2] = Math.min(1, p[i + 2]));
  }
}

// Levels of detail: 0 full, 1 an impostor of the full tree for the distance (treeImpostor.ts, built from level 0), 2 a
// flat crown seen from straight above.
export const TREE_LODS = 3;

// The flat crown: its radius and height in tree heights.
const FLAT: Record<TreeKind, { r: number; z: number }> = {
  conifer: { r: 0.24, z: 0.45 },
  broadleaf: { r: 0.37, z: 0.6 },
  birch: { r: 0.2, z: 0.65 },
  bush: { r: 0.45, z: 0.7 },
  reed: { r: 0.25, z: 0.6 },
  boulder: { r: 0.55, z: 0.8 },
  grass: { r: 0.38, z: 0.5 },
};

export function buildTree(kind: TreeKind, lod: 0 | 2 = 0): TreeModel {
  const mesh = new Mesh({ cx: 0, cy: 0, ux: 1, uy: 0, len: 0, wid: 0 });
  const leaf = rgb(leafOf(kind));
  let trunkVerts = 0;
  let headsFrom = Infinity; // the reeds' heads: not crown
  if (lod === 0 && kind === "reed") headsFrom = reeds(mesh);
  else if (lod === 0 && kind === "boulder") boulder(mesh);
  else if (lod === 0 && kind === "grass") grassTuft(mesh);
  else if (lod === 0) {
    const sh = SHAPES[kind as Shaped];
    if (sh.trunk.length) revolve(mesh, 0, 0, 0, sh.trunk, rgb(sh.bark), 5);
    trunkVerts = mesh.m.positions.length / 3;
    for (const c of sh.crowns) revolve(mesh, c.at[0], c.at[1], c.z, c.prof, leaf, 7);
  } else {
    // a hexagon, lighter in the middle (the top of the crown) than at the rim
    const { r, z } = FLAT[kind];
    const up: [number, number, number] = [0, 0, 1];
    const mid = mesh.vert(0, 0, z, up, leaf.map((v) => Math.min(1, v * 1.25)) as typeof leaf);
    const rim = Array.from({ length: 6 }, (_, k) => mesh.vert(Math.cos((k * Math.PI) / 3) * r, Math.sin((k * Math.PI) / 3) * r, z, up, leaf.map((v) => v * 0.7) as typeof leaf));
    for (let k = 0; k < 6; k++) mesh.idx(mid, rim[k], rim[(k + 1) % 6]);
  }
  const n = mesh.m.positions.length / 3;
  return { ...mesh.m, crown: Array.from({ length: n }, (_, i) => (i < trunkVerts || i >= headsFrom ? 0 : 1)) };
}

// Reeds at a point of the year: last year's straw in early spring, green over the summer, drying through the autumn
// and standing straw all winter (never bare).
export function reedAt(gameMinutes: number): { a: string; b: string; t: number } {
  const cal = calendar(gameMinutes);
  const f = cal.season + (cal.dayOfSeason - 1 + cal.hour / 24) / DAYS_PER_SEASON;
  const C = TREE_COLORS;
  const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  if (f < 2) return { a: C.reedDry, b: C.reed, t: ramp(f, 0.3, 1) };
  return { a: C.reed, b: C.reedDry, t: ramp(f, 2.1, 2.8) };
}

// Deciduous crowns at a point of the year: two colours (mixed per tree) and how bare they are.
export function crownAt(gameMinutes: number): { a: string; b: string; t: number; bare: number } {
  const cal = calendar(gameMinutes);
  const f = cal.season + (cal.dayOfSeason - 1 + cal.hour / 24) / DAYS_PER_SEASON; // 0 spring .. 4
  const C = TREE_COLORS;
  const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  if (f < 1.2) return { a: C.spring, b: C.summer, t: ramp(f, 0.5, 1.2), bare: 1 - ramp(f, 0, 0.5) };
  if (f < 2) return { a: C.summer, b: C.summer, t: 0, bare: 0 };
  if (f < 2.3) return { a: C.summer, b: C.autumn, t: ramp(f, 2, 2.3), bare: 0 };
  return { a: C.autumn, b: C.autumnLate, t: 1, bare: ramp(f, 2.75, 3.1) };
}


export function grassAt(gameMinutes: number): { a: string; b: string; t: number } {
  const cal = calendar(gameMinutes);
  const f = cal.season + (cal.dayOfSeason - 1 + cal.hour / 24) / DAYS_PER_SEASON;
  const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const C = TREE_COLORS;
  if (f < 1.1) return { a: C.grassSpring, b: C.grassSummer, t: ramp(f, 0.1, 1.1) };
  if (f < 2.1) return { a: C.grassSummer, b: C.grassSummer, t: 0 };
  return { a: C.grassSummer, b: C.grassDry, t: ramp(f, 2.1, 3.0) };
}
