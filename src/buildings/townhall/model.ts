import { clamp, cylinder, PATTERN, prism, pyramid, revolve, rgb, shade, square, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, mix, ccw, body, splitLot, part, frameOf, slabIn, up, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The town hall's 3D model (map/townKit.ts has the shared parts).

// Town hall: a long two-storey hall under a hip roof with an arcade of columns along its front, a clock tower standing out
// of the middle (door and steps at its foot, a clock above the door, a belfry with a bell, a spire), and in front a
// paved square with a flagpole and a notice board.
function townHall(c: Ctx): void {
  const { house, yard, street } = splitLot(c, 0.7);
  const h = part(c, house);
  const H = frameOf(house, street), Y = frameOf(yard, street);
  const wood = pick(c, TOWN_COLORS.planks), stone = pick(c, TOWN_COLORS.stone), trim = rgb(TOWN_COLORS.trim[0]);
  const base = pick(c, TOWN_COLORS.plaster), roofBase = pick(c, TOWN_COLORS.roofPlank);
  const wall = c.tint ?? base, roofC = c.tint ? mix(roofBase, c.tint, 0.45) : roofBase;
  const eaves = clamp(c.height * 0.62, 4.6, 6.2);
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * 0.22, 1.2, 2.6);
  body(h, { eaves, roof: "hip", rise, overhang: 0.6, wall: base, roofC: roofBase, pat: PATTERN.hall, doorPat: PATTERN.hall, plinth: true });
  // The tower is as wide as it takes to hide the windows of the hall it stands over: they sit every 3 m, centred on the wall.
  const nw = H.L >= 2.7 ? Math.floor((H.L - 2.7) / 3) + 1 : 0;
  let tw = 1.7;
  for (let k = Math.ceil((nw - 1) / 2); k < nw; k++) {
    const p = Math.abs((k - (nw - 1) / 2) * 3);
    if (p - 0.65 < tw) tw = Math.max(tw, p + 0.8);
  }
  // the arcade: columns a step out from the wall either side of the tower, a flat roof over them
  const gz = 3, gd = 1.7, a0 = tw + 0.2, a1 = H.L / 2 - 0.1;
  for (const side of [-1, 1]) {
    slabIn(c, H, Math.min(side * a0, side * a1), Math.max(side * a0, side * a1), -gd, 0, 0, 0.15, shade(stone, 1.1), shade(stone, 1.2));
    slabIn(c, H, Math.min(side * a0, side * a1), Math.max(side * a0, side * a1), -gd - 0.1, 0, gz, gz + 0.22, trim, shade(trim, 1.05));
    for (let k = 0; k < 4; k++) {
      const p = H.at(side * (a0 + 0.35 + (k * (a1 - 0.4 - a0 - 0.35)) / 3), -gd + 0.2);
      cylinder(c.mesh, up(p, 0.15), up(p, gz), 0.16, trim, trim);
    }
  }
  // the tower: plain walls (no window pattern), a ledge, a belfry on four posts with a bell, a spire
  const front = -1, back = 3, mid = (front + back) / 2;
  const tz = eaves + rise + 1.6, bz = tz + 2.1; // the shaft clears the ridge a little, the belfry is high enough to stand in
  slabIn(c, H, -tw, tw, front, back, 0, tz, wall, wall);
  slabIn(c, H, -tw - 0.06, tw + 0.06, front - 0.06, back + 0.06, 0, 0.4, shade(stone, 1.1), shade(stone, 1.2));
  slabIn(c, H, -tw - 0.15, tw + 0.15, front - 0.15, back + 0.15, tz, tz + 0.15, trim, shade(trim, 1.05));
  for (const s of [-1, 1])
    for (const d of [front + 0.3, back - 0.3]) slabIn(c, H, s * (tw - 0.2) - 0.12, s * (tw - 0.2) + 0.12, d - 0.12, d + 0.12, tz + 0.15, bz, wood, wood);
  // a low parapet between the posts: thinner than they are and ending inside them, so no faces coincide
  const ps = tw - 0.2, pf = front + 0.3, pb = back - 0.3;
  slabIn(c, H, -ps, ps, pf - 0.08, pf + 0.08, tz + 0.15, tz + 1.0, wall, trim);
  slabIn(c, H, -ps, ps, pb - 0.08, pb + 0.08, tz + 0.15, tz + 1.0, wall, trim);
  for (const s of [-1, 1]) slabIn(c, H, s * ps - 0.08, s * ps + 0.08, pf, pb, tz + 0.15, tz + 1.0, wall, trim);
  // the bell hangs on a rope from a beam across the belfry under the spire
  slabIn(c, H, -ps, ps, mid - 0.1, mid + 0.1, bz - 0.3, bz - 0.12, wood, wood);
  const bell = H.at(0, mid);
  cylinder(c.mesh, up(bell, bz - 0.3), up(bell, bz - 0.55), 0.04, shade(wood, 0.7), shade(wood, 0.7), 4);
  revolve(c.mesh, bell[0], bell[1], bz - 1.35, [[0.4, 0], [0.3, 0.32], [0.2, 0.64], [0.1, 0.76], [0, 0.8]], rgb(TOWN_COLORS.bell[0]), 10);
  pyramid(c.mesh, ccw([H.at(-tw - 0.3, front - 0.3), H.at(tw + 0.3, front - 0.3), H.at(tw + 0.3, back + 0.3), H.at(-tw - 0.3, back + 0.3)]), bz, 2, roofC);
  // one clock on the street face, above the door: a rim, a face, two hands
  const cz = (2.6 + tz) / 2 + 0.4, cr = 1.2, face = shade(trim, 1.1), rim = shade(stone, 0.85), dark = shade(wood, 0.4);
  const clock = (s: number, d: number, ds: number, dd: number) => {
    const p = H.at(s, d), q = H.at(s + ds, d + dd);
    const n: XY = [q[0] - p[0], q[1] - p[1]], l = Math.hypot(n[0], n[1]) || 1;
    const at = (k: number): XY => [p[0] + (n[0] / l) * k, p[1] + (n[1] / l) * k];
    cylinder(c.mesh, up(at(0), cz), up(at(0.06), cz), cr + 0.12, rim, rim, 20);
    cylinder(c.mesh, up(at(0.06), cz), up(at(0.1), cz), cr, face, face, 20);
    const hub = at(0.12), hr: XY = [hub[0] - (n[1] / l) * 0.6, hub[1] + (n[0] / l) * 0.6]; // the hour hand along the face
    cylinder(c.mesh, up(hub, cz), up(hub, cz + 0.9), 0.05, dark, dark, 4);
    cylinder(c.mesh, up(hub, cz), up(hr, cz), 0.06, dark, dark, 4);
  };
  clock(0, front, 0, -1);
  // door in a stone frame, two steps
  slabIn(c, H, -0.9, 0.9, front - 0.05, front, 0, 2.6, shade(stone, 1.1), shade(stone, 1.2));
  slabIn(c, H, -0.7, 0.7, front - 0.09, front - 0.05, 0, 2.35, shade(wood, 0.55), shade(wood, 0.55), PATTERN.boards);
  slabIn(c, H, -(tw - 0.2), tw - 0.2, front - 0.9, front, 0, 0.22, shade(stone, 1.15), shade(stone, 1.25));
  slabIn(c, H, -(tw + 0.2), tw + 0.2, front - 1.5, front - 0.9, 0, 0.11, shade(stone, 1.15), shade(stone, 1.25));
  // the square: paving, a flagpole with a flag, a notice board with notes
  const pave = shade(stone, 1.2);
  slabIn(c, Y, -Y.L / 2 + 0.3, Y.L / 2 - 0.3, 0.2, Y.D, 0, 0.04, pave, pave);
  const fp = Y.at(Y.L * 0.36, 1.1);
  prism(c.mesh, square(fp[0], fp[1], 0.6), 0, 0.3, shade(stone, 1.1), shade(stone, 1.25));
  cylinder(c.mesh, up(fp, 0.3), up(fp, 8), 0.06, shade(wood, 1.1), shade(wood, 1.1), 6);
  slabIn(c, Y, Y.L * 0.36 - 1.2, Y.L * 0.36 - 0.06, 1.1 - 0.015, 1.1 + 0.015, 6.4, 7.6, rgb(TOWN_COLORS.goods[0]), rgb(TOWN_COLORS.goods[0]));
  const nb = Y.L * -0.36;
  for (const o of [-0.9, 0.9]) slabIn(c, Y, nb + o - 0.05, nb + o + 0.05, 1.05, 1.15, 0, 2.2, wood, wood);
  slabIn(c, Y, nb - 1, nb + 1, 1.05, 1.15, 1, 2, shade(wood, 1.1), wood, PATTERN.boards);
  slabIn(c, Y, nb - 1.1, nb + 1.1, 0.95, 1.25, 2, 2.1, shade(wood, 0.8), shade(wood, 0.8));
  for (const [o, z] of [[-0.7, 1.35], [-0.2, 1.15], [0.3, 1.4], [0.7, 1.2]] as const) slabIn(c, Y, nb + o - 0.18, nb + o + 0.18, 1.0, 1.05, z, z + 0.4, trim, trim);
}

export const townhallModel: TownModel = { build: townHall };
