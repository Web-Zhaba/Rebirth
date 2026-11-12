import type { Building, RoadEdge, SimSnapshot } from "./types";

// The town on its way from the worker to the main thread. "loaded" carries all of it; every snapshot message after it
// carries the clock and what changed since the state the main thread already has. The main thread keeps the rest as it
// is, so a part that did not change stays the same object there, and what is drawn from it is not drawn again.

// A record as its changes: the entries that are new or changed, and the ids that are gone.
export interface Patch<T> {
  set: Record<number, T>;
  del: number[];
}

// The clock, the parts of the snapshot that changed, and the buildings and road edges as patches: a building site or a
// road under work moves a few entries every tick, the rest of them stay.
export type SimDelta = Partial<SimSnapshot> & Pick<SimSnapshot, "gameMinutes" | "realTime"> & { patch?: { buildings?: Patch<Building>; edges?: Patch<RoadEdge> } };

// The parts of a snapshot made anew for every one (the rest are parts of the state, the same object until they change):
// these are compared by content.
const DERIVED: ReadonlySet<string> = new Set<keyof SimSnapshot>(["digs", "people", "economy", "services", "houseMood", "houseGoods", "houseResidents", "research", "fieldProgress", "heritageMul", "callBlock", "inflow", "museumStaff"]);

// What the main thread already has of the town: the snapshot it was last brought up to, with the text of its derived parts.
export interface Posted {
  snap: SimSnapshot;
  text: Record<string, string | undefined>;
}

function diff<T>(was: Record<number, T>, now: Record<number, T>): Patch<T> {
  const set: Record<number, T> = {};
  const del: number[] = [];
  for (const id in now) if (now[id] !== was[id]) set[id] = now[id];
  for (const id in was) if (!(id in now)) del.push(Number(id));
  return { set, del };
}

function patched<T>(was: Record<number, T>, p: Patch<T>): Record<number, T> {
  const out = { ...was, ...p.set };
  for (const id of p.del) delete out[id];
  return out;
}

// Is everything of the two objects but `key` the same?
const sameBut = (a: object, b: object, key: string): boolean => {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const k in x) if (k !== key && x[k] !== y[k]) return false;
  for (const k in y) if (k !== key && !(k in x)) return false;
  return true;
};

// What of `snap` differs from what was posted; `posted` is brought up to `snap`.
export function snapshotDelta(posted: Posted, snap: SimSnapshot): SimDelta {
  const delta: SimDelta = { gameMinutes: snap.gameMinutes, realTime: snap.realTime };
  const out = delta as Record<string, unknown>;
  const was = posted.snap as unknown as Record<string, unknown>;
  const now = snap as unknown as Record<string, unknown>;
  for (const k in now) {
    if (now[k] === was[k]) continue;
    if (k === "buildings" && posted.snap.buildings) {
      (delta.patch ??= {}).buildings = diff(posted.snap.buildings, snap.buildings);
      continue;
    }
    // work on the roads moves their edges alone; a road drawn or removed moves the nodes too, and goes whole
    if (k === "roads" && posted.snap.roads && sameBut(posted.snap.roads, snap.roads, "edges")) {
      (delta.patch ??= {}).edges = diff(posted.snap.roads.edges, snap.roads.edges);
      continue;
    }
    if (DERIVED.has(k)) {
      const text = JSON.stringify(now[k]);
      if (text === (posted.text[k] ??= JSON.stringify(was[k]))) {
        now[k] = was[k]; // the same content: the object the main thread has a copy of stays
        continue;
      }
      posted.text[k] = text;
    }
    out[k] = now[k];
  }
  for (const k in was) if (!(k in now)) out[k] = undefined; // a part that is gone
  posted.snap = snap;
  return delta;
}

// The town the main thread has, brought up to a snapshot message. Whatever the message leaves out is kept as it is:
// the same parts, and inside a patched record the same entries.
export function applyDelta<S extends SimSnapshot>(prev: S, delta: SimDelta): S {
  const { patch, ...parts } = delta;
  const next: S = { ...prev, ...parts };
  if (patch?.buildings) next.buildings = patched(prev.buildings, patch.buildings);
  if (patch?.edges) next.roads = { ...prev.roads, edges: patched(prev.roads.edges, patch.edges) };
  return next;
}
