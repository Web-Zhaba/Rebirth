import { describe, expect, it } from "vitest";
import { finishAll } from "./admin";
import { allocateLabor, BUILDINGS } from "./buildings";
import { canPlace, emptyGrowth, reconcile, releaseSites } from "./growth";
import { addRoad, emptyRoads } from "./roads";
import { applyStroke, cancelPlans, newRoadEdges, planStroke, roadSpans, strokeTemplate, type StrokeSpan } from "./stroke";
import { allResearched } from "./tech";
import type { FoundFoundation, RoadGraph, SimState } from "./types";
import { emptyZones, regenerateCells } from "./zones";

// Building in strokes: foundations along the road first, outlines dug first, lots in the gaps.

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const area = (r: Pt[]) => Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;
const fnd = (id: string, ring: Pt[], extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring, area: area(ring), digId: 1, at: 0, ...extra });

// A built road along y = 40 from x = -200 to 200: metres along it are x + 200, side 1 is y > 40.
const builtRoad = (): RoadGraph => {
  const r = addRoad(emptyRoads(), [[-200, 40], [200, 40]], "dirt", 1, [10]);
  if (!r.ok) throw new Error(r.reason);
  for (const e of Object.values(r.graph.edges)) e.done = e.labor;
  return r.graph;
};

const mk = (foundations: FoundFoundation[] = [], techs = allResearched().techs): SimState => {
  const roads = builtRoad();
  const cells = regenerateCells(roads, [], {}).map((c) => ({ ...c, block: c.block === "pending" ? null : c.block }));
  return {
    realTime: 0,
    gameMinutes: 1000,
    roads,
    zones: { ...emptyZones(), cells },
    ...emptyGrowth(1),
    progress: { ...allResearched(), techs },
    articles: [],
    finds: { foundations, pois: [], streets: [], revealed: [{ digId: 1, x: 0, y: 40, r: 150 }], features: [], fates: {} },
  } as SimState;
};

const edgeOf = (s: SimState) => Number(Object.keys(s.roads.edges)[0]);
const span = (s: SimState, x0: number, x1: number, side: 1 | -1 = 1): StrokeSpan => ({ edge: edgeOf(s), side, from: x0 + 200, to: x1 + 200 });
const xs = (s: SimState, plan: ReturnType<typeof planStroke>) => plan.items.map((it) => Math.round(it.building.lot.cx));

