import { describe, expect, it } from "vitest";
import { nightTint } from "./nightLayer";

describe("nightTint", () => {
  it("is clear at noon, dusk blue at midnight, amber in between", () => {
    expect(nightTint(12).opacity).toBe(0);
    const night = nightTint(0);
    expect(night.opacity).toBeGreaterThan(0.3);
    expect(night.color).toBe("#26303a");
    const dawn = nightTint(6);
    expect(dawn.opacity).toBeGreaterThan(0);
    expect(dawn.opacity).toBeLessThan(night.opacity);
    expect(dawn.color).not.toBe(night.color);
  });
});
