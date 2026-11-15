import { prism } from "../../map/modelGeometry";
import { type Ctx, pick, range, inside, rect, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The vegetable garden's 3D model (map/townKit.ts has the shared parts).

// Kitchen garden: soil with beds in rows.
function garden(c: Ctx): void {
  const soil = pick(c, TOWN_COLORS.soil);
  prism(c.mesh, c.uv, 0, 0.06, soil, soil);
  const rows = Math.max(1, Math.floor((c.hw * 2 - 0.4) / 0.9));
  for (let k = 0; k < rows; k++) {
    const cv = -c.hw + 0.2 + 0.45 + k * 0.9;
    const bed = rect(-c.hl + 0.25, cv - 0.25, c.hl - 0.25, cv + 0.25);
    if (bed.every(([a, b]) => inside(c, a, b))) prism(c.mesh, bed, 0.06, range(c, 0.2, 0.35), soil, pick(c, TOWN_COLORS.foliage));
  }
}

export const gardenModel: TownModel = { build: garden };
