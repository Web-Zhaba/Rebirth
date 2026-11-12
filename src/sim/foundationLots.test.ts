import { describe, expect, it } from "vitest";
import { BUILDINGS, familyCapacity, FLOOR, floorArea, floorsOf, homesOf, houseCapacity, maxLevel, scaledJobs, storageOf, upgradable, upgradeLabor } from "./buildings";
import { dailyServices } from "./coverage";
import { floorBlocker, FOUNDATION_TAKEN, foundationBuilding, lotCheck, lotRing, sizeLimit } from "./foundationLots";
import { simplifyRing } from "./heritageGeo";
import { advanceBuildings, canPlace, canPlaceOnFoundation, emptyGrowth, placeOnFoundation } from "./growth";
import { heatShares, HEAT_AREA } from "./production";
import { parseSave } from "./save";
import { addRoad, emptyRoads } from "./roads";
import { applyStroke, planStroke } from "./stroke";
import { allResearched, initialProgress } from "./tech";
import type { City, FoundFoundation, ProgressState, RoadGraph, SimState } from "./types";
import { firewoodDaily } from "./weatherEffects";
import { emptyZones, regenerateCells } from "./zones";

// Old foundations set the building: the ring at full size, the floors of the old
// building, limits by purpose and technology, capacity and heating by the floor area.

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

const mk = (foundations: FoundFoundation[], progress: ProgressState = allResearched()): SimState => {
  const roads = builtRoad();
  const cells = regenerateCells(roads, [], {}).map((c) => ({ ...c, block: null }));
  return {
    realTime: NOW,
    gameMinutes: 1000,
    roads,
    zones: { ...emptyZones(), cells },
    ...emptyGrowth(1),
    residents: {},
    households: {},
    progress,
    finds: { foundations, pois: [], streets: [], revealed: [{ digId: 1, x: 0, y: 0, r: 120 }], features: [], fates: {} },
  } as SimState;
};
const bare = (): ProgressState => ({ ...initialProgress(), techs: [] });
// A stroke of `template` along the whole north side of the road, foundations only, and the town with it laid.
const plan = (s: SimState, template = "izba") => planStroke(s, BUILDINGS[template], [{ edge: Number(Object.keys(s.roads.edges)[0]), side: 1, from: 0, to: 400 }], true);
const grow = (s: SimState): SimState => applyStroke(s, plan(s).items).sim;

const NO_SITE = { forest: 0, water: 0, rock: 0 };
const house = found("h", rect(0, 46, 8, 10)); // 80 m², 6 m from the road

