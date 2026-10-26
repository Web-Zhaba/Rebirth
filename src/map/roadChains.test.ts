import { describe, expect, it } from "vitest";
import type { RoadGraph, RoadKind } from "../sim/types";
import { roadChains, type RoadState } from "./roadChains";

type EdgeSpec = [id: number, a: number, b: number, kind?: RoadKind, done?: number, labor?: number];

const graph = (nodes: [number, number, number][], edges: EdgeSpec[]): RoadGraph => ({
  nodes: Object.fromEntries(nodes.map(([id, x, y]) => [id, { id, x, y }])),
  edges: Object.fromEntries(
    edges.map(([id, a, b, kind = "path", done = 1, labor = 1]) => [id, { id, a, b, kind, length: 1, labor, done }]),
  ),
  nextId: 100,
});

const state = (e: { done: number; labor: number }): RoadState => (e.done >= e.labor ? "built" : "waiting");
const chains = (g: RoadGraph) => roadChains(g, state).map((c) => c.nodes);

describe("roadChains", () => {
  it("joins consecutive edges of the same kind into one polyline", () => {
    const g = graph(
      [
        [1, 0, 0],
        [2, 10, 0],
        [3, 20, 10],
      ],
      [
        [10, 1, 2],
        [11, 2, 3],
      ],
    );
    expect(chains(g)).toEqual([[1, 2, 3]]);
  });

  it("splits where the road kind changes", () => {
    const g = graph(
      [
        [1, 0, 0],
        [2, 10, 0],
        [3, 20, 0],
      ],
      [
        [10, 1, 2, "path"],
        [11, 2, 3, "dirt"],
      ],
    );
    expect(chains(g)).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("splits where the construction state changes", () => {
    const g = graph(
      [
        [1, 0, 0],
        [2, 10, 0],
        [3, 20, 0],
      ],
      [
        [10, 1, 2, "path", 1, 1],
        [11, 2, 3, "path", 0, 1],
      ],
    );
    expect(chains(g)).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("splits at a junction and keeps both branches whole", () => {
    const g = graph(
      [
        [1, -10, 0],
        [2, 0, 0],
        [3, 10, 10],
        [4, 10, -10],
      ],
      [
        [10, 1, 2],
        [11, 2, 3],
        [12, 2, 4],
      ],
    );
    const out = chains(g);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual([1, 2]);
    const branch = out.find((c) => c.length === 3)!;
    expect(new Set(branch)).toEqual(new Set([2, 3, 4]));
    expect(branch[1]).toBe(2); // the junction stays in the middle
  });

  it("closes a loop", () => {
    const g = graph(
      [
        [1, 0, 0],
        [2, 10, 0],
        [3, 0, 10],
      ],
      [
        [10, 1, 2],
        [11, 2, 3],
        [12, 3, 1],
      ],
    );
    const out = chains(g);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(4);
    expect(out[0][0]).toBe(out[0][3]);
    expect(new Set(out[0])).toEqual(new Set([1, 2, 3]));
  });

  it("keeps disconnected roads apart", () => {
    const g = graph(
      [
        [1, 0, 0],
        [2, 10, 0],
        [3, 100, 0],
        [4, 110, 0],
      ],
      [
        [10, 1, 2],
        [11, 3, 4],
      ],
    );
    expect(chains(g)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});