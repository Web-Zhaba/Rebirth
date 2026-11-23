// Shared harness for the sim benchmarks: builds a town through the REAL Handler + commands (the way
// src/pace/pace.run.ts plays it) and offers timing helpers.
//
// Everything here goes through the protocol (found / cmd / speed) on a flat synthetic meadow, so the state under
// measurement is the state the game produces, not a hand-made fixture.
import { Handler, type Storage } from "../../../src/sim/handler";
import type { Cmd, FromWorker } from "../../../src/sim/protocol";
import { applyDelta } from "../../../src/sim/delta";
import { emptyWeather } from "../../../src/sim/weather";
import { segmentCost, type TerrainProfile } from "../../../src/sim/roads";
import { BUILDINGS } from "../../../src/sim/buildings";
import { calendar } from "../../../src/sim/clock";
import type { ClientState, SimState } from "../../../src/sim/types";

export const T0 = 1_800_000_000_000; // fake wall clock at founding
export const STEP_MS = 2500; // wall ms per handler.tick() at 1x: one tick (10 game minutes) takes 2500 ms

export const mem: Storage = { get: async () => null, put: async () => {}, clear: async () => {} };

export const flat = (len: number): TerrainProfile => {
  const n = Math.max(1, Math.round(len / 10));
  return { length: len, land: Array<"meadow">(n).fill("meadow"), elev: Array<number>(n + 1).fill(0) };
};

export interface CityOptions {
  buildings: number; // target number of buildings standing (all finished: admin free-finish while building)
  settlers?: number; // families called in through the callSettlers command after the houses stand
  growDays?: number; // game days played on after the building, a familys' worth of calls and a stock top-up a day
  settlersPerDay?: number; // calls made per grown day (default 2)
  ticksAfter?: number; // ticks run so the called families arrive and the town settles
  weather?: boolean; // real weather from the site (lat 50) instead of the calm state
  seed?: number;
}

export interface City {
  h: Handler;
  sim: () => SimState;
  st: () => ClientState;
  now: number;
  msgs: FromWorker[]; // every message the handler posted (snapshots included)
  send: (cmd: Cmd) => Promise<{ ok: boolean; reason?: string }>;
  tick: (count?: number, stepMs?: number) => void;
  counts: () => { buildings: number; houses: number; workplaces: number; residents: number; households: number; edges: number; cells: number };
}

