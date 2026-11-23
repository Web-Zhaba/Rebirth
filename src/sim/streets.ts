import { addChronicle } from "./chronicle";
import { centroid } from "./excavation";
import { FOUNDATION_LOT, foundationsTaken } from "./foundationLots";
import { makeIdentityCache } from "./memo";
import { say } from "./production";
import { distToEdge } from "./roads";
import type { FoundFoundation, FoundPlace, RoadGraph, SimState } from "./types";
import { L } from "../i18n";

// A street restored in full: its houses stand on their old foundations again and a
// road runs on its old line. It then gets its real name back: shown on the map with the town, and a chronicle line.

export const STREET = {
  reach: 25, // m from the line: a foundation this close belongs to the nearest such street
  road: 6, // m: a point of the old line this close to a built road is covered
  share: 0.8, // of the old line covered by built roads
  step: 10, // m between the points tested along the line
};

type Pt = [number, number];

// Distance from a point to a polyline set.
function distToLines(x: number, y: number, lines: readonly Pt[][]): number {
  let best = Infinity;
  for (const l of lines)
    for (let i = 1; i < l.length; i++) {
      const [ax, ay] = l[i - 1];
      const [bx, by] = l[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  return best;
}

// The bounding box of a street's line: a point further from the box than `reach` is further than that from every
// segment of it, so the street is out of reach without measuring (the one build of the map is 120 × 40 streets).
interface LineBox {
  t: FoundPlace;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function lineBoxes(streets: readonly FoundPlace[]): LineBox[] {
  const out: LineBox[] = [];
  for (const t of streets) {
    if (!t.lines || t.lines.length === 0) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const l of t.lines)
      for (const [x, y] of l) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    if (x0 <= x1) out.push({ t, x0, y0, x1, y1 });
  }
  return out;
}

// The foundations of a usable size that belong to each street, by street id: each to the nearest street within reach.
function buildStreetFoundations(streets: readonly FoundPlace[], foundations: readonly FoundFoundation[]): Map<string, FoundFoundation[]> {
  const out = new Map<string, FoundFoundation[]>();
  const lined = lineBoxes(streets);
  if (lined.length === 0) return out;
  for (const f of foundations) {
    if (f.area < FOUNDATION_LOT.minArea) continue;
    const [x, y] = centroid(f.ring);
    let best: FoundPlace | null = null;
    let bd = STREET.reach;
    for (const box of lined) {
      const dx = Math.max(box.x0 - x, 0, x - box.x1);
      const dy = Math.max(box.y0 - y, 0, y - box.y1);
      if (dx * dx + dy * dy > bd * bd) continue; // out of reach of the box, so of the line
      const d = distToLines(x, y, box.t.lines!);
      if (d <= bd) [best, bd] = [box.t, d];
    }
    if (!best) continue;
    const list = out.get(best.id);
    if (list) list.push(f);
    else out.set(best.id, [f]);
  }
  return out;
}

// Every outline's street, by the identity of the two lists it is made from: a panel asks it once per foundation it
// shows, and the answer only changes when the finds do (copy-on-write). Share the map, never change it.
const byStreets = makeIdentityCache((streets: readonly FoundPlace[]) =>
  makeIdentityCache((foundations: readonly FoundFoundation[]) => buildStreetFoundations(streets, foundations)),
);

export function streetFoundations(streets: readonly FoundPlace[], foundations: readonly FoundFoundation[]): Map<string, FoundFoundation[]> {
  return byStreets(streets)(foundations);
}

// Share of the old line that built roads cover.
function buildCovered(lines: readonly Pt[][], roads: RoadGraph): number {
  const built = Object.values(roads.edges).filter((e) => e.done >= e.labor);
  if (built.length === 0) return 0;
  let n = 0;
  let hit = 0;
  for (const l of lines)
    for (let i = 1; i < l.length; i++) {
      const [ax, ay] = l[i - 1];
      const [bx, by] = l[i];
      const k = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / STREET.step));
      for (let j = i === 1 ? 0 : 1; j <= k; j++) {
        const x = ax + ((bx - ax) * j) / k;
        const y = ay + ((by - ay) * j) / k;
        n++;
        for (const e of built) {
          const a = roads.nodes[e.a];
          const b = roads.nodes[e.b];
          if (!a || !b || Math.min(a.x, b.x) - STREET.road > x || Math.max(a.x, b.x) + STREET.road < x || Math.min(a.y, b.y) - STREET.road > y || Math.max(a.y, b.y) + STREET.road < y) continue;
          if (distToEdge(roads, e, x, y) <= STREET.road) {
            hit++;
            break;
          }
        }
      }
    }
  return n > 0 ? hit / n : 0;
}

// The same by the line and the roads it was measured against: the towns panel asks it for every street it lists.
const byLines = makeIdentityCache((roads: RoadGraph) =>
  makeIdentityCache((lines: readonly Pt[][]) => buildCovered(lines, roads)),
);

export function lineCovered(lines: readonly Pt[][], roads: RoadGraph): number {
  return byLines(roads)(lines);
}

// How far each street is from being restored in full.
export interface StreetProgress {
  houses: number; // its foundations
  built: number; // of them carrying a finished building
  road: number; // share of the old line under built roads
}

export function streetProgress(s: Pick<SimState, "finds" | "buildings" | "roads">, t: FoundPlace, own?: FoundFoundation[]): StreetProgress {
  const fs = own ?? streetFoundations(s.finds.streets, s.finds.foundations).get(t.id) ?? [];
  const on = foundationsTaken(s.buildings).built; // one walk of the buildings, kept with the record
  let built = 0;
  for (const f of fs) if (on.has(f.id)) built++;
  return { houses: fs.length, built, road: t.lines ? lineCovered(t.lines, s.roads) : 0 };
}

export const isComplete = (p: StreetProgress): boolean => p.houses > 0 && p.built === p.houses && p.road >= STREET.share;

// Streets that have just been restored in full get their name back (daily). It stays, whatever is demolished later.
export function restoreStreets(s: SimState): SimState {
  const open = s.finds.streets.filter((t) => t.lines && t.restored === undefined);
  if (open.length === 0) return s;
  const own = streetFoundations(s.finds.streets, s.finds.foundations);
  let streets = s.finds.streets;
  let cur = s;
  for (const t of open) {
    if (!isComplete(streetProgress(s, t, own.get(t.id) ?? []))) continue;
    if (streets === s.finds.streets) streets = streets.slice();
    streets[streets.indexOf(t)] = { ...t, restored: s.gameMinutes };
    const text = L(`Улице вернули имя: ${t.name} — её дома и дорога снова на прежних местах`, `A street has its name back: ${t.name} — its houses and road stand where they stood`);
    const at = t.lines![0][0];
    cur = { ...cur, events: say(cur.events, cur.gameMinutes, "heritage", text, [at[0], at[1]]), chronicle: addChronicle(cur.chronicle, cur.gameMinutes, `street:${t.id}`, text) };
  }
  return streets === s.finds.streets ? s : { ...cur, finds: { ...cur.finds, streets } };
}
