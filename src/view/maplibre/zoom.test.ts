import { describe, expect, it } from "vitest";
import { mppAtZoom } from "../view";
import { distanceToZoom, goalZoom, metersPerPixel, mppToZoom, zoomToDistance } from "./zoom";

describe("zoom <-> camera scale", () => {
  it("zoom, distance and mpp round-trip", () => {
    for (const lat of [0, 45, 59.2])
      for (const z of [2, 11.5, 14.5, 18]) {
        expect(distanceToZoom(zoomToDistance(z, lat, 720), lat, 720)).toBeCloseTo(z, 9);
        expect(mppToZoom(metersPerPixel(z, lat), lat)).toBeCloseTo(z, 9);
      }
  });

  it("one zoom step halves metres per pixel and the eye distance", () => {
    expect(metersPerPixel(15, 50) / metersPerPixel(16, 50)).toBeCloseTo(2, 12);
    expect(zoomToDistance(15, 50, 720) / zoomToDistance(16, 50, 720)).toBeCloseTo(2, 12);
  });

  it("the game's reference scale matches MapLibre at the reference latitude", () => {
    expect(mppAtZoom(14)).toBeCloseTo(metersPerPixel(14, 55), 9);
  });

  it("a goal by distance or by mpp resolves to the same zoom", () => {
    const lat = 55;
    const z = 15.25;
    expect(goalZoom({ distance: zoomToDistance(z, lat, 800) }, lat, 800)).toBeCloseTo(z, 9);
    expect(goalZoom({ mpp: metersPerPixel(z, lat) }, lat, 800)).toBeCloseTo(z, 9);
  });

  it("a goal without a scale leaves the zoom alone", () => {
    expect(goalZoom({}, 55, 800)).toBeUndefined();
  });

  it("the same mpp is a different zoom at another latitude", () => {
    expect(mppToZoom(5, 30)).toBeGreaterThan(mppToZoom(5, 60));
  });
});
