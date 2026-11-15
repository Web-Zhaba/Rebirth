import { clamp, DOOR, PATTERN, prism, rgb, shade, square, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, range, rect, edgeFrame, edgeBox, body, chimney, splitLot, part, byEdge, frameOf, slabIn, beam, fence, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The infirmary's 3D model (map/townKit.ts has the shared parts).

// Healer: a white house with a green roof, a green-cross sign at the gate, an herb garden and a drying rack in front.
function healer(c: Ctx): void {
  const { house, yard, street } = splitLot(c, 0.62);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.7, 2.8, 3.4);
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * range(c, 0.3, 0.38), 1.2, 3);
  const r = body(h, { eaves, roof: c.r() < 0.6 ? "hip" : "halfhip", rise, overhang: 0.4, wall: pick(c, TOWN_COLORS.trim), roofC: pick(c, TOWN_COLORS.healerRoof), pat: PATTERN.house, doorPat: PATTERN.house + DOOR, plinth: true });
  chimney(h, r, eaves, eaves + rise + 0.4, h.cu + h.hl * 0.4, h.cv, 0.5, pick(c, TOWN_COLORS.stone));
  // a white sign with a green cross on a post by the gate, facing the street (on the wall the eaves would hide it)
  const gate = rect(yard[0], yard[1], yard[2], yard[3]);
  const sl = edgeFrame(gate, street).len * 0.32;
  const post = byEdge(gate, street, sl, -0.3), cross = rgb(TOWN_COLORS.cross[0]), board = rgb(TOWN_COLORS.trim[0]);
  prism(c.mesh, square(post[0], post[1], 0.1), 0, 2.3, shade(board, 0.6), shade(board, 0.6));
  prism(c.mesh, edgeBox(gate, street, sl - 0.42, sl + 0.42, -0.26, -0.2), 1.45, 2.3, board, board);
  prism(c.mesh, edgeBox(gate, street, sl - 0.3, sl + 0.3, -0.2, -0.16), 1.78, 1.97, cross, cross);
  prism(c.mesh, edgeBox(gate, street, sl - 0.095, sl + 0.095, -0.2, -0.16), 1.58, 2.17, cross, cross);
  // herb beds in two rows along the street (one when the yard is shallow), flowers on some, with the path from the gate to
  // the door between them; the drying rack stands in the gap between the rows on one side, parallel to the street, so
  // it never blocks the path or the door
  const F = frameOf(yard, street), { L, D } = F;
  const soil = pick(c, TOWN_COLORS.soil), wood = pick(c, TOWN_COLORS.planks);
  const rows = D >= 2.8 ? [0.4, D - 1.2] : [0.4], path = 1.1;
  for (const d0 of rows)
    for (const [s0, s1] of [[-L / 2 + 0.4, -path], [path, L / 2 - 0.4]]) {
      if (s1 - s0 < 0.8) continue;
      slabIn(c, F, s0, s1, d0, d0 + 0.6, 0, 0.22, soil, pick(c, TOWN_COLORS.foliage));
      const m = F.at((s0 + s1) / 2, d0 + 0.3);
      if (c.r() < 0.7) prism(c.mesh, square(m[0], m[1], 0.25), 0.22, 0.4, pick(c, TOWN_COLORS.flowers), pick(c, TOWN_COLORS.flowers));
    }
  if (rows.length > 1 && L / 2 - 0.6 - path >= 1.2) {
    const d = (D - 0.2) / 2, a = F.at(-L / 2 + 0.6, d), b = F.at(-path - 0.3, d);
    for (const p of [a, b]) prism(c.mesh, square(p[0], p[1], 0.1), 0, 1.7, wood, wood);
    beam(c, a, b, 1.6, 1.68, 0.06, wood);
    for (const t of [0.25, 0.5, 0.75]) {
      const p: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      prism(c.mesh, square(p[0], p[1], 0.18), 1.1, 1.6, pick(c, TOWN_COLORS.foliage), pick(c, TOWN_COLORS.foliage));
    }
  }
  fence(c, yard, street);
}

export const healerModel: TownModel = { build: healer };
