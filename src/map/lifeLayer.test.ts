import { describe, expect, it } from "vitest";
import { lightOpacity, positionAt, type Trip } from "./lifeLayer";

const trip: Trip = {
  id: 1,
  kind: "walk",
  pts: [
    [0, 0],
    [100, 0],
    [100, 50],
  ],
  depart: 600,
  speed: 10, // 150 m total -> 15 min
};

describe("positionAt", () => {
  it("is null before departure and after arrival", () => {
    expect(positionAt(trip, 599)).toBeNull();
    expect(positionAt(trip, 616)).toBeNull();
  });
  it("starts and ends at the endpoints", () => {
    expect(positionAt(trip, 600)).toEqual([0, 0]);
    const end = positionAt(trip, 615)!;
    expect(end[0]).toBeCloseTo(100);
    expect(end[1]).toBeCloseTo(50);
  });
  it("interpolates along segments and around corners", () => {
    const a = positionAt(trip, 605)!;
    expect(a[0]).toBeCloseTo(50);
    expect(a[1]).toBeCloseTo(0);
    const b = positionAt(trip, 612)!;
    expect(b[0]).toBeCloseTo(100);
    expect(b[1]).toBeCloseTo(20);
  });
  it("handles trips crossing midnight", () => {
    const late: Trip = { ...trip, depart: 1435 };
    const p = positionAt(late, 3)!; // 8 min after departure -> 80 m
    expect(p[0]).toBeCloseTo(80);
    expect(positionAt(late, 20)).toBeNull();
  });
  it("is null for degenerate trips", () => {
    expect(positionAt({ ...trip, pts: [[0, 0]] }, 600)).toBeNull();
    expect(positionAt({ ...trip, speed: 0 }, 600)).toBeNull();
    expect(positionAt({ ...trip, pts: [[1, 1], [1, 1]] }, 600)).toBeNull();
  });
});

describe("lightOpacity", () => {
  it("is off by day and on at night", () => {
    expect(lightOpacity("house", 12)).toBe(0);
    expect(lightOpacity("house", 2)).toBeGreaterThan(0.5);
    expect(lightOpacity("house", 20.5)).toBeGreaterThan(0.3);
  });
  it("lights workplaces only until 21:00", () => {
    expect(lightOpacity("work", 20.5)).toBeGreaterThan(0);
    expect(lightOpacity("work", 21.5)).toBe(0);
    expect(lightOpacity("work", 3)).toBe(0);
  });
});
