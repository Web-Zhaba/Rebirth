import { describe, expect, it } from "vitest";
import { CUBE_SIZE } from "./constants";
import { cloudOpacity, effectiveQuality, FLASH_FRAME_MS, MARCH_CLOCK_MIN, needsMarch, PRESETS, smoothstep, targetSize, type MadeMarch } from "./cloudQuality";

describe("presets", () => {
  it("match the plan table", () => {
    expect(PRESETS.low).toEqual({ scale: 0.35, steps: 24, lightSteps: 3, detail: false });
    expect(PRESETS.medium).toEqual({ scale: 0.5, steps: 48, lightSteps: 5, detail: true });
    expect(PRESETS.high).toEqual({ scale: 0.75, steps: 80, lightSteps: 6, detail: true });
    expect(CUBE_SIZE).toEqual({ low: 128, medium: 192, high: 192 });
  });
  it("scales the drawing buffer and never goes below one pixel", () => {
    expect(targetSize(1920, 1080, 0.5)).toEqual({ width: 960, height: 540 });
    expect(targetSize(1001, 7, 0.35)).toEqual({ width: 350, height: 2 });
    expect(targetSize(0, 0, 0.5)).toEqual({ width: 1, height: 1 });
  });
  it("steps high down to medium without float targets", () => {
    expect(effectiveQuality("high", false)).toBe("medium");
    expect(effectiveQuality("high", true)).toBe("high");
    expect(effectiveQuality("low", false)).toBe("low");
  });
});

describe("cloudOpacity", () => {
  it("is on far out, off close up, smooth between", () => {
    expect(cloudOpacity(1.5)).toBe(1);
    expect(cloudOpacity(5)).toBe(1);
    expect(cloudOpacity(6.5)).toBe(0);
    expect(cloudOpacity(10)).toBe(0);
    const mid = cloudOpacity(5.75);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});

describe("needsMarch", () => {
  const matrix = Float64Array.from({ length: 16 }, (_, i) => i + 0.5);
  const key = { matrix, width: 960, height: 540, clock: 1000, version: 3, quality: "medium" as const, generation: 0, flash: false };
  const made: MadeMarch = { ...key, at: 1000 };
  it("marches the first time and then reuses the target", () => {
    expect(needsMarch(null, key, false, 1000)).toBe(true);
    expect(needsMarch(made, { ...key, matrix: Float32Array.from(matrix) }, false, 1500)).toBe(false);
  });
  it("marches when the view, size, quality, uploads or context changed", () => {
    const m2 = Float64Array.from(matrix);
    m2[5] += 1e-9;
    expect(needsMarch(made, { ...key, matrix: m2 }, false, 1100)).toBe(true);
    expect(needsMarch(made, { ...key, width: 961 }, false, 1100)).toBe(true);
    expect(needsMarch(made, { ...key, quality: "low" }, false, 1100)).toBe(true);
    expect(needsMarch(made, { ...key, version: 4 }, false, 1100)).toBe(true);
    expect(needsMarch(made, { ...key, generation: 1 }, false, 1100)).toBe(true);
  });
  it("marches when the clock moved more than five game minutes", () => {
    expect(needsMarch(made, { ...key, clock: 1000 + MARCH_CLOCK_MIN }, false, 1100)).toBe(false);
    expect(needsMarch(made, { ...key, clock: 1000 + MARCH_CLOCK_MIN + 0.1 }, false, 1100)).toBe(true);
    expect(needsMarch(made, { ...key, clock: 1000 - 6 }, false, 1100)).toBe(true);
  });
  it("throttles flashes to 30 fps and wipes the last flash", () => {
    const flashing = { ...made, flash: true };
    expect(needsMarch(flashing, { ...key, flash: true }, true, 1000 + FLASH_FRAME_MS - 1)).toBe(false);
    expect(needsMarch(flashing, { ...key, flash: true }, true, 1000 + FLASH_FRAME_MS)).toBe(true);
    expect(needsMarch(made, { ...key, flash: true }, true, 1000 + FLASH_FRAME_MS)).toBe(true);
    expect(needsMarch(flashing, key, false, 1001)).toBe(true);
  });
});
