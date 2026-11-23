import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./buildings";
import { FOUNDATION_LOT } from "./foundationLots";
import { addRoad, emptyRoads } from "./roads";
import { lineCovered, streetFoundations, streetProgress, STREET } from "./streets";
import type { Building, FoundFoundation, FoundPlace, RoadGraph } from "./types";

// Which old foundations belong to which old street, and how far each street is from its name back. Both are asked for
// every foundation and every street of a panel, so both are kept by the identity of the lists and records they read:
// these tests pin the answers and that a changed list is never answered from the cache.

type Pt = [number, number];
const area = (r: Pt[]) => Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;
const found = (id: string, ring: Pt[], extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring, area: area(ring), digId: 1, at: 0, ...extra });
const street = (id: string, lines: Pt[][], extra: Partial<FoundPlace> = {}): FoundPlace => ({ id, name: `Улица ${id}`, kind: "street", digId: 1, at: 0, lines, ...extra });
const box = (x: number, y: number, size = 10): Pt[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];

// The plain answer, before the reach of each street was tested against its bounding box first: the yardstick.
function plain(streets: readonly FoundPlace[], foundations: readonly FoundFoundation[]): Map<string, FoundFoundation[]> {
  const dist = (x: number, y: number, lines: readonly Pt[][]) => {
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
  };
  const out = new Map<string, FoundFoundation[]>();
  for (const f of foundations) {
    if (f.area < FOUNDATION_LOT.minArea) continue;
    const x = f.ring.reduce((a, p) => a + p[0], 0) / f.ring.length;
    const y = f.ring.reduce((a, p) => a + p[1], 0) / f.ring.length;
    let best: FoundPlace | null = null;
    let bd = STREET.reach;
    for (const t of streets.filter((t) => t.lines && t.lines.length > 0)) {
      const d = dist(x, y, t.lines!);
      if (d <= bd) [best, bd] = [t, d];
    }
    if (!best) continue;
    const list = out.get(best.id);
    if (list) list.push(f);
    else out.set(best.id, [f]);
  }
  return out;
}

const ids = (m: Map<string, FoundFoundation[]>) => [...m].map(([id, list]) => [id, list.map((f) => f.id)]);

describe("which foundations a street had", () => {
  const main = street("main", [[[0, 0], [200, 0]]]);
  const side = street("side", [[[0, 200], [200, 200]]]);

  it("gives each foundation to the nearest street within its reach, and none to the others", () => {
    const near = found("near", box(50, 8)); // 13 m from main
    const between = found("between", box(120, 40)); // 45 m from main, far from side: out of reach
    const own = streetFoundations([main, side], [near, between]);
    expect(ids(own)).toEqual([["main", ["near"]]]);
    expect(streetFoundations([main, side], [])).toEqual(new Map());
    expect(streetFoundations([street("bare", [])], [near])).toEqual(new Map()); // a place without a line
  });

  it("leaves the rings too small to build on out of the streets", () => {
    const shed = found("shed", box(50, 8, 4)); // 16 m², under FOUNDATION_LOT.minArea
    expect(streetFoundations([main], [shed])).toEqual(new Map());
  });

  it("answers the plain scan in full, street by street, on a scattered town", () => {
    // Streets in every direction, foundations around them at every distance: the box test must not lose a neighbour.
    const streets: FoundPlace[] = [];
    const foundations: FoundFoundation[] = [];
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const x = Math.cos(a) * 30 * k;
      const y = Math.sin(a) * 30 * k;
      streets.push(street(`s${k}`, [[[x, y], [x + Math.cos(a) * 120, y + Math.sin(a) * 120]], [[x + 150, y], [x + 150, y + 40]]]));
    }
    for (let i = 0; i < 120; i++) {
      const x = ((i * 37) % 400) - 200;
      const y = ((i * 61) % 300) - 150;
      foundations.push(found(`f${i}`, box(x, y, 8 + (i % 3) * 4)));
      n++;
    }
    expect(n).toBe(120);
    expect(ids(streetFoundations(streets, foundations))).toEqual(ids(plain(streets, foundations)));
    // and on the same town with far more streets than foundations
    expect(ids(streetFoundations([...streets, ...streets.map((s) => ({ ...s, id: `${s.id}b` }))], foundations))).toEqual(
      ids(plain([...streets, ...streets.map((s) => ({ ...s, id: `${s.id}b` }))], foundations)),
    );
  });

  it("keeps its answer by the identity of the lists, and answers a new list anew", () => {
    const before = [found("a", box(50, 8))];
    const streets = [main];
    const first = streetFoundations(streets, before);
    expect(streetFoundations(streets, before)).toBe(first); // the same lists: the same map, no second walk
    const added = [...before, found("b", box(90, 8))];
    const second = streetFoundations(streets, added);
    expect(second).not.toBe(first);
    expect(ids(second)).toEqual([["main", ["a", "b"]]]);
    // a street whose line moved is a new street list, so the answer is new too
    const grown = streetFoundations([street("main", [[[0, 0], [200, 0]], [[200, 0], [200, 200]]])], added);
    expect(ids(grown)).toEqual([["main", ["a", "b"]]]);
  });
});

