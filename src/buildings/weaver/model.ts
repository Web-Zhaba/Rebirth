import { clamp, cylinder, DOOR, PATTERN, prism, revolve, rgb, ROOF_FAC, shade, square, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, range, edgeFrame, body, splitLot, part, byEdge, frameOf, up, beam, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The weaving workshop's 3D model (map/townKit.ts has the shared parts).

// Weaving workshop: a tall plastered house under a steep thatched roof, with a drying beam on posts in front of its door
// and lengths of dyed cloth hanging from it. In the yard: a pavilion with an upright loom under a lean-to roof, two dye
// vats with a stirring pole, a tenter frame with cloth stretched on it, a wool bale and a basket of yarn.
function weaver(c: Ctx): void {
  const { house, yard, street } = splitLot(c, 0.58);
  const h = part(c, house);
  const wood = pick(c, TOWN_COLORS.planks);
  const eaves = clamp(c.height * 0.62, 2.8, 3.4);
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * range(c, 0.4, 0.5), 1.6, 3.2);
  body(h, { eaves, roof: c.r() < 0.6 ? "gable" : "halfhip", rise, overhang: 0.7, wall: pick(c, TOWN_COLORS.plaster), roofC: pick(c, TOWN_COLORS.thatch), pat: PATTERN.house, doorPat: PATTERN.house + DOOR, plinth: true });
  // the drying beam: posts a metre out from the wall, tied to it at the top, cloth hanging in the gaps either side of the door
  if (h.door >= 0) {
    const half = Math.min(edgeFrame(h.uv, h.door).len / 2 - 0.4, 3.4), out = 1.15, top = 2.6;
    const at = (s: number, o: number) => byEdge(h.uv, h.door, s, o);
    for (const s of [-half, -1.1, 1.1, half]) {
      const p = at(s, out);
      prism(c.mesh, square(p[0], p[1], 0.12), 0, top + 0.1, wood, wood);
      beam(c, at(s, 0), p, top - 0.1, top, 0.1, wood);
    }
    beam(c, at(-half, out), at(half, out), top, top + 0.1, 0.12, wood);
    for (const side of [-1, 1])
      for (let s = 1.4; s + 0.3 < half; s += 0.78) {
        const len = range(c, 1.3, 1.9);
        beam(c, at(side * (s - 0.27), out), at(side * (s + 0.27), out), top - len, top - 0.02, 0.035, pick(c, TOWN_COLORS.goods));
      }
  }
  // the yard in its own frame: s along the street from the middle, d in from the street
  const F = frameOf(yard, street), L = F.L, D = F.D;
  const Y = (s: number, d: number): XY => F.at(s * L, d); // s as a fraction of the street side
  const post = (p: XY, z: number, side = 0.12) => prism(c.mesh, square(p[0], p[1], side), 0, z, wood, wood);
  const dyes = TOWN_COLORS.goods;
  // pavilion with a lean-to roof, low at the street, and an upright loom under it
  const pa = -0.48, pb = -0.17, d0 = 0.4, d1 = Math.min(1.75, D * 0.5);
  for (const [s, d, z] of [[pa, d0, 2], [pb, d0, 2], [pa, d1, 2.5], [pb, d1, 2.5]] as const) post(Y(s, d), z);
  const roofC = pick(c, TOWN_COLORS.roofPlank);
  const R = [Y(pa - 0.02, d0 - 0.25), Y(pb + 0.02, d0 - 0.25), Y(pb + 0.02, d1 + 0.25), Y(pa - 0.02, d1 + 0.25)];
  const RZ = [1.95, 1.95, 2.6, 2.6];
  c.mesh.flat(up(R[0], RZ[0]), up(R[1], RZ[1]), up(R[2], RZ[2]), roofC, ROOF_FAC);
  c.mesh.flat(up(R[0], RZ[0]), up(R[2], RZ[2]), up(R[3], RZ[3]), roofC, ROOF_FAC);
  const dm = (d0 + d1) / 2, l0 = (pa + pb) / 2 - 0.1, l1 = (pa + pb) / 2 + 0.1;
  const warp = rgb(TOWN_COLORS.trim[0]);
  for (const s of [l0 - 0.01, l1 + 0.01]) {
    post(Y(s, dm), 1.85, 0.1);
    beam(c, Y(s, dm - 0.35), Y(s, dm + 0.35), 0, 0.09, 0.1, wood); // a foot across
  }
  beam(c, Y(l0, dm), Y(l1, dm), 1.65, 1.76, 0.09, wood);
  beam(c, Y(l0, dm), Y(l1, dm), 0.32, 0.42, 0.09, wood);
  for (let k = 1; k < 9; k++) {
    const p = Y(l0 + ((l1 - l0) * k) / 9, dm);
    cylinder(c.mesh, up(p, 0.42), up(p, 1.65), 0.011, warp, warp, 4);
  }
  beam(c, Y(l0 + 0.015, dm), Y(l1 - 0.015, dm), 0.42, 0.95, 0.045, pick(c, TOWN_COLORS.canvas));
  beam(c, Y(l0 + 0.015, dm), Y(l1 - 0.015, dm), 0.5, 0.64, 0.055, pick(c, dyes));
  const stool = Y((l0 + l1) / 2, dm - 0.65);
  prism(c.mesh, square(stool[0], stool[1], 0.42), 0, 0.42, wood, shade(wood, 1.12), PATTERN.boards);
  // dye vats with a stirring pole in the first
  const vr = clamp(L * 0.04, 0.3, 0.45), vh = 0.7;
  [0.13, 0.25].forEach((s, k) => {
    const p = Y(s, 0.95);
    revolve(c.mesh, p[0], p[1], 0, [[vr, 0], [vr * 1.1, vh], [vr * 0.9, vh], [vr * 0.9, vh - 0.1], [0, vh - 0.1]], wood, 10);
    revolve(c.mesh, p[0], p[1], vh - 0.09, [[vr * 0.9, 0], [0, 0.015]], pick(c, dyes), 10);
    if (k === 0) cylinder(c.mesh, up(Y(s + 0.01, 0.95 + vr * 0.3), vh - 0.05), up(Y(s + 0.035, 0.95 + vr * 1.3), vh + 0.95), 0.03, shade(wood, 1.2));
  });
  // tenter frame: cloth stretched between two rails, a stripe across it
  const t0 = 0.34, t1 = 0.47;
  for (const s of [t0, t1]) {
    post(Y(s, 1.0), 2, 0.1);
    beam(c, Y(s, 0.7), Y(s, 1.3), 0, 0.09, 0.1, wood);
  }
  beam(c, Y(t0, 1.0), Y(t1, 1.0), 1.85, 1.95, 0.08, wood);
  beam(c, Y(t0, 1.0), Y(t1, 1.0), 0.3, 0.4, 0.08, wood);
  const stretched = pick(c, dyes);
  beam(c, Y(t0 + 0.006, 1.0), Y(t1 - 0.006, 1.0), 0.4, 1.85, 0.03, stretched);
  beam(c, Y(t0 + 0.006, 1.0), Y(t1 - 0.006, 1.0), 1.0, 1.2, 0.04, shade(stretched, 0.6));
  // wool and yarn by the pavilion
  const bale = Y(-0.115, 0.6), basket = Y(-0.115, 1.35);
  prism(c.mesh, square(bale[0], bale[1], 0.6), 0, 0.5, pick(c, TOWN_COLORS.canvas), shade(pick(c, TOWN_COLORS.canvas), 1.1));
  revolve(c.mesh, basket[0], basket[1], 0, [[0.2, 0], [0.28, 0.3], [0, 0.3]], pick(c, TOWN_COLORS.thatch), 8);
  revolve(c.mesh, basket[0], basket[1], 0.3, [[0.25, 0], [0.12, 0.18], [0, 0.2]], pick(c, dyes), 8);
}

export const weaverModel: TownModel = { build: weaver };
