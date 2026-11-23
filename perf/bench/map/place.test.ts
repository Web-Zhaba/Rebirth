// What placeTool does on every pointermove: find the lot under the cursor, build the building the sim would build,
// check it (canPlace) and price its reach. placeTool.ts does all of it synchronously in `onMove` (placeTool.ts:379-385),
// with no rAF throttle — unlike strokeTool.
//
//   npx vitest run perf/bench/map/place.test.ts --reporter=verbose
import { expect, it } from "vitest";
import { makeTown, ms, sample, table } from "./lib";
import { canPlace, makeBuilding } from "../../../src/sim/growth";
import { BUILDINGS } from "../../../src/sim/buildings";
import { previewServiceCoverage } from "../../../src/sim/coverage";
import { roadNet } from "../../../src/sim/roadNetCache";
import type { LotCell, Site } from "../../../src/sim/types";
import type { PlaceState } from "../../../src/sim/growth";

const NO_SITE: Site = { forest: 0, water: 0, rock: 0 };
const BUCKET = 16; // placeTool.ts:39

// placeTool.ts:87-113 `lookup` + `nearestStart`: a bucket index of the depth-0 lot cells, rebuilt when `zones` changes.
function lotIndex(st: { zones: { cells: LotCell[] } }) {
  const starts = new Map<number, LotCell[]>();
  const bucketKey = (bx: number, by: number) => bx * 65536 + by;
  for (const c of st.zones.cells) {
    if (c.depth !== 0) continue;
    const k = bucketKey(Math.floor(c.cx / BUCKET), Math.floor(c.cy / BUCKET));
    const list = starts.get(k);
    if (list) list.push(c);
    else starts.set(k, [c]);
  }
  return (x: number, y: number): LotCell | null => {
    let best: LotCell | null = null;
    let bestD = 24; // MAX_SNAP_M
    for (let bx = Math.floor((x - bestD) / BUCKET); bx <= Math.floor((x + bestD) / BUCKET); bx++) {
      for (let by = Math.floor((y - bestD) / BUCKET); by <= Math.floor((y + bestD) / BUCKET); by++) {
        for (const c of starts.get(bucketKey(bx, by)) ?? []) {
          const d = Math.hypot(c.cx - x, c.cy - y);
          if (d <= bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    }
    return best;
  };
}

it("placeTool: one hover frame at 100/300/600 buildings", async () => {
  const rows: (string | number)[][] = [];
  const tpl = BUILDINGS["weaver"]; // a placed workshop: the tool this cost belongs to
  for (const target of [100, 300, 600]) {
    const t = await makeTown({ buildings: target });
    const st = t.st as unknown as PlaceState & { zones: { cells: LotCell[] } };
    const nearest = lotIndex(st);
    const free = st.zones.cells.find((c) => c.depth === 0 && c.block === null);
    if (!free) continue;
    const c0 = free;
    const far = st.zones.cells.find((c) => c.edge === c0.edge && c.side === c0.side && c.i === c0.i + tpl.w - 1 && c.depth === tpl.d - 1);
    if (!far) continue;
    const frame = () => {
      // placeTool.ts:124 lookup/nearestStart
      const start = nearest(c0.cx, c0.cy);
      if (!start) return false;
      // placeTool.ts:203-214 makeBuilding for the footprint
      makeBuilding(tpl, start, far, 0, 0);
      // placeTool.ts:224 canPlace — the same check the worker makes
      return canPlace(st, tpl, start.edge, start.side, start.i, NO_SITE).ok;
    };
    const s = sample(frame, 9, 2);
    rows.push([Object.keys(st.buildings).length, st.zones.cells.length, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### placeTool.refresh — every pointermove, no rAF throttle (placeTool.ts:379-385)\n");
  console.log(table(["buildings", "cells", "median ms/move", "p90 ms"], rows));
  console.log("\nbudget: 4-6 ms per event.\n");
  expect(rows.length).toBe(3);
}, 600_000);

it("placeTool: the service reach preview (sim/coverage.ts previewServiceCoverage)", async () => {
  const t = await makeTown({ buildings: 300 });
  const st = t.st as unknown as PlaceState & { zones: { cells: LotCell[] } };
  const road = Object.values(st.roads.edges)[0];
  const door: [number, number] = [st.roads.nodes[road.a].x, st.roads.nodes[road.a].y];
  // a cold net: the cache is keyed by the graph's identity (sim/roadNetCache.ts:8), so every snapshot rebuilds it
  const cold = sample(() => roadNet(st.roads), 5, 0);
  const warm = sample(() => roadNet(st.roads), 9, 2);
  const reach = sample(() => previewServiceCoverage(st as never, "school", door[0], door[1]), 9, 2);
  console.log("\n### previewServiceCoverage — called per move for a service tool (placeTool.ts:229)\n");
  console.log(table(["call", "median ms"], [["roadNet, cold (new graph identity)", ms(cold.med)], ["roadNet, cached", ms(warm.med)], ["previewServiceCoverage", ms(reach.med)]]));
  expect(reach.med).toBeGreaterThanOrEqual(0);
}, 600_000);
