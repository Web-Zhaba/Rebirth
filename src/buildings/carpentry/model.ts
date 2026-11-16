import { cylinder, shade } from "../../map/modelGeometry";
import { type Ctx, pick, inYard, yardAcross, beam, logStack, type TownModel } from "../../map/townKit";
import { workshopHouse } from "../../map/townForms";
import { TOWN_COLORS } from "../../ui/palette";

// The carpentry workshop's 3D model (map/townKit.ts has the shared parts).

// Carpentry workshop: a plank workshop under a shingle roof; in the yard a sawhorse with a log on it, a tall stack of
// planks and a pile of logs.
function carpentry(c: Ctx): void {
  const { yard } = workshopHouse(c, { back: 0.58, stone: false, roof: TOWN_COLORS.shingle });
  // carpentry, laid out along the yard: a sawhorse with a log on it, a tall stack of planks and a pile of logs
  const wood = pick(c, TOWN_COLORS.planks), light = shade(pick(c, TOWN_COLORS.logs), 1.25);
  const [ax, ay] = yardAcross(yard);
  for (const fl of [0.08, 0.3]) {
    const m = inYard(yard, fl, 0.5);
    for (const s of [-1, 1]) cylinder(c.mesh, [m[0] + ax * s * 0.3, m[1] + ay * s * 0.3, 0.05], [m[0], m[1], 0.8], 0.05, wood);
  }
  const s0 = inYard(yard, 0.03, 0.5), s1 = inYard(yard, 0.35, 0.5);
  cylinder(c.mesh, [s0[0], s0[1], 0.95], [s1[0], s1[1], 0.95], 0.16, pick(c, TOWN_COLORS.logs), light);
  for (let k = 0; k < 4; k++) beam(c, inYard(yard, 0.42, 0.5), inYard(yard, 0.66, 0.5), k * 0.22, k * 0.22 + 0.18, 0.95 - k * 0.08, k % 2 ? light : shade(light, 0.92));
  logStack(c, inYard(yard, 0.72, 0.5), inYard(yard, 0.97, 0.5), 3, 0.16);
}

export const carpentryModel: TownModel = { build: carpentry };
