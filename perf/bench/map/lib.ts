// Shared harness for the interactive-tool benchmarks (src/map/): road chains and their 3D models, the per-pointermove
// work of roadTool/landTool/strokeTool/placeTool, the land and forest meshes, and the overlay geometry the tool previews
// push into the engine every move.
//
// Nothing here touches src/ or the network. Towns are built through the REAL Handler (as src/pace/pace.run.ts does) on a
// flat synthetic site, so the fixtures are the states the game produces.
import { Handler, type Storage } from "../../../src/sim/handler";
import type { Cmd, FromWorker } from "../../../src/sim/protocol";
import { applyDelta } from "../../../src/sim/delta";
import { emptyWeather } from "../../../src/sim/weather";
import { ROAD_KINDS, segmentCost, type TerrainProfile } from "../../../src/sim/roads";

export { ROAD_KINDS };
import type { ClientState, RoadGraph, RoadKind } from "../../../src/sim/types";

export const T0 = 1_800_000_000_000;
const STEP_MS = 2500; // fake wall ms per h.tick(): about one tick of the worker at 1x
const mem: Storage = { get: async () => null, put: async () => {}, clear: async () => {} };

export type XY = [number, number];

export const flat = (len: number): TerrainProfile => {
  const n = Math.max(1, Math.round(len / 10));
  return { length: len, land: Array<"meadow">(n).fill("meadow"), elev: Array<number>(n + 1).fill(0) };
};

// ---------- timings ----------

export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const pct = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

export const ms = (v: number): string => (v >= 100 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toFixed(4));

// Times `fn` `reps` times and returns every sample in ms (after `warm` untimed runs).
export function timeIt(fn: () => unknown, reps = 7, warm = 3): number[] {
  for (let i = 0; i < warm; i++) fn();
  const out: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    fn();
    out.push(performance.now() - t);
  }
  return out;
}

// median / p90 of a timed block, in ms, ready for a table row.
export function sample(fn: () => unknown, reps = 7, warm = 3): { med: number; p90: number; n: number } {
  const xs = timeIt(fn, reps, warm);
  return { med: median(xs), p90: pct(xs, 0.9), n: reps };
}

