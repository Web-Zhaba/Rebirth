import { cylinder, prism, revolve, rgb, shade, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, rect, logStack, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The woodcutter's 3D model (map/townKit.ts has the shared parts).

// A chopping block with an axe in it.
function choppingBlock(c: Ctx, p: XY): void {
  const wood = pick(c, TOWN_COLORS.logs);
  revolve(c.mesh, p[0], p[1], 0, [[0.28, 0], [0.28, 0.5], [0, 0.5]], wood, 9);
  cylinder(c.mesh, [p[0], p[1], 0.5], [p[0] + 0.25, p[1] + 0.1, 1.1], 0.03, shade(wood, 1.3));
  prism(c.mesh, rect(p[0] - 0.12, p[1] - 0.02, p[0] + 0.05, p[1] + 0.02), 0.45, 0.62, rgb(TOWN_COLORS.iron[0]), rgb(TOWN_COLORS.iron[0]));
}

// Woodcutter's: an open log yard: two stacks of logs, a chopping block, a small lean-to for the tools.
function logYard(c: Ctx): void {
  const L = c.hl, W = c.hw;
  logStack(c, [-L * 0.85, -W * 0.45], [L * 0.85, -W * 0.45], 3);
  logStack(c, [-L * 0.85, W * 0.25], [L * 0.2, W * 0.25], 2);
  choppingBlock(c, [L * 0.55, W * 0.45]);
}

export const woodcutterModel: TownModel = { build: logYard };
