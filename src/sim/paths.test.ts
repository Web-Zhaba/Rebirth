import { describe, expect, it } from "vitest";
import { nodePath, polyLength, routeBetween, shortestTree } from "./paths";
import { buildNet } from "./people";
import { addRoad, emptyRoads } from "./roads";
import type { RoadGraph } from "./types";

const lay = (g: RoadGraph, pts: [number, number][], labor = 0): RoadGraph => {
  const r = addRoad(g, pts, "dirt", 1, pts.slice(1).map(() => labor));
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
const at = (g: RoadGraph, x: number, y: number) => Object.values(g.nodes).find((n) => n.x === x && n.y === y)!.id;

describe("routing over built roads", () => {
  it("picks the shortest route and includes the off-road legs", () => {
    let g = lay(emptyRoads(), [[0, 0], [100, 0], [200, 0]]);
    g = lay(g, [[0, 0], [100, 150], [200, 0]]); // a longer detour
    const r = routeBetween(g, buildNet(g), [0, 5], [200, 5])!;
    expect(r.nodes).toEqual([at(g, 0, 0), at(g, 100, 0), at(g, 200, 0)]);
    expect(r.pts[0]).toEqual([0, 5]);
    expect(r.pts[r.pts.length - 1]).toEqual([200, 5]);
    expect(r.length).toBeCloseTo(210, 6);
    expect(polyLength(r.pts)).toBeCloseTo(r.length, 6);
  });
  it("avoids unbuilt edges", () => {
    let g = lay(emptyRoads(), [[0, 0], [100, 0], [200, 0]], 50); // short but not built
    g = lay(g, [[0, 0], [100, 150], [200, 0]]);
    const r = routeBetween(g, buildNet(g), [0, 5], [200, 5])!;
    expect(r.nodes).toEqual([at(g, 0, 0), at(g, 100, 150), at(g, 200, 0)]);
  });
  it("is null when unreachable, out of range or beyond the limit", () => {
    let g = lay(emptyRoads(), [[0, 0], [100, 0]]);
    g = lay(g, [[500, 0], [600, 0]]);
    const net = buildNet(g);
    expect(routeBetween(g, net, [0, 5], [600, 5])).toBeNull(); // separate components
    expect(routeBetween(g, net, [0, 5], [100, 9000])).toBeNull(); // no net node in walking range
    expect(routeBetween(g, net, [0, 5], [100, 5], 50)).toBeNull(); // 100 m of road, limit 50
    expect(routeBetween(g, net, [0, 5], [100, 5])).not.toBeNull();
  });
  it("same node gives a short walk, and the tree stops at the limit", () => {
    const g = lay(emptyRoads(), [[0, 0], [100, 0], [200, 0]]);
    const net = buildNet(g);
    const r = routeBetween(g, net, [0, 3], [0, -4])!;
    expect(r.nodes).toHaveLength(1);
    expect(r.length).toBeCloseTo(3 + 4, 6);
    const t = shortestTree(net, at(g, 0, 0), 150);
    expect(nodePath(t, at(g, 100, 0))).toEqual([at(g, 0, 0), at(g, 100, 0)]);
    expect(nodePath(t, at(g, 200, 0))).toBeNull();
  });
});