describe("a stroke", () => {
  it("lays only the templates zones grew", () => {
    expect(strokeTemplate("izba")?.id).toBe("izba");
    expect(strokeTemplate("smithy")?.id).toBe("smithy");
    expect(strokeTemplate("well")).toBeNull();
    expect(strokeTemplate("nope")).toBeNull();
  });

  it("fills the road with lots side by side, in the direction it was drawn", () => {
    const s = mk();
    const fwd = planStroke(s, BUILDINGS.izba, [span(s, -100, -20)]);
    expect(fwd.items.length).toBe(5); // 80 m, 16 m a house
    expect(fwd.items.every((it) => it.kind === "lot" && it.building.template === "izba")).toBe(true);
    const at = xs(s, fwd);
    expect(at).toEqual([...at].sort((p, q) => p - q));
    const back = planStroke(s, BUILDINGS.izba, [span(s, -20, -100)]);
    expect(xs(s, back)).toEqual([...xs(s, back)].sort((p, q) => q - p));
  });

  it("places what it planned: houses on their lots, kept while their road stands", () => {
    const s = mk();
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -100, -20), span(s, -100, -20, -1)]);
    const r = applyStroke(s, plan.items);
    expect(r.placed).toBe(plan.items.length);
    const built = Object.values(r.sim.buildings);
    expect(built.length).toBe(10);
    expect(built.every((b) => b.zone === "res" && b.state === "planned")).toBe(true);
    // ids follow the stroke: the build queue takes them in that order
    expect(built.map((b) => b.id)).toEqual(built.map((_, i) => i + 1));
    expect(reconcile(r.sim.buildings, r.sim.roads)).toBe(r.sim.buildings);
    // the ground is taken: a second stroke over it plans nothing
    expect(planStroke(r.sim, BUILDINGS.izba, [span(s, -100, -20)]).items).toEqual([]);
  });

  it("takes the foundations along it first, at their full ring, and keeps the lots off them", () => {
    const s = mk([fnd("old", rect(-4, 46, 12, 12)), fnd("far", rect(-4, 120, 12, 12)), fnd("other", rect(-4, 22, 12, 12))]);
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -40, 40)]);
    const old = plan.items.find((it) => it.key === "f:old")!;
    expect(old).toMatchObject({ kind: "foundation", foundationId: "old" });
    expect(old.building.footprint.length).toBeGreaterThanOrEqual(4);
    expect(plan.items.some((it) => it.key === "f:far" || it.key === "f:other")).toBe(false); // out of reach / other side
    const at = xs(s, plan);
    expect(at).toEqual([...at].sort((p, q) => p - q)); // the foundation sits in stroke order among the lots
    const r = applyStroke(s, plan.items);
    expect(r.placed).toBe(plan.items.length);
    for (const it of plan.items.filter((x) => x.kind === "lot"))
      if (it.kind === "lot") expect(canPlace(r.sim, BUILDINGS.izba, it.edge, it.side, it.i, { forest: 0, water: 0, rock: 0 }).ok).toBe(false);
  });

  it("with only foundations wanted leaves the gaps empty", () => {
    const s = mk([fnd("old", rect(-4, 46, 12, 12))]);
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -40, 40)], true);
    expect(plan.items.map((it) => it.key)).toEqual(["f:old"]);
  });

  it("leaves foundations of another purpose, notable sites and those too large, each with its reason", () => {
    const s = mk(
      [
        fnd("shop", rect(-60, 46, 10, 10), { cls: "shop" }),
        fnd("church", rect(-20, 46, 12, 16), { cls: "place_of_worship", name: "Церковь Покрова" }),
        fnd("big", rect(20, 46, 20, 20)),
      ],
      [],
    );
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -80, 80)], true);
    expect(plan.items).toEqual([]);
    const why = Object.fromEntries(plan.skipped.map((k) => [k.foundationId, k.reason]));
    expect(why.shop).toMatch(/^Прежде здесь/);
    expect(why.church).toBe("Церковь Покрова: восстанавливается из карточки места");
    expect(why.big).toMatch(/^Фундамент велик для этого \(400 м²\)/);
  });

  it("brings a foundation of the same class back as it was", () => {
    const s = mk([fnd("shop", rect(-4, 46, 10, 10), { cls: "shop" })]);
    const plan = planStroke(s, BUILDINGS.tavern, [span(s, -40, 40)], true);
    expect(plan.items[0].building).toMatchObject({ template: "shop", asItWas: true });
  });

  it("digs an outline first and builds on it once dug", () => {
    const s = mk([fnd("h", rect(-4, 46, 10, 10), { ghost: true })]);
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -40, 40)]);
    const dig = plan.items.find((it) => it.key === "f:h")!;
    expect(dig).toMatchObject({ kind: "dig", building: { template: "izba", foundationId: "h" } });
    const r = applyStroke(s, plan.items);
    const site = Object.values(r.sim.buildings).find((b) => b.template === "excavation")!;
    expect(site).toMatchObject({ foundationId: "h", then: "izba" });
    // no lot was laid over the outline
    expect(Object.values(r.sim.buildings).filter((b) => b.template === "izba" && !b.foundationId).every((b) => Math.abs(b.lot.cx - 1) >= 8)).toBe(true);
    const done = finishAll(r.sim);
    expect(Object.values(done.buildings).some((b) => b.template === "izba" && b.foundationId === "h")).toBe(true);
  });

  it("along a road not built yet, lays sites that wait for it", () => {
    const s = mk([fnd("old", rect(-4, 46, 12, 12))]);
    const e = s.roads.edges[edgeOf(s)];
    const raw = { ...s, roads: { ...s.roads, edges: { ...s.roads.edges, [e.id]: { ...e, done: 0 } } } };
    const plan = planStroke(raw, BUILDINGS.izba, [span(s, -40, 40)]);
    expect(plan.items.length).toBeGreaterThan(1);
    expect(plan.items.every((it) => it.building.awaitsRoad === true)).toBe(true); // the lots and the foundation alike
    const laid = applyStroke(raw, plan.items).sim;
    const sites = Object.values(laid.buildings);
    expect(sites.every((b) => b.awaitsRoad)).toBe(true);
    expect([...allocateLabor(laid.buildings, 100, 6)]).toEqual([]); // nobody works on them
    expect(releaseSites(laid.buildings, laid.roads)).toBe(laid.buildings);
    const open = releaseSites(laid.buildings, s.roads); // the road is built
    expect(Object.values(open).some((b) => b.awaitsRoad)).toBe(false);
    expect([...allocateLabor(open, 100, 6)].length).toBeGreaterThan(0);
    // along a built road a site does not wait
    expect(Object.values(applyStroke(s, planStroke(s, BUILDINGS.izba, [span(s, -40, 40)]).items).sim.buildings).some((b) => b.awaitsRoad)).toBe(false);
  });

  it("a road with houses takes the edges it added, not the pieces of one it split", () => {
    const s = mk();
    const cross: [number, number][] = [[0, -60], [0, 120]];
    const r = addRoad(s.roads, cross, "dirt", 1, [10]);
    if (!r.ok) throw new Error(r.reason);
    const fresh = newRoadEdges(s.roads, r.graph);
    expect(fresh.length).toBe(2); // the crossing road, cut at the old one
    for (const id of fresh) {
      const e = r.graph.edges[id];
      expect(Math.abs(r.graph.nodes[e.a].x) + Math.abs(r.graph.nodes[e.b].x)).toBeLessThan(1e-6);
    }
    expect(roadSpans(r.graph, fresh)).toHaveLength(4); // both sides of each
  });

  it("is undone while nobody has started on it: a restoration no longer under way, started ones kept", () => {
    const s = mk([fnd("shop", rect(-4, 46, 10, 10), { cls: "shop" })]);
    const r = applyStroke(s, planStroke(s, BUILDINGS.shop, [span(s, -60, 40)]).items);
    const ids = Object.keys(r.sim.buildings).map(Number);
    expect(r.sim.finds.foundations[0].state).toBe("restoring");
    const started = ids[0];
    const sim = { ...r.sim, buildings: { ...r.sim.buildings, [started]: { ...r.sim.buildings[started], state: "building" as const, done: 1, paid: true } } };
    const back = cancelPlans(sim, ids);
    expect(back.removed).toBe(ids.length - 1);
    expect(Object.keys(back.sim.buildings).map(Number)).toEqual([started]);
    expect(back.sim.finds.foundations[0].state).toBe(r.sim.buildings[started].foundationId ? "restoring" : undefined);
    expect(cancelPlans(back.sim, ids).removed).toBe(0);
  });
});
