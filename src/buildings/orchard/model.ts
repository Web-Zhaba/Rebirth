import { cylinder, prism, revolve, rgb, shade, square, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, range, inside, streetEdge, fence, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The orchard's 3D model (map/townKit.ts has the shared parts).

// Orchard: one kind of fruit tree in straight rows inside a fence, trunks whitewashed, fruit on the crowns, a ladder
// against one tree and a basket under it.
function orchard(c: Ctx): void {
  const grass = shade(pick(c, TOWN_COLORS.foliage), 1.2);
  prism(c.mesh, c.uv, 0, 0.04, grass, grass);
  const step = 3;
  const nu = Math.max(1, Math.floor((c.hl * 2 - 0.6) / step)), nv = Math.max(1, Math.floor((c.hw * 2 - 0.6) / step));
  const leaf = pick(c, TOWN_COLORS.foliage), fruit = pick(c, TOWN_COLORS.fruit);
  const bark = pick(c, TOWN_COLORS.logs), white = rgb(TOWN_COLORS.trim[0]);
  const rr = range(c, 1.05, 1.25), trunk = 1.1;
  const trees: XY[] = [];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const cu = -c.hl + 0.3 + (i + 0.5) * ((c.hl * 2 - 0.6) / nu), cv = -c.hw + 0.3 + (j + 0.5) * ((c.hw * 2 - 0.6) / nv);
      if (!inside(c, cu, cv)) continue;
      trees.push([cu, cv]);
      cylinder(c.mesh, [cu, cv, 0], [cu, cv, 0.7], 0.11, white);
      cylinder(c.mesh, [cu, cv, 0.7], [cu, cv, trunk + 0.3], 0.1, bark);
      const r = rr * range(c, 0.92, 1.05);
      revolve(c.mesh, cu, cv, trunk, [[0.35 * r, 0], [r * 0.95, 0.35 * r], [r, 0.8 * r], [r * 0.75, 1.3 * r], [0, 1.6 * r]], shade(leaf, range(c, 0.92, 1.08)), 10);
      // fruit around the crown's widest ring
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + c.r(), z = trunk + r * (0.5 + 0.5 * c.r());
        const rad = r * 1.0;
        prism(c.mesh, square(cu + Math.cos(a) * rad, cv + Math.sin(a) * rad, 0.17), z, z + 0.17, fruit, fruit);
      }
    }
  if (trees.length) {
    const [tu, tv] = trees[0];
    const wood = pick(c, TOWN_COLORS.planks);
    for (const s of [-0.22, 0.22]) cylinder(c.mesh, [tu + 1.1, tv + s, 0.04], [tu + 0.25, tv + s, 2.2], 0.035, wood);
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      cylinder(c.mesh, [tu + 1.1 - 0.85 * t, tv - 0.22, 2.2 * t], [tu + 1.1 - 0.85 * t, tv + 0.22, 2.2 * t], 0.02, wood);
    }
    revolve(c.mesh, tu + 1.4, tv + 0.7, 0, [[0.22, 0], [0.3, 0.32], [0, 0.32]], pick(c, TOWN_COLORS.thatch), 8);
    revolve(c.mesh, tu + 1.4, tv + 0.7, 0.32, [[0.28, 0], [0, 0.06]], fruit, 8);
  }
  fence(c, [-c.hl, -c.hw, c.hl, c.hw], streetEdge(c), true);
}

export const orchardModel: TownModel = { build: orchard };
