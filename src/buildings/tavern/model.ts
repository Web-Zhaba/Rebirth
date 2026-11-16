import { pick, byEdge, barrel, beam, type TownModel } from "../../map/townKit";
import { cabin, type CabinLook } from "../../map/townForms";
import { TOWN_COLORS } from "../../ui/palette";

// The tavern's 3D model (map/townKit.ts has the shared parts).

// An inn of two floors, often plastered, under a hip roof, with two chimneys; barrels by the door and a sign hanging
// from a bracket.
const TAVERN: CabinLook = {
  plaster: 0.6,
  twoFloors: true,
  roof: (k) => (k < 0.5 ? "hip" : "halfhip"),
  pitch: [0.28, 0.36],
  twoChimneys: true,
  atDoor: (c, wood) => {
    for (const s of [-1.7, -2.4, 1.8]) barrel(c, byEdge(c.uv, c.door, s, 0.45));
    beam(c, byEdge(c.uv, c.door, 1.1, 0), byEdge(c.uv, c.door, 1.1, 1.0), 3.0, 3.1, 0.08, wood);
    beam(c, byEdge(c.uv, c.door, 1.1, 0.35), byEdge(c.uv, c.door, 1.1, 0.9), 2.25, 2.9, 0.06, pick(c, TOWN_COLORS.goods));
  },
};

export const tavernModel: TownModel = { build: (c) => cabin(c, TAVERN), smoke: "tavern" };
