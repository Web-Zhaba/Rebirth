import { describe, expect, it } from "vitest";
import { SCENES } from "./scenes";
import { summarize } from "./stats";

describe("bench scenes", () => {
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
