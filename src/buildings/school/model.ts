import { clamp, DOOR, PATTERN, prism, pyramid, revolve, rgb, square } from "../../map/modelGeometry";
import { type Ctx, pick, body, porch, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The school's 3D model (map/townKit.ts has the shared parts).

// School: a tall plastered hall with big windows, a hip roof with a little belfry and a porch.
function school(c: Ctx): void {
  const wid = c.hw * 2;
  const eaves = clamp(c.height * 0.85, 3.6, 4.6);
  const rise = clamp(wid * 0.24, 1.2, 3);
  const r = body(c, { eaves, roof: "hip", rise, overhang: 0.5, wall: pick(c, TOWN_COLORS.plaster), roofC: pick(c, c.r() < 0.5 ? TOWN_COLORS.shingle : TOWN_COLORS.roofPlank), pat: PATTERN.hall, doorPat: PATTERN.hall + DOOR, plinth: true });
  const wood = pick(c, TOWN_COLORS.planks), trim = pick(c, TOWN_COLORS.trim);
  porch(c, trim);
  // belfry on the ridge: four posts under a tent roof, a bell between them
  const top = eaves + r.rise(0, 0);
  const s = 1.3;
  prism(c.mesh, square(0, 0, s), top - 0.6, top + 0.3, trim, trim);
  for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) prism(c.mesh, square((du * (s - 0.12)) / 2, (dv * (s - 0.12)) / 2, 0.12), top + 0.3, top + 1.5, wood, wood);
  pyramid(c.mesh, square(0, 0, s + 0.3), top + 1.5, 1.1, pick(c, TOWN_COLORS.shingle));
  revolve(c.mesh, 0, 0, top + 0.65, [[0.32, 0], [0.24, 0.25], [0.16, 0.6], [0, 0.65]], rgb(TOWN_COLORS.bell[0]), 10);
}

export const schoolModel: TownModel = { build: school };
