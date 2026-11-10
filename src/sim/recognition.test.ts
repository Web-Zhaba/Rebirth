import { describe, expect, it } from "vitest";
import { finishAll } from "./admin";
import { BUILDINGS } from "./buildings";
import { recordFinds } from "./excavation";
import { canPlaceOnFoundation, emptyGrowth, placeOnFoundation, spawnBuildings } from "./growth";
import { tierContext, tierOf, TYPICAL_SHARE, restoreWeightOf, scarcity } from "./heritage";
import { finishedMonuments, monumentMoodAt } from "./monuments";
import { digShares, districtMood, recognise, RECOGNITION, stepsOf } from "./recognition";
import { addRoad, emptyRoads } from "./roads";
import { lineCovered, restoreStreets, streetFoundations, streetProgress } from "./streets";
import { allResearched } from "./tech";
import type { FoundFoundation, FoundPlace, ProgressState, RoadGraph, SimState, StoredArticle } from "./types";
import { emptyZones, regenerateCells } from "./zones";
import { placesView } from "../ui/placesModel";

// Tiers of old buildings, recognisability of a dig and streets restored in full (docs/PLAN-restoration.md sections 3, 4).

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const area = (r: Pt[]) => Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;
const found = (id: string, ring: Pt[], extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring, area: area(ring), digId: 1, at: 0, ...extra });
const place = (id: string, name: string, digId = 1): FoundPlace => ({ id, name, kind: "shop", digId, at: 0 });
const article = (title: string): StoredArticle => ({ id: `ru:${title}`, title, extract: "", url: "", lang: "ru", lat: 0, lng: 0, at: 0 });

// A built road along y = 40.
const builtRoad = (): RoadGraph => {
  const r = addRoad(emptyRoads(), [[-200, 40], [200, 40]], "dirt", 1, [10]);
  if (!r.ok) throw new Error(r.reason);
  for (const e of Object.values(r.graph.edges)) e.done = e.labor;
  return r.graph;
};

const mk = (foundations: FoundFoundation[], extra: Partial<SimState> = {}, progress: ProgressState = allResearched()): SimState =>
  ({
    realTime: 0,
    gameMinutes: 1000,
    roads: builtRoad(),
    zones: emptyZones(),
    ...emptyGrowth(1),
    progress,
    articles: [],
    finds: { foundations, pois: [], streets: [], revealed: [{ digId: 1, x: 0, y: 40, r: 150 }] },
    ...extra,
  }) as SimState;

const put = (s: SimState, id: string, template: string): SimState => {
  const ok = canPlaceOnFoundation(s, BUILDINGS[template], id);
  if (!ok.ok) throw new Error(ok.reason);
  return placeOnFoundation(s, BUILDINGS[template], id);
};

describe("tiers", () => {
  const ctx = (names: string[], titles: string[] = []) => tierContext({ pois: names.map((n, i) => place(`p${i}`, n)) }, titles.map(article));
  it("ordinary without a kind, typical for typical kinds, nameless or repeated names", () => {
    expect(tierOf({}, ctx([]))).toBe("ordinary");
    expect(tierOf({ cls: "shop", name: "Лавка" }, ctx(["Лавка"]))).toBe("typical");
    expect(tierOf({ cls: "place_of_worship" }, ctx([]))).toBe("typical"); // a nameless building is never unique
    expect(tierOf({ cls: "school", name: "Школа №1" }, ctx(["Школа №1"]))).toBe("unique");
    expect(tierOf({ cls: "school", name: "Школа" }, ctx(["Школа", "школа"]))).toBe("typical"); // the name repeats: a chain
  });
  it("an article with the building's name is the strongest sign", () => {
    expect(tierOf({ cls: "place_of_worship", name: "Церковь Покрова" }, ctx(["Церковь Покрова", "Церковь Покрова"], ["церковь покрова"]))).toBe("unique");
  });
});

describe("rewards by tier", () => {
  it("a typical building as it was adds a quarter, no idea, no chronicle chapter, no monument", () => {
    const shop = found("s", rect(0, 0, 10, 30), { cls: "pharmacy", name: "Аптека" });
    const s = finishAll(put(mk([shop]), "s", "healer"));
    const b = s.buildings[1];
    expect(b).toMatchObject({ asItWas: true });
    expect(b.landmark).toBeUndefined();
    expect(s.progress.restored.care).toBe(Math.round(restoreWeightOf(scarcity(s.finds)) * TYPICAL_SHARE * 100) / 100);
    expect(s.chronicle.some((c) => c.kind === "heritage:s")).toBe(false);
    expect(finishedMonuments(s.buildings)).toHaveLength(0);
  });
  it("a unique one is a landmark: it works as a monument and the best monument in reach counts, not the sum", () => {
    const church = found("c", rect(0, 0, 12, 20), { cls: "place_of_worship", name: "Церковь Покрова" });
    const plain = found("m", rect(40, 0, 10, 10));
    let s = finishAll(put(mk([church, plain], { finds: { foundations: [church, plain], pois: [place("p", "Церковь Покрова")], streets: [], revealed: [{ digId: 1, x: 0, y: 40, r: 150 }] } }), "c", "chapel"));
    expect(s.buildings[1].landmark).toBe(true);
    expect(s.chronicle.some((c) => c.kind === "heritage:c")).toBe(true);
    s = finishAll(put(s, "m", "restored"));
    const ms = finishedMonuments(s.buildings);
    expect(ms).toHaveLength(2);
    expect(monumentMoodAt(ms, 20, 50)).toBe(2); // the landmark, not 1 + 2
    expect(monumentMoodAt(ms.filter((m) => !m.landmark), 20, 50)).toBe(1);
    expect(monumentMoodAt(ms, 2000, 50)).toBe(0);
  });
  it("zone growth brings a typical workshop back as it was", () => {
    const shop = found("s", rect(0, 46, 10, 12), { cls: "car_repair", name: "Мастерская" });
    const roads = builtRoad();
    const cells = regenerateCells(roads, [], [], {}).map((c) => ({ ...c, block: null, zone: "craft" as const }));
    const s = mk([shop], { roads, zones: { ...emptyZones(), cells }, lastSpawn: { res: -1000, craft: -1000, trade: -1000 } });
    const grown = spawnBuildings(s);
    const b = Object.values(grown.buildings).find((x) => x.foundationId === "s");
    expect(b).toBeDefined();
    if (!b) return;
    expect(b.template).toBe("smithy"); // not any other workshop of the zone
    expect(b.asItWas).toBe(true);
    expect(grown.finds.foundations[0].state).toBe("restoring");
  });
});

