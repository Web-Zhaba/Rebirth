import { effect, signal } from "@preact/signals";
import { DIG, MAX_HEIGHT, STREET_POINTS } from "../sim/excavation";
import type { DigInfo } from "../sim/types";
import { digs, frame, sendCmd } from "../simClient";
import { loadOldWorld, ringCentroid, type Disc, type FindFeature, type OldWorld } from "../world/oldworld";
import { hintSpots, selectHints, typeFoundations, typedFoundations, type TypedFoundation } from "./heritageSpots";

// The revealed old world (null until the first dig is loaded); drawn by the ruins layer.
export const oldWorld = signal<OldWorld | null>(null);

const DEBOUNCE_MS = 1000;
const RETRY_MS = 30_000;
const GROW_M = 2; // a disc must grow this much to reload the old world

const discOf = (d: DigInfo): Disc => ({ x: d.x, y: d.y, r: d.r });

// The pieces of a street with at most `max` points in all: every k-th point of each piece, its ends always kept.
export function thinLines(pieces: [number, number][][], max: number): [number, number][][] {
  const n = pieces.reduce((a, l) => a + l.length, 0);
  if (n <= max) return pieces;
  const k = Math.ceil(n / Math.max(2, max - 2 * pieces.length));
  const out: [number, number][][] = [];
  let left = max;
  for (const l of pieces) {
    if (left < 2) break;
    const kept = l.filter((_, i) => i === 0 || i === l.length - 1 || i % k === 0).slice(0, left);
    if (kept.length >= 2) {
      out.push(kept);
      left -= kept.length;
    }
  }
  return out;
}

// Did the set of discs change enough to reload: a new or removed dig, or a radius that grew by 2 m or more.
export function discsChanged(prev: Disc[] | null, next: Disc[]): boolean {
  if (!prev) return next.length > 0;
  if (prev.length !== next.length) return true;
  return next.some((d, i) => d.x !== prev[i].x || d.y !== prev[i].y || Math.abs(d.r - prev[i].r) >= GROW_M);
}

// The dig whose disc holds the point best (deepest inside); falls back to the first dig.
function digFor(x: number, y: number, list: DigInfo[]): number {
  let best = list[0].id;
  let bd = Infinity;
  for (const d of list) {
    const k = Math.hypot(x - d.x, y - d.y) - d.r;
    if (k < bd) {
      bd = k;
      best = d.id;
    }
  }
  return best;
}

const chunks = <T>(a: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += DIG.batch) out.push(a.slice(i, i + DIG.batch));
  return out;
};

