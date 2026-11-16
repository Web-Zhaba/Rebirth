import { clamp, cornerPosts, DOOR, GATE, offsetRing, PATTERN, prism, shade, type RGB, type RoofShape } from "./modelGeometry";
import { type Pal, type Ctx, pick, range, edgeBox, body, chimney, porch, roofPalette, splitLot, part, inRect, crate, sack, rebuildPosts } from "./townKit";
import { TOWN_COLORS } from "../ui/palette";

// The forms several buildings share (src/buildings/<id>/model.ts): the log house (houses, the tavern, the district
// office), a workshop's house and the store barn. A variation is a parameter here, never a check of the template.

// How a log house varies (the plain house is the default): the tavern is an inn of two floors, often plastered, with
// two chimneys and its own things at the door.
export interface CabinLook {
  plaster?: number; // chance of plastered walls
  twoFloors?: boolean; // two floors even before a rebuild
  roof?: (k: number) => RoofShape; // the roof shape for a draw k in 0..1
  pitch?: [number, number]; // range of the roof's rise against the width
  twoChimneys?: boolean;
  atDoor?: (c: Ctx, wood: RGB) => void; // what stands at the door instead of a porch
}

// Log house; two floors for a rebuilt house.
export function cabin(c: Ctx, look: CabinLook = {}): void {
  const wid = c.hw * 2;
  const plastered = look.plaster !== undefined && c.r() < look.plaster;
  const twoFloors = (c.opts.level ?? 1) >= 2 || !!look.twoFloors;
  const eaves = twoFloors ? clamp(c.height * 0.82, 4.6, 7) : clamp(c.height * 0.6, 2.4, 4.2);
  const k = c.r();
  const roof: RoofShape = look.roof ? look.roof(k) : k < 0.5 ? "gable" : k < 0.72 ? "halfhip" : k < 0.85 && wid >= 6.5 ? "gambrel" : "gable";
  const [p0, p1] = look.pitch ?? [0.36, 0.5];
  const rise = clamp(wid * range(c, p0, p1), 1.2, 4.5);
  const wall = pick(c, plastered ? TOWN_COLORS.plaster : TOWN_COLORS.logs);
  const pat = plastered ? PATTERN.hall : PATTERN.cabin;
  const r = body(c, { eaves, roof, rise, overhang: range(c, 0.35, 0.6), wall, roofC: pick(c, roofPalette(c, wid < 6)), pat, doorPat: pat + DOOR, plinth: true });
  // the logs' ends stand out of the corners as posts
  const corners = plastered ? null : offsetRing(c.uv, 0.13);
  if (corners) cornerPosts(c.mesh, corners, eaves - 0.4, shade(c.tint ?? wall, 0.8), 0.3);
  const brick = pick(c, TOWN_COLORS.stone);
  const fu = range(c, -0.3, 0.3) * c.hl, fv = (c.r() < 0.5 ? 0.2 : -0.2) * c.hw;
  if (look.twoChimneys) {
    chimney(c, r, eaves, eaves + rise + 0.5, fu, fv, 0.7, brick);
    chimney(c, r, eaves, eaves + rise + 0.5, -fu, -fv, 0.7, brick);
  } else if (c.r() < 0.85) chimney(c, r, eaves, eaves + rise + 0.5, fu, fv, 0.6, brick);
  const wood = pick(c, TOWN_COLORS.planks);
  if (look.atDoor && c.door >= 0) look.atDoor(c, wood);
  else if (eaves >= 2.4 && c.r() < 0.45) porch(c, wood);
  if (c.opts.upgrading) rebuildPosts(c, c.uv, eaves, wood);
}

// How a workshop's house varies: the share of the lot it takes at the back, stone walls on a plinth or planks, the roof
// palette and a roof darkened by soot.
export interface WorkshopLook {
  back: number;
  stone: boolean;
  roof: Pal;
  sooty?: boolean;
}

// A workshop: a low house with a gable roof and a gate at the back of the lot, its work in a yard towards the street
// (drawn by each workshop's own model). Returns the house's part of the lot, the yard, the street edge of the yard, the
// eaves, the roof's rise, the roof, its colour (before the soot) and a brick colour for a chimney.
export function workshopHouse(c: Ctx, look: WorkshopLook) {
  const { house, yard, street } = splitLot(c, look.back);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.7, 2.6, 3.4);
  const wall = pick(c, look.stone ? TOWN_COLORS.stone : TOWN_COLORS.planks);
  const pat = look.stone ? PATTERN.house : PATTERN.boards;
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * range(c, 0.25, 0.35), 0.8, 2.5);
  const roofC = pick(c, look.roof);
  const r = body(h, { eaves, roof: "gable", rise, overhang: 0.3, wall, roofC: look.sooty ? shade(roofC, 0.7) : roofC, pat, doorPat: pat + GATE, plinth: look.stone });
  const brick = pick(c, TOWN_COLORS.stone);
  return { h, yard, street, eaves, rise, r, roofC, brick };
}

// Store: a tall plank barn with a gambrel roof, a gate with a loft door above it, crates and sacks in front.
export function store(c: Ctx): void {
  const { house, yard } = splitLot(c, 0.75);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.58, 3.3, 4);
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * 0.42, 1.8, 4);
  const wall = pick(c, TOWN_COLORS.planks);
  body(h, { eaves, roof: "gambrel", rise, overhang: 0.35, wall, roofC: pick(c, c.r() < 0.5 ? TOWN_COLORS.roofPlank : TOWN_COLORS.shingle), pat: PATTERN.boards, doorPat: PATTERN.boards + GATE, plinth: false });
  if (h.door >= 0) prism(c.mesh, edgeBox(h.uv, h.door, -0.5, 0.5, 0.01, 0.06), 2.75, 3.2, shade(wall, 0.45), shade(wall, 0.45));
  crate(c, inRect(yard, 0.15, 0.5), 0.7);
  crate(c, inRect(yard, 0.15, 0.5), 0.55, 0.7);
  crate(c, inRect(yard, 0.32, 0.5), 0.6);
  for (const fu of [0.72, 0.84]) sack(c, inRect(yard, fu, 0.5));
}
