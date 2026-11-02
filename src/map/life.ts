import { daylight } from "../sim/clock";

// Life on the map: the trips of walkers and carts the sim plans, where one is at a minute of the day, and how bright
// the evening lights of houses, workshops and taverns are by the hour (view/engine/life.ts draws them).

export interface Trip {
  id: number;
  kind: "walk" | "cart";
  pts: [number, number][]; // local m
  depart: number; // game minute of the day
  speed: number; // m per game minute
  who?: number; // the resident a walker is (sim/life.ts); walkers only
  purpose?: "work" | "home" | "tavern"; // where a walker is heading; walkers only
}
export interface Light {
  id: number; // the building
  x: number;
  y: number;
  kind: "house" | "work" | "tavern";
}
const DAY_MIN = 1440;
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