describe("recognisability", () => {
  const four = [found("a", rect(-100, 0, 10, 10)), found("b", rect(-60, 0, 10, 10)), found("c", rect(-20, 0, 10, 10)), found("d", rect(20, 0, 10, 10)), found("tiny", rect(60, 0, 3, 3))];
  it("is the share of the dig's foundations, by area, carrying a finished building", () => {
    let s = mk(four);
    expect(digShares(s).get(1)).toMatchObject({ total: 400, restored: 0, share: 0 }); // a shed is no foundation of the place
    s = put(s, "a", "barn");
    expect(digShares(s).get(1)!.share).toBe(0); // planned is not restored
    s = finishAll(s);
    expect(digShares(s).get(1)!.share).toBe(0.25);
    expect([0, 0.24, 0.25, 0.5, 0.99, 1].map(stepsOf)).toEqual([0, 0, 1, 2, 3, 4]);
  });
  it("each quarter brings its reward once, and they stay", () => {
    let s = finishAll(put(mk(four, {}, { ...allResearched(), insights: [] }), "a", "barn"));
    s = recognise(s);
    expect(s.progress.recognised).toEqual({ 1: 1 });
    expect(s.chronicle.some((c) => c.kind === "recognised:1:1")).toBe(true);
    expect(districtMood(s.progress, s.finds, 0, 40)).toBe(RECOGNITION.mood[1]);
    expect(districtMood(s.progress, s.finds, 0, 400)).toBe(0); // outside the dig's disc
    expect(recognise(s)).toBe(s); // nothing new: the same state
    for (const id of ["b", "c", "d"]) s = finishAll(put(s, id, "barn"));
    s = recognise(s);
    expect(s.progress.recognised).toEqual({ 1: 4 });
    expect(["recognised:1:2", "recognised:1:3", "recognised:1:4"].every((k) => s.chronicle.some((c) => c.kind === k))).toBe(true);
    expect(districtMood(s.progress, s.finds, 0, 40)).toBe(RECOGNITION.mood[4]);
    const gone = recognise({ ...s, buildings: {} }); // demolished later: the rewards stay
    expect(gone.progress.recognised).toEqual({ 1: 4 });
    expect(placesView(s).places[0]).toMatchObject({ digId: 1, share: 1, steps: 4, next: null });
  });
});

describe("streets restored in full", () => {
  const street: FoundPlace = { id: "st", name: "Садовая", kind: "street", digId: 1, at: 0, lines: [[[-150, 40], [150, 40]]] };
  const houses = [found("h1", rect(-100, 46, 10, 10)), found("h2", rect(0, 46, 10, 10)), found("far", rect(0, 120, 10, 10))];
  const withStreet = (s: SimState): SimState => ({ ...s, finds: { ...s.finds, streets: [street] } });
  it("own the foundations by their line; the road covers the old line", () => {
    const own = streetFoundations([street], houses);
    expect(own.get("st")!.map((f) => f.id)).toEqual(["h1", "h2"]);
    expect(lineCovered(street.lines!, builtRoad())).toBe(1);
    expect(lineCovered(street.lines!, emptyRoads())).toBe(0);
  });
  it("gets its name back once all its houses stand on their foundations", () => {
    let s = withStreet(mk(houses));
    expect(streetProgress(s, street)).toEqual({ houses: 2, built: 0, road: 1 });
    s = finishAll(put(s, "h1", "barn"));
    expect(restoreStreets(s)).toBe(s);
    s = finishAll(put(s, "h2", "barn"));
    const done = restoreStreets(s);
    expect(done.finds.streets[0].restored).toBe(s.gameMinutes);
    expect(done.chronicle.some((c) => c.kind === "street:st")).toBe(true);
    expect(restoreStreets(done)).toBe(done);
    expect(placesView(done).streets[0]).toMatchObject({ name: "Садовая", restored: true });
  });
  it("the dig records a street's line and keeps the longer one", () => {
    const s = mk([]);
    const r1 = recordFinds(s, { digId: 1, foundations: [], pois: [], streets: [{ id: "x", name: "Садовая", lines: [[[0, 0], [50, 0]]] }] });
    if (!r1.ok) throw new Error(r1.reason);
    expect(r1.sim.finds.streets[0].lines).toEqual([[[0, 0], [50, 0]]]);
    const r2 = recordFinds(r1.sim, { digId: 1, foundations: [], pois: [], streets: [{ id: "y", name: "Садовая", lines: [[[0, 0], [120, 0]]] }] });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.sim.finds.streets).toHaveLength(1);
    expect(r2.sim.finds.streets[0].lines).toEqual([[[0, 0], [120, 0]]]);
    const bad = recordFinds(s, { digId: 1, foundations: [], pois: [], streets: [{ id: "z", name: "Б", lines: [[[0, 0]]] }] });
    expect(bad.ok).toBe(false);
  });
});
