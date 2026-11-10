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
import { foundationIndex } from "../../sim/foundationLots";
import { beyondSurvey, catalogue, foundIds } from "../../sim/items";
import { ruinsAutoShown, ruinsShown } from "../ruinsShown";
import type { View } from "../view";

// The buried old city for every renderer, as GeoJSON: foundations (floors; walls broken into low pieces with their
// height `h`, or `thin` outlines), old streets (`w` real width, `bridge`), named points, the typed old buildings (`c`
// colour, `s` state, `dim`) and their names, and the hints just beyond a dig. Picking a typed old building is here too.

const close = (ring: [number, number][]): [number, number][] => [...ring, ring[0]];
const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const EMPTY = fc([]);

// Foundations dug out (docs/PLAN-restoration.md section 5): recorded and no longer a surveyed outline. A string, so what
// depends on it is rebuilt only when it changes. Everything else of the old world is a ghost outline until it is dug.
const dugKey = computed(() =>
  (finds.value?.foundations ?? [])
    .filter((f) => !f.ghost)
    .map((f) => f.id)
    .sort()
    .join(" "),
);
const dug = computed(() => new Set(dugKey.value ? dugKey.value.split(" ") : []));

// The broken wall pieces of every dug foundation in town metres (null: too thin for walls, drawn as an outline): the 2D
// walls below and the engine's 3D walls (view/engine/models.ts) are built from the same pieces.
const allPieces = computed(() => {
  const w = oldWorld.value;
  const open = dug.value;
  return w ? w.foundations.filter((fd) => fd.ring.length >= 3 && open.has(fd.id)).map((fd) => ({ id: fd.id, ring: fd.ring, pieces: brokenWalls(fd.ring, fd.id, fd.height) })) : [];
});

// Ghost outlines of what the survey revealed and nobody has dug yet, and the digs under way: the outline draws itself
// as the work goes (`dig`: the done share of the ring, solid).
export const ruinGhosts: ReadonlySignal<FeatureCollection> = computed(() => {
  const w = oldWorld.value;
  const f = frame.value;
  if (!w || !f) return EMPTY;
  const open = dug.value;
  const out: Feature[] = [];
  for (const fd of w.foundations) {
    if (fd.ring.length < 3 || open.has(fd.id)) continue;
    out.push({ type: "Feature", properties: { dig: 0 }, geometry: { type: "LineString", coordinates: close(fd.ring.map(([x, y]) => f.toLngLat(x, y))) } });
  }
  for (const b of Object.values(buildings.value ?? {})) {
    if (b.template !== "excavation" || b.state === "planned") continue;
    const part = partialRing(b.footprint, b.labor > 0 ? b.done / b.labor : 0);
    if (part.length >= 2) out.push({ type: "Feature", properties: { dig: 1 }, geometry: { type: "LineString", coordinates: part.map(([x, y]) => f.toLngLat(x, y)) } });
  }
  return fc(out);
});

// The first `share` of a ring's perimeter, as a polyline.
export function partialRing(ring: readonly XY[], share: number): XY[] {
  const pts = [...ring, ring[0]];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * Math.max(0, Math.min(1, share));
  const out: XY[] = [pts[0]];
  for (let i = 1; i < pts.length && left > 0; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len <= left) {
      out.push([bx, by]);
      left -= len;
    } else {
      const t = len > 0 ? left / len : 0;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      left = 0;
    }
  }
  return out;
}

// Foundations a building stands on once its construction has started: their ruins are not drawn, and come back when the
// building is demolished. A string, so the ruins are rebuilt only when this set changes, not on every construction tick.
const builtOn = computed(() => {
  const ids: string[] = [];
  for (const b of Object.values(buildings.value ?? {})) if (b.foundationId && b.state !== "planned") ids.push(b.foundationId);
  return ids.sort().join(" ");
});

export const ruinWallPieces: ReadonlySignal<{ ring: XY[]; pieces: { quad: XY[]; h: number }[] | null }[]> = computed(() => {
  const key = builtOn.value;
  if (!key) return allPieces.value;
  const hidden = new Set(key.split(" "));
  return allPieces.value.filter((p) => !hidden.has(p.id));
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

// Old streets restored in full (sim/streets.ts): their names are the town's again, shown without the old city.
export const restoredStreets: ReadonlySignal<FeatureCollection> = computed(() => {
  const list = finds.value?.streets ?? [];
  const f = frame.value;
  if (!f) return EMPTY;
  return fc(
    list.flatMap((t) =>
      t.restored !== undefined && t.lines
        ? t.lines.filter((l) => l.length >= 2).map((l): Feature => ({ type: "Feature", properties: { name: t.name }, geometry: { type: "LineString", coordinates: l.map(([x, y]) => f.toLngLat(x, y)) } }))
        : [],
    ),
  );
});

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
  const open = dug.value;
  const list = typedFoundations.value.filter((t) => open.has(t.id)); // an outline does not tell what stood there
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

// Hints: notable places just beyond the discs, and the finds found that point to places the survey has not reached.
export const ruinHints: ReadonlySignal<FeatureCollection> = computed(() => {
  const f = frame.value;
  const fd = finds.value;
  if (!f) return EMPTY;
  const pts: [number, number][] = hintSpots.value.map((h) => [h.x, h.y]);
  if (fd) {
    const found = foundIds({ finds: fd });
    for (const i of catalogue({ finds: fd })) if (found.has(i.id) && !fd.fates[i.id] && !i.lines && beyondSurvey(fd, i)) pts.push([i.x, i.y]);
  }
  return fc(pts.map(([x, y]) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: f.toLngLat(x, y) } })));
});

// A click on an old foundation, an outline or a dug one, opens its panel while the old city shows; a real building on the
// same ground wins, empty ground deselects.
export function attachSitePick(view: View): void {
  view.on("click", (e) => {
    const f = frame.value;
    if (tool.value || !f || e.original.defaultPrevented) return; // a resident took the click (view/engine/life.ts)
    const [x, y] = f.toLocal(e.lngLat[0], e.lngLat[1]);
    const onBuilding = Object.values(buildings.value ?? {}).some((b) => pointInPolygon(x, y, b.footprint));
    const shown = ruinsShown.peek() || ruinsAutoShown.peek();
    const list = finds.value?.foundations ?? [];
    const hit = onBuilding || !shown ? null : (typedAt(x, y, typedFoundations.value)?.id ?? foundationIndex(list).at(x, y)?.id ?? null);
    selectedSite.value = hit;
  });
}
