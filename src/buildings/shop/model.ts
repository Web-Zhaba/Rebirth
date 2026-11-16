import { clamp, DOOR, PATTERN, prism, square } from "../../map/modelGeometry";
import { type Ctx, pick, range, edgeFrame, body, chimney, roofPalette, byEdge, crate, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The shop's 3D model (map/townKit.ts has the shared parts).

// Shop: a house with a striped awning over its front and goods on crates under it.
function shop(c: Ctx): void {
  const wid = c.hw * 2;
  const eaves = clamp(c.height * 0.6, 2.8, 4.2);
  const plastered = c.r() < 0.6;
  const wall = pick(c, plastered ? TOWN_COLORS.plaster : TOWN_COLORS.logs);
  const pat = plastered ? PATTERN.house : PATTERN.cabin;
  const rise = clamp(wid * range(c, 0.32, 0.42), 1.2, 3.5);
  const r = body(c, { eaves, roof: c.r() < 0.6 ? "gable" : "halfhip", rise, overhang: 0.35, wall, roofC: pick(c, roofPalette(c, false)), pat, doorPat: pat + DOOR, plinth: true });
  if (c.r() < 0.7) chimney(c, r, eaves, eaves + rise + 0.5, range(c, -0.3, 0.3) * c.hl, 0.2 * c.hw, 0.6, pick(c, TOWN_COLORS.stone));
  if (c.door < 0) return;
  const e = edgeFrame(c.uv, c.door);
  const half = e.len / 2 - 0.3, out = 1.1, zw = 2.75, zo = 2.15;
  const stripes = Math.max(2, Math.round((half * 2) / 0.7));
  const a = pick(c, TOWN_COLORS.goods), b = pick(c, TOWN_COLORS.trim);
  for (let k = 0; k < stripes; k++) {
    const s0 = -half + (k * 2 * half) / stripes, s1 = -half + ((k + 1) * 2 * half) / stripes;
    const p = (s: number, o: number, z: number): [number, number, number] => [...byEdge(c.uv, c.door, s, o), z];
    const col = k % 2 ? a : b;
    c.mesh.flat(p(s0, 0.02, zw), p(s1, 0.02, zw), p(s1, out, zo), col);
    c.mesh.flat(p(s0, 0.02, zw), p(s1, out, zo), p(s0, out, zo), col);
  }
  const wood = pick(c, TOWN_COLORS.planks);
  for (const s of [-half, half]) {
    const p = byEdge(c.uv, c.door, s, out - 0.05);
    prism(c.mesh, square(p[0], p[1], 0.08), 0, zo, wood, wood);
  }
  for (const s of [-1.5, 1.5]) {
    if (Math.abs(s) > half - 0.3) continue;
    const p = byEdge(c.uv, c.door, s, 0.5);
    crate(c, p, 0.6);
    prism(c.mesh, square(p[0], p[1], 0.35), 0.6, 0.85, pick(c, TOWN_COLORS.goods), pick(c, TOWN_COLORS.goods));
  }
}

export const shopModel: TownModel = { build: shop };
