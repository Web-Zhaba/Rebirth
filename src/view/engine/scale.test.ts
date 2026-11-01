import { describe, expect, it } from "vitest";
import { FOV_DEG, metersPerPixel, zoomToDistance } from "../maplibre/zoom";
import { CLICK_TOLERANCE, distanceToMpp, isClick, markerTransform, mppToDistance } from "./scale";

describe("mpp <-> distance", () => {
  it("round-trips", () => {
    expect(mppToDistance(distanceToMpp(12345, 36.87, 900), 36.87, 900)).toBeCloseTo(12345, 6);
  });
  it("agrees with MapLibre's zoom relation", () => {
    const zoom = 14.3;
    const lat = 55;
    const h = 800;
    const d = zoomToDistance(zoom, lat, h);
    expect(distanceToMpp(d, FOV_DEG, h)).toBeCloseTo(metersPerPixel(zoom, lat), 6);
  });
  it("is linear in distance and survives a zero-height canvas", () => {
    expect(distanceToMpp(2000, 40, 600)).toBeCloseTo(2 * distanceToMpp(1000, 40, 600), 9);
    expect(Number.isFinite(distanceToMpp(1000, 40, 0))).toBe(true);
  });
});

describe("click vs drag", () => {
  it("accepts a press that stayed within the tolerance", () => {
    expect(isClick([10, 10], [10 + CLICK_TOLERANCE, 10])).toBe(true);
    expect(isClick([10, 10], [12, 12])).toBe(true);
  });
  it("rejects a drag", () => {
    expect(isClick([10, 10], [14, 10])).toBe(false);
    expect(isClick([0, 0], [3, 3])).toBe(false);
  });
  it("lets a click without a press through", () => {
    expect(isClick(null, [5, 5])).toBe(true);
  });
});

describe("marker anchor", () => {
  it("pin sits on its tip, custom elements on their centre", () => {
    expect(markerTransform(100, 50, "bottom")).toContain("-100%");
    expect(markerTransform(100, 50, "center")).toContain("-50%)");
    expect(markerTransform(100, 50, "center")).not.toContain("-100%");
  });
});
