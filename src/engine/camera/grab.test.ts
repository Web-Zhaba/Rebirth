import { describe, expect, it } from "vitest";
import { buildView, rayDir, type CameraState } from "./camera";
import { pickGround } from "./pick";
import { panByPixels, rotateByPixels, solveGrab, zoomAbout, type PickFn } from "./grab";

const W = 1000;
const H = 700;
const flat = (): number => 0;
const hill = (lat: number, lng: number): number => 400 * Math.exp(-(((lat - 47.27) * 111_000) ** 2 + ((lng - 11.4) * 76_000) ** 2) / (2 * 2000 ** 2));

const mk = (groundAt: (a: number, b: number) => number): PickFn => (s, px, py) => {
  const v = buildView(s, W, H, groundAt);
  return pickGround(v.eye, rayDir(v, (px / W) * 2 - 1, 1 - (py / H) * 2), groundAt);
};

const cam = (o: Partial<CameraState> = {}): CameraState => ({ lat: 47.27, lng: 11.4, h: 0, distance: 9000, heading: 20, pitch: 60, fovY: 36.87, ...o });

describe("solveGrab", () => {
  for (const [name, ground] of [["flat", flat], ["hilly", hill]] as const) {
    it(`keeps the grabbed ground under the cursor (${name})`, () => {
      const pick = mk(ground);
      const s = cam({ h: ground(47.27, 11.4) });
      const g = pick(s, 400, 300)!;
      expect(g).not.toBeNull();
      expect(solveGrab(s, g, 560, 380, pick)).toBe(true);
      const after = pick(s, 560, 380)!;
      expect((after.lat - g.lat) * 111_000).toBeCloseTo(0, 1);
      expect((after.lng - g.lng) * 76_000).toBeCloseTo(0, 1);
      // and the camera did move
      expect(Math.abs(s.lat - 47.27) + Math.abs(s.lng - 11.4)).toBeGreaterThan(1e-4);
    });
  }

  it("works on the far globe at pitch 0", () => {
    const pick = mk(flat);
    const s = cam({ distance: 12_000_000, pitch: 0, heading: 0 });
    const g = pick(s, 500, 350)!;
    const g2 = pick(s, 600, 300)!;
    expect(solveGrab(s, g2, 500, 350, pick)).toBe(true);
    const after = pick(s, 500, 350)!;
    expect(after.lat).toBeCloseTo(g2.lat, 4);
    expect(after.lng).toBeCloseTo(g2.lng, 4);
    expect(g).not.toBeNull();
  });
});

describe("zoomAbout", () => {
  it("keeps the point under the cursor while the distance changes", () => {
    const pick = mk(flat);
    const s = cam();
    const g = pick(s, 800, 200)!;
    zoomAbout(s, 0.5, g, 800, 200, pick);
    expect(s.distance).toBeCloseTo(4500, 6);
    const after = pick(s, 800, 200)!;
    expect((after.lat - g.lat) * 111_000).toBeCloseTo(0, 1);
    expect((after.lng - g.lng) * 76_000).toBeCloseTo(0, 1);
  });
  it("respects the distance clamp", () => {
    const s = cam({ distance: 6 });
    zoomAbout(s, 0.1, null, 0, 0, mk(flat));
    expect(s.distance).toBe(5);
  });
});

describe("pixel fallbacks", () => {
  it("drag right moves the map right, i.e. the target west when heading north", () => {
    const s = cam({ heading: 0, pitch: 0 });
    panByPixels(s, 100, 0, H);
    expect(s.lng).toBeLessThan(11.4);
    expect(s.lat).toBeCloseTo(47.27, 9);
  });
  it("rotate: drag right turns heading up, drag up tilts further, pitch clamps", () => {
    const s = cam({ heading: 10, pitch: 78 });
    rotateByPixels(s, 10, -20);
    expect(s.heading).toBeCloseTo(18, 9);
    expect(s.pitch).toBe(80);
  });
});
