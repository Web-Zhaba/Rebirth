import { describe, expect, it } from "vitest";
import { inertiaStart, inertiaStep, PAN_INERTIA, VelocityTracker } from "./inertia";

describe("VelocityTracker", () => {
  it("averages over the window", () => {
    const t = new VelocityTracker();
    t.push(0, 0, 0);
    t.push(50, 10, 0);
    t.push(100, 20, 5);
    expect(t.velocity(100, 2)).toEqual([200, 50]);
  });
  it("is zero when the pointer rested before release", () => {
    const t = new VelocityTracker();
    t.push(0, 0);
    t.push(50, 100);
    expect(t.velocity(400, 1)).toEqual([0]);
  });
  it("drops samples older than the window", () => {
    const t = new VelocityTracker();
    t.push(0, 0);
    t.push(1000, 500);
    t.push(1100, 600);
    expect(t.velocity(1100, 1)[0]).toBeCloseTo(1000, 5);
  });
});

describe("inertia", () => {
  it("scales by linearity and caps the speed", () => {
    const v = inertiaStart([3000, 0], PAN_INERTIA)!;
    expect(v[0]).toBeCloseTo(900, 6);
    expect(inertiaStart([100000, 0], PAN_INERTIA)![0]).toBeCloseTo(1400, 6);
    expect(inertiaStart([2, 0], PAN_INERTIA)).toBeNull();
  });
  it("travels v^2 / 2a in total and stops", () => {
    let v = [900, 0];
    let x = 0;
    for (let i = 0; i < 200; i++) {
      const s = inertiaStep(v, 16, 2500);
      x += s.delta[0];
      v = s.v;
      if (s.done) break;
    }
    expect(x).toBeCloseTo((900 * 900) / 5000, 4);
    expect(v[0]).toBeCloseTo(0, 9);
  });
});
