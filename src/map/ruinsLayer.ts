import type maplibregl from "maplibre-gl";
import { effect, signal, type ReadonlySignal } from "@preact/signals";
import { isBridge, oldStreetKind, ROAD_KINDS } from "../sim/roads";
import { PALETTE } from "../ui/palette";
import type { Frame } from "../world/frame";
import type { OldWorld, XY } from "../world/oldworld";

const SRC_WALLS = "ruins-walls";
const SRC_FLOORS = "ruins-floors";
const SRC_STREETS = "ruins-streets";
const SRC_POIS = "ruins-pois";
const RUIN_LAYERS = ["ruins-floor", "ruins-streets", "ruins-outline", "ruins-walls", "ruins-street-names", "ruins-poi-names"];
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
export function insetRing(ring: XY[], d: number): XY[] | null {
  let p: XY[] = ring.filter((q, i) => i === 0 || q[0] !== ring[i - 1][0] || q[1] !== ring[i - 1][1]);
  if (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p = p.slice(0, -1);
  if (p.length < 3) return null;
  const a0 = area2(p);
  if (Math.abs(a0) < 1e-9) return null;
  if (a0 < 0) p = p.slice().reverse(); // counter-clockwise: the inside is on the left of every edge
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
  return out;
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

  const applyShown = () => {
    for (const id of RUIN_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", ruinsShown.peek() ? "visible" : "none");
  };

  const setup = (lat: number) => {
    const k = 512 / (EQUATOR_M * Math.cos((lat * Math.PI) / 180));
    for (const id of [SRC_WALLS, SRC_FLOORS, SRC_STREETS, SRC_POIS]) map.addSource(id, { type: "geojson", data: empty() });
    const beneath = map.getLayer("roads-casing") ? "roads-casing" : undefined;
    map.addLayer(
      { id: "ruins-floor", type: "fill", source: SRC_FLOORS, minzoom: 13, paint: { "fill-color": PALETTE.pencilFaint, "fill-opacity": 0.28 } },
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
        id: "ruins-walls",
        type: "fill-extrusion",
        source: SRC_WALLS,
        minzoom: 14,
        filter: ["==", ["get", "thin"], 0],
        paint: {
          "fill-extrusion-color": PALETTE.pencilFaint,
          "fill-extrusion-height": WALL_HEIGHT,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.9,
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
      const inner = insetRing(fd.ring, WALL_THICKNESS);
      const coords = inner ? [close(outer), close(inner.map(([x, y]) => f.toLngLat(x, y)))] : [close(outer)];
      walls.push({ type: "Feature", properties: { thin: inner ? 0 : 1 }, geometry: { type: "Polygon", coordinates: coords } });
    }
    const streets: GeoJSON.Feature[] = w.streets
      .filter((s) => s.pts.length >= 2)
      .map((s) => ({
        type: "Feature",
        properties: { w: streetWidth(s.cls), bridge: isBridge(oldStreetKind(s.cls, s.bridge === true)), ...(s.name ? { name: s.name } : {}) },
        geometry: { type: "LineString", coordinates: s.pts.map(([x, y]) => f.toLngLat(x, y)) },
      }));
    const pois: GeoJSON.Feature[] = w.pois.map((p) => ({
      type: "Feature",
      properties: { name: p.name },
      geometry: { type: "Point", coordinates: f.toLngLat(p.x, p.y) },
    }));
    const set = (id: string, features: GeoJSON.Feature[]) =>
      (map.getSource(id) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
    set(SRC_WALLS, walls);
    set(SRC_FLOORS, floors);
    set(SRC_STREETS, streets);
    set(SRC_POIS, pois);
  };

  const run = () => {
    if (disposed) return;
    disposeEffect = effect(apply);
    disposeShown = effect(() => {
      void ruinsShown.value;
      applyShown();
    });
  };
  if (map.isStyleLoaded()) run();
  else map.once("load", run);

  return () => {
    disposed = true;
    disposeEffect?.();
    disposeShown?.();
  };
}