describe("foundations as lots", () => {
  it("a stroke of houses builds on the foundation along it, in the foundation's shape, at full size", () => {
    const s = mk([house]);
    expect(plan(s).items.map((it) => it.key)).toEqual(["f:h"]);
    const grown = grow(s);
    const b = Object.values(grown.buildings)[0];
    expect(b.foundationId).toBe("h");
    expect(b.footprint).toEqual(lotRing(house));
    const t = BUILDINGS[b.template];
    expect(t.zone).toBe("res");
    const k = Math.round((house.area / (t.along * t.deep)) * 100) / 100;
    expect(b).toMatchObject({ scale: k, level: 1, floors: 1 });
    // its cost and its families follow the floor area: a family per 50 m²
    expect(b.labor).toBe(Math.max(1, Math.round(t.labor * k)));
    expect(homesOf(b)).toBe(2); // 80 m²
    expect(houseCapacity(b)).toBe(2 * familyCapacity(b));
    expect(maxLevel(b)).toBe(1); // the old building had one floor
    expect(b.door![1]).toBeCloseTo(46, 5); // the wall facing the road
    expect(plan(grown).items).toEqual([]); // built on, it is no longer free
  });

  it("regular lots keep off a free foundation", () => {
    const s = mk([house]);
    const over = s.zones.cells.find((c) => c.depth === 0 && Math.abs(c.cx - 4) < 4 && c.cy > 40)!;
    expect(canPlace(s, BUILDINGS.well, over.edge, over.side, over.i, NO_SITE)).toEqual({ ok: false, reason: FOUNDATION_TAKEN });
    // A shed too small to be a lot does not reserve its ground.
    const shed = mk([found("s", rect(0, 46, 4, 4))]);
    expect(canPlace(shed, BUILDINGS.well, over.edge, over.side, over.i, NO_SITE).ok).toBe(true);
  });

  it("the player puts any purpose on a foundation; demolishing it frees the foundation", () => {
    const s = mk([house, found("far", rect(0, 200, 8, 10)), found("crossed", rect(-50, 35, 8, 10))]);
    expect(canPlaceOnFoundation(s, BUILDINGS.garden, "h").ok).toBe(false);
    expect(canPlaceOnFoundation(s, BUILDINGS.healer, "far")).toMatchObject({ ok: false, reason: "Нужна построенная дорога рядом" });
    expect(canPlaceOnFoundation(s, BUILDINGS.healer, "crossed")).toMatchObject({ ok: false, reason: "Через фундамент проходит дорога" });
    // an old street's verge may touch the old walls: only its axis over the ring blocks it
    expect(canPlaceOnFoundation(mk([found("verge", rect(-120, 41.5, 8, 10))]), BUILDINGS.healer, "verge").ok).toBe(true);
    expect(canPlaceOnFoundation(s, BUILDINGS.well, "h").ok).toBe(false); // open ground
    expect(canPlaceOnFoundation(s, BUILDINGS.market, "h").ok).toBe(true); // no size is too small
    expect(canPlaceOnFoundation(s, BUILDINGS.barn, "h").ok).toBe(true);
    expect(lotCheck(s, house, BUILDINGS.woodcutter).ok).toBe(false);
    const placed = placeOnFoundation(s, BUILDINGS.healer, "h");
    const b = placed.buildings[1];
    expect(b).toMatchObject({ template: "healer", foundationId: "h", scale: 1.25, labor: Math.round(BUILDINGS.healer.labor * 1.25), state: "planned" });
    expect(canPlaceOnFoundation(placed, BUILDINGS.school, "h")).toMatchObject({ ok: false, reason: "Место занято зданием" });
    const rest = { ...placed.buildings };
    delete rest[1];
    expect(canPlaceOnFoundation({ ...placed, buildings: rest }, BUILDINGS.school, "h").ok).toBe(true);
  });

  it("a big foundation makes a big building: jobs by the square root, storage and cost by the floor area", () => {
    const big = found("b", rect(0, 46, 20, 24)); // 480 m²
    const s = mk([big]);
    const barn = placeOnFoundation(s, BUILDINGS.barn, "b").buildings[1];
    expect(barn.scale).toBe(4);
    expect(storageOf(barn)).toBe(4 * storageOf({ template: "barn", level: 1 }));
    expect(barn.labor).toBe(4 * BUILDINGS.barn.labor);
    const shop = foundationBuilding(BUILDINGS.carpentry, big, [10, 46], 1, 0, allResearched());
    expect(scaledJobs(BUILDINGS.carpentry.jobs, shop)).toBe(Math.round(8 * Math.sqrt(shop.scale!)));
    expect(scaledJobs(BUILDINGS.carpentry.jobs, { ...shop, scale: 40 })).toBe(8 * FLOOR.jobsCap); // one huge workshop does not take everyone
    const back = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: placeOnFoundation(s, BUILDINGS.barn, "b") })), NOW + 1)!;
    expect(back.sim.buildings[1].scale).toBe(4);
  });

  it("limits the size by purpose and technology; the limit is a goal, not an error", () => {
    const hall = found("x", rect(0, 46, 20, 20)); // 400 m²
    expect(sizeLimit(bare(), BUILDINGS.izba)).toEqual({ area: 250, floors: 1 });
    expect(sizeLimit({ techs: ["housing"] }, BUILDINGS.izba)).toEqual({ area: 400, floors: 2 });
    expect(sizeLimit({ techs: ["housing", "stonework"] }, BUILDINGS.izba)).toEqual({ area: 1000, floors: 3 });
    expect(sizeLimit({ techs: ["trusses"] }, BUILDINGS.izba)).toEqual({ area: Infinity, floors: 5 });
    expect(sizeLimit(bare(), BUILDINGS.barn)).toEqual({ area: Infinity, floors: 1 }); // unheated stores: any size, wooden
    expect(sizeLimit({ techs: ["stonework"] }, BUILDINGS.school)).toEqual({ area: 1000, floors: 1 }); // a hall in stone
    const s = mk([hall], bare());
    expect(canPlaceOnFoundation(s, BUILDINGS.healer, "x")).toMatchObject({ ok: false, reason: "Фундамент велик для этого (400 м²): нужна «Просторное жильё»" });
    expect(canPlaceOnFoundation(s, BUILDINGS.barn, "x").ok).toBe(true);
    // a stroke of houses leaves it alone until the technology allows it; regular lots still keep off it
    expect(plan(mk([hall], bare())).items).toEqual([]);
    expect(plan(mk([hall], { ...bare(), techs: ["housing"] })).items.map((it) => it.key)).toEqual(["f:x"]);
  });

  it("floors come from the old height; those the technology does not allow yet are added later", () => {
    expect([undefined, 0, 4, 5, 8, 11, 15, 19].map((h) => floorsOf(h))).toEqual([1, 1, 1, 1, 2, 3, 4, 5]); // tiles: levels x 3.66, 5 m when unknown
    const block = found("k", rect(0, 46, 15, 16), { height: 11 }); // 240 m², three floors
    const early: ProgressState = { ...bare(), techs: ["housing"] };
    const b = foundationBuilding(BUILDINGS.izba, block, [7, 46], 1, 0, early);
    expect(b).toMatchObject({ level: 2, floors: 3 });
    expect(floorArea(b)).toBeCloseTo(480, 0);
    expect(homesOf(b)).toBe(10); // a family per 50 m² of the floors built
    expect(b.labor).toBe(Math.round(BUILDINGS.izba.labor * b.scale! * 2));
    expect(b.height).toBeCloseTo(BUILDINGS.izba.height + FLOOR.height, 5);
    const done = { ...b, state: "active" as const, done: b.labor, paid: true };
    expect(upgradable(done)).toBe(true);
    expect(floorBlocker(early, done)).toBe("следующий этаж — с технологией «Работа с камнем»");
    expect(floorBlocker({ techs: ["housing", "stonework"] }, done)).toBeNull();
    // a floor costs the ring once; finished, it adds a floor of height and its families
    expect(upgradeLabor(done)).toBe(Math.round(BUILDINGS.izba.labor * b.scale!));
    const raised = advanceBuildings({ 1: { ...done, upgrade: { labor: upgradeLabor(done), done: 0, paid: true } } }, 1e6)[1];
    expect(raised.level).toBe(3);
    expect(raised.height).toBeCloseTo(BUILDINGS.izba.height + 2 * FLOOR.height, 5);
    expect(homesOf(raised)).toBe(14);
    expect(upgradable(raised)).toBe(false); // the old height is reached
  });

  it("a workplace on a foundation regains its floors as soon as the technology allows", () => {
    const shop = found("w", rect(0, 46, 10, 10), { height: 8 }); // two floors
    const placed = placeOnFoundation(mk([shop], bare()), BUILDINGS.healer, "w");
    const b = { ...placed.buildings[1], state: "active" as const, done: placed.buildings[1].labor, paid: true };
    expect(b.level).toBe(1);
    expect(dailyServices({ ...placed, buildings: { 1: b } }).buildings[1].upgrade).toBeUndefined();
    const open = dailyServices({ ...placed, buildings: { 1: b }, progress: { ...placed.progress, techs: ["housing"] } });
    expect(open.buildings[1].upgrade).toMatchObject({ labor: upgradeLabor(b), done: 0 });
  });

  it("heats a house by its floor area, only while somebody lives in it", () => {
    const s = grow(mk([found("b", rect(0, 46, 20, 12))])); // 240 m²
    const b = { ...s.buildings[1], state: "active" as const, done: s.buildings[1].labor };
    const [h1, h2] = Object.values(emptyGrowth(1).households);
    const weather = { ...s.weather, site: s.weather.site ?? ({ lat: 59 } as SimState["weather"]["site"]), yesterday: { ...s.weather.yesterday, min: -20, max: -10 } } as SimState["weather"];
    const wood = firewoodDaily(weather);
    expect(wood).toBeGreaterThan(0);
    const whole = (wood * floorArea(b)) / HEAT_AREA;
    expect(heatShares({ households: {}, buildings: { 1: b }, weather }).size).toBe(0); // an empty house burns nothing
    const one = heatShares({ households: { [h1.id]: { ...h1, home: 1 } }, buildings: { 1: b }, weather });
    {
      expect(one.get(h1.id)).toBeCloseTo(whole, 9); // one family pays the whole area
      const two = heatShares({ households: { [h1.id]: { ...h1, home: 1 }, [h2.id]: { ...h2, home: 1 } }, buildings: { 1: b }, weather });
      expect((two.get(h1.id) ?? 0) + (two.get(h2.id) ?? 0)).toBeCloseTo(whole, 9);
      expect(heatShares({ households: { [h1.id]: { ...h1, home: null } }, buildings: {}, weather }).get(h1.id)).toBeCloseTo(wood, 9); // a tent: one family's room
    }
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

  it("a notable old building is left out of a stroke", () => {
    const s = mk([found("c", rect(0, 46, 8, 10), { cls: "castle" })]);
    expect(plan(s).items).toEqual([]);
    expect(canPlaceOnFoundation(s, BUILDINGS.healer, "c").ok).toBe(true); // the player may still give it another purpose
  });

  it("a save from before floors keeps every family: a second floor where they no longer fit", () => {
    const s = grow(mk([found("t", rect(0, 46, 6, 6))])); // 36 m²: one family on one floor
    const b: Record<string, unknown> = { ...s.buildings[1], state: "active", done: s.buildings[1].labor, level: 2 };
    delete b.floors;
    const folk = emptyGrowth(1); // the founders
    const [h1, h2] = Object.values(folk.households);
    const households = { ...folk.households, [h1.id]: { ...h1, home: 1 }, [h2.id]: { ...h2, home: 1 } };
    const sim = { ...s, residents: folk.residents, households, nextPersonId: folk.nextPersonId, nextHouseholdId: folk.nextHouseholdId, buildings: { 1: b } };
    const back = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim })), NOW + 1)!;
    expect(back.sim.buildings[1].level).toBeGreaterThanOrEqual(2);
    expect(homesOf(back.sim.buildings[1])).toBeGreaterThanOrEqual(2);
    expect(Object.values(back.sim.households).filter((h) => h.home === 1)).toHaveLength(2);
  });

  it("round-trips a building on a foundation", () => {
    const s = grow(mk([house]));
    const back = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: s })), NOW + 1)!;
    const b = back.sim.buildings[1];
    expect(b).toMatchObject({ foundationId: "h", scale: s.buildings[1].scale, door: s.buildings[1].door, level: s.buildings[1].level, floors: s.buildings[1].floors, lot: s.buildings[1].lot });
    expect(b.materials).toEqual(s.buildings[1].materials);
  });
});
