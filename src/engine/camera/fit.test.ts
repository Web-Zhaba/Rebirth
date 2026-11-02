import { describe, expect, it } from "vitest";
import { FOV_Y_DEG } from "./camera";
import { fitBounds } from "./fit";

describe("fitBounds", () => {
  it("centres the box and frames its taller side", () => {
    const r = fitBounds([10, 47, 10.01, 47.01], 1000, 800, FOV_Y_DEG, 50, 5);
    expect(r.lat).toBeCloseTo(47.005, 9);
    expect(r.lng).toBeCloseTo(10.005, 9);
    // 0.01 deg of latitude is ~1112 m over 700 px; the view is 800 px tall.
    const mpp = 1111.95 / 700;
    expect(r.distance).toBeCloseTo((mpp * 800) / (2 * Math.tan((FOV_Y_DEG * Math.PI) / 360)), -1);
  });
  it("padding backs the camera off and minDistance floors it", () => {
    const a = fitBounds([10, 47, 10.01, 47.01], 1000, 800, FOV_Y_DEG, 0, 5).distance;
    const b = fitBounds([10, 47, 10.01, 47.01], 1000, 800, FOV_Y_DEG, 100, 5).distance;
    expect(b).toBeGreaterThan(a);
    expect(fitBounds([10, 47, 10.0001, 47.0001], 1000, 800, FOV_Y_DEG, 0, 500).distance).toBe(500);
  });
  it("wraps over the antimeridian", () => {
    const r = fitBounds([179, 0, -179, 1], 1000, 800, FOV_Y_DEG, 0, 5);
    expect(Math.abs(r.lng)).toBeCloseTo(180, 9);
  });
});
