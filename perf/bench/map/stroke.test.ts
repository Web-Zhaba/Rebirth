// What the stroke tool and the field/clearing tool cost per frame while dragging: planStroke (the sim's own planner, run
// on the main thread's copy of the town) and the checks landTool makes on every move.
//
// strokeTool.ts throttles its work to one rAF (strokeTool.ts:400-402 `schedule`), so the numbers below are the cost of ONE
// frame of a drag; landTool.ts does the same work on every pointermove (landTool.ts:331 → showDraft).
//
//   npx vitest run perf/bench/map/stroke.test.ts --reporter=verbose
import { expect, it } from "vitest";
import { makeTown, ms, ring, sample, table } from "./lib";
import { planStroke, type StrokeSpan } from "../../../src/sim/stroke";
import { spansAlong, strokePad } from "../../../src/map/strokeModel";
import { BUILDINGS } from "../../../src/sim/buildings";
import { validateField } from "../../../src/sim/zones";
import { validateClearing } from "../../../src/sim/clearing";
import type { ClientState, RoadGraph } from "../../../src/sim/types";
import type { PlaceState } from "../../../src/sim/growth";

// A straight drag along the road from `from`, the path strokeTool.onMove pushes into `path` (strokeTool.ts:462-472).
function dragPath(from: number, len: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = from; x <= from + len; x += 20) pts.push([x, 0]);
  return pts;
}

// The x of the free stretch a town's `extend` leaves behind (the road ends at its last node).
const freeStart = (g: RoadGraph): number => Math.max(...Object.values(g.nodes).map((n) => n.x)) - 600;

it("the town fixture has roads, cells and buildings to plan against", async () => {
  const t = await makeTown({ buildings: 300 });
  const c = t.count();
  console.log(`\ntown: ${JSON.stringify(c)}\n`);
  expect(c.cells).toBeGreaterThan(500);
  expect(c.buildings).toBeGreaterThan(100);
}, 300_000);

it("spansAlong: the drag turned into road spans (map/strokeModel.ts:46)", async () => {
  const rows: (string | number)[][] = [];
  for (const target of [100, 300, 600]) {
    const t = await makeTown({ buildings: target });
    await t.extend(600); // free lots: the town's own stretch is taken
    const g = t.st.roads;
    const pad = strokePad("izba");
    for (const len of [60, 300, 900]) {
      const path = dragPath(freeStart(g), len);
      const s = sample(() => spansAlong(g, path, pad), 7, 2);
      rows.push([Object.keys(t.st.buildings).length, Object.keys(g.edges).length, len, ms(s.med)]);
    }
  }
  console.log("\n### spansAlong — one per rAF frame of a drag (strokeTool.ts:400): a nearestEdge scan per 4 m sample\n");
  console.log(table(["buildings", "edges", "drag m", "median ms"], rows));
  expect(rows.length).toBe(9);
}, 600_000);

it("planStroke: the sim planner on the main thread (sim/stroke.ts:128)", async () => {
  const rows: (string | number)[][] = [];
  for (const target of [100, 300, 600]) {
    const t = await makeTown({ buildings: target });
    await t.extend(600);
    const st = t.st as ClientState & PlaceState;
    const g = st.roads;
    const pad = strokePad("izba");
    const tpl = BUILDINGS["izba"];
    for (const len of [60, 300, 900]) {
      const spans = spansAlong(g, dragPath(freeStart(g), len), pad);
      const s = sample(() => planStroke(st, tpl, spans), 7, 2);
      const plan = planStroke(st, tpl, spans);
      rows.push([Object.keys(st.buildings).length, st.zones.cells.length, len, spans.length, plan.items.length, plan.skipped.length, ms(s.med)]);
    }
  }
  console.log("\n### planStroke — canPlace per candidate lot, each rebuilding a cell map and the building hash (sim/growth.ts:163-180)\n");
  console.log(table(["buildings", "cells", "drag m", "spans", "items", "skipped", "median ms"], rows));
  expect(rows.length).toBe(9);
}, 600_000);

it("a whole drag frame of the stroke tool: spansAlong + planStroke", async () => {
  const rows: (string | number)[][] = [];
  for (const target of [100, 300, 600]) {
    const t = await makeTown({ buildings: target });
    await t.extend(600);
    const st = t.st as ClientState & PlaceState;
    const g = st.roads;
    const pad = strokePad("izba");
    const tpl = BUILDINGS["izba"];
    const path = dragPath(freeStart(g), 300);
    const frame = () => planStroke(st, tpl, spansAlong(g, path, pad));
    const s = sample(frame, 9, 2);
    rows.push([Object.keys(st.buildings).length, st.zones.cells.length, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### strokeTool.refresh — one frame of a 300 m drag (strokeTool.ts:378-395)\n");
  console.log(table(["buildings", "cells", "median ms/frame", "p90 ms"], rows));
  console.log("\nbudget: 4-6 ms per event.\n");
  expect(rows.length).toBe(3);
}, 600_000);

it("landTool checks: validateField / validateClearing on every pointermove", async () => {
  const rows: (string | number)[][] = [];
  for (const target of [100, 300, 600]) {
    const t = await makeTown({ buildings: target });
    const st = t.st;
    const g = st.roads;
    const poly: [number, number][] = [[200, 40], [300, 40], [300, 140], [200, 140]];
    // landTool.ts:104-105 `check`: the footprints of every building are copied into an array on each call
    const check = () => validateField(poly, g, st.zones.fields, Object.values(st.buildings).map((b) => b.footprint));
    const s = sample(check, 9, 2);
    const onlyFp = sample(() => Object.values(st.buildings).map((b) => b.footprint), 9, 2);
    const clear = sample(() => validateClearing(poly, 0.5, g, st.zones.fields, st.clearings), 9, 2);
    rows.push([Object.values(st.buildings).length, Object.keys(g.edges).length, st.zones.fields.length, ms(s.med), ms(onlyFp.med), ms(clear.med)]);
  }
  console.log("\n### landTool on every pointermove (landTool.ts:104-128, 331): validateField (sim/zones.ts:358) + the footprint array copy\n");
  console.log(table(["buildings", "edges", "fields", "validateField ms", "of which the array copy", "validateClearing ms"], rows));
  expect(rows.length).toBe(3);
}, 600_000);

it("landTool: the outline growing to 20 corners", async () => {
  const t = await makeTown({ buildings: 300 });
  const st = t.st;
  const g = st.roads;
  const rows: (string | number)[][] = [];
  for (const corners of [3, 8, 20]) {
    const poly = ring(corners, 80, 260, 90) as [number, number][];
    const s = sample(() => validateField(poly, g, st.zones.fields, Object.values(st.buildings).map((b) => b.footprint)), 9, 2);
    rows.push([corners, Object.keys(g.edges).length, ms(s.med)]);
  }
  console.log("\n### validateField against the outline's corner count (touchesRoad is O(edges × corners), sim/zones.ts:342)\n");
  console.log(table(["corners", "edges", "median ms"], rows));
  expect(rows.length).toBe(3);
}, 600_000);