// Feeds the revealed old world to the map and reports finds to the simulation.
export function attachExcavation(): void {
  const reportedF = new Set<string>();
  const reportedP = new Set<string>();
  const reportedS = new Map<string, number>(); // street name -> length of its line when last reported (m)
  const reportedX = new Set<string>(); // features that give finds
  let applied: Disc[] | null = null;
  let timer = 0;
  let loading = false;
  let retryAt = 0;
  let chain: Promise<void> = Promise.resolve();

  async function report(world: OldWorld, list: DigInfo[], typed: TypedFoundation[]): Promise<void> {
    if (list.length === 0) return;
    const streetNames = new Set(world.streets.flatMap((s) => (s.name ? [s.name] : [])));
    const typeOf = new Map(typed.map((t) => [t.id, t]));
    const groups = new Map<number, { f: { id: string; ring: [number, number][]; area: number; cls?: string; name?: string; height?: number }[]; p: { id: string; name: string; cls: string; x: number; y: number }[]; s: { id: string; name: string; lines: [number, number][][]; len: number }[]; x: FindFeature[] }>();
    const group = (id: number) => {
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { f: [], p: [], s: [], x: [] }));
      return g;
    };
    for (const f of world.foundations) {
      if (reportedF.has(f.id)) continue;
      const [cx, cy] = ringCentroid(f.ring);
      const t = typeOf.get(f.id);
      // every foundation keeps its height (the floors of its building); a typed one also its kind and name
      const h = f.height !== undefined && Number.isFinite(f.height) && f.height >= 0 && f.height <= MAX_HEIGHT ? { height: f.height } : {};
      group(digFor(cx, cy, list)).f.push({ id: f.id, ring: f.ring, area: f.area, ...h, ...(t ? { cls: t.cls, ...(t.name ? { name: t.name } : {}) } : {}) });
    }
    // Each named street once, with its line (all its pieces), and again when the line grew with the digs.
    const byName = new Map<string, { id: string; pieces: [number, number][][] }>();
    for (const t of world.streets) {
      if (!t.name || t.pts.length < 2) continue;
      const g = byName.get(t.name);
      if (g) g.pieces.push(t.pts);
      else byName.set(t.name, { id: t.id, pieces: [t.pts] });
    }
    for (const [name, { id, pieces }] of byName) {
      const len = pieces.reduce((a, l) => a + l.slice(1).reduce((b, q, i) => b + Math.hypot(q[0] - l[i][0], q[1] - l[i][1]), 0), 0);
      if ((reportedS.get(name) ?? -Infinity) >= len - 1) continue;
      group(digFor(pieces[0][0][0], pieces[0][0][1], list)).s.push({ id, name, lines: thinLines(pieces, STREET_POINTS), len });
    }
    for (const p of world.pois) {
      if (reportedP.has(p.id) || streetNames.has(p.name) || reportedS.has(p.name)) continue;
      group(digFor(p.x, p.y, list)).p.push({ id: p.id, name: p.name, cls: p.cls, x: p.x, y: p.y });
    }
    for (const x of world.features ?? []) if (!reportedX.has(x.id)) group(digFor(x.x, x.y, list)).x.push(x);
    for (const [digId, g] of groups) {
      const F = chunks(g.f);
      const P = chunks(g.p);
      const S = chunks(g.s);
      const X = chunks(g.x);
      const n = Math.max(F.length, P.length, S.length, X.length);
      for (let i = 0; i < n; i++) {
        const foundations = F[i] ?? [];
        const pois = P[i] ?? [];
        const streets = S[i] ?? [];
        const features = X[i] ?? [];
        const r = await sendCmd({ type: "recordFinds", digId, foundations, pois, streets: streets.map(({ id, name, lines }) => ({ id, name, lines })), features });
        if (!r.ok) continue; // not recorded: reported again on the next disc change
        for (const f of foundations) reportedF.add(f.id);
        for (const p of pois) reportedP.add(p.id);
        for (const t of streets) reportedS.set(t.name, t.len);
        for (const x of features) reportedX.add(x.id);
      }
    }
  }

  async function refresh(): Promise<void> {
    timer = 0;
    const f = frame.value;
    const list = digs.value;
    if (!f || loading) return;
    const discs = list.map(discOf);
    if (!discsChanged(applied, discs)) return;
    loading = true;
    try {
      const world = await loadOldWorld(f, discs);
      applied = discs;
      const typed = list.length ? typeFoundations(world.foundations, world.spots, (x, y) => digFor(x, y, list)) : [];
      oldWorld.value = world;
      typedFoundations.value = typed;
      hintSpots.value = selectHints(world, discs);
      chain = chain.then(() => report(world, list, typed)).catch(() => undefined);
    } catch {
      retryAt = Date.now() + RETRY_MS; // network failure: the game goes on, try again later
    } finally {
      loading = false;
    }
    // discs may have moved on while loading
    schedule();
  }

  function schedule(): void {
    if (timer || loading) return;
    if (!discsChanged(applied, digs.peek().map(discOf))) return;
    const wait = Math.max(DEBOUNCE_MS, retryAt - Date.now());
    timer = window.setTimeout(() => void refresh(), wait);
  }

  effect(() => {
    void digs.value;
    void frame.value;
    schedule();
  });
}
