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
    edges[nextEdge] = { id: nextEdge, a, b };
    nextEdge++;
  }
  return { nodes, edges };
};

describe("old street restoration gaps", () => {
  it("keeps the whole street when nothing is built", () => {
    expect(restoreMissingPieces(graph([]), [[0, 0], [100, 0]])).toEqual([[[0, 0], [100, 0]]]);
  });

  it("continues after an already-built prefix", () => {
    expect(restoreMissingPieces(graph([[0, 0, 40, 0]]), [[0, 0], [100, 0]])).toEqual([[[40, 0], [100, 0]]]);
  });

  it("restores both sides of an already-built middle", () => {
    expect(restoreMissingPieces(graph([[40, 0, 60, 0]]), [[0, 0], [100, 0]])).toEqual([
      [[0, 0], [40, 0]],
      [[60, 0], [100, 0]],
    ]);
  });

  it("returns no work for a fully restored street", () => {
    expect(restoreMissingPieces(graph([[0, 0, 100, 0]]), [[0, 0], [100, 0]])).toEqual([]);
  });

  it("does not mistake a crossing or a distant parallel road for restored street", () => {
    expect(restoreMissingPieces(graph([[50, -20, 50, 20]]), [[0, 0], [100, 0]])).toEqual([[[0, 0], [100, 0]]]);
    expect(restoreMissingPieces(graph([[0, 4, 40, 4]]), [[0, 0], [100, 0]])).toEqual([[[0, 0], [100, 0]]]);
  });
});
