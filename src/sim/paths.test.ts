import { describe, expect, it } from "vitest";
import { nodePath, walkTo } from "./paths";
import { buildNet, snapToRoad, spotTree, treeFrom, walkMetres } from "./people";
import { addRoad, emptyRoads } from "./roads";
import type { RoadGraph } from "./types";

const lay = (g: RoadGraph, pts: [number, number][], labor = 0): RoadGraph => {
  const r = addRoad(g, pts, "dirt", 1, pts.slice(1).map(() => labor));
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
const at = (g: RoadGraph, x: number, y: number) => Object.values(g.nodes).find((n) => n.x === x && n.y === y)!.id;

// Walk between two free points: each is snapped onto the built net, as the sim does for every door.
const walk = (g: RoadGraph, from: [number, number], to: [number, number], limit = Infinity) => {
  const net = buildNet(g);
  const a = snapToRoad(net, from[0], from[1])!;
  const b = snapToRoad(net, to[0], to[1])!;
  return walkTo(spotTree(net, a, limit), a, b, limit);
};

describe("walks over built roads", () => {
  it("takes the shortest built route and counts the off-road legs", () => {
    let g = lay(emptyRoads(), [[0, 0], [100, 0], [200, 0]]);
    g = lay(g, [[0, 0], [100, 150], [200, 0]]); // a longer detour
    const w = walk(g, [0, 5], [200, 5])!;
    expect(w.nodes[0]).toBe(at(g, 0, 0));
    expect(w.nodes).toContain(at(g, 100, 0));
    expect(w.metres).toBeGreaterThan(200); // the door snaps onto the detour edge 2.8 m away: ~200 m of road plus the legs
    expect(w.metres).toBeLessThan(220);
  });
  it("avoids unbuilt edges", () => {
    let g = lay(emptyRoads(), [[0, 0], [100, 0], [200, 0]], 50); // short but not built
    g = lay(g, [[0, 0], [100, 150], [200, 0]]);
    const w = walk(g, [0, 5], [200, 5])!;
    expect(w.nodes).toContain(at(g, 100, 150));
    expect(w.nodes).not.toContain(at(g, 100, 0));
  });
  it("is null when unreachable, out of range or beyond the limit", () => {
    let g = lay(emptyRoads(), [[0, 0], [100, 0]]);
    g = lay(g, [[500, 0], [600, 0]]);
    expect(walk(g, [0, 5], [600, 5])).toBeNull(); // separate components
    expect(walk(g, [0, 5], [100, 9000], 3000)).toBeNull(); // far from the net
    expect(walk(g, [0, 5], [100, 5], 50)).toBeNull(); // 105 m of walking, limit 50
    expect(walk(g, [0, 5], [100, 5], 150)).not.toBeNull();
  });
  it("two points on one edge walk straight along it", () => {
    const g = lay(emptyRoads(), [[0, 0], [100, 0], [200, 0]]);
    expect(walk(g, [50, 3], [60, -4])).toEqual({ nodes: [], metres: 10 + 3 + 4 });
  });
  it("a house mid-road is at its own place: the walk does not go to the nodes and back", () => {
    const g = lay(emptyRoads(), [[0, 0], [100, 0], [200, 0]]);
    const net = buildNet(g);
    const a = snapToRoad(net, 50, 3)!;
    const b = snapToRoad(net, 160, 3)!;
    expect(walkMetres(spotTree(net, a, 1000), a, b)).toBeCloseTo(110 + 3 + 3, 6);
  });
  it("a tree from a node stops at its limit", () => {
    const g = lay(emptyRoads(), [[0, 0], [100, 0], [200, 0]]);
    const t = treeFrom(buildNet(g), [[at(g, 0, 0), 0]], 150);
    expect(nodePath(t, at(g, 100, 0))).toEqual([at(g, 0, 0), at(g, 100, 0)]);
    expect(nodePath(t, at(g, 200, 0))).toBeNull();
  });
});
