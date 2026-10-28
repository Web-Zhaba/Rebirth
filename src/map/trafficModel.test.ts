import { describe, expect, it } from "vitest";
import { trafficDataActive } from "./trafficModel";

describe("traffic overlay activation", () => {
  it("rebuilds traffic data only for the traffic overlay", () => {
    expect(trafficDataActive("traffic")).toBe(true);
    expect(trafficDataActive("none")).toBe(false);
    expect(trafficDataActive("well")).toBe(false);
    expect(trafficDataActive("value")).toBe(false);
  });
});
