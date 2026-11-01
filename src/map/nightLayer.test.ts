import { describe, expect, it } from "vitest";
import { nightTint } from "./nightLayer";
import { PALETTE } from "../ui/palette";

describe("nightTint", () => {
  it("is clear at noon, dusk blue at midnight, amber in between", () => {
    expect(nightTint(12).opacity).toBe(0);
    const night = nightTint(0);
    expect(night.opacity).toBeGreaterThan(0.3);
    // the world's own dusk color, so a palette change never reads as a broken night
    expect(night.color).toBe(PALETTE.dusk);
    const dawn = nightTint(6);
    expect(dawn.opacity).toBeGreaterThan(0);
    expect(dawn.opacity).toBeLessThan(night.opacity);
    expect(dawn.color).not.toBe(night.color);
  });
});
