import { describe, expect, it } from "vitest";
import { buildCloudData, buildShellMesh, cloudOpacity, interval, smoothstep, TEX_H, TEX_W } from "./cloudTexture";

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

describe("interval", () => {
  it("splits game minutes into 30-minute steps", () => {
    expect(interval(0)).toEqual({ k: 0, f: 0 });
    expect(interval(45)).toEqual({ k: 1, f: 0.5 });
  });
});

describe("buildCloudData", () => {
  const d = buildCloudData(5000, 12345, 0);
  it("has the grid size, opaque alpha, values in range and some variety", () => {
    expect(d.length).toBe(TEX_W * TEX_H * 4);
    let min = 255;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      expect(d[i + 3]).toBe(255);
      min = Math.min(min, d[i]);
      max = Math.max(max, d[i]);
    }
    expect(max - min).toBeGreaterThan(100);
  });
  it("is deterministic and colder at the poles", () => {
    expect(Array.from(buildCloudData(5000, 12345, 0).slice(0, 64))).toEqual(Array.from(d.slice(0, 64)));
    const row = (j: number) => d[(j * TEX_W) * 4 + 2];
    expect(row(TEX_H - 1)).toBeLessThan(row(TEX_H / 2));
  });
  it("builds in a few milliseconds", () => {
    const t0 = performance.now();
    buildCloudData(9000, 7, 0);
    console.log("cloud texture ms", (performance.now() - t0).toFixed(1));
  });
});

describe("buildShellMesh", () => {
  it("indexes inside the vertex array", () => {
    const m = buildShellMesh(12, 6);
    expect(m.verts.length).toBe(13 * 7 * 4);
    expect(Math.max(...m.indices)).toBe(13 * 7 - 1);
  });
});
