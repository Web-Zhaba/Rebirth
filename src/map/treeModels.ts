import { calendar, DAYS_PER_SEASON } from "../sim/clock";
import { TREE_COLORS } from "../ui/palette";
import { Mesh, revolve, rgb, type Model, type XY } from "./modelGeometry";
import type { TreeKind } from "./treeScatter";

// One tree of each kind, 1 m tall, on the shared mesh of modelGeometry.ts; the tree layer (treeLayer.ts) scales, turns
// and sways each instance. `crown` marks the vertices of the foliage (1) against the trunk (0): the layer recolours
// deciduous crowns by season and whitens snow on them.

export interface TreeModel extends Model {
  crown: number[]; // per vertex
}

// Profiles of revolution: (radius, height) bottom to top, in tree heights.
const SHAPES: Record<TreeKind, { trunk: XY[]; bark: string; crowns: { at: XY; z: number; prof: XY[] }[] }> = {
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
};

// Levels of detail: 0 full, 1 a few faces for the distance, 2 a flat crown seen from straight above.
export const TREE_LODS = 3;

// The simple crown of each kind for the distance: one surface, no trunk.
const FAR: Record<TreeKind, { z: number; prof: XY[] }> = {
  conifer: { z: 0.12, prof: [[0.26, 0], [0, 0.88]] },
  broadleaf: { z: 0.3, prof: [[0.12, 0], [0.37, 0.2], [0.3, 0.5], [0, 0.7]] },
  birch: { z: 0.35, prof: [[0.08, 0], [0.2, 0.25], [0, 0.65]] },
};
// The flat crown: its radius and height in tree heights.
const FLAT: Record<TreeKind, { r: number; z: number }> = { conifer: { r: 0.24, z: 0.45 }, broadleaf: { r: 0.37, z: 0.6 }, birch: { r: 0.2, z: 0.65 } };

export function buildTree(kind: TreeKind, lod = 0): TreeModel {
  const mesh = new Mesh({ cx: 0, cy: 0, ux: 1, uy: 0, len: 0, wid: 0 });
  const sh = SHAPES[kind];
  const leaf = rgb(kind === "conifer" ? TREE_COLORS.conifer : TREE_COLORS.summer);
  let trunkVerts = 0;
  if (lod === 0) {
    revolve(mesh, 0, 0, 0, sh.trunk, rgb(sh.bark), 5);
    trunkVerts = mesh.m.positions.length / 3;
    for (const c of sh.crowns) revolve(mesh, c.at[0], c.at[1], c.z, c.prof, leaf, 7);
  } else if (lod === 1) {
    revolve(mesh, 0, 0, FAR[kind].z, FAR[kind].prof, leaf, 5);
  } else {
    // a hexagon, lighter in the middle (the top of the crown) than at the rim
    const { r, z } = FLAT[kind];
    const up: [number, number, number] = [0, 0, 1];
    const mid = mesh.vert(0, 0, z, up, leaf.map((v) => Math.min(1, v * 1.25)) as typeof leaf);
    const rim = Array.from({ length: 6 }, (_, k) => mesh.vert(Math.cos((k * Math.PI) / 3) * r, Math.sin((k * Math.PI) / 3) * r, z, up, leaf.map((v) => v * 0.7) as typeof leaf));
    for (let k = 0; k < 6; k++) mesh.idx(mid, rim[k], rim[(k + 1) % 6]);
  }
  const n = mesh.m.positions.length / 3;
  return { ...mesh.m, crown: Array.from({ length: n }, (_, i) => (i < trunkVerts ? 0 : 1)) };
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
