import { prism, revolve, shade, square, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, inRect, beam, type TownModel } from "../../map/townKit";
import { workshopHouse } from "../../map/townForms";
import { TOWN_COLORS } from "../../ui/palette";

// The pottery's 3D model (map/townKit.ts has the shared parts).

// A clay pot standing at z.
function pot(c: Ctx, p: XY, z: number, k = 1): void {
  revolve(c.mesh, p[0], p[1], z, [[0.12 * k, 0], [0.2 * k, 0.15 * k], [0.16 * k, 0.32 * k], [0.1 * k, 0.38 * k], [0, 0.38 * k]], pick(c, TOWN_COLORS.clay), 8);
}

// Pottery: a stone workshop under a roof of the potter's own tiles; in the yard a domed kiln with a stub chimney and pots
// on a board and on the ground.
function pottery(c: Ctx): void {
  const { yard } = workshopHouse(c, { back: 0.5, stone: true, roof: TOWN_COLORS.clay });
  // a domed kiln with a stub chimney, pots on a board and on the ground
  const k = inRect(yard, 0.32, 0.5);
  const kr = Math.min(1.25, Math.min(yard[2] - yard[0], yard[3] - yard[1]) * 0.42);
  const clay = pick(c, TOWN_COLORS.clay);
  revolve(c.mesh, k[0], k[1], 0, [[kr, 0], [kr, 0.4], [kr * 0.9, kr * 0.9], [kr * 0.5, kr * 1.35], [0, kr * 1.5]], clay, 12);
  prism(c.mesh, square(k[0], k[1], 0.35), kr * 1.3, kr * 1.5 + 0.5, shade(clay, 0.8), shade(clay, 0.5));
  c.mesh.emit(k[0], k[1], kr * 1.5 + 0.5);
  const a = inRect(yard, 0.62, 0.3), b = inRect(yard, 0.62, 0.7);
  const wood = pick(c, TOWN_COLORS.planks);
  beam(c, a, b, 0.7, 0.78, 0.4, wood);
  for (const p of [a, b]) prism(c.mesh, square(p[0], p[1], 0.1), 0, 0.7, wood, wood);
  for (const tt of [0.2, 0.5, 0.8]) pot(c, [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt], 0.78);
  for (const [fu, fv] of [[0.85, 0.3], [0.88, 0.62]]) pot(c, inRect(yard, fu, fv), 0, 1.4);
}

export const potteryModel: TownModel = { build: pottery, smoke: "furnace" };
