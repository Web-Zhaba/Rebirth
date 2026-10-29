import type * as maplibregl from "maplibre-gl";
import { effect, signal, type ReadonlySignal } from "@preact/signals";
import { doneKinds } from "../sim/heritage";
import { isBridge, oldStreetKind, ROAD_KINDS } from "../sim/roads";
import { DOMAIN_COLORS, mixHex, PALETTE, TREE_COLORS } from "../ui/palette";
import type { Frame } from "../world/frame";
import { ringCentroid, type OldWorld, type XY } from "../world/oldworld";
import { pointInPolygon } from "../sim/zones";
import { hintSpots, selectedSite, typedAt, typedFoundations } from "./heritageSpots";
import { tool } from "./tools";

const SRC_WALLS = "ruins-walls";
const SRC_FLOORS = "ruins-floors";
const SRC_STREETS = "ruins-streets";
const SRC_POIS = "ruins-pois";
const SRC_TYPED = "ruins-typed";
const SRC_TYPED_NAMES = "ruins-typed-labels";
const SRC_HINTS = "ruins-hints";
const RUIN_LAYERS = [
  "ruins-floor",
  "ruins-typed-fill",
  "ruins-streets",
  "ruins-outline",
  "ruins-typed-outline",
  "ruins-walls",
  "ruins-hints",
  "ruins-street-names",
  "ruins-typed-names",
  "ruins-poi-names",
];
const EQUATOR_M = 40075016.686;

// Whether the old city is drawn: a choice of the player's, kept in localStorage. The finds stay either way.
const SHOW_KEY = "rebirth.ruins";
function readShown(): boolean {
  try {
    return localStorage.getItem(SHOW_KEY) !== "0";
  } catch {
    return true;
  }
}

export const ruinsShown = signal(readShown());
export const ruinsAutoShown = signal(false);

export function toggleRuins(): void {
  ruinsShown.value = !ruinsShown.value;
  try {
    localStorage.setItem(SHOW_KEY, ruinsShown.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export const WALL_HEIGHT = 0.6; // m
export const WALL_THICKNESS = 0.5; // m
const FONT = ["Noto Sans Regular"];
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

// Major streets wide, footways and tracks as narrow as the path they come back as, the rest in between.
export const streetWidth = (cls: string): number => (MAJOR.has(cls) ? 10 : oldStreetKind(cls, false) === "path" ? ROAD_KINDS.path.width : 6);

// ---------- pure geometry ----------

const area2 = (r: XY[]): number => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s;
};

// Proper intersection of segments ab and cd (touching endpoints do not count).
function segCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function selfIntersects(r: XY[]): boolean {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
      if (segCross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return true;
    }
  }
  return false;
}

// Ring moved `d` m towards its inside (mitred corners). Returns an open ring in counter-clockwise
// order, or null when the inset degenerates (too thin, spiky, self-intersecting, flipped).
// The ring without repeated or closing points, counter-clockwise; null when it encloses nothing.
function cleanRing(ring: XY[]): XY[] | null {
  const EPS = 0.01; // 1 cm: removes zero-ish vector-tile edges that create huge mitres
  const p0: XY[] = [];
  for (const q of ring) {
    const last = p0[p0.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > EPS) p0.push(q);
  }
  if (p0.length > 1 && Math.hypot(p0[0][0] - p0[p0.length - 1][0], p0[0][1] - p0[p0.length - 1][1]) <= EPS) p0.pop();
  if (p0.length < 3 || selfIntersects(p0)) return null;
  const a0 = area2(p0);
  if (Math.abs(a0) < 1e-9) return null;
  return a0 < 0 ? p0.slice().reverse() : p0; // counter-clockwise: the inside is on the left of every edge
}

function pointInRing(q: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
    if (Math.hypot(q[0] - (a[0] + dx * t), q[1] - (a[1] + dy * t)) < 1e-7) return true;
    if ((b[1] > q[1]) !== (a[1] > q[1]) && q[0] < ((a[0] - b[0]) * (q[1] - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}

export function insetRing(ring: XY[], d: number): XY[] | null {
  const p = cleanRing(ring);
  if (!p) return null;
  const n = p.length;
  const normals: XY[] = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-9) return null;
    normals.push([-(y1 - y0) / len, (x1 - x0) / len]);
  }
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const n0 = normals[(i + n - 1) % n];
    const n1 = normals[i];
    const k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    if (k < 0.05) return null; // near-reversal: the miter would shoot off
    const mx = (d * (n0[0] + n1[0])) / k;
    const my = (d * (n0[1] + n1[1])) / k;
    if (Math.hypot(mx, my) > d * 8) return null;
    out.push([p[i][0] + mx, p[i][1] + my]);
  }
  // Every inset edge must keep its direction (otherwise it collapsed and flipped).
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ox = p[j][0] - p[i][0];
    const oy = p[j][1] - p[i][1];
    const nx = out[j][0] - out[i][0];
    const ny = out[j][1] - out[i][1];
    if (ox * nx + oy * ny <= 0) return null;
  }
  const a1 = area2(out);
  if (a1 <= 0 || a1 >= area2(p)) return null;
  if (selfIntersects(out)) return null;
  // A mathematically valid mitre can still jump across a deep concavity. In that case
  // MapLibre triangulates the wall band through the building interior, producing the
  // characteristic "inside face". Prefer a flat outline to broken 3D geometry.
  if (out.some((q) => !pointInRing(q, p))) return null;
  return out;
}

