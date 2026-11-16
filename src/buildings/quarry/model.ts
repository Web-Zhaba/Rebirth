import { cylinder, prism, rgb, shade, square, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, range, inside, rect, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The quarry's 3D model (map/townKit.ts has the shared parts).

// Quarry: rubble, cut blocks and a lifting tripod with a block hanging from it.
function quarry(c: Ctx): void {
  const base = pick(c, TOWN_COLORS.stone);
  prism(c.mesh, c.uv, 0, 0.12, shade(base, 0.9), shade(base, 0.9));
  const n = 3 + Math.floor(c.r() * 3);
  for (let k = 0; k < n; k++) {
    const cu = range(c, -0.7, 0.2) * c.hl, cv = range(c, -0.7, 0.7) * c.hw, s = range(c, 0.8, 1.8);
    const sq = rect(cu - s / 2, cv - s * 0.35, cu + s / 2, cv + s * 0.35);
    if (!sq.every(([a, b]) => inside(c, a, b))) continue;
    const col = shade(pick(c, TOWN_COLORS.stone), range(c, 0.85, 1.1));
    prism(c.mesh, sq, 0.12, 0.12 + range(c, 0.5, 1.4), col, shade(col, 1.1));
  }
  // tripod over the last block
  const p: XY = [c.hl * 0.5, 0], H = 4.2, R = Math.min(c.hw, c.hl) * 0.5;
  const wood = pick(c, TOWN_COLORS.logs);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3;
    cylinder(c.mesh, [p[0] + Math.cos(a) * R, p[1] + Math.sin(a) * R, 0.08], [p[0], p[1], H], 0.08, wood); // lifted by its radius: a slanted end dips
  }
  cylinder(c.mesh, [p[0], p[1], H], [p[0], p[1], 1.6], 0.02, rgb(TOWN_COLORS.iron[0]));
  const block = shade(base, 1.08);
  prism(c.mesh, square(p[0], p[1], 0.8), 0.9, 1.6, block, block);
}

export const quarryModel: TownModel = { build: quarry };
