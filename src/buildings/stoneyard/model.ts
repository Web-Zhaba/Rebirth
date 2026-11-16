import { cylinder, PATTERN, prism, revolve, shade, type RGB, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, range, streetEdge, frameOf, slabIn, up, beam, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The stone yard's 3D model (map/townKit.ts has the shared parts).

// Stone yard: a pale gravel floor inside a low stone wall with a gate, piles of dressed blocks, slabs standing in a rack,
// heaps of rubble, a mason's trestle with a block being dressed, and a hand cart loaded with stone.
function stoneYard(c: Ctx): void {
  const F = frameOf([-c.hl, -c.hw, c.hl, c.hw], streetEdge(c));
  const { L, D } = F;
  const stone = pick(c, TOWN_COLORS.stone), wood = pick(c, TOWN_COLORS.planks);
  const floor = shade(stone, 1.15), wc = shade(stone, 0.95);
  prism(c.mesh, c.uv, 0, 0.05, floor, floor);
  // the wall: both sides and the back, the street side with a gate between two piers
  const e = L / 2 - 0.15, t = 0.45, wh = 0.85;
  const wall = (s0: number, s1: number, d0: number, d1: number, h = wh) => slabIn(c, F, s0, s1, d0, d1, 0, h, wc, shade(wc, 1.12), PATTERN.house);
  wall(-e, -e + t, 0.15, D - 0.15);
  wall(e - t, e, 0.15, D - 0.15);
  wall(-e + t, e - t, D - 0.15 - t, D - 0.15);
  if (L >= 7)
    for (const side of [-1, 1]) {
      const w0 = side * 2, w1 = side * (e - t);
      wall(Math.min(side * 1.45, w0), Math.max(side * 1.45, w0), 0.15, 0.7, 1.5);
      wall(Math.min(w0, w1), Math.max(w0, w1), 0.15, 0.6);
    }
  else wall(-e + t, e - t, 0.15, 0.6);
  const P = (fs: number, fd: number): XY => F.at(fs * L, fd * D);
  // piles of dressed blocks in staggered courses; `taper`: each course one block shorter
  const pile = (fs: number, fd: number, cols: number, rows: number, courses: number, col: RGB, taper = false) => {
    const bl = 0.95, bw = 0.5, bh = 0.34, g = 0.03, cs = fs * L, cd = fd * D;
    for (let k = 0; k < courses; k++) {
      const nc = Math.max(1, taper ? cols - k : cols), off = taper ? 0 : (k % 2) * 0.25;
      for (let i = 0; i < nc; i++)
        for (let j = 0; j < rows; j++) {
          const s0 = cs - (nc * bl) / 2 + i * bl + off, d0 = cd - (rows * bw) / 2 + j * bw;
          slabIn(c, F, s0 + g, s0 + bl - g, d0 + g, d0 + bw - g, k * bh, (k + 1) * bh - 0.02, shade(col, range(c, 0.88, 1.08)), shade(col, range(c, 1.05, 1.2)));
        }
    }
  };
  pile(-0.008, 0.82, 5, 2, 3, stone);
  pile(0.325, 0.82, 3, 2, 3, shade(stone, 1.12), true);
  // rubble
  for (const [fs, fd, r, k] of [[-0.35, 0.78, 1.25, 0.8], [-0.24, 0.9, 0.9, 0.95]] as const) {
    const p = P(fs, fd);
    revolve(c.mesh, p[0], p[1], 0.04, [[r, 0], [r * 0.85, r * 0.3], [r * 0.5, r * 0.55], [0, r * 0.62]], shade(stone, k), 10);
  }
  // slabs on edge in a wooden cradle
  const rc = -0.33 * L, rd = 0.45 * D;
  for (let k = 0; k < 7; k++) {
    const s = rc - 0.9 + k * 0.3;
    slabIn(c, F, s, s + 0.12, rd - 0.6, rd + 0.6, 0.18, 1.7 - (k % 3) * 0.1, shade(stone, range(c, 0.82, 1.1)), shade(stone, 1.2));
  }
  for (const o of [-0.45, 0.45]) slabIn(c, F, rc - 1.1, rc + 1.1, rd + o - 0.07, rd + o + 0.07, 0, 0.18, wood, wood);
  for (const so of [-1.1, 1.1]) for (const o of [-0.72, 0.72]) slabIn(c, F, rc + so - 0.05, rc + so + 0.05, rd + o - 0.05, rd + o + 0.05, 0, 1.4, wood, wood);
  // the mason's trestle: a plank on four legs, a block with a fresh cut face, a heap of chips
  const ms = 0.3 * L, md = 0.45 * D;
  slabIn(c, F, ms - 0.9, ms + 0.9, md - 0.3, md + 0.3, 0.75, 0.83, wood, shade(wood, 1.1), PATTERN.boards);
  for (const so of [-0.7, 0.7]) for (const o of [-0.22, 0.22]) slabIn(c, F, ms + so - 0.04, ms + so + 0.04, md + o - 0.04, md + o + 0.04, 0, 0.75, wood, wood);
  slabIn(c, F, ms - 0.45, ms + 0.45, md - 0.22, md + 0.22, 0.83, 1.25, shade(stone, 1.05), shade(stone, 1.35));
  const chips = F.at(ms + 1.3, md + 0.2);
  revolve(c.mesh, chips[0], chips[1], 0.04, [[0.45, 0], [0.3, 0.12], [0, 0.18]], shade(stone, 1.1), 8);
  // a two-wheeled hand cart with a load of blocks, its shafts propped on posts
  const cs = -0.33 * L, cd = 0.17 * D;
  slabIn(c, F, cs - 0.75, cs + 0.75, cd - 0.5, cd + 0.5, 0.45, 0.55, wood, shade(wood, 1.1), PATTERN.boards);
  slabIn(c, F, cs - 0.55, cs - 0.05, cd - 0.35, cd + 0.35, 0.55, 0.95, shade(stone, 0.95), shade(stone, 1.15));
  slabIn(c, F, cs + 0.05, cs + 0.55, cd - 0.3, cd + 0.3, 0.55, 0.85, shade(stone, 1.08), shade(stone, 1.25));
  for (const o of [-0.58, 0.5]) cylinder(c.mesh, up(F.at(cs, cd + o), 0.4), up(F.at(cs, cd + o + 0.08), 0.4), 0.4, wood, shade(wood, 0.7), 10);
  for (const o of [-0.3, 0.3]) beam(c, F.at(cs + 0.7, cd + o), F.at(cs + 1.9, cd + o), 0.5, 0.57, 0.08, wood);
  for (const o of [-0.3, 0.3]) slabIn(c, F, cs + 1.85, cs + 1.95, cd + o - 0.05, cd + o + 0.05, 0, 0.5, wood, wood);
}

export const stoneyardModel: TownModel = { build: stoneYard };
