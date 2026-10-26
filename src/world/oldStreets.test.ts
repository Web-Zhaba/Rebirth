import { describe, expect, it } from "vitest";
import { roadLine, snapToOldStreets, streetJunctions, streetPolylines } from "./oldStreets";

const streets = [
  { name: "Милютина", pts: [[0, 0], [100, 0], [100, 100]] as [number, number][] },
  { pts: [[0, 50], [40, 50]] as [number, number][] },
];

describe("snapToOldStreets", () => {
  it("takes the nearest vertex first", () => {
    expect(snapToOldStreets({ x: 97, y: 3 }, streets, 10)).toEqual({ x: 100, y: 0, vertex: true, name: "Милютина" });
  });
  it("then the nearest point on a segment", () => {
    expect(snapToOldStreets({ x: 50, y: 4 }, streets, 10)).toEqual({ x: 50, y: 0, vertex: false, name: "Милютина" });
    // an unnamed street gives no name
    expect(snapToOldStreets({ x: 20, y: 53 }, streets, 10)).toEqual({ x: 20, y: 50, vertex: false });
  });
  it("a vertex beats a closer segment point", () => {
    expect(snapToOldStreets({ x: 95, y: 1 }, streets, 10)).toMatchObject({ x: 100, y: 0, vertex: true });
  });
  it("returns null when nothing is within the tolerance", () => {
    expect(snapToOldStreets({ x: 50, y: 20 }, streets, 10)).toBeNull();
    expect(snapToOldStreets({ x: 0, y: 0 }, [], 10)).toBeNull();
  });
});

describe("streetPolylines", () => {
  it("returns every way of the named street and skips the others", () => {
    const ways = [
      { id: "a", name: "Милютина", cls: "minor", pts: [[0, 0], [10, 0]] as [number, number][] },
      { id: "b", name: "Милютина", cls: "minor", pts: [[10, 0], [10, 10]] as [number, number][] },
      { id: "c", name: "Тропа", cls: "path", pts: [[0, 5], [3, 5]] as [number, number][] },
      { id: "d", name: "Милютина", cls: "minor", pts: [[1, 1]] as [number, number][] },
    ];
    expect(streetPolylines(ways, "Милютина")).toEqual([
      { pts: [[0, 0], [10, 0]], cls: "minor" },
      { pts: [[10, 0], [10, 10]], cls: "minor" },
    ]);
    expect(streetPolylines(ways, "Нет такой")).toEqual([]);
  });
});

describe("roadLine", () => {
  const segs = (pts: [number, number][]) => pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  it("merges a dense line into segments of at least the minimum", () => {
    const dense = Array.from({ length: 41 }, (_, i) => [i, 0] as [number, number]); // a vertex every metre
    const out = roadLine(dense, 8, new Set())!;
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([40, 0]);
    expect(Math.min(...segs(out))).toBeGreaterThanOrEqual(8);
  });
  it("keeps the junctions where other streets end", () => {
    const pts: [number, number][] = [[0, 0], [3, 0], [11, 0], [13, 0], [30, 0]];
    expect(roadLine(pts, 8, new Set(["13,0"]))).toEqual([[0, 0], [13, 0], [30, 0]]);
  });
  it("lets the end win over a pinned junction just before it, and gives up on a too short line", () => {
    expect(roadLine([[0, 0], [20, 0], [25, 0]], 8, new Set(["20,0"]))).toEqual([[0, 0], [25, 0]]);
    expect(roadLine([[0, 0], [3, 0], [5, 0]], 8, new Set())).toBeNull();
  });
  it("collects the ends of every street", () => {
    expect(streetJunctions([{ pts: [[0, 0], [1, 1], [2, 2]] }, { pts: [] }])).toEqual(new Set(["0,0", "2,2"]));
  });
});
