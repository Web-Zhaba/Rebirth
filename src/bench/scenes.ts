// Benchmark scenes of the engine (docs/PLAN-engine.md, N0). A scene is a camera path: a target on the ground, the eye's
// distance to it, heading and pitch.

export interface BenchCamera {
  lat: number;
  lng: number;
  distance: number; // m, eye to target
  heading: number; // deg, clockwise from north
  pitch: number; // deg, 0 = looking straight down
}

export interface BenchScene {
  id: string;
  label: string;
  seconds: number; // measured part of the path; a warm-up runs before it
  at(t: number): BenchCamera; // t in 0..1
}

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
