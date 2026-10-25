import type { Land } from "../world/landcover";
import { fieldCentroid } from "./fields";
import type { Clearing, Field, RoadGraph, TerrainInfo } from "./types";
import { pointInPolygon, polygonsOverlap, selfIntersects, signedArea } from "./zones";

// Forest clearing («Вырубка», PLAN-pace.md section 6). Rates are per 100 m2.
export const CLEARING = {
  forestHours: 6.25, // person-hours of felling and stubbing
  otherHours: 0.5, // person-hours of clearing brush on open ground
  logs: 2.5, // m3 of logs from forest (about 250 m3 per ha)
  minArea: 200, // m2
  maxArea: 50_000, // m2, 5 ha
  reach: 300, // m, from the centroid to the nearest built road node
};

const EPS = 1e-9;

export const clearingLabor = (area: number, forest: number): number => (area * (forest * CLEARING.forestHours + (1 - forest) * CLEARING.otherHours)) / 100;
export const clearingLogs = (area: number, forest: number): number => (area * forest * CLEARING.logs) / 100;

export const isCleared = (c: Clearing): boolean => c.done >= c.labor - EPS;

// Is the local point on ground a finished clearing has cleared?
export function clearedAt(x: number, y: number, clearings: readonly Clearing[]): boolean {
  return clearings.some((c) => isCleared(c) && pointInPolygon(x, y, c.pts));
}

// Forest inside a finished clearing is meadow.
export const landOver = (land: Land, x: number, y: number, clearings: readonly Clearing[]): Land => (land === "forest" && clearedAt(x, y, clearings) ? "meadow" : land);

export const overTerrain = (t: TerrainInfo, x: number, y: number, clearings: readonly Clearing[]): TerrainInfo => {
  const land = landOver(t.land, x, y, clearings);
  return land === t.land ? t : { ...t, land };
};

export type ClearingCheck = { ok: true; pts: [number, number][]; area: number; labor: number } | { ok: false; reason: string };

const bad = (reason: string): ClearingCheck => ({ ok: false, reason });

// A built road node (an end of a finished edge) within CLEARING.reach of the point.
function nearBuiltRoad(x: number, y: number, g: RoadGraph): boolean {
  for (const e of Object.values(g.edges)) {
    if (e.done < e.labor) continue;
    for (const n of [g.nodes[e.a], g.nodes[e.b]]) if (n && Math.hypot(n.x - x, n.y - y) <= CLEARING.reach) return true;
  }
  return false;
}

// Returns the polygon in counter-clockwise order with its area and labor, or a Russian reason.
export function validateClearing(pts: [number, number][], forest: number, graph: RoadGraph, fields: readonly Field[], clearings: readonly Clearing[]): ClearingCheck {
  if (!Array.isArray(pts) || pts.length < 3) return bad("Нужно минимум 3 точки");
  if (!pts.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6)) {
    return bad("Некорректный контур");
  }
  if (pts.length > 256) return bad("Слишком много точек");
  if (!Number.isFinite(forest) || forest < 0 || forest > 1) return bad("Некорректная доля леса");
  if (selfIntersects(pts)) return bad("Контур пересекает сам себя");
  const signed = signedArea(pts);
  const area = Math.abs(signed);
  if (area < CLEARING.minArea) return bad("Слишком маленький участок");
  if (area > CLEARING.maxArea) return bad("Слишком большой участок: до 5 га");
  const ccw: [number, number][] = signed >= 0 ? pts.map((p) => [p[0], p[1]]) : pts.map((p) => [p[0], p[1]] as [number, number]).reverse();
  if (fields.some((f) => polygonsOverlap(ccw, f.pts))) return bad("Вырубка накладывается на поле");
  if (clearings.some((c) => polygonsOverlap(ccw, c.pts))) return bad("Вырубка накладывается на другую");
  const [cx, cy] = fieldCentroid({ pts: ccw });
  if (!nearBuiltRoad(cx, cy, graph)) return bad("Слишком далеко от построенной дороги (до 300 м)");
  return { ok: true, pts: ccw, area, labor: clearingLabor(area, forest) };
}

export const nextClearingId = (clearings: readonly Clearing[]): number => clearings.reduce((m, c) => Math.max(m, c.id), 0) + 1;
