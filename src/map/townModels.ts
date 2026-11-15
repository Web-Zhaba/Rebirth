import { clamp, framed, Mesh, rgb, rng, type Model, type XY } from "./modelGeometry";
import { frontEdge, type Ctx, type TownOptions } from "./townKit";
import { cabin } from "./townForms";
import { MODELS } from "../buildings/models";

export type { TownOptions } from "./townKit";

// Models of the town's own buildings: footprint + template height + template -> mesh, on the shared geometry of
// modelGeometry.ts. Each building draws its own model (src/buildings/<id>/model.ts) from the shared kit (townKit.ts) and
// forms (townForms.ts: a log house, a workshop, a barn), and draws its materials, roof shape, pitch, overhang, chimney
// and porch from a seed (the ring by default), so a street of the same template still varies. The door faces the
// street (`front`).
//
// Recognisable without a label: what a building is for shows in front of it. Workplaces stand at the back of the lot and
// keep their work in a yard towards the street (the forge and anvil, the kiln and pots, haystacks behind a fence, herb
// beds and a drying rack), shops get an awning with goods, the tavern barrels and a hanging sign, the school a belfry.

// How a building's model sits on the ground: on piles (a pier), or on a plinth (the default).
export const townSeat = (template: string): "piles" | "plinth" => {
  const m = (MODELS as Record<string, (typeof MODELS)[keyof typeof MODELS] | undefined>)[template];
  return m && "build" in m && m.seat === "piles" ? "piles" : "plinth";
};

// Builds the model of a building of the town. `height` is the template height in metres (after any upgrade). A
// template without a model of its own (or an unknown one) is drawn as a log house.
export function buildTownModel(ringIn: readonly XY[], height: number, template: string, opts: TownOptions = {}): Model {
  const model = (MODELS as Record<string, (typeof MODELS)[keyof typeof MODELS] | undefined>)[template] ?? null;
  const h = clamp(Number.isFinite(height) ? height : 5, 1, 30);
  if (model && "whole" in model) return model.whole(ringIn, h, opts);
  const { box, uv, tris, seed } = framed(ringIn);
  const toUV = (p: XY): XY => [p[0] * box.ux + p[1] * box.uy, -p[0] * box.uy + p[1] * box.ux];
  const front = opts.front ? toUV(opts.front) : null;
  const c: Ctx = {
    mesh: new Mesh(box),
    uv,
    tris,
    hl: Math.max(box.len, 1) / 2,
    hw: Math.max(box.wid, 1) / 2,
    cu: 0,
    cv: 0,
    front,
    r: rng(opts.seed ?? seed),
    door: frontEdge(uv, front),
    height: h,
    opts,
    tint: opts.tint ? rgb(opts.tint) : null,
  };
  (model ? model.build : cabin)(c);
  return c.mesh.m;
}
