import { cylinder, pyramid, shade, square } from "../../map/modelGeometry";
import { type Ctx, pick, beam, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The sawmill's 3D model (map/townKit.ts has the shared parts).

// Saw pit: a log on a tall trestle frame for two sawyers, sawn planks and a heap of sawdust.
function sawFrame(c: Ctx): void {
  const L = c.hl, W = c.hw, H = 1.6;
  const wood = pick(c, TOWN_COLORS.planks);
  for (const u of [-L * 0.55, L * 0.55]) {
    // an A-frame across the pit
    cylinder(c.mesh, [u, -W * 0.45, 0.07], [u, 0, H], 0.07, wood);
    cylinder(c.mesh, [u, W * 0.45, 0.07], [u, 0, H], 0.07, wood);
    cylinder(c.mesh, [u, -W * 0.25, H * 0.45], [u, W * 0.25, H * 0.45], 0.05, wood);
  }
  cylinder(c.mesh, [-L * 0.9, 0, H + 0.2], [L * 0.9, 0, H + 0.2], 0.22, pick(c, TOWN_COLORS.logs), shade(pick(c, TOWN_COLORS.logs), 1.35));
  const plank = shade(pick(c, TOWN_COLORS.logs), 1.3);
  beam(c, [-L * 0.7, W * 0.75], [L * 0.7, W * 0.75], 0, 0.4, 0.5, plank);
  pyramid(c.mesh, square(-L * 0.1, -W * 0.7, 0.9), 0, 0.3, shade(plank, 1.1));
}

export const sawpitModel: TownModel = { build: sawFrame };
