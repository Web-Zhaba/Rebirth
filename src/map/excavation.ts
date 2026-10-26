import { effect, signal } from "@preact/signals";
import { DIG } from "../sim/excavation";
import type { DigInfo } from "../sim/types";
import { digs, frame, sendCmd } from "../simClient";
import { loadOldWorld, ringCentroid, type Disc, type OldWorld } from "../world/oldworld";
import { hintSpots, selectHints, typeFoundations, typedFoundations, type TypedFoundation } from "./heritageSpots";

// The revealed old world (null until the first dig is loaded); drawn by the ruins layer.
export const oldWorld = signal<OldWorld | null>(null);

const DEBOUNCE_MS = 1000;
const RETRY_MS = 30_000;
const GROW_M = 2; // a disc must grow this much to reload the old world

const discOf = (d: DigInfo): Disc => ({ x: d.x, y: d.y, r: d.r });

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
  const reportedS = new Set<string>(); // street names
  let applied: Disc[] | null = null;
  let timer = 0;
  let loading = false;
  let retryAt = 0;
  let chain: Promise<void> = Promise.resolve();

  async function report(world: OldWorld, list: DigInfo[], typed: TypedFoundation[]): Promise<void> {
    if (list.length === 0) return;
    const streetNames = new Set(world.streets.flatMap((s) => (s.name ? [s.name] : [])));
    const typeOf = new Map(typed.map((t) => [t.id, t]));
    const groups = new Map<number, { f: { id: string; ring: [number, number][]; area: number; cls?: string; name?: string; height?: number }[]; p: { id: string; name: string; cls: string; x: number; y: number }[]; s: { id: string; name: string }[] }>();
    const group = (id: number) => {
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { f: [], p: [], s: [] }));
      return g;
    };
    for (const f of world.foundations) {
      if (reportedF.has(f.id)) continue;
      const [cx, cy] = ringCentroid(f.ring);
      const t = typeOf.get(f.id);
      group(digFor(cx, cy, list)).f.push({ id: f.id, ring: f.ring, area: f.area, ...(t ? { cls: t.cls, ...(t.name ? { name: t.name } : {}), ...(t.height !== undefined ? { height: t.height } : {}) } : {}) });
    }
    const seen = new Set<string>();
    for (const s of world.streets) {
      if (!s.name || reportedS.has(s.name) || seen.has(s.name) || s.pts.length === 0) continue;
      seen.add(s.name);
      group(digFor(s.pts[0][0], s.pts[0][1], list)).s.push({ id: s.id, name: s.name });
    }
    for (const p of world.pois) {
      if (reportedP.has(p.id) || streetNames.has(p.name) || reportedS.has(p.name)) continue;
      group(digFor(p.x, p.y, list)).p.push({ id: p.id, name: p.name, cls: p.cls, x: p.x, y: p.y });
    }
    for (const [digId, g] of groups) {
      const F = chunks(g.f);
      const P = chunks(g.p);
      const S = chunks(g.s);
      const n = Math.max(F.length, P.length, S.length);
      for (let i = 0; i < n; i++) {
        const foundations = F[i] ?? [];
        const pois = P[i] ?? [];
        const streets = S[i] ?? [];
        const r = await sendCmd({ type: "recordFinds", digId, foundations, pois, streets });
        if (!r.ok) continue; // not recorded: reported again on the next disc change
        for (const f of foundations) reportedF.add(f.id);
        for (const p of pois) reportedP.add(p.id);
        for (const s of streets) reportedS.add(s.name);
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
