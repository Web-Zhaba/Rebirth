import { cylinder, PATTERN, rgb, ROOF_FAC, shade } from "../../map/modelGeometry";
import { type Ctx, pick, splitLot, frameOf, slabIn, up, logStack, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The timber yard's 3D model (map/townKit.ts has the shared parts).

// Timber yard: an open shed on posts with a lean-to roof and a plank back wall, rows of logs stacked in it with their ends
// to the street; in front, stacks of sawn planks airing on cross sticks, a pile of logs held by stakes, and a gallows hoist
// with a log hanging from its chains.
function timberYard(c: Ctx): void {
  const { house, yard, street } = splitLot(c, 0.45);
  const S = frameOf(house, street), Y = frameOf(yard, street);
  const wood = pick(c, TOWN_COLORS.planks), iron = rgb(TOWN_COLORS.iron[0]);
  // the shed: front posts low, the back wall high, one roof sheet over them
  const bays = Math.max(1, Math.round((S.L - 0.8) / 3.2)), step = (S.L - 0.8) / bays;
  const sPost = (k: number) => -S.L / 2 + 0.4 + k * step;
  const df = 0.35, db = S.D - 0.3, zf = 3, zb = 3.9;
  const zRoof = (d: number) => zf + ((d - df) * (zb - zf)) / (db - df);
  const roofC = pick(c, c.r() < 0.5 ? TOWN_COLORS.roofPlank : TOWN_COLORS.shingle);
  const r = [S.at(-S.L / 2 + 0.05, 0.05), S.at(S.L / 2 - 0.05, 0.05), S.at(S.L / 2 - 0.05, S.D - 0.05), S.at(-S.L / 2 + 0.05, S.D - 0.05)];
  const rz = [zRoof(0.05), zRoof(0.05), zRoof(S.D - 0.05), zRoof(S.D - 0.05)];
  c.mesh.flat(up(r[0], rz[0]), up(r[1], rz[1]), up(r[2], rz[2]), roofC, ROOF_FAC);
  c.mesh.flat(up(r[0], rz[0]), up(r[2], rz[2]), up(r[3], rz[3]), roofC, ROOF_FAC);
  slabIn(c, S, -S.L / 2 + 0.3, S.L / 2 - 0.3, S.D - 0.3, S.D - 0.1, 0, zb - 0.05, shade(wood, 0.9), shade(wood, 0.9), PATTERN.boards);
  slabIn(c, S, -S.L / 2 + 0.3, S.L / 2 - 0.3, df - 0.07, df + 0.07, zf - 0.25, zf, wood, wood);
  for (let k = 0; k <= bays; k++) slabIn(c, S, sPost(k) - 0.08, sPost(k) + 0.08, df - 0.08, df + 0.08, 0, zf - 0.25, wood, wood);
  // logs under it, ends to the street
  for (let k = 0; k < bays; k++) {
    const mid = (sPost(k) + sPost(k + 1)) / 2;
    logStack(c, S.at(mid, 0.9), S.at(mid, S.D - 0.65), c.r() < 0.5 ? 4 : 3, 0.2);
  }
  // sawn planks airing: a few thick courses of boards (one plain block each), three sticks across between courses
  const plank = shade(pick(c, TOWN_COLORS.logs), 1.3), sx = (f: number) => f * Y.L, dy = (m: number) => (m * Y.D) / 5.5;
  const airing = (s0: number, s1: number, d0: number, d1: number, courses: number) => {
    for (let k = 0; k < courses; k++) {
      const z = k * 0.23;
      slabIn(c, Y, s0, s1, d0, d1, z, z + 0.17, shade(plank, k % 2 ? 0.94 : 1), plank);
      if (k < courses - 1) for (const s of [s0 + 0.1, (s0 + s1) / 2 - 0.04, s1 - 0.18]) slabIn(c, Y, s, s + 0.08, d0, d1, z + 0.17, z + 0.23, shade(plank, 0.6), shade(plank, 0.6));
    }
  };
  airing(sx(-0.45), sx(-0.175), dy(3.6), dy(4.7), 6);
  airing(sx(-0.45), sx(-0.215), dy(1.4), dy(2.5), 4);
  // a pile of logs along the street between stakes
  const pd = dy(3.4);
  logStack(c, Y.at(sx(-0.13), pd), Y.at(sx(0.15), pd), 4, 0.22);
  for (const s of [sx(-0.14), sx(0.16)]) for (const o of [-1.02, 1.02]) slabIn(c, Y, s - 0.05, s + 0.05, pd + o - 0.05, pd + o + 0.05, 0, 1.25, wood, wood);
  // the gallows: two posts on feet, a cross beam, braces, a log hanging from chains
  const g0 = sx(0.3), g1 = sx(0.44), gd = dy(2.4), top = 3.3;
  for (const [s, dir] of [[g0, 1], [g1, -1]] as const) {
    slabIn(c, Y, s - 0.07, s + 0.07, gd - 0.07, gd + 0.07, 0, top, wood, wood);
    slabIn(c, Y, s - 0.07, s + 0.07, gd - 0.7, gd + 0.7, 0, 0.1, wood, wood);
    cylinder(c.mesh, up(Y.at(s, gd), 2.4), up(Y.at(s + dir * 0.7, gd), top + 0.05), 0.05, wood);
  }
  slabIn(c, Y, g0 - 0.2, g1 + 0.2, gd - 0.08, gd + 0.08, top, top + 0.15, wood, wood);
  const gm = (g0 + g1) / 2;
  for (const o of [-0.7, 0.7]) cylinder(c.mesh, up(Y.at(gm, gd), top), up(Y.at(gm, gd + o), 1.55), 0.014, iron, iron, 4);
  const log = pick(c, TOWN_COLORS.logs);
  cylinder(c.mesh, up(Y.at(gm, gd - 1.1), 1.35), up(Y.at(gm, gd + 1.1), 1.35), 0.2, log, shade(log, 1.35));
}

export const logyardModel: TownModel = { build: timberYard };
