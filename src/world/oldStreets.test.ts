import { describe, expect, it } from "vitest";
import { snapToOldStreets } from "./oldStreets";

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
