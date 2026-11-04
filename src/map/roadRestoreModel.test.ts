import { describe, expect, it } from "vitest";
import { restoreMissingPieces, type RoadGraphLike } from "./roadRestoreModel";

const graph = (segments: [number, number, number, number][]): RoadGraphLike => {
  const nodes: RoadGraphLike["nodes"] = {};
  const edges: RoadGraphLike["edges"] = {};
  let nextNode = 1;
  let nextEdge = 1;
  for (const [ax, ay, bx, by] of segments) {
    const a = nextNode++;
    const b = nextNode++;
    nodes[a] = { id: a, x: ax, y: ay };
    nodes[b] = { id: b, x: bx, y: by };
    edges[nextEdge] = { id: nextEdge, a, b, kind: "dirt" };
    nextEdge++;
  }
  return { nodes, edges };
};

const restoreMissing = (g: RoadGraphLike, pts: [number, number][]) => restoreMissingPieces(g, pts, "dirt");

describe("old street restoration gaps", () => {
  it("keeps the whole street when nothing is built", () => {
    expect(restoreMissing(graph([]), [[0, 0], [100, 0]])).toEqual([[[0, 0], [100, 0]]]);
  });

  it("continues after an already-built prefix", () => {
    expect(restoreMissing(graph([[0, 0, 40, 0]]), [[0, 0], [100, 0]])).toEqual([[[40, 0], [100, 0]]]);
  });

  it("restores both sides of an already-built middle", () => {
    expect(restoreMissing(graph([[40, 0, 60, 0]]), [[0, 0], [100, 0]])).toEqual([
      [[0, 0], [40, 0]],
      [[60, 0], [100, 0]],
    ]);
  });

  it("returns no work for a fully restored street", () => {
    expect(restoreMissing(graph([[0, 0, 100, 0]]), [[0, 0], [100, 0]])).toEqual([]);
  });

  it("does not mistake a crossing or a distant parallel road for restored street", () => {
    expect(restoreMissing(graph([[50, -20, 50, 20]]), [[0, 0], [100, 0]])).toEqual([[[0, 0], [100, 0]]]);
    expect(restoreMissing(graph([[0, 4, 40, 4]]), [[0, 0], [100, 0]])).toEqual([[[0, 0], [100, 0]]]);
  });

  it("lays the missing part of a bent street as one line", () => {
    expect(restoreMissing(graph([]), [[0, 0], [50, 0], [50, 50]])).toEqual([[[0, 0], [50, 0], [50, 50]]]);
  });

  it("does not lay a road again beside one drawn a little off the old line", () => {
    expect(restoreMissing(graph([[0, 2, 100, 2]]), [[0, 0], [100, 0]])).toEqual([]);
  });

  it("ends a missing part on the road beside it, so the street joins it", () => {
    const out = restoreMissing(graph([[0, 2, 40, 2]]), [[0, 0], [100, 0]]);
    expect(out).toEqual([[[40, 2], [100, 0]]]);
  });

  it("lengthens a gap too short for a road over the roads at both its ends", () => {
    const out = restoreMissing(graph([[0, 0, 40, 0], [45, 0, 100, 0]]), [[0, 0], [100, 0]]);
    expect(out).toHaveLength(1);
    const [[a], [b]] = [out[0][0], out[0][out[0].length - 1]];
    expect(b - a).toBeGreaterThanOrEqual(8);
    expect(a).toBeLessThan(40);
    expect(b).toBeGreaterThan(45);
  });

  it("leaves the seam of two roads that already meet", () => {
    expect(restoreMissing(graph([[0, 0, 40, 0]]), [[0, 0], [40, 0], [40.4, 30]])).toEqual([[[40, 0], [40.4, 30]]]);
  });

  it("finishes a short end of a street from the road before it", () => {
    const out = restoreMissing(graph([[0, 0, 95, 0]]), [[0, 0], [100, 0]]);
    expect(out).toHaveLength(1);
    expect(out[0][out[0].length - 1]).toEqual([100, 0]);
    expect(out[0][0][0]).toBeLessThan(95);
  });
});