// The walls of a foundation as they stand after a century: pieces about PIECE m along the ring, each its own height
// (a hash of the foundation and the piece), higher at the corners, which hold out longest, and higher for a building
// that was tall; about one piece in six has fallen to a stub. Null when the ring is too thin for walls.
const PIECE = 2.5; // m
export function brokenWalls(ring: XY[], key: string, height = 6): { quad: XY[]; h: number }[] | null {
  const p = cleanRing(ring);
  if (!p) return null;

  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
  const rnd = (a: number, b: number) => {
    let h = Math.imul(seed ^ Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263), 1274126177);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };

  const top = Math.min(3, Math.max(1.2, height * 0.3)); // m, the best kept piece of this building
  const out: { quad: XY[]; h: number }[] = [];
  const lerp = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  // Build every wall piece directly from its outer edge. For a counter-clockwise
  // footprint the left-hand normal always points into the building. This avoids the
  // old outer↔inset vertex correspondence entirely: on concave footprints that
  // correspondence could create a diagonal polygon spanning the building interior.
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const ex = p[j][0] - p[i][0];
    const ey = p[j][1] - p[i][1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;

    const nx = (-ey / len) * WALL_THICKNESS;
    const ny = (ex / len) * WALL_THICKNESS;
    const n = Math.max(1, Math.round(len / PIECE));

    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const a = lerp(p[i], p[j], t0);
      const b = lerp(p[i], p[j], t1);
      const ai: XY = [a[0] + nx, a[1] + ny];
      const bi: XY = [b[0] + nx, b[1] + ny];

      // If the footprint is locally thinner than the wall itself, drawing this piece
      // would put its inner edge outside the foundation. Skip only that piece instead
      // of turning the whole building into an outline.
      const mid: XY = [(a[0] + b[0]) / 2 + nx * 0.5, (a[1] + b[1]) / 2 + ny * 0.5];
      if (!pointInRing(ai, p) || !pointInRing(bi, p) || !pointInRing(mid, p)) continue;

      const corner = Math.max(0, 1 - Math.min(k, n - 1 - k) * 0.6);
      const r = rnd(i, k);
      const h = r < 0.16 ? 0.1 : WALL_HEIGHT * 0.5 + (top - WALL_HEIGHT * 0.5) * Math.min(1, rnd(i, k + 1000) ** 2 * 0.8 + corner * 0.5 * r);

      // Always a convex rectangle; MapLibre/earcut therefore cannot invent an
      // interior diagonal face while triangulating the extrusion cap.
      out.push({ quad: [a, b, bi, ai], h });
    }
  }

  return out.length ? out : null;
}

// ---------- layer ----------

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

// Width in px of `meters` of ground at zoom z (512 px tiles), at least 1 px.
function realWidth(k: number): maplibregl.ExpressionSpecification {
  const stops: unknown[] = [];
  for (let z = 8; z <= 22; z++) stops.push(z, ["max", 1, ["*", ["get", "w"], k * 2 ** z]]);
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops] as maplibregl.ExpressionSpecification;
}

const close = (ring: [number, number][]): [number, number][] => [...ring, ring[0]];

