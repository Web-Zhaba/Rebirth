// The benchmark input: one realistic town, built once through the real Handler (./town.ts) and cached beside the
// harness, so every benchmark file measures the same data and a run costs seconds instead of minutes.
// Delete .fixture.json to rebuild it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ClientState, City } from "../../../src/sim/types";
import { buildTown } from "./town";

export interface Fixture {
  state: ClientState;
  city: City;
  /** Consecutive snapshot messages the worker posted while the town was played, in order. */
  deltas: unknown[];
  meta: Record<string, unknown>;
}

const FILE = new URL("./.fixture.json", import.meta.url);

export async function loadFixture(): Promise<Fixture> {
  if (existsSync(FILE)) {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Fixture;
    if (raw.meta?.version === 2) return raw;
  }
  const town = await buildTown({ days: 60 });
  // Play on and keep the snapshots the worker posts: the layer benchmark replays them one by one.
  town.ticks(4);
  const deltas = town.ticks(160);
  const c = town.count();
  const fixture: Fixture = {
    state: town.st,
    city: town.city,
    deltas,
    meta: {
      version: 2,
      ...c,
      chronicle: town.st.chronicle.length,
      historyRows: town.st.history.length,
      finds: {
        foundations: town.st.finds.foundations.length,
        streets: town.st.finds.streets.length,
        pois: town.st.finds.pois.length,
        features: town.st.finds.features.length,
      },
      techs: town.st.progress.techs.length,
      cells: town.st.zones.cells.length,
      bytes: JSON.stringify(town.st).length,
      failures: town.failures,
      notes: town.notes,
    },
  };
  writeFileSync(FILE, JSON.stringify(fixture));
  return fixture;
}

/** The fixture with `n` buildings: the same town, more entries (cloned ids), for the scaling curves. */
export function withBuildings(f: Fixture, n: number): ClientState {
  const list = Object.values(f.state.buildings);
  const base = f.state;
  if (n <= list.length) {
    const kept = list.slice(0, n);
    const ids = new Set(kept.map((b) => b.id));
    const only = <T>(rec: Record<number, T>): Record<number, T> => {
      const out: Record<number, T> = {};
      for (const id of ids) if (rec[id] !== undefined) out[id] = rec[id];
      return out;
    };
    const buildings: ClientState["buildings"] = {};
    for (const b of kept) buildings[b.id] = b;
    return { ...base, buildings, houseMood: only(base.houseMood), houseGoods: only(base.houseGoods), houseResidents: only(base.houseResidents), museumStaff: only(base.museumStaff) };
  }
  const buildings: ClientState["buildings"] = {};
  for (const b of list) buildings[b.id] = b;
  const houseMood = { ...base.houseMood };
  const houseGoods = { ...base.houseGoods };
  const houseResidents = { ...base.houseResidents };
  let id = Math.max(...list.map((b) => b.id)) + 1;
  for (let k = list.length; k < n; k++, id++) {
    const src = list[k % list.length];
    const dx = 900 + id * 12;
    buildings[id] = { ...src, id, footprint: src.footprint.map(([x, y]) => [x + dx, y] as [number, number]), lot: { ...src.lot, cx: src.lot.cx + dx } };
    if (base.houseMood[src.id] !== undefined) houseMood[id] = base.houseMood[src.id];
    if (base.houseGoods[src.id] !== undefined) houseGoods[id] = base.houseGoods[src.id];
    if (base.houseResidents[src.id] !== undefined) houseResidents[id] = base.houseResidents[src.id];
  }
  return { ...base, buildings, houseMood, houseGoods, houseResidents };
}

export function median(list: number[]): number {
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface Timing {
  name: string;
  median: number;
  min: number;
  p90: number;
  n: number;
}

const now = (): number => performance.now();

/** Median ms of one call of `fn`: warm-up first, then `samples` batches of `reps` calls, timing each batch. */
export function time(name: string, fn: () => unknown, opts: { samples?: number; reps?: number; warmup?: number } = {}): Timing {
  const samples = opts.samples ?? 9;
  const reps = opts.reps ?? 1;
  const warmup = opts.warmup ?? Math.max(3, Math.min(20, Math.floor(200 / reps)));
  for (let k = 0; k < warmup; k++) fn();
  const out: number[] = [];
  for (let s = 0; s < samples; s++) {
    const t0 = now();
    for (let r = 0; r < reps; r++) fn();
    out.push((now() - t0) / reps);
  }
  const sorted = [...out].sort((a, b) => a - b);
  return { name, median: median(out), min: sorted[0], p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))], n: samples * reps };
}

export function table(rows: Timing[], unit = "ms"): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (v: number) => (v < 0.001 ? v.toExponential(2) : v.toFixed(4));
  console.log(`${pad("model / function", 46)} ${pad(`median ${unit}`, 12)} ${pad(`min ${unit}`, 12)} ${pad(`p90 ${unit}`, 12)} calls`);
  for (const r of rows) console.log(`${pad(r.name, 46)} ${pad(num(r.median), 12)} ${pad(num(r.min), 12)} ${pad(num(r.p90), 12)} ${r.n}`);
}
