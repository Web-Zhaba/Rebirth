import { positionAt, whereAt, type Rest, type Trip, type Whereabouts } from "../map/life";
import { buildingCentre } from "../sim/people";
import type { Building, ResidentQuery } from "../sim/types";
import { L } from "../i18n";

export { buildingCentre };

// The walk a resident is on right now (commute or evening gathering), with the point to follow.
export function residentWalk(trips: readonly Trip[], id: number, minuteOfDay: number): { trip: Trip; pos: [number, number] } | null {
  for (const t of trips) {
    if (t.kind !== "walk" || t.who !== id) continue;
    const pos = positionAt(t, minuteOfDay);
    if (pos) return { trip: t, pos };
  }
  return null;
}

export interface ResidentPlace {
  walk: { trip: Trip; pos: [number, number] } | null; // on a walk
  place: Whereabouts | null; // off the walks; null without the day's life for them yet
}

// Where a resident is at a minute of the day, read from the same trips and rests their figure is drawn from.
export function residentPlace(trips: readonly Trip[], rests: readonly Rest[], id: number, minuteOfDay: number): ResidentPlace {
  const walk = residentWalk(trips, id, minuteOfDay);
  if (walk) return { walk, place: null };
  const rest = rests.find((r) => r.who === id);
  if (!rest) return { walk: null, place: null };
  return { walk: null, place: whereAt(rest, trips.filter((t) => t.kind === "walk" && t.who === id), minuteOfDay) };
}

export interface FollowStatus {
  key: "gone" | "work" | "home" | "camp" | "site" | "walk" | "tavern";
  text: string;
  note?: string;
}

// What the follow card says: where the resident is (or where they are heading).
export function followStatus(info: ResidentQuery | null, p: ResidentPlace): FollowStatus {
  if (!info) return { key: "gone", text: L("Больше не в поселении", "No longer in the settlement") };
  const note = info.role;
  if (p.walk) {
    const purpose = p.walk.trip.purpose;
    const key = purpose === "work" ? "walk" : purpose === "tavern" ? "tavern" : "home";
    const text = purpose === "work" ? L("Идёт на работу", "Going to work") : purpose === "tavern" ? L("Идёт на вечерний сбор", "Going to the evening gathering") : L("Идёт домой", "Going home");
    return { key, text, note };
  }
  const where = p.place?.where;
  if (where === "site") return { key: "site", text: L("На стройке", "At a building site"), note };
  if (where === "work") return { key: "work", text: L("На работе", "At work"), note };
  if (where === "tavern") return { key: "tavern", text: L("На вечернем сборе", "At the evening gathering"), note };
  if (info.home !== null) return { key: "home", text: L("Дома", "At home"), note };
  return { key: "camp", text: L("В лагере", "In the camp"), note };
}

// Where to point the camera when the resident is not walking: where they show, else the end of the walk that took them
// indoors, else the building they are in (the workplace at work, the house otherwise; a tent family's camp is at the
// founding point).
export function residentPoint(info: ResidentQuery, place: Whereabouts | null, buildings: Record<number, Building>): [number, number] {
  if (place?.at) return place.at;
  const pts = place?.last?.pts;
  if (pts && pts.length > 0) return pts[pts.length - 1];
  const job = place?.where === "work" && info.job !== null ? buildings[info.job] : undefined;
  const home = info.home !== null ? buildings[info.home] : undefined;
  return job ? buildingCentre(job) : home ? buildingCentre(home) : [0, 0];
}
