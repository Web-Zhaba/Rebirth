import { describe, expect, it } from "vitest";
import { SCENES, distanceToZoom, metersPerPixel, zoomToDistance } from "./scenes";
import { summarize } from "./stats";

describe("bench scenes", () => {
  it("zoom and distance round-trip", () => {
    for (const z of [2, 11.5, 14.5, 18]) expect(distanceToZoom(zoomToDistance(z, 55, 720), 55, 720)).toBeCloseTo(z, 9);
  });

  it("one zoom step halves metres per pixel", () => {
    expect(metersPerPixel(15, 0) / metersPerPixel(16, 0)).toBeCloseTo(2, 12);
  });

  it("scenes give finite cameras over the whole path", () => {
    for (const s of SCENES)
      for (const t of [0, 0.5, 1]) {
        const c = s.at(t);
        expect(Number.isFinite(c.lat + c.lng + c.distance + c.heading + c.pitch)).toBe(true);
      }
  });

  it("summarizes frame times", () => {
    expect(summarize([4, 1, 3, 2])).toMatchObject({ frames: 4, median: 3, max: 4, mean: 2.5 });
  });
});
