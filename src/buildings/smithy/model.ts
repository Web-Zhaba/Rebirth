import { clamp, prism, revolve, rgb, ROOF_FAC, shade, square, type RGB } from "../../map/modelGeometry";
import { type Ctx, pick, rect, chimney, type Rect, frameOf, slabIn, beam, logStack, type TownModel } from "../../map/townKit";
import { workshopHouse } from "../../map/townForms";
import { TOWN_COLORS } from "../../ui/palette";

// The smithy's 3D model (map/townKit.ts has the shared parts).

// The smith's yard under a lean-to roof, high at the workshop wall and low at the street. The yard comes in different
// widths, so the work is laid out in slots from the middle out and what does not fit is left out: the middle stays clear
// (the workshop gate and the way to it), left of it against the wall a stone forge with a flue and an anvil on a stump in
// front of it, and a coal heap beyond it; right of it a stack of logs for charcoal with a rack of tools above, and a quench
// trough in front. Everything stays under 1.7 m, well below the lean-to (2.3 m at its lowest).
function smithYard(c: Ctx, yard: Rect, street: number, eaves: number, roofC: RGB, brick: RGB): void {
  const F = frameOf(yard, street), { L, D } = F;
  const wood = pick(c, TOWN_COLORS.planks), iron = rgb(TOWN_COLORS.iron[0]), ember = rgb(TOWN_COLORS.ember[0]);
  const low = 2.3, high = eaves - 0.2;
  const roofAt = (d: number) => low + (high - low) * (d / D);
  const wall = D - 0.1; // just off the workshop wall
  const reach = L / 2 - 0.2; // how far from the middle things may stand
  const gate = clamp(reach - 1.5, 0.7, 1.2); // half the clear way to the gate
  // the lean-to: one plane over the yard on posts along the street edge (none in front of the gate), a beam over them
  const wallEdge = (street + 2) % 4;
  const P = rect(yard[0], yard[1], yard[2], yard[3]).map((p, i): [number, number, number] => [p[0], p[1], i === wallEdge || i === (wallEdge + 1) % 4 ? high : low]);
  c.mesh.flat(P[0], P[1], P[2], roofC, ROOF_FAC);
  c.mesh.flat(P[0], P[2], P[3], roofC, ROOF_FAC);
  const posts = [-L / 2 + 0.07, L / 2 - 0.07];
  if (reach - gate > 2.4) posts.push(-(gate + reach) / 2, (gate + reach) / 2);
  for (const s of posts) {
    const p = F.at(s, 0.07);
    prism(c.mesh, square(p[0], p[1], 0.14), 0, roofAt(0.07), wood, wood);
  }
  beam(c, F.at(-L / 2 + 0.07, 0.07), F.at(L / 2 - 0.07, 0.07), low - 0.28, low - 0.02, 0.12, wood);
  // left: the forge (1.3 m wide), its anvil, and a coal heap when there is room beyond it
  if (reach - gate >= 1.4) {
    const fs = -(gate + 0.75), fd = wall - 0.65;
    slabIn(c, F, fs - 0.65, fs + 0.65, fd - 0.65, fd + 0.55, 0, 0.85, brick, shade(brick, 1.1));
    slabIn(c, F, fs - 0.45, fs + 0.45, fd - 0.45, fd + 0.35, 0.85, 0.93, shade(iron, 0.8), ember);
    slabIn(c, F, fs - 0.42, fs + 0.42, wall - 0.55, wall, 0.93, roofAt(wall - 0.55) - 0.03, shade(brick, 0.9), shade(brick, 0.6)); // ends just under the roof
    const ad = Math.max(0.5, fd - 0.65 - 0.85), a0 = F.at(fs, ad);
    revolve(c.mesh, a0[0], a0[1], 0, [[0.28, 0], [0.28, 0.5], [0, 0.5]], pick(c, TOWN_COLORS.logs), 8);
    slabIn(c, F, fs - 0.1, fs + 0.1, ad - 0.1, ad + 0.1, 0.5, 0.62, iron, iron);
    slabIn(c, F, fs - 0.34, fs + 0.26, ad - 0.14, ad + 0.14, 0.62, 0.78, iron, shade(iron, 1.35));
    slabIn(c, F, fs + 0.26, fs + 0.46, ad - 0.1, ad + 0.1, 0.64, 0.78, iron, shade(iron, 1.35));
    slabIn(c, F, fs + 0.46, fs + 0.62, ad - 0.05, ad + 0.05, 0.7, 0.78, iron, shade(iron, 1.35));
    if (reach - gate >= 2.5) {
      const cp = F.at(-reach + 0.5, wall - 0.5);
      revolve(c.mesh, cp[0], cp[1], 0, [[0.5, 0], [0.45, 0.15], [0.28, 0.3], [0.1, 0.38], [0, 0.4]], shade(iron, 0.7), 9);
    }
  }
  // right: charcoal logs stacked along the wall with the tool rack above them (a beam with tongs and hammers), and the
  // quench trough in front of them
  if (reach - gate >= 1.5) {
    const r0 = gate + 0.1, r1 = Math.min(r0 + 1.9, reach - 0.1);
    logStack(c, F.at(r0 + 0.2, wall - 0.55), F.at(r1 - 0.1, wall - 0.55), 3, 0.16);
    beam(c, F.at(r0, wall), F.at(r1, wall), 1.6, 1.7, 0.08, wood);
    const n = Math.max(3, Math.round((r1 - r0) / 0.55));
    for (let k = 0; k < n; k++) {
      const s = r0 + ((k + 0.5) * (r1 - r0)) / n;
      const p = F.at(s, wall);
      prism(c.mesh, square(p[0], p[1], 0.05), 1.1, 1.6, iron, iron);
      if (k % 2) slabIn(c, F, s - 0.1, s + 0.1, wall - 0.05, wall + 0.04, 1.0, 1.16, iron, shade(iron, 1.3));
    }
    const ts = (r0 + r1) / 2;
    if (wall - 1.1 >= 1.2) slabIn(c, F, ts - 0.45, ts + 0.45, 0.6, 1.0, 0, 0.4, wood, rgb(TOWN_COLORS.water[0]));
  }
}

// Smithy: a stone workshop under a sooty plank roof with a tall wide chimney, the smith's work in the yard under a lean-to.
function smithy(c: Ctx): void {
  const { h, yard, street, eaves, rise, r, roofC, brick } = workshopHouse(c, { back: 0.58, stone: true, roof: TOWN_COLORS.roofPlank, sooty: true });
  // a tall wide chimney, and in the yard the smith's work under a lean-to
  chimney(h, r, eaves, eaves + rise + 1.8, h.cu, h.cv, 1.1, shade(brick, 0.8));
  smithYard(c, yard, street, eaves, roofC, brick);
}

export const smithyModel: TownModel = { build: smithy, smoke: "furnace" };