describe("how far a street is from its name", () => {
  const built = (pts: Pt[]): RoadGraph => {
    const r = addRoad(emptyRoads(), pts, "dirt", 1, [10]);
    if (!r.ok) throw new Error(r.reason);
    for (const e of Object.values(r.graph.edges)) e.done = e.labor;
    return r.graph;
  };
  const alone = (id: number, foundationId: string): Building =>
    ({ id, template: "izba", zone: "res", lot: { cx: 0, cy: 0, angle: 0, w: 2, d: 3 }, side: 1, footprint: box(0, 0), height: 4, state: "active", labor: 1, done: 1, created: 0, paid: true, level: 1, streak: 0, foundationId }) as Building;

  it("counts the foundations of its own line and the road over it", () => {
    const t = street("main", [[[0, 0], [300, 0]]]);
    const houses = [found("a", box(50, 8)), found("b", box(150, 8)), found("far", box(150, 200))];
    const s = { finds: { streets: [t], foundations: houses }, buildings: {}, roads: built([[0, 0], [300, 0]]) } as never;
    expect(streetProgress(s, t)).toEqual({ houses: 2, built: 0, road: 1 });
    expect(lineCovered(t.lines!, built([[0, 400], [300, 400]]))).toBe(0); // a road along, not over, the old line
    expect(lineCovered(t.lines!, emptyRoads())).toBe(0);
  });

  it("counts only finished buildings, and follows the buildings record it is given", () => {
    const t = street("main", [[[0, 0], [300, 0]]]);
    const houses = [found("a", box(50, 8)), found("b", box(150, 8))];
    const roads = built([[0, 0], [300, 0]]);
    const at = (buildings: Record<number, Building>) => streetProgress({ finds: { streets: [t], foundations: houses }, buildings, roads } as never, t);
    expect(at({ 1: alone(1, "a") })).toEqual({ houses: 2, built: 1, road: 1 });
    expect(at({ 1: alone(1, "a"), 2: { ...alone(2, "b"), state: "building" } })).toEqual({ houses: 2, built: 1, road: 1 }); // under way
    // the dig site on a foundation is not a building on it either
    const site = { ...alone(3, "b"), template: "excavation" } as Building;
    expect(at({ 1: alone(1, "a"), 3: site })).toEqual({ houses: 2, built: 1, road: 1 });
    expect(at({ 1: alone(1, "a"), 2: alone(2, "b") })).toEqual({ houses: 2, built: 2, road: 1 });
    expect(BUILDINGS.excavation.workSite).toBe(true);
  });

  it("keeps the covered share by the roads it was measured on", () => {
    const t = street("main", [[[0, 0], [300, 0]]]);
    const under = built([[0, 0], [300, 0]]);
    const away = built([[0, 400], [300, 400]]);
    expect(lineCovered(t.lines!, under)).toBe(1);
    expect(lineCovered(t.lines!, under)).toBe(1); // the same road graph: the same answer, not a second walk
    expect(lineCovered(t.lines!, away)).toBe(0); // a new graph is measured anew
    expect(lineCovered(t.lines!, under)).toBe(1);
  });
});
