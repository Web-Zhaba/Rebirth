import { band, clamp, PATTERN, prism, revolve, ROOF_FAC, roofOf, roofSurface, square, triangulate } from "../../map/modelGeometry";
import { type Ctx, pick, rect, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The well's 3D model (map/townKit.ts has the shared parts).

// Well: a round stone curb with water, two posts and a small roof.
function well(c: Ctx): void {
  const r = clamp(Math.min(c.hl, c.hw) * 0.55, 0.45, 0.8);
  const stone = pick(c, TOWN_COLORS.stone), wood = pick(c, TOWN_COLORS.planks);
  revolve(c.mesh, 0, 0, 0, [[r, 0], [r, 0.8], [r * 0.8, 0.8]], stone, 12);
  revolve(c.mesh, 0, 0, 0.6, [[r * 0.8, 0], [0, 0]], pick(c, TOWN_COLORS.water), 12);
  prism(c.mesh, rect(-r - 0.1, -0.05, r + 0.1, 0.05), 1.6, 1.7, wood, wood); // the windlass
  const hl = r + 0.4, hw = 0.6, eaves = 2;
  const roof = roofOf("gable", hl, hw, 0.6);
  // the posts run up to the roof and end along its slopes, so they neither stop short of it nor pierce it
  for (const u of [-r - 0.1, r + 0.1]) band(c.mesh, square(u, 0, 0.12), eaves, roof, 0, null, wood, PATTERN.plain, eaves + 0.6);
  const tris = triangulate(rect(-hl, -hw, hl, hw));
  if (tris) roofSurface(c.mesh, tris, eaves, roof, pick(c, TOWN_COLORS.shingle), ROOF_FAC);
}

export const wellModel: TownModel = { build: well };
