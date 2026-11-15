import { cylinder, prism, revolve, rgb, shade, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, rect, beam, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The dig's 3D model (map/townKit.ts has the shared parts).

// Excavation: a dark trench lined with planks under a grid of strings on pegs, rounded spoil heaps, a sieve on legs, a
// bucket and a ladder down into the trench.
function dig(c: Ctx): void {
  const soil = pick(c, TOWN_COLORS.soil);
  prism(c.mesh, c.uv, 0, 0.03, shade(soil, 1.15), shade(soil, 1.15));
  const tu = c.hl * 0.62, tv = c.hw * 0.55, cu = -c.hl * 0.12;
  const pit = rgb(TOWN_COLORS.pit[0]), wood = pick(c, TOWN_COLORS.planks);
  prism(c.mesh, rect(cu - tu, -tv, cu + tu, tv), 0.03, 0.05, pit, pit);
  const T = rect(cu - tu, -tv, cu + tu, tv);
  for (let i = 0; i < 4; i++) beam(c, T[i], T[(i + 1) % 4], 0.03, 0.16, 0.22, wood);
  // pegs on the rim and strings across, every metre or so
  const n = Math.max(2, Math.round((tu * 2) / 1.2)), m = Math.max(2, Math.round((tv * 2) / 1.2));
  const peg = (p: XY) => cylinder(c.mesh, [p[0], p[1], 0.03], [p[0], p[1], 0.55], 0.035, wood);
  const str = rgb(TOWN_COLORS.trim[0]);
  for (let k = 0; k <= n; k++) {
    const u = cu - tu + (2 * tu * k) / n;
    peg([u, -tv - 0.2]);
    peg([u, tv + 0.2]);
    cylinder(c.mesh, [u, -tv - 0.2, 0.5], [u, tv + 0.2, 0.5], 0.012, str, str, 4);
  }
  for (let k = 0; k <= m; k++) {
    const v = -tv + (2 * tv * k) / m;
    peg([cu - tu - 0.2, v]);
    peg([cu + tu + 0.2, v]);
    cylinder(c.mesh, [cu - tu - 0.2, v, 0.5], [cu + tu + 0.2, v, 0.5], 0.012, str, str, 4);
  }
  // spoil heaps, rounded, beside the trench
  const side = cu + tu + (c.hl - (cu + tu)) / 2;
  for (const [v, k] of [[-c.hw * 0.5, 1], [c.hw * 0.45, 0.8]] as const) {
    const r = Math.min(0.9, (c.hl - (cu + tu)) * 0.55) * k;
    revolve(c.mesh, side, v, 0.03, [[r, 0], [r * 0.85, r * 0.35], [r * 0.5, r * 0.62], [0, r * 0.72]], soil, 10);
  }
  // the sieve on four legs and a bucket in front of the trench
  const sv = -c.hw + 0.55, su = cu - tu * 0.4;
  for (const [du, dv] of [[-0.35, -0.25], [0.35, -0.25], [0.35, 0.25], [-0.35, 0.25]]) cylinder(c.mesh, [su + du, sv + dv, 0], [su + du, sv + dv, 0.7], 0.03, wood);
  prism(c.mesh, rect(su - 0.42, sv - 0.32, su + 0.42, sv + 0.32), 0.7, 0.8, wood, shade(pit, 1.6));
  revolve(c.mesh, su + 1, sv, 0, [[0.16, 0], [0.2, 0.32], [0, 0.32]], rgb(TOWN_COLORS.iron[0]), 8);
  // a ladder standing in the trench
  for (const s of [-0.2, 0.2]) cylinder(c.mesh, [cu - tu * 0.5 + s, 0.2, 0.05], [cu - tu * 0.5 + s, -0.25, 1.3], 0.03, wood);
}

export const digModel: TownModel = { build: dig };
