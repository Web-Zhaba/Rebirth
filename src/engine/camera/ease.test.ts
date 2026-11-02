import { describe, expect, it } from "vitest";
import { bezier, easeFly, easeOutCubic } from "./ease";

describe("easing", () => {
  it("hits the end points and is monotonic", () => {
    let prev = 0;
    for (let i = 0; i <= 50; i++) {
      const v = easeFly(i / 50);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(easeFly(0)).toBe(0);
    expect(easeFly(1)).toBe(1);
  });
  it("linear bezier is the identity", () => {
    const f = bezier(0, 0, 1, 1);
    expect(f(0.3)).toBeCloseTo(0.3, 5);
  });
  it("ease-out cubic starts fast", () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 9);
  });
});
