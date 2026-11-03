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
  sex?: "m" | "f"; // and their sex and age in years the day the trip was planned, for the figure; walkers only
  age?: number;
  purpose?: "work" | "home" | "tavern"; // where a walker is heading; walkers only
}
// A resident where they stay when not on a walk (sim/life.ts): at home, and at work during work hours. Their walks of
// the day take them between those. A spot is where they show; null is indoors (a house, a workshop), out of sight.
export interface Rest {
  who: number;
  sex: "m" | "f";
  age: number; // years, the day it was planned
  home: [number, number] | null; // local m: a spot in the camp; null in their house
  work?: { at: [number, number] | null; from: number; to: number }; // a spot on an open-air plot; hours in game minutes of the day
}
export interface Light {
  id: number; // the building
  x: number;
  y: number;
  kind: "house" | "work" | "tavern";
}
const DAY_MIN = 1440;
const WORK_LIGHTS_END = 21;

// Deterministic 32-bit mix of an id (and a salt), as a number in [0, 1).
export function unit(id: number, salt: number): number {
  let h = Math.imul(id ^ Math.imul(salt, 0x9e3779b1), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
const TAVERN_LIGHTS = [18, 24];

// Where a trip is at a minute of the day and which way it is heading there (a unit vector, local m).
export function placeAt(trip: Trip, minuteOfDay: number): { at: [number, number]; dir: [number, number] } | null {
  const { pts, speed } = trip;
  if (pts.length < 2 || !(speed > 0)) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (total <= 0) return null;
  const t = (((minuteOfDay - trip.depart) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const dist = t * speed;
  if (dist > total) return null;
  let left = dist;
  let dir: [number, number] = [0, 1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg > 0) dir = [(x1 - x0) / seg, (y1 - y0) / seg];
    if (left <= seg) {
      const u = seg > 0 ? left / seg : 0;
      return { at: [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u], dir };
    }
    left -= seg;
  }
  return { at: pts[pts.length - 1], dir };
}

// Where a resident who is not on a walk stands at a minute of the day, which way they face (a unit vector) and whether
// they are at work; null when they are indoors. With walks today (`walks`, theirs) they are where the one that ended
// last took them (a tavern is indoors); without, the work hours decide.
export function standAt(rest: Rest, walks: readonly Trip[], minuteOfDay: number): { at: [number, number]; dir: [number, number]; working: boolean } | null {
  let where: Trip["purpose"] | undefined;
  let since = Infinity;
  for (const w of walks) {
    if (w.pts.length < 2 || !(w.speed > 0)) continue;
    let len = 0;
    for (let i = 1; i < w.pts.length; i++) len += Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]);
    const ago = (((minuteOfDay - w.depart - len / w.speed) % DAY_MIN) + DAY_MIN) % DAY_MIN;
    if (ago < since) (since = ago), (where = w.purpose);
  }
  if (since === Infinity && rest.work) {
    const { from, to } = rest.work;
    const m = ((minuteOfDay % DAY_MIN) + DAY_MIN) % DAY_MIN;
    where = (from <= to ? m >= from && m < to : m >= from || m < to) ? "work" : "home";
  }
  const at = where === "work" ? (rest.work?.at ?? null) : where === "tavern" ? null : rest.home;
  if (!at) return null;
  const face = 2 * Math.PI * unit(rest.who, 13);
  return { at, dir: [Math.cos(face), Math.sin(face)], working: where === "work" };
}

export const positionAt = (trip: Trip, minuteOfDay: number): [number, number] | null => placeAt(trip, minuteOfDay)?.at ?? null;

export function lightOpacity(kind: Light["kind"], hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const dark = Math.min(1, Math.max(0, (0.4 - daylight(h)) / 0.4));
  if (kind === "work" && !(h >= 12 && h < WORK_LIGHTS_END)) return 0;
  if (kind === "tavern") return h >= TAVERN_LIGHTS[0] && h < TAVERN_LIGHTS[1] ? Math.max(dark, 0.5 * Math.min(1, (h - 17) / 1.5)) : 0;
  return dark * 0.85;
}
