import { positionAt, type Trip } from "../map/lifeLayer";
import type { Building, ResidentQuery } from "../sim/types";

// Where a building stands: the centroid of its footprint, in local metres.
export function buildingCentre(b: Building): [number, number] {
  const n = b.footprint.length;
  if (n === 0) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of b.footprint) {
    x += p[0];
    y += p[1];
  }
  return [x / n, y / n];
}

// The walk a resident is on right now (commute or evening gathering), with the point to follow.
export function residentWalk(trips: readonly Trip[], id: number, minuteOfDay: number): { trip: Trip; pos: [number, number] } | null {
  for (const t of trips) {
    if (t.kind !== "walk" || t.who !== id) continue;
    const pos = positionAt(t, minuteOfDay);
    if (pos) return { trip: t, pos };
  }
  return null;
}

export interface FollowStatus {
  key: "gone" | "work" | "home" | "camp" | "site" | "walk" | "tavern";
  text: string;
  note?: string;
}

// What the follow card says: where the resident is (or where they are heading), from the sim's own facts.
export function followStatus(info: ResidentQuery | null, walk: { trip: Trip } | null, working: boolean): FollowStatus {
  if (!info) return { key: "gone", text: "Больше не в поселении" };
  if (walk) {
    const key = walk.trip.purpose === "work" ? "walk" : walk.trip.purpose === "tavern" ? "tavern" : "home";
    const text = walk.trip.purpose === "work" ? "Идёт на работу" : walk.trip.purpose === "tavern" ? "Идёт на вечерний сбор" : "Идёт домой";
    return { key, text, note: info.role };
  }
  if (working && info.idle) return { key: "site", text: "На стройке", note: info.role };
  if (working && info.job !== null) return { key: "work", text: "На работе", note: info.role };
  if (info.home !== null) return { key: "home", text: "Дома", note: info.role };
  return { key: "camp", text: "В лагере", note: info.role };
}

// Where to point the camera when the resident is not walking: the workplace during work hours, else home.
// A tent family has no home: the camp at the founding point.
export function residentPoint(info: ResidentQuery, working: boolean, buildings: Record<number, Building>): [number, number] {
  const job = working && info.job !== null && !info.idle ? buildings[info.job] : undefined;
  const home = info.home !== null ? buildings[info.home] : undefined;
  return job ? buildingCentre(job) : home ? buildingCentre(home) : [0, 0];
}
