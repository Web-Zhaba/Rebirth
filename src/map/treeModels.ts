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

export function buildTree(kind: TreeKind): TreeModel {
  const mesh = new Mesh({ cx: 0, cy: 0, ux: 1, uy: 0, len: 0, wid: 0 });
  const sh = SHAPES[kind];
  revolve(mesh, 0, 0, 0, sh.trunk, rgb(sh.bark), 5);
  const trunkVerts = mesh.m.positions.length / 3;
  const leaf = rgb(kind === "conifer" ? TREE_COLORS.conifer : TREE_COLORS.summer);
  for (const c of sh.crowns) revolve(mesh, c.at[0], c.at[1], c.z, c.prof, leaf, 7);
  const n = mesh.m.positions.length / 3;
  return { ...mesh.m, crown: Array.from({ length: n }, (_, i) => (i < trunkVerts ? 0 : 1)) };
}
