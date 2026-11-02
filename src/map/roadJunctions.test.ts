import { describe, expect, it } from "vitest";
import { ROAD_KINDS } from "../sim/roads";
import type { RoadEdge, RoadGraph, RoadKind } from "../sim/types";
import { PATTERN, pointInRing, type Model, type XY } from "./modelGeometry";
import { buildJunctionModel, junctionOutline, junctionReach, roadJunctions, type RoadJunction } from "./roadJunctions";

type Spec = [id: number, a: number, b: number, kind?: RoadKind, done?: number, labor?: number];

const graph = (nodes: [number, number, number][], edges: Spec[]): RoadGraph => ({
  nodes: Object.fromEntries(nodes.map(([id, x, y]) => [id, { id, x, y }])),
  edges: Object.fromEntries(
    edges.map(([id, a, b, kind = "dirt", done = 10, labor = 10]) => {
      const p = nodes.find((n) => n[0] === a)!;
      const q = nodes.find((n) => n[0] === b)!;
      const length = Math.hypot(q[1] - p[1], q[2] - p[2]);
      return [id, { id, a, b, kind, length, labor, done } as RoadEdge];
    }),
  ),
  nextId: 100,
});

const allBuilt = (_e: RoadEdge): boolean => true;
const junctions = (g: RoadGraph, built: (e: RoadEdge) => boolean = allBuilt): RoadJunction[] => roadJunctions(g, built);

const CROSS = graph(
  [
    [1, -12, 0],
    [2, 12, 0],
    [3, 0, -12],
    [4, 0, 12],
    [5, 0, 0],
  ],
  [
    [10, 1, 5, "dirt"],
    [11, 5, 2, "dirt"],
    [12, 3, 5, "dirt"],
    [13, 5, 4, "dirt"],
  ],
);
const T = graph(
  [
    [1, -12, 0],
    [2, 12, 0],
    [3, 0, -12],
    [4, 0, 0],
  ],
  [
    [10, 1, 4, "dirt"],
    [11, 4, 2, "dirt"],
    [12, 3, 4, "path"],
  ],
);

const facets = (m: Model): number[] => m.facade.filter((_, i) => i % 4 === 0);
const codes = (m: Model) => new Set(m.facade.filter((_, i) => i % 4 === 3));

function check(m: Model): void {
  const n = m.positions.length / 3;
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.colors.length).toBe(m.positions.length);
  expect(m.facade.length).toBe(n * 4);
  expect(m.indices.length % 3).toBe(0);
  expect(m.indices.every((i) => i >= 0 && i < n)).toBe(true);
  expect([...m.positions, ...m.normals, ...m.colors, ...m.facade].every(Number.isFinite)).toBe(true);
  for (let k = 0; k < n; k++) expect(m.normals[k * 3 + 2]).toBeCloseTo(1, 6);
}

