import { describe, expect, it } from "vitest";
import { BUILDINGS, familyCapacity, homesOf, houseCapacity, storageOf } from "./buildings";
import { FOUNDATION_TAKEN, foundationBuilding, foundationLots, lotCheck, lotRing } from "./foundationLots";
import { simplifyRing } from "./heritageGeo";
import { vacantHouses } from "./people";
import { canPlace, canPlaceOnFoundation, emptyGrowth, placeOnFoundation, spawnBuildings } from "./growth";
import { parseSave } from "./save";
import { addRoad, emptyRoads } from "./roads";
import { allResearched } from "./tech";
import type { City, FoundFoundation, RoadGraph, SimState, ZoneType } from "./types";
import { emptyZones, regenerateCells } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59, lng: 37, foundedAt: NOW - 1e6 };

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const found = (id: string, ring: Pt[], extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring, area: Math.abs(ring.reduce((a, p, i) => a + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0)) / 2, digId: 1, at: 0, ...extra });

// A built dirt road along y = 40 from x = -200 to 200.
const builtRoad = (): RoadGraph => {
  const r = addRoad(emptyRoads(), [[-200, 40], [200, 40]], "dirt", 1, [10]);
  if (!r.ok) throw new Error(r.reason);
  for (const e of Object.values(r.graph.edges)) e.done = e.labor;
  return r.graph;
};

const mk = (foundations: FoundFoundation[], zone: ZoneType | "none" = "none"): SimState => {
  const roads = builtRoad();
  const cells = regenerateCells(roads, [], [], {}).map((c) => ({ ...c, block: null, zone }));
  return {
    realTime: NOW,
    gameMinutes: 1000,
    roads,
    zones: { ...emptyZones(), cells },
    ...emptyGrowth(1),
    residents: {},
    households: {},
    lastSpawn: { res: -1000, craft: -1000, trade: -1000 },
    progress: allResearched(),
    finds: { foundations, pois: [], streets: [], revealed: [{ digId: 1, x: 0, y: 0, r: 120 }] },
  } as SimState;
};

const NO_SITE = { forest: 0, water: 0, rock: 0 };
const house = found("h", rect(0, 46, 8, 10)); // 80 m², 6 m from the road