export async function makeCity(o: CityOptions): Promise<City> {
  const msgs: FromWorker[] = [];
  let st!: ClientState;
  const results = new Map<number, { ok: boolean; reason?: string }>();
  const post = (m: FromWorker) => {
    msgs.push(m);
    if (m.t === "loaded" && m.save) st = m.save.sim;
    else if (m.t === "snapshot") st = { ...applyDelta(st, m.sim), zones: m.zones ?? st.zones, chronicle: m.chronicle ?? st.chronicle, finds: m.finds ?? st.finds };
    else if (m.t === "cmdResult") results.set(m.id, m);
    else if (m.t === "error") throw new Error(`worker error: ${m.message}`);
  };
  const weather = o.weather === true;
  const h = new Handler(mem, post, async () => ({ land: "meadow", slope: 0 }), async () => 200);
  await h.handle({ t: "found", city: { name: "Bench", lat: weather ? 50 : 59.12, lng: 37.9, foundedAt: T0 + (o.seed ?? 0) }, now: T0 + (o.seed ?? 0) });
  if (!weather) h["save"]!.sim.weather = emptyWeather(); // the calm state, as before the weather: deterministic ticks

  const sim = (): SimState => h["save"]!.sim;
  let now = T0 + (o.seed ?? 0);
  let seq = 0;
  const send = async (cmd: Cmd) => {
    const id = ++seq;
    await h.handle({ t: "cmd", id, cmd });
    await h.idle();
    const r = results.get(id) ?? { ok: false, reason: "no result" };
    return r;
  };
  const tick = (count = 1, stepMs = STEP_MS) => {
    for (let i = 0; i < count; i++) {
      now += stepMs;
      h.tick(now);
    }
  };

  // Admin cheats through the real command: everything started finishes at once, all techs, a full stock.
  for (const op of [{ k: "unlock" }, { k: "free", on: true }, { k: "stock" }] as const) {
    const r = await send({ type: "admin", op } as Cmd);
    if (!r.ok) throw new Error(`admin ${op.k} rejected: ${r.reason}`);
  }

  // ----- roads: a straight line east from the founding point, 50 m at a time -----
  let roadEnd = 0;
  const extendRoad = async (to: number) => {
    const pts: [number, number][] = [];
    for (let x = roadEnd; x < to; x += 50) pts.push([x, 0]);
    pts.push([to, 0]);
    const labor = pts.slice(1).map((p, i) => segmentCost(flat(p[0] - pts[i][0]), "path").labor);
    roadEnd = to;
    return send({ type: "addRoad", kind: "path", pts, snapTol: 6, labor });
  };

  const spansOf = (edges: number[]) => {
    const s = sim();
    const out: { edge: number; side: 1 | -1; from: number; to: number }[] = [];
    for (const id of edges) {
      const e = s.roads.edges[id];
      if (!e) continue;
      const a = s.roads.nodes[e.a];
      const b = s.roads.nodes[e.b];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (const side of [1, -1] as const) out.push({ edge: id, side, from: 0, to: len });
    }
    return out;
  };

  const houseCount = () => Object.values(sim().buildings).filter((b) => b.zone === "res").length;
  const total = () => Object.keys(sim().buildings).length;

  // Lay rows along the newest edge only: alternating classes so the town has houses, workshops and shops, and a share
  // of service buildings (well, school, chapel, healer) placed on a free lot.
  const SERVICE_TEMPLATES = ["well", "school", "chapel", "healer"];
  let edgeSeq = 0;
  const lay = async (template: string, edges: number[]) => {
    const spans = spansOf(edges);
    if (spans.length === 0) return 0;
    const before = total();
    const r = await send({ type: "placeStroke", template, spans });
    if (!r.ok) return 0;
    return total() - before;
  };
  const placeService = async (template: string) => {
    const s = sim();
    const used = new Set(Object.values(s.buildings).map((b) => `${b.lot.cx}`));
    for (const c of s.zones.cells) {
      if (c.depth !== 0 || c.block !== null) continue;
      if (used.has(`${c.cx}`)) continue;
      const r = await send({ type: "placeBuilding", template, edge: c.edge, side: c.side, i: c.i, site: { forest: 0, water: 0, rock: 0 } });
      return r.ok;
    }
    return false;
  };

  const target = o.buildings;
  let guard = 0;
  while (total() < target && guard++ < 400) {
    const from = roadEnd;
    const r = await extendRoad(roadEnd + 50);
    if (!r.ok) throw new Error(`addRoad rejected: ${r.reason}`);
    const s = sim();
    const fresh = Object.values(s.roads.edges)
      .filter((e) => Math.min(s.roads.nodes[e.a].x, s.roads.nodes[e.b].x) >= from - 1)
      .map((e) => e.id);
    const cls = edgeSeq++ % 6;
    if (cls === 5) await lay("shop", fresh);
    else if (cls === 4) await lay("weaver", fresh);
    else {
      await lay("izba", fresh);
      if (total() > target * 0.5 && Object.keys(sim().buildings).length % 17 === 0) await placeService(SERVICE_TEMPLATES[edgeSeq % SERVICE_TEMPLATES.length]);
    }
  }

  // The town is raised: the admin free-finish goes off, so ticks are the plain game's cost (handler.tick runs
  // finishAll every tick while `free` is on: a cheat, not the game).
  const offFree = await send({ type: "admin", op: { k: "free", on: false } } as Cmd);
  if (!offFree.ok) throw new Error(`admin free off rejected: ${offFree.reason}`);

  // ----- people: the player calls settlers while families wait for homes (real command, real stock cost) -----
  const wanted = o.settlers ?? 0;
  if (wanted > 0) {
    let calls = 0;
    for (let round = 0; round < 400 && calls < wanted; round++) {
      if (calls % 8 === 0) await send({ type: "admin", op: { k: "stock" } } as Cmd); // the goods the calls charge
      const r = await send({ type: "callSettlers" });
      if (!r.ok) {
        tick(18); // let the families on their way arrive and homes free up
        continue;
      }
      calls++;
    }
  }
  // ----- grow: game days at 1x, the stock topped up each morning (the town has no farms here, it must not starve) -----
  const days = o.growDays ?? 0;
  for (let d = 0; d < days; d++) {
    await send({ type: "admin", op: { k: "stock" } } as Cmd);
    for (let k = 0; k < (o.settlersPerDay ?? 2); k++) await send({ type: "callSettlers" });
    tick(144); // one game day: 144 ticks of 10 game minutes
  }
  if (o.ticksAfter) tick(o.ticksAfter);

  const counts = () => {
    const s = sim();
    return {
      buildings: Object.keys(s.buildings).length,
      houses: Object.values(s.buildings).filter((b) => b.zone === "res").length,
      workplaces: Object.values(s.buildings).filter((b) => b.zone !== "res").length,
      residents: Object.keys(s.residents).length,
      households: Object.keys(s.households).length,
      edges: Object.keys(s.roads.edges).length,
      cells: s.zones.cells.length,
    };
  };

  return { h, sim, st: () => st, get now() { return now; }, msgs, send, tick, counts } as City & { now: number };
}

// ---------- timing ----------

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

export const ms = (v: number): string => (v >= 100 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(3));

export const bytes = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

export const dayHour = (gameMinutes: number): { day: number; hour: number } => {
  const c = calendar(gameMinutes);
  return { day: Math.floor((gameMinutes + 360) / 1440), hour: c.hour };
};

// Times `fn` `reps` times and returns every sample in ms.
export function timeIt(fn: () => unknown, reps = 5): number[] {
  const out: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    fn();
    out.push(performance.now() - t);
  }
  return out;
}

export const table = (head: string[], rows: (string | number)[][]): string =>
  [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");

export { BUILDINGS };
