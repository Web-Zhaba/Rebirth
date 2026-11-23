// The finds screens of the town panel: the outline card (heritageModel.buildOutlineView) and the places tab
// (placesModel.placesView) walk the old foundations and streets on every render. Both were O(streets × foundations) per
// card, so this bench keeps the pre-optimisation path next to the current one and measures both on the same fixture in
// one run: the absolute numbers of this machine drift, their ratio does not.
//
//   npx vitest run --config vitest.perf.config.ts perf/bench/ui/finds.test.ts --reporter=verbose
import { it } from "vitest";
import { digBlocker, streetDigs, streetOf } from "../../../src/sim/digging";
import { BUILDINGS } from "../../../src/sim/buildings";
import { FOUNDATION_LOT } from "../../../src/sim/foundationLots";
import { streetFoundations, streetProgress, STREET } from "../../../src/sim/streets";
import type { Building, ClientState, FoundFoundation, FoundPlace, RoadGraph, SimState } from "../../../src/sim/types";
import * as heritage from "../../../src/ui/heritageModel";
import * as places from "../../../src/ui/placesModel";
import { loadFixture, table, time, type Timing } from "./fixture";

type Pt = [number, number];

// ---------- the path before the caches, kept as the yardstick ----------

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

// sim/streets.ts streetFoundations, as it was: every foundation against every street, not a box tested first.
function oldStreetFoundations(streets: readonly FoundPlace[], foundations: readonly FoundFoundation[]): Map<string, FoundFoundation[]> {
  const out = new Map<string, FoundFoundation[]>();
  const lined = streets.filter((t) => t.lines && t.lines.length > 0);
  if (lined.length === 0) return out;
  for (const f of foundations) {
    if (f.area < FOUNDATION_LOT.minArea) continue;
    const [x, y] = [f.ring.reduce((a, p) => a + p[0], 0) / f.ring.length, f.ring.reduce((a, p) => a + p[1], 0) / f.ring.length];
    let best: FoundPlace | null = null;
    let bd = STREET.reach;
    for (const t of lined) {
      const d = distToLines(x, y, t.lines!);
      if (d <= bd) [best, bd] = [t, d];
    }
    if (!best) continue;
    const list = out.get(best.id);
    if (list) list.push(f);
    else out.set(best.id, [f]);
  }
  return out;
}

const oldStreetOf = (streets: readonly FoundPlace[], foundations: readonly FoundFoundation[], id: string): { id: string; name: string } | null => {
  for (const [sid, list] of oldStreetFoundations(streets, foundations))
    if (list.some((f) => f.id === id)) {
      const t = streets.find((x) => x.id === sid);
      return t ? { id: sid, name: t.name } : null;
    }
  return null;
};

// sim/digging.ts digBlocker, as it was: a walk over every building for one foundation.
const oldDigBlocker = (buildings: Record<number, Building>, f: FoundFoundation | undefined): string | null => {
  if (!f || !f.ghost) return null;
  for (const b of Object.values(buildings)) if (b.foundationId === f.id) return "dug already";
  return null;
};

const oldStreetDigs = (streets: readonly FoundPlace[], foundations: readonly FoundFoundation[], buildings: Record<number, Building>, id: string): FoundFoundation[] =>
  (oldStreetFoundations(streets, foundations).get(id) ?? []).filter((f) => oldDigBlocker(buildings, f) === null);

// What one outline card walked before: streetOf + digBlocker + streetDigs, each rebuilding the street map.
const oldCard = (st: Pick<SimState, "finds" | "buildings">, f: FoundFoundation): number => {
  oldDigBlocker(st.buildings, f);
  const street = oldStreetOf(st.finds.streets, st.finds.foundations, f.id);
  if (!street) return 0;
  const digs = oldStreetDigs(st.finds.streets, st.finds.foundations, st.buildings, street.id);
  return digs.length;
};

const oldLineCovered = (lines: readonly Pt[][], roads: RoadGraph): number => {
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
          hit++;
          break;
        }
      }
    }
  return n > 0 ? hit / n : 0;
};

