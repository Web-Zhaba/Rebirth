import { describe, expect, it } from "vitest";
import { finishAll } from "./admin";
import { BUILDINGS } from "./buildings";
import { completeExcavations, orderDig, orderStreetDig, streetDigs, streetOf } from "./digging";
import { salvagedStone } from "./excavation";
import { canPlaceOnFoundation, emptyGrowth } from "./growth";
import { addRoad, emptyRoads } from "./roads";
import { allResearched } from "./tech";
import type { FoundFoundation, FoundPlace, RoadGraph, SimState } from "./types";
import { emptyZones } from "./zones";
import { buildOutlineView } from "../ui/heritageModel";

// Excavation in two stages (docs/PLAN-restoration.md section 5): the survey leaves ghost outlines, each dug on its own.

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const area = (r: Pt[]) => Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;
const ghost = (id: string, ring: Pt[], extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring, area: area(ring), digId: 1, at: 0, ghost: true, ...extra });

const builtRoad = (): RoadGraph => {
  const r = addRoad(emptyRoads(), [[-200, 40], [200, 40]], "dirt", 1, [10]);
  if (!r.ok) throw new Error(r.reason);
  for (const e of Object.values(r.graph.edges)) e.done = e.labor;
  return r.graph;
};

const mk = (foundations: FoundFoundation[], streets: FoundPlace[] = [], pois: FoundPlace[] = []): SimState =>
  ({ realTime: 0, gameMinutes: 1000, roads: builtRoad(), zones: emptyZones(), ...emptyGrowth(1), progress: allResearched(), articles: [], finds: { foundations, pois, streets, revealed: [{ digId: 1, x: 0, y: 40, r: 150 }], features: [], fates: {} } }) as SimState;

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  return r as Extract<T, { ok: true }>;
};

describe("an outline", () => {
  const house = ghost("h", rect(0, 46, 10, 10));
  it("cannot be built on until it is dug", () => {
    const s = mk([house]);
    expect(canPlaceOnFoundation(s, BUILDINGS.healer, "h")).toEqual({ ok: false, reason: "Это пока только контур: раскопайте фундамент" });
  });
  it("is dug by the artel as a site on its ring; finished, it opens, gives its stone and quietly, for an ordinary house", () => {
    const s0 = mk([house]);
    const s1 = ok(orderDig(s0, "h")).sim;
    const site = s1.buildings[1];
    expect(site).toMatchObject({ template: "excavation", foundationId: "h", state: "planned", labor: 8 }); // 100 m2
    expect(orderDig(s1, "h")).toEqual({ ok: false, reason: "Здесь уже копают" });
    const s2 = finishAll(s1);
    expect(s2.buildings[1]).toBeUndefined(); // the dig is gone
    expect(s2.finds.foundations[0].ghost).toBeUndefined();
    expect(s2.stock.stone - s1.stock.stone).toBeCloseTo(salvagedStone(100), 9);
    expect(s2.events.some((e) => e.kind === "discovery")).toBe(false);
    expect(canPlaceOnFoundation(s2, BUILDINGS.healer, "h").ok).toBe(true);
    expect(orderDig(s2, "h")).toEqual({ ok: false, reason: "Фундамент уже раскопан" });
  });
  it("a unique old building opens with a discovery: an event with its site, and a chronicle line", () => {
    const church = ghost("c", rect(0, 0, 12, 20), { cls: "place_of_worship", name: "Церковь Покрова" });
    const s = finishAll(ok(orderDig(mk([church], [], [{ id: "p", name: "Церковь Покрова", kind: "place_of_worship", digId: 1, at: 0 }]), "c")).sim);
    const e = s.events.find((x) => x.kind === "discovery")!;
    expect(e).toMatchObject({ site: "c", text: "Открыто: Церковь Покрова — культовое здание" });
    expect(e.pos).toBeDefined();
    expect(s.chronicle.some((c) => c.kind === "found:c")).toBe(true);
  });
  it("completes only finished digs", () => {
    const s = ok(orderDig(mk([house]), "h")).sim;
    expect(completeExcavations(s)).toBe(s);
  });
});

describe("a dug foundation's panel", () => {
  it("tells which purposes its size allows now and what lifts the limit", () => {
    const big = { id: "b", ring: rect(0, 46, 20, 20), area: 400, digId: 1, at: 0 } as FoundFoundation;
    const v = buildOutlineView(big, { ...mk([big]), progress: { ...allResearched(), techs: [] } });
    expect(v.limits.map((l) => [l.what, l.why])).toEqual([
      ["Жильё и мастерские", "Фундамент велик для этого (400 м²): нужна «Просторное жильё»"],
      ["Залы: храм, школа, ратуша, музей", "Фундамент велик для этого (400 м²): нужна «Работа с камнем»"],
      ["Склады и рынок", null],
    ]);
    expect(buildOutlineView({ ...big, ghost: true }, mk([big])).limits).toEqual([]);
  });
});

describe("a whole street", () => {
  const street: FoundPlace = { id: "st", name: "Садовая", kind: "street", digId: 1, at: 0, lines: [[[-150, 40], [150, 40]]] };
  const houses = [ghost("a", rect(-100, 46, 10, 10)), ghost("b", rect(0, 46, 10, 10)), ghost("c", rect(60, 46, 10, 10)), ghost("far", rect(0, 140, 10, 10))];
  it("orders every outline of the street in one go, skipping those under way", () => {
    let s = mk(houses, [street]);
    expect(streetOf(s, "a")).toEqual({ id: "st", name: "Садовая" });
    expect(streetOf(s, "far")).toBeNull();
    s = ok(orderDig(s, "b")).sim;
    expect(streetDigs(s, "st").map((f) => f.id)).toEqual(["a", "c"]);
    const r = ok(orderStreetDig(s, "st"));
    expect(r.count).toBe(2);
    expect(Object.values(r.sim.buildings).map((b) => b.foundationId).sort()).toEqual(["a", "b", "c"]);
    expect(orderStreetDig(r.sim, "st")).toEqual({ ok: false, reason: "На этой улице копать нечего" });
    expect(orderStreetDig(r.sim, "nope")).toEqual({ ok: false, reason: "Нет такой улицы" });
    const done = finishAll(r.sim);
    expect(done.finds.foundations.filter((f) => f.ghost).map((f) => f.id)).toEqual(["far"]);
  });
});
