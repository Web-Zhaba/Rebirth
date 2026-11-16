import { clamp, cylinder, DOOR, PATTERN, revolve, rgb } from "../../map/modelGeometry";
import { type Ctx, pick, edgeFrame, body, splitLot, part, inYard, byEdge, beam, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The hunting post's 3D model (map/townKit.ts has the shared parts).

// Hunter's lodge: a small log hut with a lean-to roof, a hide stretched on a frame and a fire pit.
function hut(c: Ctx): void {
  const { house, yard } = splitLot(c, 0.6);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.7, 2, 2.4);
  body(h, { eaves, roof: "shed", rise: 0.9, overhang: 0.3, wall: pick(c, TOWN_COLORS.logs), roofC: pick(c, c.r() < 0.5 ? TOWN_COLORS.turf : TOWN_COLORS.roofPlank), pat: PATTERN.cabin, doorPat: PATTERN.cabin + DOOR, plinth: false });
  const wood = pick(c, TOWN_COLORS.logs);
  const a = inYard(yard, 0.45, 0.5), b = inYard(yard, 0.95, 0.5);
  for (const p of [a, b]) cylinder(c.mesh, [p[0], p[1], 0], [p[0], p[1], 2], 0.07, wood);
  cylinder(c.mesh, [a[0], a[1], 1.9], [b[0], b[1], 1.9], 0.05, wood);
  beam(c, [a[0] + (b[0] - a[0]) * 0.1, a[1] + (b[1] - a[1]) * 0.1], [a[0] + (b[0] - a[0]) * 0.9, a[1] + (b[1] - a[1]) * 0.9], 0.45, 1.85, 0.04, rgb(TOWN_COLORS.hide[0]));
  // antlers over the door
  if (h.door >= 0) {
    const ed = edgeFrame(h.uv, h.door), bone = rgb(TOWN_COLORS.trim[0]);
    const m = byEdge(h.uv, h.door, 0, 0.06);
    for (const s of [-1, 1]) cylinder(c.mesh, [m[0], m[1], 2.0], [m[0] + ed.t[0] * s * 0.35 + ed.n[0] * 0.15, m[1] + ed.t[1] * s * 0.35 + ed.n[1] * 0.15, 2.45], 0.03, bone);
  }
  const fire = inYard(yard, 0.18, 0.5);
  revolve(c.mesh, fire[0], fire[1], 0, [[0.45, 0], [0.45, 0.18], [0.3, 0.18], [0.3, 0.05], [0, 0.05]], pick(c, TOWN_COLORS.stone), 10);
  revolve(c.mesh, fire[0], fire[1], 0.05, [[0.25, 0], [0, 0.02]], rgb(TOWN_COLORS.ember[0]), 8);
}

export const hunterModel: TownModel = { build: hut };