export const table = (head: string[], rows: (string | number)[][]): string =>
  [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");

// ---------- road graph fixtures ----------

// A snake of `segments` straight edges of `len` metres each, every one built (done = labor): the graph a grown town has.
// Roads alternate kind so chains break where a real town's do, and every 10th edge starts a branch so junctions exist.
export function snakeGraph(segments: number, len = 40, kinds: RoadKind[] = ["dirt", "path", "dirt", "stone"]): RoadGraph {
  const nodes: Record<number, { id: number; x: number; y: number }> = {};
  const edges: Record<number, RoadGraph["edges"][number]> = {};
  let next = 1;
  let x = 0;
  let y = 0;
  let dir = 0; // 0 east, 1 north, 2 west, 3 south: a snake that folds every 12 edges
  const dirs: XY[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  let prev = next;
  nodes[prev] = { id: prev, x, y };
  next++;
  for (let i = 0; i < segments; i++) {
    if (i > 0 && i % 12 === 0) dir = (dir + 1) % 4;
    const [dx, dy] = dirs[dir];
    const nx = x + dx * len;
    const ny = y + dy * len;
    const id = next++;
    nodes[id] = { id, x: nx, y: ny };
    const kind = kinds[i % kinds.length];
    const labor = ROAD_KINDS[kind].labor * len;
    edges[id] = { id, a: prev, b: id, kind, length: len, labor, done: labor };
    prev = id;
    x = nx;
    y = ny;
  }
  return { nodes, edges, nextId: next };
}

// A branch of `arms` edges fanning out of node 0: one junction with several arms.
export function starGraph(arms: number, len = 30, kind: RoadKind = "dirt"): RoadGraph {
  const nodes: Record<number, { id: number; x: number; y: number }> = { 1: { id: 1, x: 0, y: 0 } };
  const edges: Record<number, RoadGraph["edges"][number]> = {};
  let next = 2;
  for (let k = 0; k < arms; k++) {
    const a = (k / arms) * Math.PI * 2;
    const id = next++;
    nodes[id] = { id, x: Math.cos(a) * len, y: Math.sin(a) * len };
    const labor = ROAD_KINDS[kind].labor * len;
    edges[id] = { id, a: 1, b: id, kind, length: len, labor, done: labor };
  }
  return { nodes, edges, nextId: next };
}

// The centre line of a chain of `segments` edges of `len` metres, as a polyline in town metres.
export function polyline(segments: number, len = 40): XY[] {
  const out: XY[] = [];
  let x = 0;
  let y = 0;
  let dir = 0;
  const dirs: XY[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  out.push([x, y]);
  for (let i = 0; i < segments; i++) {
    if (i > 0 && i % 12 === 0) dir = (dir + 1) % 4;
    const [dx, dy] = dirs[dir];
    x += dx * len;
    y += dy * len;
    out.push([x, y]);
  }
  return out;
}

// A curved road: `n` points on a circle of radius `r` — what arcPath gives while the pointer bends an arc.
export function arc(n: number, r = 200): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI * 0.9;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

// A convex ring of `sides` vertices on a circle of radius `r`: a field, a footprint, a building's outline.
export function ring(sides: number, r = 40, cx = 0, cy = 0): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// `n` footprints scattered on a grid 200 m apart (a town of `n` buildings' lots).
export function footprints(n: number, size = 8): XY[][] {
  const out: XY[][] = [];
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const cx = (i % cols) * 30;
    const cy = Math.floor(i / cols) * 30;
    out.push([
      [cx, cy],
      [cx + size, cy],
      [cx + size, cy + size],
      [cx, cy + size],
    ]);
  }
  return out;
}

// ---------- a town through the real Handler ----------

export interface Town {
  st: ClientState;
  h: Handler;
  now: number;
  count: () => { buildings: number; edges: number; cells: number; fields: number; foundations: number };
  /** Lenient the road by `m` metres east and ticks until the sim has cut lots along it; returns the fresh edge ids. */
  extend: (m: number, ticks?: number) => Promise<number[]>;
  /** Play `n` worker ticks. */
  tick: (n?: number) => void;
}

// A meadow town: one road, rows of houses and workshops along it, the construction finished at once, one field and one
// clearing. `buildings` is a target, reached by lengthening the road while rows still fit.
export async function makeTown(opts: { buildings?: number; days?: number } = {}): Promise<Town> {
  const target = opts.buildings ?? 200;
  let st!: ClientState;
  const results = new Map<number, { ok: boolean; reason?: string }>();
  const post = (m: FromWorker) => {
    if (m.t === "loaded" && m.save) st = m.save.sim;
    else if (m.t === "snapshot") st = { ...applyDelta(st, m.sim), zones: m.zones ?? st.zones, chronicle: m.chronicle ?? st.chronicle, finds: m.finds ?? st.finds, articles: m.articles ?? st.articles };
    else if (m.t === "cmdResult") results.set(m.id, m);
    else if (m.t === "error") throw new Error(m.message);
  };
  let now = T0;
  const h = new Handler(mem, post, async () => ({ land: "meadow", slope: 0 }), async () => 200);
  await h.handle({ t: "found", city: { name: "Bench", lat: 59.12, lng: 37.9, foundedAt: T0 }, now });
  h["save"]!.sim.weather = emptyWeather();
  let seq = 0;
  const send: (cmd: Cmd) => Promise<{ ok: boolean; reason?: string; ids?: number[] }> = async (cmd) => {
    const id = ++seq;
    await h.handle({ t: "cmd", id, cmd });
    await h.idle();
    return results.get(id) ?? { ok: false, reason: "no result" };
  };

  const counts = () => ({
    buildings: Object.keys(st.buildings).length,
    edges: Object.keys(st.roads.edges).length,
    cells: st.zones.cells.length,
    fields: st.zones.fields.length,
    foundations: st.finds.foundations.length,
  });

  await send({ type: "admin", op: { k: "unlock" } } as unknown as Cmd);
  await send({ type: "admin", op: { k: "free", on: true } } as unknown as Cmd);
  await send({ type: "admin", op: { k: "stock" } } as unknown as Cmd);

  let roadEnd = 0;
  const extendRoad = async (to: number) => {
    const pts: XY[] = [];
    for (let x = roadEnd; x < to; x += 50) pts.push([x, 0]);
    pts.push([to, 0]);
    const labor = pts.slice(1).map((p, i) => segmentCost(flat(p[0] - pts[i][0]), "path").labor);
    roadEnd = to;
    return send({ type: "addRoad", kind: "path", pts, snapTol: 6, labor });
  };
  const spansOf = (edges: number[]) => {
    const out: { edge: number; side: 1 | -1; from: number; to: number }[] = [];
    for (const id of edges) {
      const e = st.roads.edges[id];
      if (!e) continue;
      const a = st.roads.nodes[e.a];
      const b = st.roads.nodes[e.b];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (const side of [1, -1] as const) out.push({ edge: id, side, from: 0, to: len });
    }
    return out;
  };
  let guard = 0;
  let cls = 0;
  while (Object.keys(st.buildings).length < target && guard++ < 200) {
    const from = roadEnd;
    const r = await extendRoad(roadEnd + 50);
    if (!r.ok) break;
    const fresh = Object.values(st.roads.edges)
      .filter((e) => Math.min(st.roads.nodes[e.a].x, st.roads.nodes[e.b].x) >= from - 1)
      .map((e) => e.id);
    const spans = spansOf(fresh);
    if (spans.length === 0) continue;
    const t = cls++ % 5 === 4 ? "weaver" : "izba";
    await send({ type: "placeStroke", template: t, spans, drop: [] } as unknown as Cmd);
  }
  await send({ type: "admin", op: { k: "finish" } } as unknown as Cmd);
  await send({ type: "addField", pts: [[60, 40], [160, 40], [160, 240], [60, 240]] } as unknown as Cmd);
  await send({ type: "addClearing", pts: [[80, -150], [130, -150], [130, -50], [80, -50]], forest: 0.8 } as unknown as Cmd);

  const ticks = opts.days ?? 4;
  for (let d = 0; d < ticks; d++) {
    for (let k = 0; k < 36; k++) {
      now += STEP_MS;
      h.tick(now);
    }
  }

  const tick = (n = 1) => {
    for (let k = 0; k < n; k++) {
      now += STEP_MS;
      h.tick(now);
    }
  };
  // A stretch of new road east of the town with no buildings on it: the free lots a drag fills.
  const extend = async (m: number, ticks = 3): Promise<number[]> => {
    const from = roadEnd;
    await extendRoad(roadEnd + m);
    tick(ticks); // the sim cuts the lots along a new road on its ticks
    return Object.values(st.roads.edges)
      .filter((e) => Math.min(st.roads.nodes[e.a].x, st.roads.nodes[e.b].x) >= from - 1)
      .map((e) => e.id);
  };

  return {
    get st() {
      return st;
    },
    h,
    get now() {
      return now;
    },
    count: counts,
    extend,
    tick,
  } as Town & { now: number };
}
