import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import { daylight, START_MINUTE_OF_DAY } from "../sim/clock";
import { MAP_ONLY, PALETTE } from "../ui/palette";
import type { Frame } from "../world/frame";

export interface Trip {
  id: number;
  kind: "walk" | "cart";
  pts: [number, number][]; // local m
  depart: number; // game minute of the day
  speed: number; // m per game minute
}
export interface Light {
  id: number; // the building
  x: number;
  y: number;
  kind: "house" | "work" | "tavern";
}
export interface LifeOptions {
  trips: ReadonlySignal<Trip[]>;
  gameMinutes: ReadonlySignal<number>;
  lights: ReadonlySignal<Light[]>;
  frame: ReadonlySignal<Frame | null>;
  gameMinPerSec: () => number;
}

const SRC_TRIPS = "life-trips";
const SRC_LIGHTS = "life-lights";
const EQUATOR_M = 40075016.686;
const FRAME_MS = 50; // ~20 fps
const MAX_EXTRAP = 15;
const DAY_MIN = 1440;
const HALO = 0.3;
const WORK_LIGHTS_END = 21;
const TAVERN_LIGHTS = [18, 24];

export function positionAt(trip: Trip, minuteOfDay: number): [number, number] | null {
  const { pts, speed } = trip;
  if (pts.length < 2 || !(speed > 0)) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (total <= 0) return null;
  const t = (((minuteOfDay - trip.depart) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const dist = t * speed;
  if (dist > total) return null;
  let left = dist;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (left <= seg) {
      const u = seg > 0 ? left / seg : 0;
      return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
    }
    left -= seg;
  }
  return pts[pts.length - 1];
}

export function lightOpacity(kind: Light["kind"], hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const dark = Math.min(1, Math.max(0, (0.4 - daylight(h)) / 0.4));
  if (kind === "work" && !(h >= 12 && h < WORK_LIGHTS_END)) return 0;
  if (kind === "tavern") return h >= TAVERN_LIGHTS[0] && h < TAVERN_LIGHTS[1] ? Math.max(dark, 0.5 * Math.min(1, (h - 17) / 1.5)) : 0;
  return dark * 0.85;
}

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

function metersToPx(k: number, meters: number): maplibregl.ExpressionSpecification {
  const stops: unknown[] = [];
  for (let z = 8; z <= 22; z++) stops.push(z, Math.max(1, meters * k * 2 ** z));
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops] as maplibregl.ExpressionSpecification;
}

export function attachLifeLayer(map: maplibregl.Map, opts: LifeOptions): () => void {
  const { trips, gameMinutes, lights, frame, gameMinPerSec } = opts;
  let ready = false;
  let disposed = false;
  let raf = 0;
  let last = 0;
  let lastDrawnCount = -1;
  let base = { gm: gameMinutes.peek(), at: performance.now() };
  const stops: (() => void)[] = [];
  const shown = { house: -1, work: -1, tavern: -1 };

  const nowGame = (): number => base.gm + Math.min(MAX_EXTRAP, (gameMinPerSec() * (performance.now() - base.at)) / 1000);

  const setup = (lat: number) => {
    const k = 512 / (EQUATOR_M * Math.cos((lat * Math.PI) / 180));
    map.addSource(SRC_LIGHTS, { type: "geojson", data: empty() });
    map.addSource(SRC_TRIPS, { type: "geojson", data: empty() });
    const glow = (id: string, kind: string, r: number) =>
      map.addLayer({
        id,
        type: "circle",
        source: SRC_LIGHTS,
        minzoom: 14,
        filter: ["==", ["get", "kind"], kind],
        paint: {
          "circle-color": MAP_ONLY.lamp,
          "circle-radius": metersToPx(k, r),
          "circle-blur": 0.9,
          "circle-opacity": 0,
          "circle-pitch-alignment": "map",
        },
      });
    glow("life-lights-house", "house", 5);
    glow("life-lights-work", "work", 8);
    glow("life-lights-tavern", "tavern", 12);
    const dot = (id: string, kind: string, px: [number, number], color: string) =>
      map.addLayer({
        id,
        type: "circle",
        source: SRC_TRIPS,
        minzoom: 13,
        filter: ["==", ["get", "kind"], kind],
        paint: {
          "circle-color": color,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, px[0], 19, px[1]],
          "circle-stroke-color": PALETTE.paperRaised,
          "circle-stroke-width": 0.8,
        },
      });
    dot("life-walkers", "walk", [1.5, 3.5], PALETTE.ink);
    dot("life-carts", "cart", [2.5, 6], MAP_ONLY.cart);
    ready = true;
  };

  const drawTrips = (f: Frame, minuteOfDay: number) => {
    const allTrips = trips.peek();
    const features: GeoJSON.Feature[] = [];
    for (const t of allTrips) {
      const p = positionAt(t, minuteOfDay);
      if (!p) continue;
      features.push({
        type: "Feature",
        properties: { kind: t.kind },
        geometry: { type: "Point", coordinates: f.toLngLat(p[0], p[1]) },
      });
    }

    // Не вызываем setData вхолостую, если никого не было и нет
    if (features.length === 0 && lastDrawnCount === 0) return;
    lastDrawnCount = features.length;

    (map.getSource(SRC_TRIPS) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
  };

const drawDarkness = (minuteOfDay: number) => {
    for (const kind of ["house", "work", "tavern"] as const) {
      const o = lightOpacity(kind, minuteOfDay / 60);
      // Не инвалидируем стили карты ради сотых долей прозрачности
      if (Math.abs(o - shown[kind]) < 0.05) continue;
      shown[kind] = o;
      if (map.getLayer(`life-lights-${kind}`)) {
        map.setPaintProperty(`life-lights-${kind}`, "circle-opacity", [
          "interpolate",
          ["linear"],
          ["zoom"],
          15.5,
          o,
          17.5,
          o * HALO,
        ]);
      }
    }
  };

  const tick = (ts: number) => {
    raf = 0;
    if (disposed || document.hidden) return;
    raf = requestAnimationFrame(tick);
    if (ts - last < FRAME_MS) return;
    last = ts;
    const f = frame.peek();
    if (!ready || !f) return;
    const minuteOfDay = (nowGame() + START_MINUTE_OF_DAY) % DAY_MIN;
    drawTrips(f, minuteOfDay);
    drawDarkness(minuteOfDay);
  };

  const kick = () => {
    if (!raf && !disposed && !document.hidden) raf = requestAnimationFrame(tick);
  };
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else {
      kick();
    }
  };

  const run = () => {
    if (disposed) return;
    stops.push(
      effect(() => {
        const gm = gameMinutes.value;
        base = { gm, at: performance.now() };
      }),
      effect(() => {
        const f = frame.value;
        const list = lights.value;
        if (!f) return;
        if (!ready) setup(f.toLngLat(0, 0)[1]);
        const features: GeoJSON.Feature[] = list.map((l) => ({
          type: "Feature",
          properties: { kind: l.kind },
          geometry: { type: "Point", coordinates: f.toLngLat(l.x, l.y) },
        }));
        (map.getSource(SRC_LIGHTS) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
        kick();
      }),
    );
    document.addEventListener("visibilitychange", onVisibility);
    kick();
  };
  if (map.isStyleLoaded()) run();
  else map.once("load", run);

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    for (const s of stops) s();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}