import { describe, expect, it, vi } from "vitest";
import { PerfProfiler } from "./profiler";

describe("PerfProfiler", () => {
  it("starts and stops without throwing", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const p = new PerfProfiler();
    p.startCapture();
    const s = p.stopCapture();
    expect(s.frames).toBe(0);
    expect(s.longFrames.over100).toBe(0);
    vi.unstubAllGlobals();
  });
});