// The buried old city as ruins: low stone walls over foundations, faint ochre dashed streets, names.
export function attachRuinsLayer(
  map: maplibregl.Map,
  world: ReadonlySignal<OldWorld | null>,
  frame: ReadonlySignal<Frame | null>,
): () => void {
  let ready = false;
  let disposeEffect: (() => void) | null = null;
  let disposeShown: (() => void) | null = null;
  let disposed = false;
  let sc: typeof import("../simClient") | null = null; // loaded lazily: the pure parts of this file are tested without the worker

  const applyShown = () => {
    for (const id of RUIN_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", ruinsShown.peek() || ruinsAutoShown.peek() ? "visible" : "none");
  };

  const setup = (lat: number) => {
    const k = 512 / (EQUATOR_M * Math.cos((lat * Math.PI) / 180));
    for (const id of [SRC_WALLS, SRC_FLOORS, SRC_STREETS, SRC_POIS, SRC_TYPED, SRC_TYPED_NAMES, SRC_HINTS]) map.addSource(id, { type: "geojson", data: empty() });
    const beneath = map.getLayer("roads-casing") ? "roads-casing" : undefined;
    map.addLayer(
      { id: "ruins-floor", type: "fill", source: SRC_FLOORS, minzoom: 13, paint: { "fill-color": PALETTE.pencilFaint, "fill-opacity": 0.28 } },
      beneath,
    );
    // Notable buildings: floor in the colour of their domain.
    map.addLayer(
      { id: "ruins-typed-fill", type: "fill", source: SRC_TYPED, minzoom: 13, paint: { "fill-color": ["get", "c"], "fill-opacity": ["match", ["get", "s"], "restored", 0.12, "restoring", 0.3, "lost", 0.2, ["case", ["==", ["get", "dim"], 1], 0.2, 0.5]] } },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-streets",
        type: "line",
        source: SRC_STREETS,
        minzoom: 12,
        layout: { "line-cap": "butt", "line-join": "round" },
        // Solid and faint: at real width, dashes read as rows of small houses.
        // Old bridges darker and stronger, so a dig shows where a bridge will come back.
        paint: {
          "line-color": ["case", ["get", "bridge"], PALETTE.pencil, PALETTE.warn],
          "line-width": realWidth(k),
          "line-opacity": ["case", ["get", "bridge"], 0.6, 0.3],
        },
      },
      beneath,
    );
    // Foundations too thin to inset: outline only.
    map.addLayer(
      {
        id: "ruins-outline",
        type: "line",
        source: SRC_WALLS,
        minzoom: 14,
        filter: ["==", ["get", "thin"], 1],
        paint: { "line-color": PALETTE.pencil, "line-width": 1.2, "line-opacity": 0.85 },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-typed-outline",
        type: "line",
        source: SRC_TYPED,
        minzoom: 13,
        layout: { "line-join": "round" },
        paint: { "line-color": ["get", "c"], "line-width": ["match", ["get", "s"], "restoring", 3.5, "restored", 1, 2], "line-opacity": ["match", ["get", "s"], "lost", 0.45, ["case", ["==", ["get", "dim"], 1], 0.5, 0.95]] },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-walls",
        type: "fill-extrusion",
        source: SRC_WALLS,
        minzoom: 14,
        filter: ["==", ["get", "thin"], 0],
        paint: {
          // weathered stone, the lowest pieces grown over with moss
          "fill-extrusion-color": ["interpolate", ["linear"], ["get", "h"], 0.1, mixHex(PALETTE.pencilFaint, TREE_COLORS.summer, 0.45), 1, PALETTE.pencilFaint, 2.5, mixHex(PALETTE.pencilFaint, TREE_COLORS.stone, 0.5)],
          "fill-extrusion-height": ["get", "h"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.95,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      beneath,
    );
    // Hints: faint unnamed spots just beyond a dig, no type and no domain colour.
    map.addLayer(
      {
        id: "ruins-hints",
        type: "circle",
        source: SRC_HINTS,
        minzoom: 14,
        paint: {
          "circle-radius": 4,
          "circle-color": PALETTE.pencilFaint,
          "circle-opacity": 0.35,
          "circle-stroke-color": PALETTE.pencilFaint,
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.5,
        },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-street-names",
        type: "symbol",
        source: SRC_STREETS,
        minzoom: 15,
        filter: ["has", "name"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": 11,
          "text-letter-spacing": 0.05,
        },
        paint: { "text-color": PALETTE.ink2, "text-halo-color": PALETTE.paperRaised, "text-halo-width": 1.5 },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-typed-names",
        type: "symbol",
        source: SRC_TYPED_NAMES,
        minzoom: 15,
        layout: {
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": 12,
          "text-max-width": 8,
          "text-anchor": "center",
        },
        paint: { "text-color": PALETTE.ink, "text-halo-color": PALETTE.paperRaised, "text-halo-width": 1.5 },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-poi-names",
        type: "symbol",
        source: SRC_POIS,
        minzoom: 15,
        layout: {
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": 11,
          "text-max-width": 8,
          "text-anchor": "top",
          "text-offset": [0, 0.4],
        },
        paint: { "text-color": PALETTE.ink, "text-halo-color": PALETTE.paperRaised, "text-halo-width": 1.5 },
      },
      beneath,
    );
    ready = true;
    applyShown();
  };

  const apply = () => {
    const w = world.value;
    const f = frame.value;
    if (!w || !f || disposed) return;
    if (!ready) setup(f.toLngLat(0, 0)[1]);

    const walls: GeoJSON.Feature[] = [];
    const floors: GeoJSON.Feature[] = [];
    for (const fd of w.foundations) {
      if (fd.ring.length < 3) continue;
      const outer = fd.ring.map(([x, y]) => f.toLngLat(x, y));
      floors.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [close(outer)] } });
      const pieces = brokenWalls(fd.ring, fd.id, fd.height);
      if (!pieces) walls.push({ type: "Feature", properties: { thin: 1 }, geometry: { type: "Polygon", coordinates: [close(outer)] } });
      else
        for (const q of pieces)
          walls.push({ type: "Feature", properties: { thin: 0, h: q.h }, geometry: { type: "Polygon", coordinates: [close(q.quad.map(([x, y]) => f.toLngLat(x, y)))] } });
    }
    const streets: GeoJSON.Feature[] = w.streets
      .filter((s) => s.pts.length >= 2)
      .map((s) => ({
        type: "Feature",
        properties: { w: streetWidth(s.cls), bridge: isBridge(oldStreetKind(s.cls, s.bridge === true)), ...(s.name ? { name: s.name } : {}) },
        geometry: { type: "LineString", coordinates: s.pts.map(([x, y]) => f.toLngLat(x, y)) },
      }));
    const typedList = typedFoundations.value;
    const stateOf = new Map((sc?.finds.value?.foundations ?? []).flatMap((x) => (x.state ? [[x.id, x.state] as const] : [])));
    const done = doneKinds(sc?.finds.value?.foundations ?? []); // a kind already restored: its other sites are fainter
    const typedNameSet = new Set(typedList.flatMap((t) => (t.name ? [t.name] : []))); // labelled by the typed layer instead
    const pois: GeoJSON.Feature[] = w.pois
      .filter((p) => !typedNameSet.has(p.name))
      .map((p) => ({
        type: "Feature",
        properties: { name: p.name },
        geometry: { type: "Point", coordinates: f.toLngLat(p.x, p.y) },
      }));
    const typed: GeoJSON.Feature[] = [];
    const typedNames: GeoJSON.Feature[] = [];
    for (const t of typedList) {
      if (t.ring.length < 3) continue;
      const outer = t.ring.map(([x, y]) => f.toLngLat(x, y));
      const st = stateOf.get(t.id) ?? "";
      typed.push({ type: "Feature", properties: { c: st === "lost" ? PALETTE.pencilFaint : DOMAIN_COLORS[t.domain], s: st, dim: st === "" && done.has(t.cls) ? 1 : 0 }, geometry: { type: "Polygon", coordinates: [close(outer)] } });
      if (t.name) typedNames.push({ type: "Feature", properties: { name: t.name }, geometry: { type: "Point", coordinates: f.toLngLat(...ringCentroid(t.ring)) } });
    }
    const hints: GeoJSON.Feature[] = hintSpots.value.map((h) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: f.toLngLat(h.x, h.y) } }));
    const set = (id: string, features: GeoJSON.Feature[]) =>
      (map.getSource(id) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
    set(SRC_WALLS, walls);
    set(SRC_FLOORS, floors);
    set(SRC_STREETS, streets);
    set(SRC_POIS, pois);
    set(SRC_TYPED, typed);
    set(SRC_TYPED_NAMES, typedNames);
    set(SRC_HINTS, hints);
  };

  // A click on a typed old building opens its panel; a real building on the same ground wins, empty ground deselects.
  const onClick = (e: maplibregl.MapMouseEvent) => {
    const f = frame.value;
    if (!ready || tool.value || !f) return;
    const [x, y] = f.toLocal(e.lngLat.lng, e.lngLat.lat);
    const onBuilding = Object.values(sc?.buildings.value ?? {}).some((b) => pointInPolygon(x, y, b.footprint));
    selectedSite.value = onBuilding ? null : (typedAt(x, y, typedFoundations.value)?.id ?? null);
  };
  map.on("click", onClick);

  const run = () => {
    if (disposed) return;
    disposeEffect = effect(apply);
    disposeShown = effect(() => {
      void ruinsShown.value;
      void ruinsAutoShown.value;
      applyShown();
    });
  };
  void import("../simClient").then((m) => {
    sc = m;
    if (disposed) return;
    if (map.isStyleLoaded()) run();
    else map.once("load", run);
  });

  return () => {
    disposed = true;
    map.off("click", onClick);
    disposeEffect?.();
    disposeShown?.();
  };
}
