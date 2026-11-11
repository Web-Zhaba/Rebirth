import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../sim/buildings";
import { emptyGrowth } from "../sim/growth";
import { addRoad, emptyRoads } from "../sim/roads";
import { planStroke } from "../sim/stroke";
import { allResearched } from "../sim/tech";
import type { FoundFoundation, RoadGraph, SimState } from "../sim/types";
import { emptyZones, regenerateCells } from "../sim/zones";
import { spansAlong, strokePad, strokeSummary } from "./strokeModel";

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// Two built roads meeting at a corner: x from -200 to 0 along y = 40, then y from 40 to 240 along x = 0.
const roads = (): RoadGraph => {
  const r = addRoad(emptyRoads(), [[-200, 40], [0, 40], [0, 240]], "dirt", 1, [10, 10]);
  if (!r.ok) throw new Error(r.reason);
  for (const e of Object.values(r.graph.edges)) e.done = e.labor;
  return r.graph;
};

const town = (foundations: FoundFoundation[] = []): SimState => {
  const g = roads();
  const cells = regenerateCells(g, [], {}).map((c) => ({ ...c, block: c.block === "pending" ? null : c.block }));
  return { realTime: 0, gameMinutes: 1000, roads: g, zones: { ...emptyZones(), cells }, ...emptyGrowth(1), progress: allResearched(), articles: [], finds: { foundations, pois: [], streets: [], revealed: [], features: [], fates: {} } } as SimState;
};

describe("a dragged path", () => {
  it("becomes one span per road edge and side, in the order it was drawn, padded at both ends", () => {
    const g = roads();
    const spans = spansAlong(g, [[-150, 46], [-50, 46]], 8);
    expect(spans.length).toBe(1);
    expect(spans[0]).toMatchObject({ side: 1 });
    expect(spans[0].from).toBeCloseTo(42, 6);
    expect(spans[0].to).toBeCloseTo(158, 6);
    const back = spansAlong(g, [[-50, 46], [-150, 46]], 8);
    expect(back[0].from).toBeGreaterThan(back[0].to);
  });
  it("turns the corner onto the next edge, and with both sides takes each span's other side too", () => {
    const g = roads();
    const spans = spansAlong(g, [[-60, 46], [-6, 46], [-6, 120]], 8);
    expect(new Set(spans.map((s) => s.edge)).size).toBe(2);
    const both = spansAlong(g, [[-150, 46], [-50, 46]], 8, true);
    expect(both.map((s) => s.side)).toEqual([1, -1]);
  });
  it("is a point for a click: one lot's frontage around it", () => {
    const s = town();
    const spans = spansAlong(s.roads, [[-100, 50]], strokePad("izba"));
    expect(planStroke(s, BUILDINGS.izba, spans).items.length).toBe(1);
  });
  it("away from roads covers nothing", () => {
    expect(spansAlong(roads(), [[-100, 200]], 8)).toEqual([]);
  });
});

describe("the summary card", () => {
  it("counts what the player keeps: foundations, digs, new lots, families and cost", () => {
    const s = town([
      { id: "old", ring: rect(-104, 46, 12, 12), area: 144, digId: 1, at: 0 },
      { id: "out", ring: rect(-150, 46, 10, 10), area: 100, digId: 1, at: 0, ghost: true },
    ]);
    const plan = planStroke(s, BUILDINGS.izba, spansAlong(s.roads, [[-190, 46], [-20, 46]], strokePad("izba")));
    const all = strokeSummary(plan, new Set(), s.finds.foundations);
    expect(all).toMatchObject({ onFoundations: 1, dig: 1, dropped: 0 });
    expect(all.fresh).toBeGreaterThan(3);
    expect(all.total).toBe(plan.items.length);
    expect(all.homes).toBeGreaterThanOrEqual(all.total);
    expect(all.labor).toBeGreaterThan(0);
    const lot = plan.items.find((it) => it.kind === "lot")!;
    const less = strokeSummary(plan, new Set([lot.key]), s.finds.foundations);
    expect(less.total).toBe(all.total - 1);
    expect(less.dropped).toBe(1);
    expect(less.materials.logs).toBeLessThan(all.materials.logs);
  });
});
