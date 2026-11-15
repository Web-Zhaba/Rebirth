import { band, clamp, cornerPosts, cylinder, DOOR, offsetRing, PATTERN, prism, revolve, rgb, roofOf, shade, shiftRoof, square, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, range, mix, ccw, rect, edgeBox, eavesRoof, part, barrel, crate, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The fishing pier's 3D model (map/townKit.ts has the shared parts).

// Fishing pier: a plank deck on piles, a hut with a hipped roof at the back (its door to the open deck), a rack with
// fish and a net drying, a boat pulled up on one side, barrels, a basket and a coil of rope on the other, and tall
// mooring posts at the open end.
function pier(c: Ctx): void {
  const { hl, hw } = c;
  const wood = pick(c, TOWN_COLORS.planks), pile = shade(wood, 0.8), dark = shade(wood, 0.55);
  const deck = 0.6;
  // piles: at the corners, then every 1.3 m or so along the edges under the deck, with a beam round the deck's edge
  cornerPosts(c.mesh, c.uv, deck - 0.12, pile, 0.2); // piles end under the deck's planks, not in their top face
  const inner = offsetRing(c.uv, -0.15) ?? c.uv;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i], b = inner[(i + 1) % inner.length];
    const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.3);
    for (let k = 1; k < n; k++) {
      const p: XY = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      prism(c.mesh, square(p[0], p[1], 0.16), 0, deck - 0.12, pile, pile);
    }
  }
  const rim = offsetRing(c.uv, 0.05);
  if (rim) prism(c.mesh, rim, deck - 0.3, deck - 0.1, dark, dark);
  prism(c.mesh, c.uv, deck - 0.12, deck, wood, wood, PATTERN.boards);
  // tall mooring posts at the two corners of the open end (the +u side)
  const ends = [...inner].sort((p, q) => q[0] - p[0]).slice(0, 2);
  for (const p of ends) cylinder(c.mesh, [p[0], p[1], deck - 0.06], [p[0], p[1], deck + 0.9], 0.1, pile, dark);

  // the hut at the back: log walls, a hip roof, a door and a step on the open side
  const h = part(c, [-hl + 0.3, -hw * 0.5, -hl * 0.1, hw * 0.5]);
  const top = deck + 1.9, rise = clamp(h.hw * 0.6, 0.7, 1.1);
  const wall = c.tint ?? pick(c, TOWN_COLORS.logs), roofC = pick(c, TOWN_COLORS.roofPlank);
  const roof = shiftRoof(roofOf("hip", h.hl, h.hw, rise), h.cu, h.cv);
  band(c.mesh, h.uv, top, roof, 0, null, wall, PATTERN.cabin, top, 1, PATTERN.cabin + DOOR, deck);
  eavesRoof(h, roof, top, 0.3, c.tint ? mix(roofC, c.tint, 0.45) : roofC);
  prism(c.mesh, edgeBox(h.uv, 1, -0.5, 0.5, 0, 0.4), deck, deck + 0.1, wood, shade(wood, 1.1));

  // the drying rack: two beams on posts, fish hanging from the top one; below it a net on one half and more fish on the other
  const ur = hl * 0.42, w = hw * 0.45, topZ = deck + 1.65, lowZ = deck + 0.95;
  const iron = rgb(TOWN_COLORS.iron[0]), silver = mix(iron, rgb(TOWN_COLORS.trim[0]), 0.65);
  for (const v of [-w, w]) prism(c.mesh, square(ur, v, 0.12), deck, topZ + 0.06, wood, wood);
  for (const z of [topZ, lowZ]) cylinder(c.mesh, [ur, -w, z], [ur, w, z], 0.045, wood);
  const fish = (v: number, z: number) => {
    const len = range(c, 0.3, 0.42);
    prism(c.mesh, rect(ur - 0.035, v - 0.09, ur + 0.035, v + 0.09), z - len, z - 0.04, silver, shade(silver, 0.8));
  };
  for (let k = 0; k < 7; k++) fish(-w + 0.25 + (k * (2 * w - 0.5)) / 6, topZ);
  for (let k = 0; k < 3; k++) fish(0.3 + (k * (w - 0.6)) / 2, lowZ);
  const net = mix(rgb(TOWN_COLORS.canvas[1]), iron, 0.35);
  prism(c.mesh, rect(ur - 0.02, -w + 0.1, ur + 0.02, -0.1), lowZ - 0.6, lowZ - 0.03, net, net);
  for (let k = 0; k < 4; k++) {
    const v = -w + 0.2 + (k * (w - 0.5)) / 3;
    prism(c.mesh, square(ur, v, 0.08), lowZ - 0.1, lowZ - 0.02, rgb(TOWN_COLORS.hide[0]), rgb(TOWN_COLORS.hide[0])); // cork floats
  }

  // a small boat lying along the +v edge: pointed hull, dark inside, two thwarts, an oar
  const ub = hl * 0.45, vb = hw * 0.78, lb = Math.min(2.4, hl * 0.8), wb = 0.8;
  const hull = ccw([[ub - lb / 2, vb], [ub - lb / 2 + 0.55, vb - wb / 2], [ub + lb / 2 - 0.55, vb - wb / 2], [ub + lb / 2, vb], [ub + lb / 2 - 0.55, vb + wb / 2], [ub - lb / 2 + 0.55, vb + wb / 2]]);
  prism(c.mesh, hull, deck, deck + 0.4, pick(c, TOWN_COLORS.planks), dark);
  const light = shade(wood, 1.2);
  for (const s of [-0.3, 0.3]) prism(c.mesh, rect(ub + s - 0.06, vb - wb / 2 + 0.1, ub + s + 0.06, vb + wb / 2 - 0.1), deck + 0.4, deck + 0.46, light, light);
  cylinder(c.mesh, [ub - lb / 2 + 0.1, vb - 0.12, deck + 0.52], [ub + lb / 2 - 0.1, vb + 0.22, deck + 0.7], 0.025, light);

  // the other side: barrels, a crate with a basket of fish, a coil of rope
  const vs = -hw + 0.55;
  crate(c, [-hl * 0.3, vs], 0.55, deck);
  barrel(c, [hl * 0.05, vs], 0.28, 0.75, deck);
  barrel(c, [hl * 0.05 + 0.62, vs], 0.26, 0.7, deck);
  const basket = pick(c, TOWN_COLORS.thatch), cb: XY = [hl * 0.05 + 0.3, vs + 0.85];
  revolve(c.mesh, cb[0], cb[1], deck, [[0.2, 0], [0.28, 0.2], [0.3, 0.32], [0.24, 0.32], [0, 0.26]], basket, 8);
  for (const s of [-0.1, 0.1]) prism(c.mesh, rect(cb[0] + s - 0.03, cb[1] - 0.12, cb[0] + s + 0.03, cb[1] + 0.12), deck + 0.26, deck + 0.38, silver, shade(silver, 0.8));
  revolve(c.mesh, hl - 0.7, vs, deck, [[0.3, 0], [0.3, 0.12], [0.18, 0.12], [0.18, 0.02], [0, 0.02]], rgb(TOWN_COLORS.hide[0]), 10);
}

export const fisherModel: TownModel = { build: pier, seat: "piles" };
