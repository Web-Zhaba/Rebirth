import { computed, type ReadonlySignal } from "@preact/signals";
import type { Feature, FeatureCollection } from "geojson";
import { doneKinds } from "../../sim/heritage";
import { isBridge, oldStreetKind } from "../../sim/roads";
import { pointInPolygon } from "../../sim/zones";
import { buildings, finds, frame } from "../../simClient";
import { DOMAIN_COLORS, PALETTE } from "../../ui/palette";
import { ringCentroid, type XY } from "../../world/oldworld";
import { oldWorld } from "../../map/excavation";
import { hintSpots, selectedSite, typedAt, typedFoundations } from "../../map/heritageSpots";
import { brokenWalls, streetWidth } from "../../map/ruinsGeometry";
import { tool } from "../../map/tools";
import type { View } from "../view";

// The buried old city for every renderer, as GeoJSON: foundations (floors; walls broken into low pieces with their
// height `h`, or `thin` outlines), old streets (`w` real width, `bridge`), named points, the typed old buildings (`c`
// colour, `s` state, `dim`) and their names, and the hints just beyond a dig. Picking a typed old building is here too.

const close = (ring: [number, number][]): [number, number][] => [...ring, ring[0]];
const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const EMPTY = fc([]);

// The broken wall pieces of every foundation in town metres (null: too thin for walls, drawn as an outline): the 2D
// walls below and the engine's 3D walls (view/engine/models.ts) are built from the same pieces.
export const ruinWallPieces: ReadonlySignal<{ ring: XY[]; pieces: { quad: XY[]; h: number }[] | null }[]> = computed(() => {
  const w = oldWorld.value;
  return w ? w.foundations.filter((fd) => fd.ring.length >= 3).map((fd) => ({ ring: fd.ring, pieces: brokenWalls(fd.ring, fd.id, fd.height) })) : [];
});

const foundations = computed(() => {
  const f = frame.value;
  const walls: Feature[] = [];
  const floors: Feature[] = [];
  if (f)
    for (const { ring, pieces } of ruinWallPieces.value) {
      const outer = ring.map(([x, y]) => f.toLngLat(x, y));
      floors.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [close(outer)] } });
      if (!pieces) walls.push({ type: "Feature", properties: { thin: 1 }, geometry: { type: "Polygon", coordinates: [close(outer)] } });
      else for (const q of pieces) walls.push({ type: "Feature", properties: { thin: 0, h: q.h }, geometry: { type: "Polygon", coordinates: [close(q.quad.map(([x, y]) => f.toLngLat(x, y)))] } });
    }
  return { walls: fc(walls), floors: fc(floors) };
});
export const ruinWalls: ReadonlySignal<FeatureCollection> = computed(() => foundations.value.walls);
export const ruinFloors: ReadonlySignal<FeatureCollection> = computed(() => foundations.value.floors);

export const ruinStreets: ReadonlySignal<FeatureCollection> = computed(() => {
  const w = oldWorld.value;
  const f = frame.value;
  if (!w || !f) return EMPTY;
  return fc(
    w.streets
      .filter((s) => s.pts.length >= 2)
      .map((s) => ({
        type: "Feature",
        properties: { w: streetWidth(s.cls), bridge: isBridge(oldStreetKind(s.cls, s.bridge === true)), ...(s.name ? { name: s.name } : {}) },
        geometry: { type: "LineString", coordinates: s.pts.map(([x, y]) => f.toLngLat(x, y)) },
      })),
  );
});

const typed = computed(() => {
  const f = frame.value;
  const list = typedFoundations.value;
  const sites = finds.value?.foundations ?? [];
  const stateOf = new Map(sites.flatMap((x) => (x.state ? [[x.id, x.state] as const] : [])));
  const done = doneKinds(sites); // a kind already restored: its other sites are fainter
  const shapes: Feature[] = [];
  const names: Feature[] = [];
  if (f)
    for (const t of list) {
      if (t.ring.length < 3) continue;
      const outer = t.ring.map(([x, y]) => f.toLngLat(x, y));
      const st = stateOf.get(t.id) ?? "";
      shapes.push({ type: "Feature", properties: { c: st === "lost" ? PALETTE.pencilFaint : DOMAIN_COLORS[t.domain], s: st, dim: st === "" && done.has(t.cls) ? 1 : 0 }, geometry: { type: "Polygon", coordinates: [close(outer)] } });
      if (t.name) names.push({ type: "Feature", properties: { name: t.name }, geometry: { type: "Point", coordinates: f.toLngLat(...ringCentroid(t.ring)) } });
    }
  return { shapes: fc(shapes), names: fc(names) };
});
export const ruinTyped: ReadonlySignal<FeatureCollection> = computed(() => typed.value.shapes);
export const ruinTypedNames: ReadonlySignal<FeatureCollection> = computed(() => typed.value.names);

// Named points not already labelled by a typed old building.
export const ruinPois: ReadonlySignal<FeatureCollection> = computed(() => {
  const w = oldWorld.value;
  const f = frame.value;
  if (!w || !f) return EMPTY;
  const typedNames = new Set(typedFoundations.value.flatMap((t) => (t.name ? [t.name] : [])));
  return fc(w.pois.filter((p) => !typedNames.has(p.name)).map((p) => ({ type: "Feature", properties: { name: p.name }, geometry: { type: "Point", coordinates: f.toLngLat(p.x, p.y) } })));
});

export const ruinHints: ReadonlySignal<FeatureCollection> = computed(() => {
  const f = frame.value;
  return f ? fc(hintSpots.value.map((h) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: f.toLngLat(h.x, h.y) } }))) : EMPTY;
});

// A click on a typed old building opens its panel; a real building on the same ground wins, empty ground deselects.
export function attachSitePick(view: View): void {
  view.on("click", (e) => {
    const f = frame.value;
    if (tool.value || !f) return;
    const [x, y] = f.toLocal(e.lngLat[0], e.lngLat[1]);
    const onBuilding = Object.values(buildings.value ?? {}).some((b) => pointInPolygon(x, y, b.footprint));
    selectedSite.value = onBuilding ? null : (typedAt(x, y, typedFoundations.value)?.id ?? null);
  });
}
