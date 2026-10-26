import { describe, expect, it } from "vitest";
import { makeFrame } from "../world/frame";
import { buildHeritageModel } from "./heritageModels";
import { appendModel, emptyBuffers } from "./restoredBuffers";
import { restoredFilter } from "./restoredIds";

describe("appendModel", () => {
  const frame = makeFrame(55.75, 37.6);
  const origin = { lng: frame.toLngLat(0, 0)[0], lat: frame.toLngLat(0, 0)[1] };
  const ring: [number, number][] = [[0, 0], [10, 0], [10, 6], [0, 6]];

  it("keeps local metres in the mercator and globe frames and offsets indices when merging", () => {
    const m = buildHeritageModel(ring, 6, "house");
    const b = emptyBuffers();
    appendModel(b, m, frame.toLngLat, origin);
    const n = m.positions.length / 3;
    appendModel(b, m, frame.toLngLat, origin);
    expect(b.g.length).toBe(n * 6);
    expect(b.i.length).toBe(m.indices.length * 2);
    expect(Math.min(...b.i.slice(m.indices.length))).toBeGreaterThanOrEqual(n);
    for (let k = 0; k < n; k++) {
      const [x, y, z] = [m.positions[k * 3], m.positions[k * 3 + 1], m.positions[k * 3 + 2]];
      // mercator frame is metres at the origin latitude (up untouched)
      expect(b.m[k * 3 + 2]).toBeCloseTo(z, 6);
      expect(Math.abs(b.m[k * 3] - x)).toBeLessThan(0.1);
      expect(Math.abs(b.m[k * 3 + 1] - y)).toBeLessThan(0.1);
      expect(b.g[k * 3 + 2]).toBeCloseTo(z, 1);
      expect(Math.abs(b.g[k * 3] - x)).toBeLessThan(0.1);
      expect(Math.abs(b.g[k * 3 + 1] - y)).toBeLessThan(0.1);
    }
  });
});

describe("restoredFilter", () => {
  it("excludes the given ids, nothing for an empty set", () => {
    expect(restoredFilter([])).toBeNull();
    expect(restoredFilter([3, 7])).toEqual(["!", ["in", ["get", "id"], ["literal", [3, 7]]]]);
  });
});
