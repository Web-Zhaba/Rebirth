import { PATTERN, prism, shade, square } from "../../map/modelGeometry";
import { type Ctx, pick, range, rect, barrel, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The market's 3D model (map/townKit.ts has the shared parts).

// Market: stalls in two rows facing the middle, each a counter with goods under a striped canopy on four posts.
function market(c: Ctx): void {
  const wood = pick(c, TOWN_COLORS.planks);
  const dust = shade(pick(c, TOWN_COLORS.soil), 1.5);
  prism(c.mesh, c.uv, 0, 0.03, dust, dust);
  const cols = Math.max(1, Math.floor((c.hl * 2 - 0.6) / 3));
  const sw = (c.hl * 2 - 0.6) / cols;
  for (const side of [-1, 1])
    for (let k = 0; k < cols; k++) {
      const cu = -c.hl + 0.3 + sw * (k + 0.5), back = side * (c.hw - 0.3), front = side * (c.hw - 2.2);
      const hw = sw / 2 - 0.25;
      const stripeA = pick(c, TOWN_COLORS.goods), stripeB = pick(c, TOWN_COLORS.trim);
      const n = 4;
      for (let s = 0; s < n; s++) {
        const u0 = cu - hw + (2 * hw * s) / n, u1 = cu - hw + (2 * hw * (s + 1)) / n;
        const col = s % 2 ? stripeA : stripeB;
        c.mesh.flat([u0, back, 2.5], [u1, back, 2.5], [u1, front - side * 0.3, 2.0], col);
        c.mesh.flat([u0, back, 2.5], [u1, front - side * 0.3, 2.0], [u0, front - side * 0.3, 2.0], col);
      }
      for (const u of [cu - hw, cu + hw]) for (const [v, z] of [[back, 2.5], [front - side * 0.3, 2.0]] as const) prism(c.mesh, square(u, v, 0.1), 0, z, wood, wood);
      const counter = rect(cu - hw + 0.1, Math.min(front, front + side * 0.7), cu + hw - 0.1, Math.max(front, front + side * 0.7));
      prism(c.mesh, counter, 0, 0.9, wood, shade(wood, 1.1), PATTERN.boards);
      for (const du of [-0.6, 0, 0.6]) if (Math.abs(du) < hw - 0.2 && c.r() < 0.8) prism(c.mesh, square(cu + du, front + side * 0.35, 0.38), 0.9, 0.9 + range(c, 0.15, 0.35), pick(c, TOWN_COLORS.goods), pick(c, TOWN_COLORS.goods));
      if (c.r() < 0.6) barrel(c, [cu + hw - 0.35, back - side * 0.5]);
    }
}

export const marketModel: TownModel = { build: market };