describe("foundations as lots", () => {
  it("a zone builds on its foundation first, in the foundation's shape, scaled by its area", () => {
    const s = mk([house], "res");
    expect(foundationLots(s, "res").map((l) => l.f.id)).toEqual(["h"]);
    expect(foundationLots(s, "craft")).toEqual([]);
    const grown = spawnBuildings(s);
    const b = Object.values(grown.buildings)[0];
    expect(b.foundationId).toBe("h");
    expect(b.footprint).toEqual(lotRing(house));
    const t = BUILDINGS[b.template];
    expect(t.zone).toBe("res");
    const k = Math.round((house.area / (t.along * t.deep)) * 100) / 100;
    expect(b.scale).toBe(k);
    expect(houseCapacity(b)).toBe(Math.max(1, Math.round(t.residents * k)));
    expect(b.labor).toBe(Math.round(t.labor * k));
    expect(b.door![1]).toBeCloseTo(46, 5); // the wall facing the road
    expect(foundationLots(grown, "res")).toEqual([]); // built on, it is no longer free
  });

  it("regular lots keep off a free foundation", () => {
    const s = mk([house]);
    const over = s.zones.cells.find((c) => c.depth === 0 && Math.abs(c.cx - 4) < 4 && c.cy > 40)!;
    expect(canPlace(s, BUILDINGS.well, over.edge, over.side, over.i, NO_SITE)).toEqual({ ok: false, reason: FOUNDATION_TAKEN });
    // A shed too small to be a lot does not reserve its ground.
    const shed = mk([found("s", rect(0, 46, 4, 4))]);
    expect(canPlace(shed, BUILDINGS.well, over.edge, over.side, over.i, NO_SITE).ok).toBe(true);
  });

  it("the player puts a building on a foundation; demolishing it frees the foundation", () => {
    const s = mk([house, found("far", rect(0, 200, 8, 10)), found("crossed", rect(-50, 35, 8, 10))]);
    expect(canPlaceOnFoundation(s, BUILDINGS.garden, "h").ok).toBe(false);
    expect(canPlaceOnFoundation(s, BUILDINGS.healer, "far")).toMatchObject({ ok: false, reason: "Нужна построенная дорога рядом" });
    expect(canPlaceOnFoundation(s, BUILDINGS.healer, "crossed")).toMatchObject({ ok: false, reason: "Через фундамент проходит дорога" });
    expect(canPlaceOnFoundation(s, BUILDINGS.well, "h").ok).toBe(false); // open ground
    expect(canPlaceOnFoundation(s, BUILDINGS.market, "h")).toMatchObject({ ok: false, reason: "Фундамент мал для этой постройки (80 м²)" });
    expect(canPlaceOnFoundation(s, BUILDINGS.barn, "h").ok).toBe(true);
    expect(lotCheck(s, house, BUILDINGS.woodcutter).ok).toBe(false);
    expect(canPlaceOnFoundation(s, BUILDINGS.healer, "h").ok).toBe(true);
    const placed = placeOnFoundation(s, BUILDINGS.healer, "h");
    const b = placed.buildings[1];
    expect(b).toMatchObject({ template: "healer", foundationId: "h", scale: 1.25, labor: Math.round(BUILDINGS.healer.labor * 1.25), state: "planned" });
    expect(canPlaceOnFoundation(placed, BUILDINGS.school, "h")).toMatchObject({ ok: false, reason: "Место занято зданием" });
    const rest = { ...placed.buildings };
    delete rest[1];
    expect(canPlaceOnFoundation({ ...placed, buildings: rest }, BUILDINGS.school, "h").ok).toBe(true);
  });

  it("a big foundation makes a big building: more families, jobs and storage, at the same cost per m²", () => {
    const big = found("b", rect(0, 46, 20, 24)); // 480 m²
    const s = mk([big]);
    const home = placeOnFoundation(s, BUILDINGS.barn, "b").buildings[1];
    expect(home.scale).toBe(4);
    expect(storageOf(home)).toBe(4 * storageOf({ template: "barn" }));
    expect(home.labor).toBe(4 * BUILDINGS.barn.labor);
    const house5 = { ...foundationBuilding(BUILDINGS.izba5, big, [10, 46], 1, 0), state: "active" as const };
    expect(house5.scale).toBe(Math.round((480 / (11 * 13)) * 100) / 100);
    expect(homesOf(house5)).toBe(Math.round(2 * house5.scale!));
    expect(vacantHouses({ 1: house5 }, {})).toEqual(Array(homesOf(house5)).fill(1));
    expect(familyCapacity(house5)).toBe(Math.floor(houseCapacity(house5) / homesOf(house5)));
  });

  it("a barn or a market takes a foundation of any size; others keep their cap", () => {
    const huge = found("x", rect(0, 46, 60, 55)); // 3300 m²
    const s = mk([huge]);
    expect(canPlaceOnFoundation(s, BUILDINGS.school, "x")).toMatchObject({ ok: false, reason: "Фундамент велик для этой постройки (3300 м²)" });
    for (const t of [BUILDINGS.barn, BUILDINGS.market]) {
      expect(canPlaceOnFoundation(s, t, "x").ok).toBe(true);
      const b = placeOnFoundation(s, t, "x").buildings[1];
      const k = Math.round((3300 / (t.along * t.deep)) * 100) / 100;
      expect(b.scale).toBe(k);
      expect(b.labor).toBe(Math.round(t.labor * k));
      const back = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: placeOnFoundation(s, t, "x") })), NOW + 1)!;
      expect(back.sim.buildings[1].scale).toBe(k);
    }
    expect(storageOf(placeOnFoundation(s, BUILDINGS.barn, "x").buildings[1])).toBe(Math.round((3300 / 120) * 100) / 100 * storageOf({ template: "barn" }));
    // Zone growth leaves such a foundation alone: no grown template fits it.
    expect(foundationLots(mk([huge], "res"), "res")).toEqual([]);
  });

  it("the footprint keeps the old ring's shape and never crosses itself", () => {
    // A comb: a 4 m spine along y = 0..4 with 10 teeth 2 m wide and 20 m long, 2 m apart (42 points, counter-clockwise).
    const comb: Pt[] = [[0, 0], [40, 0]];
    for (let i = 9; i >= 0; i--) comb.push([4 * i + 4, 24], [4 * i + 2, 24], [4 * i + 2, 4], [4 * i, 4]);
    expect(lotRing({ ring: comb })).toEqual(comb); // under the cap: the walls follow the ring exactly
    const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    for (const max of [24, 12, 6]) {
      const r = simplifyRing(comb, max);
      const e = r.map((p, i): [Pt, Pt] => [p, r[(i + 1) % r.length]]);
      for (let i = 0; i < e.length; i++)
        for (let j = i + 2; j < e.length; j++) {
          if (i === 0 && j === e.length - 1) continue;
          const [a, b] = e[i], [c, d] = e[j];
          expect(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0).toBe(false);
        }
    }
  });

  it("a notable old building is no lot", () => {
    const s = mk([found("c", rect(0, 46, 8, 10), { cls: "castle" })], "res");
    expect(foundationLots(s, "res")).toEqual([]);
    expect(canPlaceOnFoundation(s, BUILDINGS.healer, "c").ok).toBe(false);
  });

  it("round-trips a building on a foundation", () => {
    const s = spawnBuildings(mk([house], "res"));
    const back = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: s })), NOW + 1)!;
    const b = back.sim.buildings[1];
    expect(b).toMatchObject({ foundationId: "h", scale: s.buildings[1].scale, door: s.buildings[1].door, materials: s.buildings[1].materials, lot: s.buildings[1].lot });
  });
});
