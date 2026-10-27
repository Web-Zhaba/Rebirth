import { describe, expect, it } from "vitest";
import { makeFrame } from "../world/frame";
import { buildHeritageModel } from "./heritageModels";
import { mergePacked, projectModel } from "./modelBuffers";

describe("projectModel / mergePacked", () => {
  const frame = makeFrame(55.75, 37.6);
  const origin = { lng: frame.toLngLat(0, 0)[0], lat: frame.toLngLat(0, 0)[1] };
  const ring: [number, number][] = [[0, 0], [10, 0], [10, 6], [0, 6]];

  it("keeps local metres in the mercator and globe frames", () => {
    const m = buildHeritageModel(ring, 6, "house");
    const p = projectModel(m, frame.toLngLat, origin);
    const n = m.positions.length / 3;
    expect(p.g.length).toBe(n * 3);
    expect(p.f.length).toBe(n * 4);
    for (let k = 0; k < n; k++) {
      const [x, y, z] = [m.positions[k * 3], m.positions[k * 3 + 1], m.positions[k * 3 + 2]];
      // mercator frame is metres at the origin latitude (up untouched)
      expect(p.m[k * 3 + 2]).toBeCloseTo(z, 4);
      expect(Math.abs(p.m[k * 3] - x)).toBeLessThan(0.1);
      expect(Math.abs(p.m[k * 3 + 1] - y)).toBeLessThan(0.1);
      expect(p.g[k * 3 + 2]).toBeCloseTo(z, 1);
      expect(Math.abs(p.g[k * 3] - x)).toBeLessThan(0.1);
      expect(Math.abs(p.g[k * 3 + 1] - y)).toBeLessThan(0.1);
    }
  });

  it("offsets indices when merging", () => {
    const p = projectModel(buildHeritageModel(ring, 6, "house"), frame.toLngLat, origin);
    const q = projectModel(buildHeritageModel(ring, 6, "station"), frame.toLngLat, origin);
    const all = mergePacked([p, q]);
    const np = p.g.length / 3;
    expect(all.g.length).toBe(p.g.length + q.g.length);
    expect(all.f.length).toBe(p.f.length + q.f.length);
    expect(all.i.length).toBe(p.i.length + q.i.length);
    expect(Array.from(all.i.slice(0, p.i.length))).toEqual(Array.from(p.i));
    expect(Math.min(...all.i.slice(p.i.length))).toBe(np);
    expect(Math.max(...all.i)).toBeLessThan(all.g.length / 3);
    expect(Array.from(all.g.slice(p.g.length))).toEqual(Array.from(q.g));
    expect(mergePacked([]).i.length).toBe(0);
  });
});
