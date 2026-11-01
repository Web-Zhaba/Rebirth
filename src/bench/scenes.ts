// Benchmark scenes shared by the MapLibre map and the new engine (docs/PLAN-engine.md, N0). A scene is a camera
// path in engine-neutral terms: a target on the ground, the eye's distance to it, heading and pitch. MapLibre
// gets it through `toMapLibre`, the engine uses it directly, so both render the same view.

export interface BenchCamera {
  lat: number;
  lng: number;
  distance: number; // m, eye to target
  heading: number; // deg, clockwise from north (MapLibre bearing)
  pitch: number; // deg, 0 = looking straight down
}

export interface BenchScene {
  id: string;
  label: string;
  seconds: number; // measured part of the path; a warm-up runs before it
  at(t: number): BenchCamera; // t in 0..1
}

// MapLibre's vertical field of view and the earth radius its metre conversions use.
export const FOV_DEG = 36.87;
export const EARTH_RADIUS = 6371008.8;
export const TILE_PX = 512;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const SCENES: readonly BenchScene[] = [
  {
    id: "globe",
    label: "far globe, slow spin",
    seconds: 10,
    at: (t) => ({ lat: 45, lng: lerp(-20, 60, t), distance: 12_000_000, heading: 0, pitch: 0 }),
  },
  {
    id: "mountains",
    label: "Innsbruck valley, orbit at 75°",
    seconds: 10,
    at: (t) => ({ lat: 47.2692, lng: 11.4041, distance: 9_000, heading: 360 * t, pitch: 75 }),
  },
  {
    id: "forest",
    label: "taiga fly-over at 75°",
    seconds: 10,
    at: (t) => ({ lat: 59.2, lng: lerp(37.5, 37.58, t), distance: 1_500, heading: 90, pitch: 75 }),
  },
];

// A town scene needs a founded town: built from its centre at run time.
export function townScene(lat: number, lng: number): BenchScene {
  return { id: "town", label: "own town, orbit at 75°", seconds: 10, at: (t) => ({ lat, lng, distance: 1_200, heading: 360 * t, pitch: 75 }) };
}

// Metres per CSS pixel at the target for a MapLibre zoom.
export function metersPerPixel(zoom: number, lat: number): number {
  return (2 * Math.PI * EARTH_RADIUS * Math.cos((lat * Math.PI) / 180)) / (TILE_PX * 2 ** zoom);
}

// Eye-to-target distance (m) MapLibre keeps for a zoom in a viewport `heightPx` CSS pixels tall.
export function zoomToDistance(zoom: number, lat: number, heightPx: number): number {
  return ((0.5 * heightPx) / Math.tan(((FOV_DEG / 2) * Math.PI) / 180)) * metersPerPixel(zoom, lat);
}

export function distanceToZoom(distance: number, lat: number, heightPx: number): number {
  const unit = zoomToDistance(0, lat, heightPx);
  return Math.log2(unit / distance);
}

export function toMapLibre(c: BenchCamera, heightPx: number): { center: [number, number]; zoom: number; bearing: number; pitch: number } {
  return { center: [c.lng, c.lat], zoom: distanceToZoom(c.distance, c.lat, heightPx), bearing: c.heading, pitch: c.pitch };
}
