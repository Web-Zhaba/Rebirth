import { band, clamp, cylinder, NOFAC, PATTERN, planeRoof, prism, roofSurface, shade, square, type XY } from "../../map/modelGeometry";
import { type Ctx, pick, edgeFrame, edgeBox, streetSide, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The cellar's 3D model (map/townKit.ts has the shared parts).

// Cellar: a rounded earth mound with grass on it, an entrance of stone at the street end with a plank door and steps,
// and a vent pipe on top.
function cellar(c: Ctx): void {
  const { axis } = streetSide(c);
  // the mound's ridge runs towards the street; its profile across is an arch, the lowest of planes tangent to it
  const a = axis === 1 ? c.hl : c.hw, b = clamp(a * 0.9, 1, 2.2);
  const planes: [number, number, number][] = [];
  for (const deg of [-78, -60, -38, -14, 14, 38, 60, 78]) {
    const t = (deg * Math.PI) / 180, k = (b * Math.tan(t)) / a;
    planes.push(axis === 1 ? [-k, 0, b / Math.cos(t)] : [0, -k, b / Math.cos(t)]);
  }
  const roof = planeRoof(planes);
  const turf = pick(c, TOWN_COLORS.turf), earth = pick(c, TOWN_COLORS.soil);
  band(c.mesh, c.uv, 0, roof, 0, null, earth, PATTERN.plain, 0);
  roofSurface(c.mesh, c.tris, 0, roof, turf, NOFAC);
  if (c.door >= 0) {
    const stone = pick(c, TOWN_COLORS.stone), wood = pick(c, TOWN_COLORS.planks);
    prism(c.mesh, edgeBox(c.uv, c.door, -1, -0.65, 0, 0.35), 0, 1.75, stone, shade(stone, 1.1));
    prism(c.mesh, edgeBox(c.uv, c.door, 0.65, 1, 0, 0.35), 0, 1.75, stone, shade(stone, 1.1));
    prism(c.mesh, edgeBox(c.uv, c.door, -1.1, 1.1, 0, 0.4), 1.75, 2.05, stone, shade(stone, 1.1));
    prism(c.mesh, edgeBox(c.uv, c.door, -0.65, 0.65, 0.02, 0.12), 0, 1.7, shade(wood, 0.7), shade(wood, 0.7), PATTERN.boards);
    prism(c.mesh, edgeBox(c.uv, c.door, -0.7, 0.7, 0.35, 0.75), 0, 0.15, stone, shade(stone, 1.1));
    prism(c.mesh, edgeBox(c.uv, c.door, -0.7, 0.7, 0.75, 1.1), 0, 0.07, stone, shade(stone, 1.1));
    const e = edgeFrame(c.uv, c.door), half = axis === 1 ? c.hw : c.hl;
    const v: XY = [e.m[0] - e.n[0] * half * 1.3, e.m[1] - e.n[1] * half * 1.3];
    cylinder(c.mesh, [v[0], v[1], b * 0.8], [v[0], v[1], b + 0.6], 0.1, shade(wood, 0.8));
    prism(c.mesh, square(v[0], v[1], 0.32), b + 0.6, b + 0.68, shade(wood, 0.6), shade(wood, 0.6));
  }
}

export const cellarModel: TownModel = { build: cellar };
