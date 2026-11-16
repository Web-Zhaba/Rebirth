import { clamp, cylinder, prism, revolve, rgb, shade, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, rect, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The forager's 3D model (map/townKit.ts has the shared parts).

// Forager's camp: a shelter of poles and bark like a cone, baskets of berries, a tray of mushrooms and a small fire.
function tent(c: Ctx): void {
  const r = Math.min(c.hl, c.hw) * 0.55, cu = -c.hl * 0.3, cv = -c.hw * 0.25, H = clamp(c.height + 0.6, 2.2, 3);
  const bark = pick(c, TOWN_COLORS.logs), pole = shade(bark, 1.2);
  revolve(c.mesh, cu, cv, 0, [[r, 0], [r * 0.55, H * 0.45], [r * 0.18, H * 0.78]], shade(bark, 0.85), 9);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const base: [number, number, number] = [cu + Math.cos(a) * r * 1.02, cv + Math.sin(a) * r * 1.02, 0.05];
    const apex: [number, number, number] = [cu - Math.cos(a) * 0.15, cv - Math.sin(a) * 0.15, H];
    cylinder(c.mesh, base, apex, 0.04, pole);
  }
  // baskets full of berries
  const basket = pick(c, TOWN_COLORS.thatch);
  for (const [fu, fv] of [[0.55, 0.55], [0.85, 0.2]]) {
    const u = fu * c.hl, v = fv * c.hw;
    revolve(c.mesh, u, v, 0, [[0.22, 0], [0.3, 0.32], [0, 0.32]], basket, 8);
    revolve(c.mesh, u, v, 0.32, [[0.28, 0], [0, 0.07]], pick(c, TOWN_COLORS.berries), 8);
  }
  // a tray of mushrooms
  const tu = c.hl * 0.6, tv = -c.hw * 0.55;
  prism(c.mesh, rect(tu - 0.45, tv - 0.3, tu + 0.45, tv + 0.3), 0, 0.12, basket, basket);
  for (const [du, dv] of [[-0.25, -0.12], [0, 0.1], [0.25, -0.08], [0.15, 0.15], [-0.2, 0.15]]) {
    revolve(c.mesh, tu + du, tv + dv, 0.12, [[0.04, 0], [0.04, 0.07], [0.12, 0.08], [0, 0.14]], rgb(TOWN_COLORS.mushroom[0]), 6);
  }
  const fire: XY = [c.hl * 0.2, c.hw * 0.55];
  revolve(c.mesh, fire[0], fire[1], 0, [[0.35, 0], [0.35, 0.15], [0.22, 0.15], [0.22, 0.04], [0, 0.04]], pick(c, TOWN_COLORS.stone), 9);
  revolve(c.mesh, fire[0], fire[1], 0.04, [[0.2, 0], [0, 0.03]], rgb(TOWN_COLORS.ember[0]), 8);
}

export const foragerModel: TownModel = { build: tent };