// streetProgress, as it was: the Set of the findings built on rebuilt for every street.
function oldStreetProgress(s: Pick<SimState, "finds" | "buildings" | "roads">, t: FoundPlace, own: FoundFoundation[]) {
  const on = new Set<string>();
  for (const b of Object.values(s.buildings)) if (b.foundationId && b.state === "active" && !BUILDINGS[b.template]?.workSite) on.add(b.foundationId);
  const road: number = t.lines ? oldLineCovered(t.lines, s.roads) : 0;
  return { houses: own.length, built: own.filter((f) => on.has(f.id)).length, road };
}


// ---------- the bench ----------

// The finds of a snapshot that changed: new lists, as a delta that touched the finds makes them.
const freshFinds = (st: ClientState): ClientState => ({ ...st, finds: { ...st.finds, foundations: st.finds.foundations.slice(), streets: st.finds.streets.slice() } });

// A pool of towns whose finds have just changed, a new one per call: the copy is made outside the timer, so a probe
// measures the cold cache the first render after a snapshot pays, not the copying of two lists.
function pool(make: () => ClientState, size = 64): () => ClientState {
  const list = Array.from({ length: size }, make);
  let i = 0;
  return () => list[i++ % size];
}

it("the finds screens: the outline card and the places tab, before and after the caches", async () => {
  const f = await loadFixture();
  const st = f.state;
  const own = streetFoundations(st.finds.streets, st.finds.foundations);
  // The card of an outline on an old street: the walk the report measured (streetOf + streetDigs + digBlocker). The
  // fixture's own foundations are all dug, so the outline is taken as still only surveyed.
  const onStreet = [...own.values()][0]?.[0] ?? st.finds.foundations[0];
  const ghost: FoundFoundation = { ...onStreet, ghost: true };
  const street = st.finds.streets.find((t) => (own.get(t.id) ?? []).length > 0 && t.lines) ?? st.finds.streets[0];
  const coldFoundations = pool(() => freshFinds(st));
  const coldCard = pool(() => freshFinds(st));
  const coldPlaces = pool(() => freshFinds(st));

  const probes: [string, () => unknown][] = [
    ["streetFoundations (old: foundations × streets)", () => oldStreetFoundations(st.finds.streets, st.finds.foundations)],
    ["streetFoundations (now, the finds just changed)", () => {
      const g = coldFoundations();
      return streetFoundations(g.finds.streets, g.finds.foundations);
    }],
    ["streetFoundations (now, unchanged since the last call)", () => streetFoundations(st.finds.streets, st.finds.foundations)],
    ["streetOf + digBlocker + streetDigs (old: one card)", () => oldCard(st, ghost)],
    ["streetOf + digBlocker + streetDigs (now: one card)", () => {
      streetOf(st, ghost.id);
      digBlocker(st, ghost);
      streetDigs(st, street.id);
    }],
    ["buildOutlineView (now, cache warm)", () => heritage.buildOutlineView(ghost, st)],
    ["buildOutlineView (now, the finds just changed)", () => heritage.buildOutlineView(ghost, coldCard())],
    ["buildOutlineView × every foundation", () => st.finds.foundations.forEach((x) => heritage.buildOutlineView(x, st))],
    ["placesView (warm: the finds unchanged)", () => places.placesView(st)],
    ["placesView (the finds just changed)", () => places.placesView(coldPlaces())],
    ["streetProgress × every street (old)", () => st.finds.streets.forEach((t) => oldStreetProgress(st, t, own.get(t.id) ?? []))],
    ["streetProgress × every street (now)", () => st.finds.streets.forEach((t) => streetProgress(st, t, own.get(t.id) ?? []))],
    ["digBlocker × every foundation (old)", () => st.finds.foundations.forEach((x) => oldDigBlocker(st.buildings, x))],
    ["digBlocker × every foundation (now)", () => st.finds.foundations.forEach((x) => digBlocker(st, x))],
  ];
  console.log(`
### the finds screens: ${st.finds.foundations.length} foundations, ${st.finds.streets.length} old streets, ${Object.values(st.buildings).length} buildings
`);
  table(probes.map(([name, fn]) => time(name, fn)));
  console.log(`
the card is measured on an outline of street ${street.id} (${(own.get(street.id) ?? []).length} of its own); a panel asks the card once per foundation
`);
});