describe("roadJunctions", () => {
  it("makes one apron per branch, the through road first", () => {
    const [j] = junctions(CROSS);
    expect(j.arms).toHaveLength(4);
    expect(j.p).toEqual([0, 0]);
    // two arms of a through road, opposite each other, come before the crossing pair
    expect(j.arms[0].dir[0] * j.arms[1].dir[0] + j.arms[0].dir[1] * j.arms[1].dir[1]).toBeCloseTo(-1, 6);
    expect(j.arms[0].edge).toBeLessThan(j.arms[2].edge);
  });

  it("prefers the wider road, then the paved one", () => {
    const [t] = junctions(T);
    expect(t.arms[0].kind).toBe("dirt");
    expect(t.arms[0].hw).toBe(ROAD_KINDS.dirt.width / 2);

    const paved = graph(
      [
        [1, -12, 0],
        [2, 12, 0],
        [3, 0, -12],
        [4, 0, 12],
        [5, 0, 0],
      ],
      [
        [10, 1, 5, "stone"],
        [11, 5, 2, "stone"],
        [12, 3, 5, "dirt"],
        [13, 5, 4, "dirt"],
      ],
    );
    expect(junctions(paved)[0].arms[0].kind).toBe("stone");
  });

  it("paves a change of kind, but leaves bends and dead ends alone", () => {
    const switchOfKind = graph(
      [
        [1, -12, 0],
        [2, 0, 0],
        [3, 12, 0],
      ],
      [
        [10, 1, 2, "stone"],
        [11, 2, 3, "dirt"],
      ],
    );
    expect(junctions(switchOfKind)).toHaveLength(1);

    const bend = graph(
      [
        [1, -12, 0],
        [2, 0, 0],
        [3, 0, 12],
      ],
      [
        [10, 1, 2, "dirt"],
        [11, 2, 3, "dirt"],
      ],
    );
    expect(junctions(bend)).toHaveLength(0);

    const deadEnd = graph(
      [
        [1, -12, 0],
        [2, 0, 0],
      ],
      [[10, 1, 2, "dirt"]],
    );
    expect(junctions(deadEnd)).toHaveLength(0);
  });

  it("leaves out the road that is not built yet, and bridge decks", () => {
    const halfBuilt = graph(
      [
        [1, -12, 0],
        [2, 12, 0],
        [3, 0, -12],
        [4, 0, 0],
      ],
      [
        [10, 1, 4, "dirt"],
        [11, 4, 2, "dirt"],
        [12, 3, 4, "dirt", 0, 10],
      ],
    );
    expect(junctions(halfBuilt, (e) => e.done >= e.labor)).toHaveLength(0); // the unfinished road is not drawn, so the node is a bend

    const bridge = graph(
      [
        [1, -12, 0],
        [2, 12, 0],
        [3, 0, -12],
        [4, 0, 0],
      ],
      [
        [10, 1, 4, "dirt"],
        [11, 4, 2, "dirt"],
        [12, 3, 4, "bridge"],
      ],
    );
    expect(junctions(bridge)).toHaveLength(0); // a deck ends on its own ramp
  });

  it("contains the node, every arm's edges, and the joints it replaces", () => {
    const [j] = junctions(CROSS);
    const outline = junctionOutline(j);
    const reach = junctionReach(j);
    // the union of the arm strips, a hand's width inside its edges (the outline's chords round the sharp corners a little)
    for (const arm of j.arms) {
      for (const t of [0.25, 0.5, 0.75, 0.95]) {
        for (const off of [-arm.hw + 0.15, 0, arm.hw - 0.15]) {
          const p: XY = [j.p[0] + arm.dir[0] * reach * t + -arm.dir[1] * off, j.p[1] + arm.dir[1] * reach * t + arm.dir[0] * off];
          expect(pointInRing(p[0], p[1], outline)).toBe(true);
        }
      }
    }
    // the rim turns exactly at the corners between the arms: 45° out of the node, hw along both roads
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const r = ROAD_KINDS.dirt.width / 2;
      expect(pointInRing(j.p[0] + dx * (r - 0.15), j.p[1] + dy * (r - 0.15), outline)).toBe(true);
      expect(pointInRing(j.p[0] + dx * r * 1.1, j.p[1] + dy * r * 1.1, outline)).toBe(false);
    }
  });

  it("builds a flat apron of the dominant road's surface", () => {
    const [j] = junctions(T);
    const m = buildJunctionModel(j);
    check(m);
    expect(codes(m)).toEqual(new Set([PATTERN.junctionRuts]));

    const stoneJunction = junctions(
      graph(
        [
          [1, -12, 0],
          [2, 12, 0],
          [3, 0, -12],
          [4, 0, 12],
          [5, 0, 0],
        ],
        [
          [10, 1, 5, "stone"],
          [11, 5, 2, "stone"],
          [12, 3, 5, "stone"],
          [13, 5, 4, "stone"],
        ],
      ),
    )[0];
    expect(codes(buildJunctionModel(stoneJunction))).toEqual(new Set([PATTERN.junctionCobbles]));

    const pathJunction = junctions(
      graph(
        [
          [1, -12, 0],
          [2, 12, 0],
          [3, 0, -12],
          [4, 0, 0],
        ],
        [
          [10, 1, 4, "path"],
          [11, 4, 2, "path"],
          [12, 3, 4, "path"],
        ],
      ),
    )[0];
    expect(codes(buildJunctionModel(pathJunction))).toEqual(new Set([PATTERN.junctionPlain]));
  });

  it("paints the through road's ruts in its own coordinates", () => {
    const [j] = junctions(CROSS);
    const m = buildJunctionModel(j);
    const t = j.arms[0].dir;
    const n: XY = [-t[1], t[0]];
    for (let k = 0; k < m.positions.length / 3; k++) {
      const dx = m.positions[k * 3] - j.p[0], dy = m.positions[k * 3 + 1] - j.p[1];
      expect(m.facade[k * 4 + 1]).toBeCloseTo(dx * n[0] + dy * n[1], 6);
      expect(m.facade[k * 4 + 2]).toBeCloseTo(j.arms[0].hw * 2, 6);
    }
  });

  it("keeps the shoulder off the middle and on the rim", () => {
    const [j] = junctions(CROSS);
    const m = buildJunctionModel(j);
    const bands = facets(m);
    const at = (x: number, y: number): number => {
      let best = 0, d = Infinity;
      for (let k = 0; k < bands.length; k++) {
        const dk = Math.hypot(m.positions[k * 3] - x, m.positions[k * 3 + 1] - y);
        if (dk < d) (d = dk), (best = k);
      }
      return bands[best];
    };
    const hw = j.arms[0].hw;
    expect(at(0, 0)).toBe(0); // the paved middle
    expect(at(hw - 0.05, junctionReach(j) * 0.8)).toBeGreaterThan(0.8); // along an arm's outer edge
    expect(at(0, junctionReach(j))).toBe(0); // across an arm's cut, exactly where the ribbon continues
    expect(Math.max(...bands)).toBeGreaterThan(0.95);
    // a path's shoulder starts further in than a dirt road's, and both read as the same 0..1 band
    const [t] = junctions(T);
    expect(Math.max(...facets(buildJunctionModel(t)))).toBeGreaterThan(0.95);
  });

  it("covers a junction where one road runs straight through", () => {
    const through = graph(
      [
        [1, -12, 0],
        [2, 12, 0],
        [3, 0, -12],
        [4, 0, 0],
      ],
      [
        [10, 1, 4, "dirt"],
        [11, 4, 2, "dirt"],
        [12, 3, 4, "path"],
      ],
    );
    const [j] = junctions(through);
    expect(j.arms.map((a) => a.kind).sort()).toEqual(["dirt", "dirt", "path"]);
    const outline = junctionOutline(j);
    // the narrow arm's mouth is only paved where it meets the wide one: 4 m down the path is its own ribbon again
    expect(pointInRing(j.p[0], j.p[1] - junctionReach(j) * 0.9, outline)).toBe(false);
  });
});



