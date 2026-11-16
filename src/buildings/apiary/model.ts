import { prism, revolve, shade, square } from "../../map/modelGeometry";
import { type Ctx, pick, range, beam, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The apiary's 3D model (map/townKit.ts has the shared parts).

// Apiary: straw skeps on low benches.
function apiary(c: Ctx): void {
  const grass = shade(pick(c, TOWN_COLORS.foliage), 1.15);
  prism(c.mesh, c.uv, 0, 0.04, grass, grass);
  const wood = pick(c, TOWN_COLORS.planks);
  for (const v of [-c.hw * 0.45, c.hw * 0.45]) {
    beam(c, [-c.hl * 0.8, v], [c.hl * 0.8, v], 0.35, 0.45, 0.6, wood);
    for (const u of [-c.hl * 0.7, c.hl * 0.7]) prism(c.mesh, square(u, v, 0.12), 0, 0.35, wood, wood);
    for (let u = -c.hl * 0.55; u <= c.hl * 0.55 + 1e-6; u += Math.max(0.9, c.hl * 0.55)) {
      const r = range(c, 0.32, 0.4);
      revolve(c.mesh, u, v, 0.45, [[r, 0], [r * 1.02, r * 0.5], [r * 0.85, r * 1.1], [r * 0.45, r * 1.55], [0, r * 1.7]], pick(c, TOWN_COLORS.hive), 10);
    }
  }
}

export const apiaryModel: TownModel = { build: apiary };
