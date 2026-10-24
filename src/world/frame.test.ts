import { describe, expect, it } from "vitest";
import { makeFrame } from "./frame";

describe("frame", () => {
  const f = makeFrame(59.12, 37.9);
  it("round-trips", () => {
    for (const [lng, lat] of [
      [38.01, 59.2],
      [37.9, 59.12],
      [37.2, 58.9],
    ]) {
      const [x, y] = f.toLocal(lng, lat);
      const [lng2, lat2] = f.toLngLat(x, y);
      expect(Math.abs(lng2 - lng)).toBeLessThan(1e-9);
      expect(Math.abs(lat2 - lat)).toBeLessThan(1e-9);
    }
  });
  it("1000 m north is about 0.00898 deg", () => {
    const [, lat] = f.toLngLat(0, 1000);
    expect(Math.abs((lat - 59.12) / 0.00898 - 1)).toBeLessThan(0.005);
  });
  it("1000 m east is about 0.01750 deg", () => {
    const [lng] = f.toLngLat(1000, 0);
    expect(Math.abs((lng - 37.9) / 0.0175 - 1)).toBeLessThan(0.005);
  });
});
